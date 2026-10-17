import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { Logger } from 'cortico/core/types.ts';
import { prepareImageRequest } from './image-requests.ts';

/** 单张表情包的元数据（按内容 sha256 去重）。 */
export interface StickerMeta {
  /** 内容 sha256，去重主键。 */
  hash: string;
  /** 文件扩展名（含点）。 */
  ext: string;
  /** 相对表情包目录的文件名，bot 可经 [表情包:文件名] 引用发送。 */
  file: string;
  /** 来自 OneBot 的 summary（如「[表情]摸头」），空则无。 */
  summary: string;
  /** 情感标签（如 开心/撒娇/嘲讽/无奈），VLM 推断或「未知」。 */
  emotion: string;
  /** 适用场景（如 回应夸奖/表达无语），VLM 推断或「未知」。 */
  usage: string;
  /** 2-4 字短标签。 */
  tag: string;
  /** 给人看的短名（优先用 summary 清洗后）。 */
  label: string;
  firstSeen: number;
  lastSeen: number;
  /** 累计出现次数（去重后仍计数）。 */
  count: number;
  /** 出现过的会话地址列表。 */
  sources: string[];
}

/** 视觉配置（直接复用 vision 段，标注情感/用处时调用 VLM）。 */
export interface StickerVisionCfg {
  enabled: boolean;
  endpoint: string;
  apiKeySecret: string;
  model: string;
  maxBytes: number;
  timeoutMs: number;
}

interface Job {
  url: string;
  conv: string;
  summary: string;
}

/**
 * 表情包自动收藏：下载 + 内容级去重（sha256）+ 情感/用处标注 + 持久化。
 *
 * - 仅当 sticker.enabled 时启用（world 在消息循环里判定表情包后调用 ingest）。
 * - 去重：相同内容只落盘一次，重复出现仅累加 count / 刷新 lastSeen / 记录来源。
 * - 情感/用处：优先用 OneBot summary；若 vision.enabled 且有 key，再用 VLM 结构化标注补全。
 * - 元数据持久化到 <dataDir>/sticker-index.json，跨重启仍生效。
 */
export class StickerStore {
  private readonly dir: string;
  private readonly vision: StickerVisionCfg;
  private readonly log: Logger;
  private readonly indexFile: string;
  private readonly meta = new Map<string, StickerMeta>();
  private readonly annotating = new Set<string>();
  private inflight = 0;
  private readonly queue: Job[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(dir: string, vision: StickerVisionCfg, log: Logger, dataDir = '',
    private readonly secret: (name: string) => string | undefined = (name) => process.env[name]) {
    this.dir = dir;
    this.vision = vision;
    this.log = log.child('sticker');
    this.indexFile = dataDir ? join(dataDir, 'sticker-index.json') : '';
    this.load();
    this.log.info(`StickerStore init indexFile=${this.indexFile} emojiDir=${this.dir} loaded=${this.meta.size}`);
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    } catch {
      this.log.warn('无法创建表情包目录', { dir: this.dir });
    }
  }

  get size(): number {
    return this.meta.size;
  }

  /** 消息里检测到表情包时调用（异步、不阻塞事件循环）。 */
  ingest(url: string, conv: string, summary: string): void {
    if (this.queue.length > 300) {
      this.log.warn('表情包队列已满，丢弃一条', { url });
      return;
    }
    this.queue.push({ url, conv, summary });
    this.pump();
  }

  /** 立即落盘（stop 时调用）。 */
  flush(): void {
    this.save();
  }

  /** 统计 + 最近列表，供 qq_sticker_stats 工具与控制台自查。 */
  stats(limit = 10, query = ''): { total: number; byEmotion: Record<string, number>; recent: StickerMeta[] } {
    const byEmotion: Record<string, number> = {};
    for (const m of this.meta.values()) byEmotion[m.emotion] = (byEmotion[m.emotion] ?? 0) + 1;
    const recent = [...this.meta.values()]
      .filter((m) => existsSync(join(this.dir, m.file)))
      .filter((m) => !query || [m.label, m.emotion, m.usage, m.tag, m.summary].join(' ').toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, limit);
    return { total: this.meta.size, byEmotion, recent };
  }

  async importFavorites(favorites: Array<{ url: string; summary: string }>): Promise<{ added: number; existing: number; failed: number }> {
    const result = { added: 0, existing: 0, failed: 0 };
    for (let i = 0; i < favorites.length; i += 4) {
      const outcomes = await Promise.all(favorites.slice(i, i + 4).map((f) => this.process({ ...f, conv: 'qq:favorites' })));
      for (const outcome of outcomes) result[outcome]++;
    }
    this.flush();
    return result;
  }

  private pump(): void {
    if (this.inflight >= 4) return;
    const job = this.queue.shift();
    if (!job) return;
    this.inflight++;
    void this.process(job).finally(() => {
      this.inflight--;
      this.pump();
    });
  }

