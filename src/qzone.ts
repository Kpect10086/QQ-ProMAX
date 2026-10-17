import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'cortico/core/types.ts';
import type { ChatMsg } from './proactive.ts';
import type { QQIdentity } from './types.ts';

/**
 * QQ 空间（动态/说说）发布器。
 *
 * 能力：
 *  - 发动态：send_qzone_msg（文本 + 多图 + @人 + 可见权限），按 conversation + 记忆（最近聊天上下文）
 *    让 bot 以第一人称发表对某件事/某人的真实想法、吐槽、安利、简介。
 *  - 删动态：delete_qzone_msg（按 tid）。
 *  - 评论回复：监听 QzoneInteractEvent 自动/手动回复评论（回复 action 可配置）。
 *  - 后台自动冒泡：按概率周期性发一条动态（与主动说话调度器类似）。
 *
 * 注意：send_qzone_msg / delete_qzone_msg 已在 NapCat 文档确认；评论回复 action 因版本差异
 * 不一定同名，故 commentAction 做成可配置，默认 send_qzone_comment，失败只告警不影响其它功能。
 */

export interface QZoneAutoReplyConfig {
  enabled: boolean;
  systemPrompt: string;
  dailyQuota: number;
  cooldownSec: number;
}

export interface QZoneConfig {
  enabled: boolean;
  systemPrompt: string;
  endpoint: string;
  apiKeySecret: string;
  model: string;
  /** 自动发动态的 tick 周期（秒）。 */
  tickSec: number;
  /** 每个 tick 真正发一条动态的概率。 */
  chancePerTick: number;
  /** 每日自动动态上限（0=不限）。 */
  dailyQuota: number;
  /** 可见权限 ugc_right：1=公开（默认），其余值随 NapCat 版本。 */
  permission: number;
  /** 自动发动态时附图策略：none=不附；recent=附上最近一条QQ图片。 */
  imageMode: 'none' | 'recent';
  autoReplyComments: QZoneAutoReplyConfig;
  /** 回复评论用的 OneBot action（不同 NapCat 版本可能不同）。 */
  commentAction: string;
}

export interface QZonePosterOpts {
  cfg: QZoneConfig;
  log: Logger;
  dataDir: string;
  /** 调 OneBot action（NapCat 扩展接口）。 */
  callApi: (action: string, params: Record<string, unknown>) => Promise<unknown>;
  /** 用 LLM 生成动态/评论文本。 */
  chatCompletion: (messages: ChatMsg[]) => Promise<string | null>;
  /** 最近聊天上下文（文本），用于让动态“有话可说”。 */
  getContext: () => string;
  /** 取一条最近的 QQ 图片 URL（file://|http(s)://|base64://），供自动附图。 */
  getRecentImageUrl?: () => string | null;
  /** 取 API Key。 */
  resolveSecret: (name: string | undefined) => string | undefined;
  blockedReason?: () => string | null;
  review?: (text: string) => Promise<boolean>;
  /** 把一条外部交互（如评论）推给 host（用于记忆沉淀/让 bot 看到）。 */
  pushEvent: (e: unknown) => Promise<unknown>;
  identity: () => QQIdentity | null;
}

export interface QZonePostResult {
  ok: boolean;
  tid?: string;
  text?: string;
  error?: string;
}

const POST_ACTION = 'send_qzone_msg';
const DELETE_ACTION = 'delete_qzone_msg';
const GET_LIST_ACTION = 'get_qzone_msg_list';

function startOfDay(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 去掉模型常给的包裹引号 / 代码围栏 / 多余空行。 */
function cleanText(t: string): string {
  let s = (t ?? '').trim();
  if (!s) return s;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('“') && s.endsWith('”'))) s = s.slice(1, -1).trim();
  if (s.startsWith('```') || s.startsWith('···')) {
    const nl = s.search(/\n/);
    if (nl >= 0) s = s.slice(nl + 1);
    if (s.endsWith('```') || s.endsWith('···')) s = s.slice(0, -3);
    s = s.trim();
  }
  return s;
}

/** 从一段文本里抽出纯数字的 uin（用于 @目标）。 */
function extractUins(ats: string[]): number[] {
  const out: number[] = [];
  for (const a of ats) {
    const n = Number(a);
    if (Number.isFinite(n) && a.trim() !== '' && /^\d+$/.test(a.trim())) out.push(n);
  }
  return out;
}

