import type { Logger } from 'cortico/core/types.ts';
import type { QQWorldConfig } from './config.ts';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 被动视觉（可选，默认关闭）：下载图片并用 OpenAI 兼容端点（如 OpenRouter）VLM 描述。
 * 仅当 config.vision.enabled=true 时启用；失败时降级为占位，不阻塞事件。
 *
 * 与内置 qq 对齐的补强：
 * - 内容级去重（sha256 而非 url 摘要），并把去重表持久化到 dataDir，跨重启仍生效；
 * - 每次调用写用量归账（digest / 字节数 / 是否成功 / 耗时）到 <dataDir>/vision-accounting.jsonl；
 * - 暴露 viewImage()，供 qq_view_image 工具主动重看某张图。
 */
export class Vision {
  private readonly cfg: QQWorldConfig['vision'];
  private readonly log: Logger;
  /** sha256 -> 上次成功描述的时间（内容级去重，跨重启持久化）。 */
  private readonly seen = new Map<string, number>();
  private inflight = 0;
  private readonly queue: Array<{ url: string; expireAt: number; resolve: (s: string | null) => void }> = [];
  private readonly dataDir: string;
  private readonly seenFile: string;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(cfg: QQWorldConfig['vision'], log: Logger, dataDir = '') {
    this.cfg = cfg;
    this.log = log.child('vision');
    this.dataDir = dataDir;
    this.seenFile = dataDir ? join(dataDir, 'vision-seen.json') : '';
    this.loadSeen();
  }

  /** 注册一张待描述图片；并发已满则立即返回 null（本轮先不描述）。 */
  register(url: string, expireAt: number): Promise<string | null> | null {
    if (!this.cfg.enabled) return null;
    if (this.inflight >= this.cfg.maxConcurrent) return null;
    return new Promise<string | null>((resolve) => {
      this.queue.push({ url, expireAt, resolve });
      this.pump();
    });
  }

  private pump(): void {
    if (this.inflight >= this.cfg.maxConcurrent) return;
    const job = this.queue.shift();
    if (!job) return;
    this.inflight++;
    void this.process(job).finally(() => {
      this.inflight--;
      this.pump();
    });
  }

  private async process(job: { url: string; expireAt: number; resolve: (s: string | null) => void }): Promise<void> {
    const t0 = Date.now();
    try {
      const bytes = await this.fetchBytes(job.url);
      if (!bytes) {
        this.account('', 0, false, Date.now() - t0);
        return job.resolve(null);
      }
      const sha = createHash('sha256').update(bytes).digest('hex');
      const prev = this.seen.get(sha);
      if (prev !== undefined && Date.now() - prev < 6 * 3600_000) {
        this.account(sha, bytes.length, false, Date.now() - t0); // 内容去重：同图 6h 内不再算一次
        return job.resolve(null);
      }
      const desc = await this.describe(bytes);
      if (desc) {
        this.seen.set(sha, Date.now());
        this.saveSeenDebounced();
      }
      this.account(sha, bytes.length, !!desc, Date.now() - t0);
      job.resolve(desc);
    } catch (e) {
      this.log.warn('视觉描述失败', { err: String(e) });
      job.resolve(null);
    }
  }

  /** 主动重看一张图片（qq_view_image 用）：绕过去重，重新向 VLM 取描述。 */
  async viewImage(url: string): Promise<string | null> {
    const t0 = Date.now();
    const bytes = await this.fetchBytes(url);
    if (!bytes) {
      this.account('', 0, false, Date.now() - t0);
      return null;
    }
    const sha = createHash('sha256').update(bytes).digest('hex');
    const desc = await this.describe(bytes);
    this.account(sha, bytes.length, !!desc, Date.now() - t0);
    return desc;
  }

  private loadSeen(): void {
    if (!this.seenFile || !existsSync(this.seenFile)) return;
    try {
      const raw = JSON.parse(readFileSync(this.seenFile, 'utf8')) as Record<string, number>;
      for (const [k, v] of Object.entries(raw)) this.seen.set(k, v);
    } catch {
      /* 忽略损坏的归账文件 */
    }
  }

  private saveSeenDebounced(): void {
    if (!this.seenFile || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.saveSeen();
    }, 2000);
  }

  private saveSeen(): void {
    if (!this.seenFile) return;
    try {
      writeFileSync(this.seenFile, JSON.stringify(Object.fromEntries(this.seen)), 'utf8');
    } catch {
      /* 忽略写入失败 */
    }
  }

  /** 写一次 VLM 调用归账（内容摘要 + 字节数 + 是否成功 + 耗时）。 */
  private account(digest: string, bytes: number, ok: boolean, ms: number): void {
    if (!this.dataDir) return;
    try {
      appendFileSync(
        join(this.dataDir, 'vision-accounting.jsonl'),
        JSON.stringify({ ts: new Date().toISOString(), digest, bytes, ok, ms }) + '\n',
        'utf8',
      );
    } catch {
      /* 忽略写入失败 */
    }
  }

  private async fetchBytes(url: string): Promise<Uint8Array | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > this.cfg.maxBytes) return null;
      return buf;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async describe(bytes: Uint8Array): Promise<string | null> {
    const apiKey = process.env[this.cfg.apiKeySecret];
    if (!apiKey) {
      this.log.warn('缺少视觉 API Key', { secret: this.cfg.apiKeySecret });
      return null;
    }
    const base64 = Buffer.from(bytes).toString('base64');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(`${this.cfg.endpoint.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: this.cfg.model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: '用一句话简要描述这张图片里的关键内容，用于群聊上下文。' },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
              ],
            },
          ],
        }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = json.choices?.[0]?.message?.content?.trim();
      return text || null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
