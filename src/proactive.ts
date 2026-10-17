import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'cortico/core/types.ts';

/**
 * 主动说话调度器（移植自 fat-fish qq_bot_runtime 的 ProactiveSpeaker）。
 *
 * 后台每分钟 tick 一次，按状态机（warmup / stable / silent）决定是否向某个监听会话
 * 主动发一条闲聊消息：
 *  - warmup：接入后前 warmupMin 分钟，高概率（warmupChance）且保证至少发一条；
 *  - stable：之后低概率（stableChancePerTick）随机冒泡；
 *  - silent：某会话连续 unrepliedThreshold 条主动消息都未获回复，则静默 silentHours 小时。
 *
 * 自带：内容去重（最近若干条不重复）、每日配额、私聊/群冷却、跨重启持久化。
 * 与 MC 有关的能力（发现玩法/求助）已被剥离——QQ 插件没有游戏状态，只保留闲聊冒泡。
 */
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
  /** 进入睡眠时播报文案：LLM 生成失败时回退使用的兜底文案（正常由 LLM 现场生成，每次不固定）。空=无兜底。 */
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
  /** 生成主动消息用的 system 提示（闲聊风格）。 */
  systemPrompt: string;
  /** OpenAI 兼容 chat 端点（默认与视觉共用 OpenRouter）。 */
  endpoint: string;
  /** 取 API Key 的环境变量名。 */
  apiKeySecret: string;
  /** chat 模型名。 */
  model: string;
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
  /** 每日主动消息上限（0=不限）。 */
  dailyQuota: number;
  /** 去重窗口：记住最近多少条主动消息避免重复。 */
  dedupWindow: number;
  /** 主动消息与近期已发内容相似度上限（0~1，字符二元组 Jaccard）；超过则跳过，防同一话题反复换汤不换药。 */
  topicSimilarity: number;
  /** 主动消息生成时模型输出 token 上限（越大单次说得越长），页面可填，默认 2000。 */
  tokenLimit: number;
  /** 主动说话是否带对象昵称/称呼；关闭后不称呼对方具体名字，直接用「你」。默认 true。 */
  withNickname: boolean;
}

