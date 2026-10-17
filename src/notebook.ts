import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import type { Logger } from 'cortico/core/types.ts';

/**
 * 智能体私人笔记本桥接键（由 cortico-world-memory 在 start() 时登记、stop() 时清除）。
 * 零硬依赖：记忆插件未安装/未启用时该键不存在，自动回退到原生 JSONL。
 */
const BRIDGE_KEY = 'cortico:memory:notebook';

export interface NotebookEntry {
  id: string;
  text: string;
  ts: number;
}

/** 记忆插件暴露的最小笔记本接口（其实现直接落到 MemoryBase 的 'qq' scope）。 */
interface MemoryNotebookBridge {
  kind: 'memory';
  save(text: string): number;
  list(): Array<{ text: string; ts: number }>;
  get(index: number): { text: string; ts: number } | null;
  forget(index: number): boolean;
}

function getBridge(): MemoryNotebookBridge | null {
  const b = (globalThis as Record<string, unknown>)[BRIDGE_KEY];
  if (b && typeof (b as MemoryNotebookBridge).save === 'function') return b as MemoryNotebookBridge;
  return null;
}

/**
 * 智能体私人笔记本：让 AI 记录自己想记的东西。
 * - 记忆插件(cortico-world-memory)启用时，直接写入其笔记库('qq' scope)，享受常驻环境提示词 + 混合检索。
 * - 否则落到本插件 dataDir/notebook.jsonl（原生），用稳定字符串 id。
 * 后端在每次调用时惰性判定，与 world 启动顺序无关；记忆插件中途启停也能正确切换。
 */
export class Notebook {
  private readonly file: string;

  constructor(private readonly dataDir: string, private readonly log?: Logger) {
    this.file = join(dataDir, 'notebook.jsonl');
  }

  /** 当前实际使用的后端（用于向 AI 反馈它记到了哪里）。 */
  get backend(): 'memory' | 'native' {
    return getBridge() ? 'memory' : 'native';
  }

  private loadNative(): NotebookEntry[] {
    try {
      const raw = readFileSync(this.file, 'utf8');
      return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as NotebookEntry);
    } catch {
      return [];
    }
  }

  private saveNative(entries: NotebookEntry[]): void {
    const body = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '');
    writeFileSync(this.file, body, 'utf8');
  }

  async save(text: string): Promise<{ id: string; backend: string }> {
    const t = text.trim();
    if (!t) return { id: '', backend: this.backend };
    const bridge = getBridge();
    if (bridge) {
      const idx = bridge.save(t);
      this.log?.info?.('笔记本写入记忆插件 qq scope #' + idx);
      return { id: String(idx), backend: 'memory' };
    }
    const entries = this.loadNative();
    const id = `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    entries.push({ id, text: t, ts: Date.now() });
    this.saveNative(entries);
    return { id, backend: 'native' };
  }

  async list(): Promise<Array<NotebookEntry & { seq?: number }>> {
    const bridge = getBridge();
    if (bridge) {
      return bridge.list().map((n, i) => ({ id: String(i), text: n.text, ts: n.ts, seq: i + 1 }));
    }
    return this.loadNative();
  }

  async get(id: string): Promise<NotebookEntry | null> {
    const bridge = getBridge();
    if (bridge) {
      const e = bridge.get(Number(id));
      return e ? { id, text: e.text, ts: e.ts } : null;
    }
    return this.loadNative().find((e) => e.id === id) ?? null;
  }

  async forget(id: string): Promise<boolean> {
    const bridge = getBridge();
    if (bridge) {
      return bridge.forget(Number(id));
    }
    const entries = this.loadNative();
    const i = entries.findIndex((e) => e.id === id);
    if (i < 0) return false;
    entries.splice(i, 1);
    this.saveNative(entries);
    return true;
  }
}