/** 兼容不同 NapCat 版本对 QZone 互动事件的字段命名。 */
function parseQzoneEvent(ev: Record<string, any>): { tid?: string; commentId?: string; operatorId?: number; operatorNick?: string; text?: string; subType?: string } | null {
  if (!ev || typeof ev !== 'object') return null;
  const post = String(ev.post_type ?? '');
  const detail = String(ev.detail_type ?? ev.sub_type ?? '');
  const isQzone = post === 'qzone' || post === 'interact' || /qzone/i.test(detail) || /Qzone/i.test(detail) || /QZone/i.test(detail);
  if (!isQzone) return null;
  const tid = ev.tid ?? ev.feed_id ?? ev.feedId ?? (typeof ev.feed === 'object' ? ev.feed?.tid : undefined);
  const commentId = ev.comment_id ?? ev.commentId ?? ev.cid ?? ev.comment?.id;
  const operatorId = typeof ev.operator_id === 'number' ? ev.operator_id : typeof ev.user_id === 'number' ? ev.user_id : undefined;
  const operatorNick = ev.operator_nick ?? ev.operatorNick ?? ev.user_nick ?? ev.nickname ?? (typeof ev.operator === 'object' ? ev.operator?.nickname : undefined);
  const text = ev.content ?? ev.comment ?? ev.comment_text ?? ev.text;
  return { tid: tid ? String(tid) : undefined, commentId: commentId ? String(commentId) : undefined, operatorId, operatorNick: operatorNick ? String(operatorNick) : undefined, text: text ? String(text) : undefined, subType: detail };
}

export class QZonePoster {
  private readonly cfg: QZoneConfig;
  private readonly log: Logger;
  private readonly dataDir: string;
  private readonly stateFile: string;
  private readonly opts: QZonePosterOpts;

  private timer: ReturnType<typeof setInterval> | undefined;
  private lastPosts: { tid?: string; text: string; at: number }[] = [];
  private dailyCount = 0;
  private dayStart = startOfDay();
  private processedComments = new Set<string>();
  private lastReplyAt = 0;
  private replyDailyCount = 0;

  constructor(opts: QZonePosterOpts) {
    this.opts = opts;
    this.cfg = opts.cfg;
    this.log = opts.log.child('qzone');
    this.dataDir = opts.dataDir;
    this.stateFile = opts.dataDir ? join(opts.dataDir, 'qzone-state.json') : '';
    this.load();
  }

  start(): void {
    if (!this.cfg.enabled) {
      this.log.info('QQ空间动态未开启');
      return;
    }
    this.timer = setInterval(() => void this.tick().catch((e) => this.log.warn('QQ空间 tick 异常', { err: String(e) })), Math.max(10, this.cfg.tickSec) * 1000);
    this.log.info('QQ空间动态发布器已启动', { tickSec: this.cfg.tickSec, permission: this.cfg.permission });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.save();
  }

  /** 生成一条动态文本（基于最近聊天）。topic 可给方向，如“吐槽最近的天气”。 */
  async generateContent(topic?: string): Promise<string | null> {
    const ctx = this.opts.getContext().slice(-6000);
    const whoami = this.describeSelf();
    const userMsg =
      `【你的身份】${whoami}\n` +
      `【最近聊天上下文（供你取材/联想）】\n${ctx || '（暂无）'}\n\n` +
      `请基于以上，以第一人称发一条 QQ 空间动态。可以是对某件事/某个人的真实看法、吐槽、安利或简介，也可以分享当下心情。` +
      (topic ? `这次的方向：${topic}。` : '') +
      `要求：像你本人真实的朋友圈碎碎念，自然、有梗、别太长（1-3 句最佳，最多不超 100 字），不要写成回复、不要加「在吗」、不要客服腔，可带少量 emoji。`;
    const text = await this.opts.chatCompletion([
      { role: 'system', content: this.cfg.systemPrompt },
      { role: 'user', content: userMsg },
    ]);
    return text ? cleanText(text) : null;
  }

  private describeSelf(): string {
    const id = this.opts.identity();
    if (!id) return '（你是这个 QQ 的主人，有自己的性格）';
    return `QQ ${id.selfId} / 昵称「${id.nickname}」`;
  }

