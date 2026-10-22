import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import type { Logger } from 'cortico/core/types.ts';

/**
 * 智能体私人笔记本桥接键（由 cortico-world-memory 在 start() 时登记、stop() 时清除）。
 *
 * **这是一个可选增强，不是依赖。** 本扩展不 import 记忆插件、也不要求它存在：
 * - 桥接键只在记忆插件启用时才有；未安装/未启用时下面每个方法都走原生 JSONL 后端，
 *   功能完整可用（只是没有混合检索与常驻环境提示词）。
 * - 后端在**每次调用时惰性判定**，与 World 启动顺序无关，记忆插件中途启停也能即时切换。
 *
 * 为什么用 globalThis 桥接而不是事件流：框架的 `World` 契约里只有主循环回调
 * （onTurnEnded / onEventsSettled / onBatchEnd / onIdle 等），**没有 World 之间的
 * 发布/订阅通道**，无法把「写入另一 World 的存储」表达成事件。因此这里退而采用
 * 最小的能力协商：被调用方主动登记一个窄接口，调用方按需探测。
 *
 * 副作用面很小：桥接接口只有 save/list/get/forget 四个纯数据方法，不暴露对方内部状态，
 * 记忆插件停止时键被删除，本扩展自动回到原生后端。
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
