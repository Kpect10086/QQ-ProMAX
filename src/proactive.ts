import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'cortico/core/types.ts';

/** 按会话冷却、配额与作息投递主模型交流事件；正文和发送由主模型决定。 */
export interface ProactiveTarget {
  address: string; // 'private:123' | 'group:456'
  kind: 'private' | 'group';
  label: string;
}

/** 作息配置：按真实时间切换「睡眠/午休/活跃」状态。 */
export interface RoutineConfig {
  /** 是否启用作息。 */
  enabled: boolean;
  /** 睡眠时段开始（HH:MM 24h）。到 sleepEnd 之间为「睡眠」，不主动冒泡但可被动回复。 */
  sleepStart: string;
  /** 睡眠时段结束（HH:MM）。可早于 sleepStart 形成跨午夜（如 23:00→07:30）。 */
  sleepEnd: string;
  /** 午休/打盹时段开始（HH:MM），仅作状态注入，不屏蔽主动冒泡。 */
  lazyStart: string;
  /** 午休/打盹时段结束（HH:MM）。 */
  lazyEnd: string;
  /** 进入睡眠时播报文案：保留旧配置字段，交流事件不自动发送该文案。 */
  greetSleep: string;
  /** 离开睡眠（醒来）时播报文案：同上，兜底用。 */
  greetWake: string;
  /** 进入午休时播报文案：同上，兜底用。 */
  greetLazy: string;
}

