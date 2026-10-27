import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import {randomUUID} from 'node:crypto';
import type { Logger } from 'cortico/core/types.ts';

export interface NotebookEntry {
  id: string;
  text: string;
  ts: number;
}

export class Notebook {
  private readonly file: string;

  constructor(private readonly dataDir: string, private readonly log?: Logger) {
    this.file = join(dataDir, 'notebook.jsonl');
  }

  /** 当前实际使用的后端（用于向 AI 反馈它记到了哪里）。 */
  get backend(): 'native' {
    return 'native';
  }

  private loadNative(): NotebookEntry[] {
    try {
      const raw = readFileSync(this.file, 'utf8');
      return raw.split('\n').filter(line => line.trim()).map((line) => {
        const entry = JSON.parse(line) as NotebookEntry;
        if (!entry || typeof entry.id !== 'string' || typeof entry.text !== 'string' || !Number.isFinite(entry.ts)) {
          throw new Error('笔记本条目损坏，保留原文件，未执行写入');
        }
        return entry;
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  private saveNative(entries: NotebookEntry[]): void {
    const body = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '');
    mkdirSync(this.dataDir || '.', {recursive: true});
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, body, 'utf8');
      renameSync(temporary, this.file);
    } finally {
      rmSync(temporary, {force: true});
    }
  }

  async save(text: string): Promise<{ id: string; backend: string }> {
    const t = text.trim();
    if (!t) return { id: '', backend: this.backend };
    const entries = this.loadNative();
    const id = `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    entries.push({ id, text: t, ts: Date.now() });
    this.saveNative(entries);
    return { id, backend: 'native' };
  }

  async list(): Promise<Array<NotebookEntry & { seq?: number }>> {
    return this.loadNative();
  }

  async get(id: string): Promise<NotebookEntry | null> {
    return this.loadNative().find((e) => e.id === id) ?? null;
  }

  async forget(id: string): Promise<boolean> {
    const entries = this.loadNative();
    const i = entries.findIndex((e) => e.id === id);
    if (i < 0) return false;
    entries.splice(i, 1);
    this.saveNative(entries);
    return true;
  }
}