  private async process(job: Job): Promise<'added' | 'existing' | 'failed'> {
    try {
      const bytes = await this.fetchBytes(job.url);
      if (!bytes) return 'failed';
      const hash = createHash('sha256').update(bytes).digest('hex');

      // 去重：已存在则只更新计数/来源，不重复落盘
      const existing = this.meta.get(hash);
      if (existing) {
        if (!existsSync(join(this.dir, existing.file))) writeFileSync(join(this.dir, existing.file), bytes);
        existing.count++;
        existing.lastSeen = Date.now();
        if (job.summary && !existing.summary) existing.summary = job.summary;
        if (!existing.sources.includes(job.conv)) existing.sources.push(job.conv);
        await this.annotateMeta(existing, bytes);
        this.scheduleSave();
        return 'existing';
      }

      const ext = this.extOf(job.url, bytes);
      const file = `sticker-${hash.slice(0, 16)}${ext}`;
      writeFileSync(join(this.dir, file), bytes);

      const meta: StickerMeta = {
        hash,
        ext,
        file,
        summary: job.summary || '',
        emotion: '未知',
        usage: '未知',
        tag: '',
        label: this.cleanSummary(job.summary) || '表情包',
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        count: 1,
        sources: [job.conv],
      };
      this.meta.set(hash, meta);
      await this.annotateMeta(meta, bytes);
      this.log.info('表情包已收藏', { file, label: meta.label, emotion: meta.emotion, usage: meta.usage });
      this.scheduleSave();
      return 'added';
    } catch (e) {
      this.log.warn('表情包处理失败', { err: String(e), url: job.url });
      return 'failed';
    }
  }

  private async annotateMeta(meta: StickerMeta, bytes: Uint8Array): Promise<void> {
    if (!this.vision.enabled || this.annotating.has(meta.hash)) return;
    if (meta.emotion && meta.emotion !== '未知' && meta.usage && meta.usage !== '未知') return;
    this.annotating.add(meta.hash);
    try {
      const ann = await this.annotate(bytes);
      if (ann.emotion !== '未知' && ann.usage !== '未知') Object.assign(meta, ann);
      meta.label = this.cleanSummary(meta.summary) || meta.tag || '表情包';
    } finally {
      this.annotating.delete(meta.hash);
    }
  }

  /** 用 VLM 结构化标注情感/用处；无 key 或失败时返回「未知」降级。 */
  private async annotate(bytes: Uint8Array): Promise<{ emotion: string; usage: string; tag: string }> {
    const apiKey = this.secret(this.vision.apiKeySecret);
    if (!apiKey) {
      this.log.warn('缺视觉 API Key，表情包情感标注降级为未知', { secret: this.vision.apiKeySecret });
      return { emotion: '未知', usage: '未知', tag: '' };
    }
    const base64 = Buffer.from(bytes).toString('base64');
    const mime = ({ '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' } as Record<string, string>)[this.extOf('', bytes)] || 'image/jpeg';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.vision.timeoutMs);
    try {
      const res = await fetch(`${this.vision.endpoint.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(await prepareImageRequest({
          model: this.vision.model,
          messages: [
            {
              role: 'system',
              content:
                '你是表情包分析助手。分析这张表情包并严格只输出一个 JSON：' +
                '{"emotion":"情感(如 开心/撒娇/嘲讽/无奈/愤怒/惊讶/喜爱/鼓励/无语)","usage":"适用场景(如 回应夸奖/表达无语/撒娇卖萌/表示赞同/吐槽/安慰)","tag":"2-4字短标签"}。' +
                '不要输出 JSON 以外的任何文字。',
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: '分析这个表情包。' },
                { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
              ],
            },
          ],
        }, ctrl.signal)),
      });
      if (!res.ok) return { emotion: '未知', usage: '未知', tag: '' };
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return this.parseAnn(json.choices?.[0]?.message?.content?.trim());
    } catch {
      return { emotion: '未知', usage: '未知', tag: '' };
    } finally {
      clearTimeout(timer);
    }
  }

  private parseAnn(text?: string): { emotion: string; usage: string; tag: string } {
    if (!text) return { emotion: '未知', usage: '未知', tag: '' };
    try {
      const m = text.match(/\{[\s\S]*\}/);
      const o = m ? (JSON.parse(m[0]) as Record<string, unknown>) : null;
      if (o) {
        return {
          emotion: String(o.emotion || '未知'),
          usage: String(o.usage || '未知'),
          tag: String(o.tag || ''),
        };
      }
    } catch {
      /* 解析失败降级 */
    }
    return { emotion: '未知', usage: '未知', tag: '' };
  }

  private extOf(url: string, bytes: Uint8Array): string {
    const u = url.split('?')[0];
    const e = extname(u).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(e)) return e;
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return '.jpg';
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return '.png';
    if (bytes[0] === 0x47 && bytes[1] === 0x49) return '.gif';
    if (bytes.length >= 12 && Buffer.from(bytes.slice(0, 4)).toString('hex') === '52494646') return '.webp';
    return '.img';
  }

  private cleanSummary(s: string): string {
    return (s || '').replace(/^\[表情\]/i, '').replace(/^\[emoji\]/i, '').trim();
  }

  private async fetchBytes(url: string): Promise<Uint8Array | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.vision.timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > this.vision.maxBytes) return null;
      return buf;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private load(): void {
    if (!this.indexFile || !existsSync(this.indexFile)) return;
    try {
      const raw = JSON.parse(readFileSync(this.indexFile, 'utf8')) as Record<string, StickerMeta>;
      for (const [k, v] of Object.entries(raw)) if (k === v.hash) this.meta.set(k, v);
    } catch {
      this.log.warn('表情包索引损坏，忽略', { file: this.indexFile });
    }
  }

  private scheduleSave(): void {
    if (!this.indexFile || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.save();
    }, 2000);
  }

  private save(): void {
    if (!this.indexFile) return;
    try {
      writeFileSync(this.indexFile, JSON.stringify(Object.fromEntries(this.meta)), 'utf8');
    } catch {
      this.log.warn('表情包索引写入失败', { file: this.indexFile });
    }
  }
}
