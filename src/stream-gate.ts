import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import type {OneBotMessage} from './types.ts';

/** Incoming chat waits on disk until the operator leaves live mode. */
export class QQStreamGate {
  private queue: OneBotMessage[];
  private timer: ReturnType<typeof setInterval> | null = null;
  private work: Promise<void> | null = null;
  private stopped = true;
  constructor(private readonly statusFile: () => string, private readonly file: string,
    private readonly paused: () => boolean, private readonly deliver: (event: OneBotMessage) => Promise<void>,
    private readonly onError: (error: unknown) => void) {
    const rows = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
    if (!Array.isArray(rows) || rows.some(row => row?.post_type !== 'message')) throw Error('Invalid deferred QQ messages');
    this.queue = rows;
  }
  get pending(): number {return this.queue.length;}
  blocked(): boolean {
    const file = this.statusFile();
    if (!file || !existsSync(file)) return false;
    try {return JSON.parse(readFileSync(file, 'utf8')).live === true;}
    catch {return true;}
  }
  defer(event: OneBotMessage): boolean {
    if (!this.blocked() && !this.queue.length) return false;
    const duplicate = event.message_id != null && this.queue.some(row => row.message_id === event.message_id
      && row.user_id === event.user_id && row.group_id === event.group_id);
    if (!duplicate) {this.queue.push(event); this.save();}
    return true;
  }
  start(): void {
    this.stopped = false;
    this.timer = setInterval(() => void this.drain(), 500); this.timer.unref?.();
  }
  async drain(): Promise<void> {
    if (this.stopped || this.work || this.blocked() || this.paused() || !this.queue.length) return;
    this.work = Promise.resolve().then(async () => {
      for (let count = 0; count < 32 && this.queue.length; count++) {
        if (this.stopped || this.blocked() || this.paused()) break;
        await this.deliver(this.queue[0]);
        this.queue.shift(); this.save();
      }
    }).catch(this.onError).finally(() => {this.work = null;});
    await this.work;
  }
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer); this.timer = null;
    await this.work;
  }
  private save(): void {
    mkdirSync(dirname(this.file), {recursive: true});
    writeFileSync(this.file + '.tmp', JSON.stringify(this.queue), 'utf8');
    renameSync(this.file + '.tmp', this.file);
  }
}