/** 根据作息配置与当前时间算出所处时段（sleep 可跨午夜）。 */
export function routineSegment(cfg: RoutineConfig, now: Date = new Date()): 'sleep' | 'lazy' | 'active' {
  const toMin = (hhmm: string): number => {
    const [h, m] = hhmm.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const cur = now.getHours() * 60 + now.getMinutes();
  const s0 = toMin(cfg.sleepStart);
  const s1 = toMin(cfg.sleepEnd);
  const inSleep = s0 <= s1 ? cur >= s0 && cur < s1 : cur >= s0 || cur < s1;
  if (inSleep) return 'sleep';
  const l0 = toMin(cfg.lazyStart);
  const l1 = toMin(cfg.lazyEnd);
  if (l0 <= l1 && cur >= l0 && cur < l1) return 'lazy';
  return 'active';
}

export interface ProactiveConfig {
  enabled: boolean;
  /** 对哪些会话主动说话：private=仅私聊；group=仅群；both=都。 */
  mode: 'private' | 'group' | 'both';
  /** tick 周期（秒）。 */
  tickSec: number;
  /** 暖场时长（分钟）。 */
  warmupMin: number;
  /** stable 状态每 tick 发送概率（1/30）。 */
  stableChancePerTick: number;
  /** warmup 状态每 tick 发送概率（1/3）。 */
  warmupChance: number;
  /** 私聊两次主动消息最小间隔（秒）。 */
  privateCooldownSec: number;
  /** 群两次主动消息最小间隔（秒）。 */
  groupCooldownSec: number;
  /** 连续未回复多少条进入静默。 */
  unrepliedThreshold: number;
  /** 静默时长（小时）。 */
  silentHours: number;
  /** 每日交流事件上限（0=不限）。 */
  dailyQuota: number;
  /** 去重窗口：记住最近多少条主动消息避免重复。 */
  dedupWindow: number;
}

type AddrState = {
  firstSeen: number;
  lastSent: number;
  lastActivity?: number;
  activityVersion?: number;
  unreplied: number;
  silentUntil: number;
  state: 'warmup' | 'stable' | 'silent';
};

export interface ProactiveStatus {
  enabled: boolean;
  runState: '关' | '暖场' | '稳定' | '静默';
  dailyCount: number;
  dailyQuota: number;
  targets: number;
  recent: string[];
  perAddr: Record<string, { state: string; unreplied: number; silentUntil: number; lastSent: number }>;
}

export class ProactiveSpeaker {
  private readonly cfg: ProactiveConfig;
  private readonly log: Logger;
  private readonly dataDir: string;
  private readonly stateFile: string;
  private readonly request: (target: ProactiveTarget, reason: string) => Promise<boolean>;
  private readonly getTargets: () => ProactiveTarget[];
  private readonly isPaused?: () => boolean;
  private readonly isQuiet?: () => boolean;
  private readonly routine?: RoutineConfig;

  private readonly states = new Map<string, AddrState>();
  private readonly generating = new Set<string>();
  private recent: string[] = [];
  private dailyCount = 0;
  private dayStart = startOfDay();
  private firstMessageSent = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private runState: ProactiveStatus['runState'] = '稳定';
  /** 上次记录的作息时段（用于检测时段切换并播报）。首次运行（无存档）不播报。 */
  private lastRoutineSegment: 'sleep' | 'lazy' | 'active' | undefined;

  constructor(opts: {
    cfg: ProactiveConfig;
    log: Logger;
    dataDir: string;
    request: (target: ProactiveTarget, reason: string) => Promise<boolean>;
    getTargets: () => ProactiveTarget[];
    /** 总开关是否暂停；提供时暂停则 tick 直接停手。 */
    isPaused?: () => boolean;
    isQuiet?: () => boolean;
      /** 作息配置：睡眠段暂停主动冒泡 + 时段切换播报。 */
    routine?: RoutineConfig;
  }) {
    this.cfg = opts.cfg;
    this.log = opts.log.child('proactive');
    this.dataDir = opts.dataDir;
    this.stateFile = opts.dataDir ? join(opts.dataDir, 'proactive-state.json') : '';
    this.request = opts.request;
    this.getTargets = opts.getTargets;
    this.isPaused = opts.isPaused;
    this.isQuiet = opts.isQuiet;
    this.routine = opts.routine;
    this.load();
  }

  start(): void {
    if (!this.cfg.enabled) {
      this.runState = '关';
      return;
    }
    this.runState = '暖场';
    this.timer = setInterval(() => void this.tick().catch((e) => this.log.warn('主动调度 tick 异常', { err: String(e) })), Math.max(5, this.cfg.tickSec) * 1000);
    this.log.info('主动说话调度器已启动', { tickSec: this.cfg.tickSec, mode: this.cfg.mode });
  }

  stop(): void {
    this.runState = '关';
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.save();
  }

  /** 收到对方消息时调用：重置该会话的未回复计数并解除静默。 */
  notifyReply(address: string): void {
    const s = this.ensure(address);
    s.lastActivity = Date.now();
    s.activityVersion = (s.activityVersion ?? 0) + 1;
    s.unreplied = 0;
    s.silentUntil = 0;
    if (s.state === 'silent') s.state = 'stable';
    this.save();
  }

  notifySent(address: string, at = Date.now()): void {
    const s = this.ensure(address);
    s.lastSent = Math.max(s.lastSent, at);
    s.activityVersion = (s.activityVersion ?? 0) + 1;
    this.save();
  }

  status(targets = this.getTargets().length): ProactiveStatus {
    const perAddr: ProactiveStatus['perAddr'] = {};
    for (const [addr, s] of this.states) {
      perAddr[addr] = { state: s.state, unreplied: s.unreplied, silentUntil: s.silentUntil, lastSent: s.lastSent };
    }
    return {
      enabled: this.cfg.enabled,
      runState: this.runState,
      dailyCount: this.dailyCount,
      dailyQuota: this.cfg.dailyQuota,
      targets,
      recent: this.recent.slice(-10),
      perAddr,
    };
  }

  /** 控制台手动触发一次交流事件，遵守配额与冷却。 */
  async trigger(address?: string): Promise<string> {
    if (!this.cfg.enabled) return '主动说话未开启。';
    if (this.isQuiet?.()) return '静默时段停止主动发言，仅允许私聊回复。';
    const targets = this.getTargets();
    let pick: ProactiveTarget | undefined;
    if (address) pick = targets.find((t) => t.address === address);
    else pick = this.pickRandom(targets);
    if (!pick) return '当前没有可主动说话的监听会话（检查 groups/privates 与 mode）。';
    const ok = await this.emit(pick);
    return ok ? `已向 ${pick.label} 投递一次主模型交流事件。` : '本次未投递（暂停、静默、配额或冷却限制）。';
  }

  private async tick(): Promise<void> {
    if (!this.cfg.enabled) return;
    if (this.isPaused?.()) return;
    if (this.isQuiet?.()) { this.runState = '静默'; return; }
    // 作息：睡眠段不主动冒泡，并在时段切换时主动播报（去睡/醒/午休）。
    if (this.routine?.enabled) {
      const seg = routineSegment(this.routine);
      if (seg !== this.lastRoutineSegment) {
        if (this.lastRoutineSegment !== undefined) await this.announceRoutine(this.lastRoutineSegment, seg);
        this.lastRoutineSegment = seg;
        this.save();
      }
      if (seg === 'sleep') {
        this.runState = '稳定';
        return; // 睡眠段：不主动冒泡（被找仍会被动回复，由对话逻辑处理）
      }
    }
    this.rolloverDay();
    const targets = this.getTargets();
    if (!targets.length) {
      this.runState = '稳定';
      return;
    }
    let anyWarmup = false;
    let anySilent = false;
    let anyStable = false;
    for (const t of targets) {
      const s = this.ensure(t.address);
      const st = this.evalState(s);
      if (st === 'warmup') anyWarmup = true;
      else if (st === 'silent') anySilent = true;
      else anyStable = true;

      const cooldown = t.kind === 'private' ? this.cfg.privateCooldownSec : this.cfg.groupCooldownSec;
      if (st === 'silent') continue;
      if (this.cfg.dailyQuota > 0 && this.dailyCount >= this.cfg.dailyQuota) continue;
      if (Date.now() - Math.max(s.lastSent, s.lastActivity ?? 0) < cooldown * 1000) continue;

      let p: number;
      if (st === 'warmup') {
        // 暖场保证至少发一条；其余按高概率
        p = this.firstMessageSent ? this.cfg.warmupChance : 1;
      } else {
        p = this.cfg.stableChancePerTick;
      }
      if (Math.random() < p) {
        await this.emit(t);
      }
    }
    // 汇总运行态（用于 badge）
    this.runState = anyWarmup ? '暖场' : anySilent ? '静默' : '稳定';
  }

  private async emit(t: ProactiveTarget, reason = '定时交流'): Promise<boolean> {
    if (this.isPaused?.() || this.isQuiet?.()) return false;
    if (this.generating.has(t.address)) return false;
    this.generating.add(t.address);
    try {
      const state = this.ensure(t.address);
      const cooldown = t.kind === 'private' ? this.cfg.privateCooldownSec : this.cfg.groupCooldownSec;
      this.rolloverDay();
      if (this.cfg.dailyQuota > 0 && this.dailyCount >= this.cfg.dailyQuota) return false;
      if (this.evalState(state) === 'silent' || Date.now() - Math.max(state.lastSent, state.lastActivity ?? 0) < cooldown * 1000) return false;
      if (!await this.request(t, reason)) return false;
      const clean = t.address;
      const s = this.ensure(t.address);
      s.lastSent = Date.now();
      s.unreplied += 1;
      if (s.state === 'warmup' && !this.firstMessageSent) this.firstMessageSent = true;
      this.pushRecent(clean);
      this.dailyCount += 1;
      this.save();
      this.log.info('已投递主动交流事件', { address: t.address, label: t.label, unreplied: s.unreplied, reason });
      return true;
    } finally {this.generating.delete(t.address);}
  }

  private evalState(s: AddrState): 'warmup' | 'stable' | 'silent' {
    const now = Date.now();
    if (s.silentUntil && now < s.silentUntil) {
      s.state = 'silent';
      return 'silent';
    }
    if (s.silentUntil && now >= s.silentUntil) {
      s.silentUntil = 0;
      s.unreplied = 0;
    }
    if (s.unreplied >= this.cfg.unrepliedThreshold) {
      s.state = 'silent';
      s.silentUntil = now + this.cfg.silentHours * 3600_000;
      this.log.info('会话连续未回复，进入静默', { firstSeen: s.firstSeen, until: new Date(s.silentUntil).toISOString() });
      return 'silent';
    }
    const warmupMs = this.cfg.warmupMin * 60_000;
    s.state = now - s.firstSeen < warmupMs ? 'warmup' : 'stable';
    return s.state;
  }

  private async announceRoutine(prev: 'sleep' | 'lazy' | 'active', seg: 'sleep' | 'lazy' | 'active'): Promise<void> {
    if (seg === 'active' && prev !== 'sleep') return;
    for (const target of this.getTargets()) {
      if (this.isPaused?.() || this.isQuiet?.()) return;
      await this.emit(target, '作息从 ' + prev + ' 切换到 ' + seg);
    }
  }

  private ensure(address: string): AddrState {
    let s = this.states.get(address);
    if (!s) {
      s = { firstSeen: Date.now(), lastSent: 0, unreplied: 0, silentUntil: 0, state: 'warmup' };
      this.states.set(address, s);
    } else if (Date.now() - s.firstSeen > 6 * 3600_000) {
      // 距上次启动超过 6 小时，重新暖场，保证本次进程至少主动冒泡一条
      s.firstSeen = Date.now();
    }
    return s;
  }

  private pickRandom(targets: ProactiveTarget[]): ProactiveTarget | undefined {
    if (!targets.length) return undefined;
    return targets[Math.floor(Math.random() * targets.length)];
  }

  private pushRecent(text: string): void {
    this.recent.push(text);
    const cap = Math.max(1, this.cfg.dedupWindow);
    while (this.recent.length > cap) this.recent.shift();
  }

  private rolloverDay(): void {
    const today = startOfDay();
    if (today !== this.dayStart) {
      this.dayStart = today;
      this.dailyCount = 0;
    }
  }

  private load(): void {
    if (!this.stateFile || !existsSync(this.stateFile)) return;
    try {
      const raw = JSON.parse(readFileSync(this.stateFile, 'utf8')) as {
        states?: Record<string, AddrState>;
        recent?: string[];
        dailyCount?: number;
        dayStart?: number;
        firstMessageSent?: boolean;
        lastRoutineSegment?: 'sleep' | 'lazy' | 'active';
      };
      for (const [k, v] of Object.entries(raw.states ?? {})) this.states.set(k, v);
      this.recent = Array.isArray(raw.recent) ? raw.recent : [];
      this.dailyCount = typeof raw.dailyCount === 'number' ? raw.dailyCount : 0;
      this.dayStart = typeof raw.dayStart === 'number' ? raw.dayStart : startOfDay();
      this.firstMessageSent = !!raw.firstMessageSent;
      this.lastRoutineSegment = raw.lastRoutineSegment;
    } catch {
      /* 忽略损坏的状态文件 */
    }
  }

  private save(): void {
    if (!this.stateFile) return;
    try {
      const obj = {
        states: Object.fromEntries(this.states),
        recent: this.recent,
        dailyCount: this.dailyCount,
        dayStart: this.dayStart,
        firstMessageSent: this.firstMessageSent,
        lastRoutineSegment: this.lastRoutineSegment,
      };
      writeFileSync(this.stateFile, JSON.stringify(obj), 'utf8');
    } catch {
      /* 忽略写入失败 */
    }
  }
}

function startOfDay(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