  /** 发一条动态。content 缺省时自动生成；images/ats 可选。 */
  async post(opts: { content?: string; topic?: string; images?: string[]; ats?: string[]; permission?: number }): Promise<QZonePostResult> {
    const blocked = this.opts.blockedReason?.();
    if (blocked) return {ok:false,error:blocked};
    let content = opts.content ? cleanText(opts.content) : '';
    if (!content) {
      const gen = await this.generateContent(opts.topic);
      if (!gen) return { ok: false, error: '生成动态文本失败（未拿到模型文本）' };
      content = gen;
    }
    if (!content) return { ok: false, error: '动态内容为空' };

    // @人：文本里嵌入 @昵称；纯数字则同时作为 target_uins（NapCat 可见/互动对象）
    let ats = opts.ats ?? [];
    let body = content;
    for (const a of ats) {
      const name = /^\d+$/.test(a.trim()) ? a.trim() : a.trim();
      if (!body.includes('@' + name)) body = `@${name} ` + body;
    }
    if (this.opts.review && !await this.opts.review(body)) {body = content = 'filtered'; ats = []; opts = {...opts,images:[]};}

    const images: string[] = [...(opts.images ?? [])];
    if (content !== 'filtered' && !images.length && this.cfg.imageMode === 'recent') {
      const u = this.opts.getRecentImageUrl?.();
      if (u) images.push(u);
    }

    const params: Record<string, unknown> = { content: body };
    if (images.length) params.images = images;
    params.ugc_right = typeof opts.permission === 'number' ? opts.permission : this.cfg.permission;
    const uins = extractUins(ats);
    if (uins.length) params.target_uins = uins;

    try {
      const blocked = this.opts.blockedReason?.();
      if (blocked) return {ok:false,error:blocked};
      const r = (await this.opts.callApi(POST_ACTION, params)) as {tid?: string | number} | undefined;
      const tid = r?.tid != null ? String(r.tid).trim() : undefined;
      if (!tid) return {ok:false,error:'协议端未返回动态 tid，发布结果无法确认；请先读取动态列表核对，不要重复发布。'};
      this.recordPost(tid, body);
      this.log.info('已发 QQ空间动态', { tid, text: body.slice(0, 60) });
      return { ok: true, tid, text: body };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn('发 QQ空间动态失败', { err: msg });
      return { ok: false, error: msg };
    }
  }

  /** 删除一条动态。 */
  async delete(tid: string): Promise<{ ok: boolean; error?: string }> {
    const blocked = this.opts.blockedReason?.();
    if (blocked) return {ok:false,error:blocked};
    try {
      await this.opts.callApi(DELETE_ACTION, { tid });
      this.lastPosts = this.lastPosts.filter((p) => p.tid !== tid);
      this.save();
      this.log.info('已删 QQ空间动态', { tid });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn('删 QQ空间动态失败', { err: msg });
      return { ok: false, error: msg };
    }
  }

  /** 回复某条动态下的一条评论。 */
  async replyComment(tid: string, commentId: string, content: string): Promise<{ ok: boolean; error?: string }> {
    const blocked = this.opts.blockedReason?.();
    if (blocked) return {ok:false,error:blocked};
    let text = cleanText(content);
    if (text && this.opts.review && !await this.opts.review(text)) text = 'filtered';
    if (!text) return { ok: false, error: '回复内容为空' };
    try {
      const blocked = this.opts.blockedReason?.();
      if (blocked) return {ok:false,error:blocked};
      await this.opts.callApi(this.cfg.commentAction, { tid, content: text, comment_id: commentId });
      this.log.info('已回复 QQ空间评论', { tid, commentId, text: text.slice(0, 40) });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn('回复 QQ空间评论失败', { err: msg, action: this.cfg.commentAction });
      return { ok: false, error: msg };
    }
  }

  /** 取自己的动态列表（尽力而为；get_qzone_msg_list 不一定所有 NapCat 版本都支持）。 */
  async getFeeds(num = 5): Promise<{ ok: boolean; feeds?: unknown[]; error?: string }> {
    try {
      const data = await this.opts.callApi(GET_LIST_ACTION, {num});
      const list = data as {msglist?: unknown[]; feeds?: unknown[]} | undefined;
      const feeds = Array.isArray(data) ? data : list?.msglist ?? list?.feeds;
      if (!Array.isArray(feeds)) return {ok:false,error:'协议端返回的动态列表格式无法识别，不能据此判断空间为空。'};
      return {ok:true,feeds};
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn('获取 QQ空间动态列表失败', { err: msg });
      return { ok: false, error: msg };
    }
  }

  /** 处理一条 QZone 互动事件（评论/点赞等）。 */
  async onEvent(ev: Record<string, any>): Promise<void> {
    const p = parseQzoneEvent(ev);
    if (!p) return;
    this.log.info('收到 QQ空间互动事件', { subType: p.subType, tid: p.tid, commentId: p.commentId, who: p.operatorNick });

    // 推给 host：让 bot 看到、也能沉淀进记忆（external 来源）
    try {
      await this.opts.pushEvent({
        origin: 'external',
        source: 'qq',
        text: `【QQ空间${p.subType === 'comment' ? '评论' : '互动'}】${p.operatorNick ?? p.operatorId ?? '某人'} 在你的动态(${p.tid ?? '?'})下${p.subType === 'comment' ? '评论' : '互动'}：${p.text ?? ''}`,
        meta: { kind: 'qzone_interact', subType: p.subType, tid: p.tid, commentId: p.commentId, operatorId: p.operatorId, operatorNick: p.operatorNick },
      } as Record<string, unknown>);
    } catch { /* 忽略推送失败 */ }

    // 仅评论触发自动回复
    if (p.subType !== 'comment' || !p.commentId || !p.tid) return;
    const key = `${p.tid}#${p.commentId}`;
    if (this.processedComments.has(key)) return;
    this.processedComments.add(key);
    this.save();

    if (!this.cfg.autoReplyComments.enabled || this.opts.blockedReason?.()) return;
    const now = Date.now();
    this.rolloverReplyDay();
    if (this.cfg.autoReplyComments.cooldownSec > 0 && now - this.lastReplyAt < this.cfg.autoReplyComments.cooldownSec * 1000) return;
    if (this.cfg.autoReplyComments.dailyQuota > 0 && this.replyDailyCount >= this.cfg.autoReplyComments.dailyQuota) return;

    const reply = await this.generateReply(p);
    if (!reply) return;
    const res = await this.replyComment(p.tid, p.commentId, reply);
    if (res.ok) {
      this.lastReplyAt = now;
      this.replyDailyCount += 1;
      this.save();
    }
  }