export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };
type AddrState = {
  firstSeen: number;
  lastSent: number;
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
  private readonly generate: (messages: ChatMsg[]) => Promise<string | null>;
  private readonly send: (address: string, text: string) => Promise<string>;
  private readonly getTargets: () => ProactiveTarget[];
  private readonly isPaused?: () => boolean;
  private readonly isQuiet?: () => boolean;
  private readonly systemPromptFor?: (target: ProactiveTarget) => string;
  private readonly routine?: RoutineConfig;
  /** 自称（第一人称昵称）。 */
  private readonly selfName: string;

  private readonly states = new Map<string, AddrState>();
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
    generate: (messages: ChatMsg[]) => Promise<string | null>;
    send: (address: string, text: string) => Promise<string>;
    getTargets: () => ProactiveTarget[];
    /** 总开关是否暂停；提供时暂停则 tick 直接停手。 */
    isPaused?: () => boolean;
    isQuiet?: () => boolean;
    /** 给定目标，返回主动说话用的系统提示词（含 Persona + 记忆）；不提供则回退 cfg.systemPrompt。 */
    systemPromptFor?: (target: ProactiveTarget) => string;
    /** 作息配置：睡眠段暂停主动冒泡 + 时段切换播报。 */
    routine?: RoutineConfig;
    /** 自称（第一人称昵称）。 */
    selfName?: string;
  }) {
    this.cfg = opts.cfg;
    this.log = opts.log.child('proactive');
    this.dataDir = opts.dataDir;
    this.stateFile = opts.dataDir ? join(opts.dataDir, 'proactive-state.json') : '';
    this.generate = opts.generate;
    this.send = opts.send;
    this.getTargets = opts.getTargets;
    this.isPaused = opts.isPaused;
    this.isQuiet = opts.isQuiet;
    this.systemPromptFor = opts.systemPromptFor;
    this.routine = opts.routine;
    this.selfName = (opts.selfName ?? '').trim() || '我';
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
    const s = this.states.get(address);
    if (!s) return;
    s.unreplied = 0;
    s.silentUntil = 0;
    if (s.state === 'silent') s.state = 'stable';
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

  /** 手动触发一次主动说话（工具用）。 */
  async trigger(address?: string): Promise<string> {
    if (!this.cfg.enabled) return '主动说话未开启。';
    if (this.isQuiet?.()) return '静默时段停止主动发言，仅允许私聊回复。';
    const targets = this.getTargets();
    let pick: ProactiveTarget | undefined;
    if (address) pick = targets.find((t) => t.address === address);
    if (!pick) pick = this.pickRandom(targets);
    if (!pick) return '当前没有可主动说话的监听会话（检查 groups/privates 与 mode）。';
    const ok = await this.emit(pick, true);
    return ok ? `已向 ${pick.label} 主动发送一条消息。` : '本次未发送（发送限制或生成失败）。';
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
      if (Date.now() - s.lastSent < cooldown * 1000) continue;

      let p: number;
      if (st === 'warmup') {
        // 暖场保证至少发一条；其余按高概率
        p = this.firstMessageSent ? this.cfg.warmupChance : 1;
      } else {
        p = this.cfg.stableChancePerTick;
      }
      if (Math.random() < p) {
        await this.emit(t, false);
      }
    }
    // 汇总运行态（用于 badge）
    this.runState = anyWarmup ? '暖场' : anySilent ? '静默' : '稳定';
  }

  private async emit(t: ProactiveTarget, forced: boolean): Promise<boolean> {
    if (this.isPaused?.() || this.isQuiet?.()) return false;
    const prompt = this.buildUserPrompt(t, forced);
    const system = this.systemPromptFor ? this.systemPromptFor(t) : this.cfg.systemPrompt;
    const text = await this.generate([
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ]);
    if (!text || !text.trim()) {
      this.log.warn('主动消息生成失败', { address: t.address });
      return false;
    }
    const clean = text.trim();
    // 内容去重：最近若干条里出现过则跳过（除非强制触发）
    if (!forced && this.recent.includes(clean)) {
      this.log.info('主动消息命中去重，跳过', { address: t.address });
      return false;
    }
    // 话题相似度：与近期已发内容过于相似则跳过（除非强制触发），防同一话题反复换汤不换药造成死循环
    if (!forced && this.cfg.topicSimilarity > 0) {
      const maxSim = this.recent.reduce((m, r) => Math.max(m, this.similarity(clean, r)), 0);
      if (maxSim > this.cfg.topicSimilarity) {
        this.log.info('主动消息与近期话题过于相似，跳过', { address: t.address, similarity: maxSim.toFixed(2) });
        this.pushRecent(clean);
        return false;
      }
    }
    if (this.isPaused?.() || this.isQuiet?.()) return false;
    const res = await this.send(t.address, clean);
    if (res.startsWith('[send blocked]') || res.startsWith('[send failed]')) return false;
    const s = this.ensure(t.address);
    s.lastSent = Date.now();
    s.unreplied += 1;
    if (s.state === 'warmup' && !this.firstMessageSent) this.firstMessageSent = true;
    this.pushRecent(clean);
    this.dailyCount += 1;
    this.save();
    this.log.info('已主动发送', { address: t.address, label: t.label, unreplied: s.unreplied, res: res.slice(0, 40) });
    return true;
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

  private buildUserPrompt(t: ProactiveTarget, forced: boolean): string {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const who = this.cfg.withNickname
      ? (t.kind === 'private' ? `私聊「${t.label}」` : `群「${t.label}」`)
      : (t.kind === 'private' ? '你正在私聊的对象' : '你正在群聊里的对象');
    const hint = forced ? '（这是被手动触发的主动发言，务必说点有意思的）' : '';
    const avoid = this.recent.length ? `\n不要和之前说过的内容重复：\n- ${this.recent.slice(-5).join('\n- ')}` : '';
    // 作息提示：午休段让主动冒泡更简短自然（睡眠段已在 tick 里被拦下，不会走到这里）。
    let routineNote = '';
    if (this.routine?.enabled && routineSegment(this.routine) === 'lazy') {
      routineNote = `\n（当前是${this.selfName}的午休/打盹时段，简短点更自然，别太耗能。）`;
    }
    return `现在是 ${hh}:${mm}。你要主动向${who}说一句话（闲聊/关心/抛个话题都行，别太生硬，也别太长，一两句即可）。${hint}${avoid}${routineNote}\n\n注意：只聊系统提示里「真实对话」里出现过的事；如果没什么可接的，就泛泛关心/问候，或返回空（什么都不说）。绝不要编造没发生过的事件或细节。`;
  }

  /** 时段切换时，向所有可主动说话的会话播报一句（去睡/醒/午休）。文案由 LLM 现场生成（带记忆），每次说法不固定；生成失败才回退到配置里的固定文案。 */
  private async announceRoutine(prev: 'sleep' | 'lazy' | 'active', seg: 'sleep' | 'lazy' | 'active'): Promise<void> {
    // 确定切换场景与兜底文案（兜底仅在 LLM 生成失败时使用）。
    let fallback = '';
    let scene = '';
    if (seg === 'sleep') { fallback = this.routine!.greetSleep; scene = '要去睡觉'; }
    else if (seg === 'lazy') { fallback = this.routine!.greetLazy; scene = '要去午休/打盹'; }
    else if (seg === 'active' && prev === 'sleep') { fallback = this.routine!.greetWake; scene = '刚睡醒起床'; }
    else return; // 其它切换（如 lazy→active）不播报

    for (const t of this.getTargets()) {
      const system = this.systemPromptFor ? this.systemPromptFor(t) : this.cfg.systemPrompt;
      const userPrompt =
        `【作息播报·${scene}】现在是我作息时段切换的时刻（从「${prev}」切到「${seg}」）。` +
        `请直接用你自己的口吻、自然地说一句这种场景下的话（比如${scene}时的随口感慨或碎碎念），一两句即可，别太长别太正式。` +
        `每次可以换种说法，不要每次都一模一样，也不要念固定套话。不要加「在吗」、不要客服腔。`;
      let line = '';
      try {
        const gen = await this.generate([{ role: 'system', content: system }, { role: 'user', content: userPrompt }]);
        line = (gen ?? '').trim();
      } catch (e) {
        this.log.warn('作息播报生成失败，回退固定文案', { address: t.address, err: String(e) });
      }
      if (!line) line = (fallback ?? '').trim();
      if (!line) continue;
      try {
        await this.send(t.address, line);
      } catch (e) {
        this.log.warn('作息播报发送失败', { address: t.address, err: String(e) });
      }
    }
    this.log.info('作息时段切换播报', { from: prev, to: seg });
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

  /** 字符二元组 Jaccard 相似度（0~1），忽略空白与大小写，用于话题换汤不换药的近似去重。 */
  private similarity(a: string, b: string): number {
    const ba = this.bigrams(a);
    const bb = this.bigrams(b);
    if (!ba.size || !bb.size) return 0;
    let inter = 0;
    for (const g of ba) if (bb.has(g)) inter++;
    return inter / (ba.size + bb.size - inter);
  }
  private bigrams(s: string): Set<string> {
    const t = s.replace(/\s+/g, '').toLowerCase();
    const set = new Set<string>();
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
    return set;
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
