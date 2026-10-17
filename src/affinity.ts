import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'cortico/core/types.ts';

/** 单个用户的好感度条目。score 可正可负，范围 [-100, 100]，初始 0=普通。 */
export interface AffinityEntry {
  /** 好感度（关系分）。正数=有好感，负数=反感，0=普通。 */
  score: number;
  /** 最近一次看到的昵称（列表展示用）。 */
  name?: string;
  /** 自由备注：关系标签 / 怎么认识的 / 关键事件。 */
  note?: string;
  /** 上次变动时间（epoch ms）。 */
  updatedAt: number;
  /** 上次变动原因。 */
  lastReason?: string;
}

const MIN = -100;
const MAX = 100;

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < MIN) return MIN;
  if (n > MAX) return MAX;
  return Math.round(n);
}

/** 好感度 → 关系状态描述（用于上下文注入与列表展示，并附带态度指引）。 */
export function affinityLabel(score: number): string {
  if (score >= 80) return '挚友（非常亲近，可以很放松很亲昵）';
  if (score >= 50) return '很要好（明显有好感，态度可以热络）';
  if (score >= 20) return '有好感（偏亲近，比普通朋友多一点）';
  if (score > -10 && score < 20) return '普通（中性，正常有礼貌地相处即可）';
  if (score <= -10 && score > -40) return '有点不爽（略带冷淡/客气，保持分寸）';
  if (score <= -40 && score > -70) return '反感（明显不待见，客气但疏远）';
  return '厌恶（很负面，尽量公事公办、保持距离，别硬凑）';
}

/**
 * 每用户独立的好感度存储：随互动上下浮动、可正可负，落盘到 dataDir/affinity.json。
 * key 为用户 QQ 号（字符串），跨群/私聊统一同一份。
 */
export class AffinityStore {
  private readonly file: string;
  private readonly log: Logger;
  private data = new Map<string, AffinityEntry>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(dataDir: string, log: Logger) {
    this.log = log;
    this.file = join(dataDir, 'affinity.json');
    this.load();
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return;
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { entries?: Record<string, AffinityEntry> };
      if (raw.entries && typeof raw.entries === 'object') {
        for (const [k, v] of Object.entries(raw.entries)) {
          if (v && typeof v.score === 'number') {
            this.data.set(k, { note: '', lastReason: '', ...v, score: clamp(v.score) });
          }
        }
      }
    } catch (e) {
      this.log.warn('好感度存储读取失败 ' + String(e));
    }
  }

  private scheduleFlush(): void {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 1500);
    if (typeof this.flushTimer.unref === 'function') this.flushTimer.unref();
  }

  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    try {
      const entries: Record<string, AffinityEntry> = {};
      for (const [k, v] of this.data) entries[k] = v;
      writeFileSync(this.file, JSON.stringify({ entries }, null, 2), 'utf8');
    } catch (e) {
      this.log.warn('好感度存储落盘失败 ' + String(e));
    }
  }

  get(key: string): AffinityEntry | undefined {
    return this.data.get(key);
  }

  /** 调整好感度（delta 可正可负，delta=0 仅用于记录昵称/备注）。返回调整后的条目。 */
  adjust(key: string, delta: number, reason?: string, name?: string): AffinityEntry {
    const cur = this.data.get(key) ?? { score: 0, name: key, updatedAt: 0 };
    if (Number.isFinite(delta) && delta !== 0) cur.score = clamp((cur.score ?? 0) + delta);
    if (name) cur.name = name;
    if (reason) cur.lastReason = reason;
    cur.updatedAt = Date.now();
    this.data.set(key, cur);
    this.scheduleFlush();
    return cur;
  }

  setNote(key: string, note: string, name?: string): AffinityEntry {
    const cur = this.data.get(key) ?? { score: 0, name: key ?? key, updatedAt: 0 };
    if (name) cur.name = name;
    cur.note = note;
    cur.updatedAt = Date.now();
    this.data.set(key, cur);
    this.scheduleFlush();
    return cur;
  }

  /** 列出全部，按好感度从高到低排序。 */
  list(): Array<{ key: string } & AffinityEntry> {
    return [...this.data.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.score - a.score);
  }

  count(): number {
    return this.data.size;
  }
}