  private async generateReply(p: { tid?: string; commentId?: string; operatorNick?: string; text?: string }): Promise<string | null> {
    const whoami = this.describeSelf();
    const userMsg =
      `【你的身份】${whoami}\n` +
      `【某条动态下，@${p.operatorNick ?? '对方'} 评论说】${p.text ?? '（空）'}\n\n` +
      `请直接回这条评论一句话：自然，别太长，可带 emoji，不要客套寒暄。`;
    const text = await this.opts.chatCompletion([
      { role: 'system', content: this.cfg.autoReplyComments.systemPrompt },
      { role: 'user', content: userMsg },
    ]);
    return text ? cleanText(text) : null;
  }

  private async tick(): Promise<void> {
    if (!this.cfg.enabled) return;
    if (this.opts.blockedReason?.()) return;
    this.rolloverDay();
    if (this.cfg.dailyQuota > 0 && this.dailyCount >= this.cfg.dailyQuota) return;
    if (Math.random() >= this.cfg.chancePerTick) return;
    const text = await this.generateContent();
    if (!text) {
      this.log.warn('QQ空间动态自动生成失败');
      return;
    }
    await this.post({ content: text });
  }

  private recordPost(tid: string | undefined, text: string): void {
    this.lastPosts.push({ tid, text, at: Date.now() });
    while (this.lastPosts.length > 20) this.lastPosts.shift();
    this.rolloverDay();
    this.dailyCount += 1;
    this.save();
  }

  private rolloverDay(): void {
    const today = startOfDay();
    if (today !== this.dayStart) {
      this.dayStart = today;
      this.dailyCount = 0;
      this.replyDailyCount = 0;
    }
  }

  private rolloverReplyDay(): void {
    const today = startOfDay();
    if (today !== this.dayStart) {
      this.dayStart = today;
      this.replyDailyCount = 0;
    }
  }

  status(): Record<string, unknown> {
    return {
      enabled: this.cfg.enabled,
      blockedReason: this.opts.blockedReason?.() ?? null,
      dailyCount: this.dailyCount,
      dailyQuota: this.cfg.dailyQuota,
      autoReply: this.cfg.autoReplyComments.enabled,
      replyDailyCount: this.replyDailyCount,
      lastPosts: this.lastPosts.slice(-8).map((p) => ({ tid: p.tid, text: p.text.slice(0, 60), at: p.at })),
    };
  }

  private load(): void {
    if (!this.stateFile || !existsSync(this.stateFile)) return;
    try {
      const raw = JSON.parse(readFileSync(this.stateFile, 'utf8')) as {
        lastPosts?: { tid?: string; text: string; at: number }[];
        dailyCount?: number;
        dayStart?: number;
        processedComments?: string[];
        replyDailyCount?: number;
        lastReplyAt?: number;
      };
      this.lastPosts = Array.isArray(raw.lastPosts) ? raw.lastPosts : [];
      this.dailyCount = typeof raw.dailyCount === 'number' ? raw.dailyCount : 0;
      this.dayStart = typeof raw.dayStart === 'number' ? raw.dayStart : startOfDay();
      this.processedComments = new Set(Array.isArray(raw.processedComments) ? raw.processedComments : []);
      this.replyDailyCount = typeof raw.replyDailyCount === 'number' ? raw.replyDailyCount : 0;
      this.lastReplyAt = typeof raw.lastReplyAt === 'number' ? raw.lastReplyAt : 0;
    } catch {
      /* 忽略损坏状态文件 */
    }
  }

  private save(): void {
    if (!this.stateFile) return;
    try {
      const obj = {
        lastPosts: this.lastPosts,
        dailyCount: this.dailyCount,
        dayStart: this.dayStart,
        processedComments: [...this.processedComments],
        replyDailyCount: this.replyDailyCount,
        lastReplyAt: this.lastReplyAt,
      };
      writeFileSync(this.stateFile, JSON.stringify(obj), 'utf8');
    } catch {
      /* 忽略写入失败 */
    }
  }
}
