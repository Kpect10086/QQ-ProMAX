import type {Language} from 'cortico/core/language.ts';
type WorldHost = FrameworkWorldHost & {isPaused?():boolean};
const toolError = (error: string) => ({failed:true as const,text:error,error});
import {createHash, randomBytes} from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import type { BlobInput, EventEnvelope, Logger, PromptDocDecl, ToolDef, ToolSpec, ToolCallContext, World, WorldWebUiDecl, WorldHost as FrameworkWorldHost, WorldLamp, WorldPanelDecl, WorldStreamSocket } from 'cortico/core/types.ts';

import { shortTime } from './time.ts';
import { reviewContent, reviewMemory } from './content-review.ts';
import { downloadImageBytes } from './image-download.ts';
import {QQStreamGate} from './stream-gate.ts';
import {outgoingChatText} from './outgoing-text.ts';
import {externalName} from './external-name.ts';
import {QQ_QUIET_GROUP, QuietReplies, routineQuiet, quietReplyAllowed} from './quiet-hours.ts';
import {forwardSource as inferForwardSource} from './forward-source.ts';
import { OneBotDriver } from './driver.ts';
import { QQ_CONFIG_GROUP, QQ_VOICE_GROUP, QQ_DEFAULTS, normalizeConfig, toIds, type QQConfigSection, type QQWorldConfig } from './config.ts';
import { synthesizeVoice, checkVoiceDeps, voiceReady, type RuntimeVoiceCfg } from './voice.ts';

import {join} from 'node:path';
import {resourcePath} from './local-resources.ts';
import { fileURLToPath } from 'node:url';
import { buildOutgoing, resolveEmojiFile, eventClock, eventTs, renderIncoming, renderSegmentsPlain, splitReplyIntoMessages } from './normalize.ts';

const EXT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENV_PROMPT_FILE = fileURLToPath(new URL('../ENV_PROMPT.md', import.meta.url));

import { type Conv, type OneBotMessage, type OneBotSegment, type QQIdentity, type QQSenderBrief } from './types.ts';
import { Vision } from './vision.ts';
import { previewVideo } from './video.ts';
import { StickerStore } from './sticker.ts';
import { ReminderStore, parseWhen, formatWhen } from './reminder.ts';
import { ProactiveSpeaker, type ProactiveTarget, routineSegment } from './proactive.ts';
import { makeHistoryTools } from './history-tools.ts';
import { compactQQTools } from './compact-tools.ts';
import { Notebook } from './notebook.ts';
import { festivalText } from './festival.ts';

const SOURCE = 'qqbot';
/** 合并转发节点里取不到昵称时的占位（对齐内置 qq 的 'QQ用户' 占位）。 */
const PLACEHOLDER_NICKNAME = 'QQ用户';

/** 合并转发节点的渲染结果（对齐内置 qq 的 ForwardNode）。 */
interface ForwardNode {
  line: string;
  body: string;
  imageUrls: string[];
  named: boolean;
  time?: number;
  userId?: string;
  messageType?: string;
  originGroupId?: number;
  originPeerUin?: number;
}

interface PendingSend {
  address: string;
  label: string;
  text: string;
  images?: string[];
  voice?: boolean;
  createdAt: number;
  /** 绑定到本草稿的引用回复消息编号（跨会话校验后写入）。 */
  replyMessageId?: number;
  /** qq_send 是否已直接发出（去掉强制草稿门后通常为 true）。 */
  sent?: boolean;
}

/** 把配置里的 JSON 字符串安全地解析成对象；非法或空则回退 {}。用于 TTS 额外参数透传。 */
function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

export class QQWorld implements World {
  readonly id = 'qqbot';
  private config: QQWorldConfig = QQ_DEFAULTS;
  private host: WorldHost | null = null;
  private log: Logger = consoleLogger();
  private driver: OneBotDriver | null = null;
  private identity: QQIdentity | null = null;
  private readonly convs = new Map<string, Conv>();
  private readonly pendingSends = new Map<string, PendingSend>();
  /** 自己发出的消息索引（message_id → 会话），用于引用回复自己刚发的消息。 */
  private readonly knownMessages = new Map<string, { conv: string; ts: number }>();
  /** 最近收到的图片 URL 缓冲（供 qq_view_image 主动重看，无需事件里带 URL）。 */
  private readonly recentImages: Array<{ url: string; conv: string; at: number }> = [];
  private vision: Vision;
  private stickers: StickerStore | null = null;
  private stickerSync: Promise<string> | null = null;
  private stickerSyncResult = '';
  private proactive: ProactiveSpeaker | null = null;
  private connected = false;
  private sendPolicyQueued = false;
  private deliveredSendPolicy = '';
  /** sendTo 因限速/防死循环而拦截时返回的字符串前缀，便于 qq_send 工具区分“已发送”与“被拦截”。 */
  private static readonly SEND_BLOCKED = '[send blocked] ';
  /** sendTo 没有任何一段确认发送成功时返回的字符串前缀。 */
  private static readonly SEND_FAILED = '[send failed] ';
  private static readonly SEND_PARTIAL = '[send partial] ';
  /** 群聊发言频率限制：group:<id> -> 已发出消息的时间戳数组（用于滑动窗口计数）。 */
  private groupSpeakStamps = new Map<string, number[]>();
  /** 防死循环：会话地址 -> 自上次对方发言以来的 bot 连续发送条数。 */
  private botStreak = new Map<string, number>();
  /** 防死循环：会话地址 -> 最近一次收到对方发言的时间戳（用于 idle 收尾判断）。 */
  private lastUserMsgAt = new Map<string, number>();
  private lastUserMsgAtByQQ = new Map<number,number>();
  private readonly eventSockets = new Set<WorldStreamSocket>();
  private packageDir = '';
  private get emojiDirAbs() {return resourcePath(this.config.localResourcesDir || this.dataDir, this.config.emojiDir || 'emoji', true) || '';}
  /** 本进程已处理过的 message_id（去重，防止 NapCat 重投导致同一消息回两遍）。仅内存。 */
  private readonly processedIds = new Set<string>();
  private connectedAtSec = Math.floor(Date.now() / 1000);
  private startupHistoryCount = 0;
  private readonly historyOnlyConvs = new Set<string>();
  private pruningIncoming = false;
  /**
   * 兜底自动回复状态。当一条“应当回复”的入站消息（私聊 / 被 @ 的群消息）触发了本轮，
   * 而模型最终没有调用 qq_send 就把文本当成了回复（纯文字回答 → 控制台有、QQ 收不到），
   * 我们在回合收束时把模型生成的文本自动发往来源会话，避免漏发。
   */
  private readonly _pendingReplyConvs = new Set<string>();
  private readonly pendingFilteredReplies = new Set<string>();
  private readonly filteredReplyAttempts = new Set<string>();
  private _tapBuf = '';
  private readonly _sentThisTurn = new Set<string>();
  private privateReplyCounts = new Map<string, number>();
  private privateReplyBudgets = new Map<string, {cursor: number; counts: Map<string, number>}>();
  /** 群成员昵称→QQ 缓存（懒加载，供按昵称 @人/戳人）。groupId -> (小写名->qq)。 */
  private readonly memberIndex = new Map<number, Map<string, number>>();
  private get stickerDirAbs() {return resourcePath(this.config.localResourcesDir || this.dataDir, this.config.sticker.dir || this.config.emojiDir || 'emoji', true) || '';}
  /** 定时提醒 / 记事本存储。 */
  private reminders!: ReminderStore;
  /** 到点提醒检查定时器句柄。 */
  private reminderTimer: ReturnType<typeof setInterval> | undefined = undefined;
  /** 私人笔记存放在本扩展 dataDir/notebook.jsonl。 */
  private notebook!: Notebook;
  // 发送去重：记录同会话最近一次实际发出的归一化文本，6s 内完全相同则跳过（防“一句话回复两遍”）。
  private dedupSends = new Map<string, { norm: string; ts: number; replyCursor?: number }>();
  private recentSends: Array<{conv:string;at:string;text:string;messageIds:string[]}> = [];
  /** 状态持久化目录（来自 ctx.dataDir），用于跨重启重建 knownMessages（防串台索引）。 */
  private dataDir = '';
  private stateFile = '';
  /** 外号→QQ 记忆（持久化到 dataDir/qqbot-aliases.json），解析 who 时优先查这里。 */
  private aliases = new Map<string, number>();
  private aliasesFile = '';
  private stateSaveTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  /**
   * 串行处理链（对齐内置 qq 的 msgChain）。所有消息/通知都接到这条 Promise 链上依次执行，
   * 严格保证按到达顺序落库，避免并发时 knownMessages / convs / 聚合窗口交叉污染导致串台。
   */
  private msgChain: Promise<void> = Promise.resolve();
  private streamGate: QQStreamGate | null = null;
  private policyTimer: ReturnType<typeof setInterval> | null = null;
  private readonly quietReplies: QuietReplies;

  constructor(config?: Partial<QQWorldConfig>, packageDir?: string, dataDir = '', private readonly secretResolver?: (name:string)=>string) {
    this.config = normalizeConfig((config ?? {}) as QQConfigSection);
    this.packageDir = packageDir ?? '';
    this.dataDir = dataDir;
    this.quietReplies = new QuietReplies(dataDir ? join(dataDir, 'qq-quiet-replies.json') : '');
    this.stateFile = dataDir ? join(dataDir, 'qqbot-known-messages.json') : '';
    this.vision = new Vision(this.config.vision, consoleLogger());
  }

  // ---- 生命周期 ----

  /**
   * 反向监听必须带鉴权：连接进来的那一端能读到 bot 要发的全部消息、也能伪造入站事件
   * （`get_group_member_info` 之类的管理接口就走这条连接）。若配置里 token 为空，
   * 这里生成一个随机 token 并持久化到 dataDir，保证**任何情况下都不会退化成无鉴权监听**，
   * 同时跨重启稳定，用户只需把它填进 NapCat 一次。
   *
   * 绑回环（127.0.0.1）时这仍是有意义的第二道锁：同机其它进程/恶意网页脚本都连不上。
   */
  private ensureReverseToken(): void {
    if (this.config.mode !== 'reverse') return;
    if (this.config.token) return;
    const file = join(this.dataDir, 'reverse-token.txt');
    let token = '';
    try {
      token = readFileSync(file, 'utf8').trim();
    } catch {
      /* 首次运行，下面生成 */
    }
    if (!/^[0-9a-f]{32,}$/i.test(token)) {
      token = randomBytes(24).toString('hex');
      try {
        writeFileSync(file, token, { encoding: 'utf8', mode: 0o600 });
      } catch (err) {
        this.log?.warn?.('无法持久化反向连接 token，重启后会变化', { err: String(err) });
      }
    }
    this.config.token = token;
    // 注意：world 实例拿不到框架的配置写入 API（`World` 契约里没有持久化方法，
    // 框架的 setConfigPath 是 bot.ts 的内部函数）。所以 token 只持久化到上面的
    // reverse-token.txt；config.json 里的 token 字段保持用户自己填的值（默认为空）。
    // 每次启动都会从这个文件读回同一串，因此跨重启稳定。
    this.log?.warn?.(
      `反向连接未配置 token，已自动生成：${token} —— 请在 NapCat「设置反向客户端」的 Token 里填同一串，否则连不上`,
    );
  }

  /** 供控制台面板展示当前生效的反向 token（用户要拿它去配 NapCat）。 */
  get reverseTokenForPanel(): string {
    return this.config.mode === 'reverse' ? this.config.token : '';
  }

  /**
   * 按**当前**配置新建 OneBot driver。连接类配置（模式/地址/端口/路径/Token）改了之后，
   * 靠 {@link restartConnection} 重建 driver 即可生效，不必整进程重启。
   * 注意 config 是 ctx.cfg 的同一引用（normalizeConfig 原地补全），这里读到的就是最新值。
   */
  private createDriver(): OneBotDriver {
    //建 driver 前再确认一次（restartConnection 也走这里，配置刚被改过时兜底）。
    this.ensureReverseToken();
    return new OneBotDriver({

      mode: this.config.mode,
      wsUrl: this.config.wsUrl,
      wsHost: this.config.wsHost,
      wsPort: this.config.wsPort,
      wsPath: this.config.wsPath,
      token: this.config.token,
      log: this.log,
      onEvent: (ev) => void this.handleEvent(ev),
      onConnectionChange: (c) => {
        this.connected = c;
        this.publishSendPolicy();
        if (c) {
          this.connectedAtSec = Math.floor(Date.now() / 1000);
          if (this.config.voice.enabled) checkVoiceDeps(this.voiceRuntime(), this.log);
          void this.reloadIdentity();
          if (this.config.sticker.enabled) void this.syncFavoriteStickers().then((result) => this.log.info(result));
        }
      },
    });
  }

  /**
   * 用当前配置重建 OneBot 连接（控制台「重启连接」按钮）。
   * 只换 driver，会话状态/存储/定时器都不动——比整进程重启轻得多，改完连接参数点一下即可。
   */
  async restartConnection(): Promise<{ ok: boolean; mode: string; target: string; message: string }> {
    const prev = this.driver;
    this.driver = null;
    this.connected = false;
    if (prev) {
      try {
        await prev.stop();
      } catch (e) {
        this.log.warn('重启连接时关闭旧连接失败', { err: String(e) });
      }
    }
    const driver = this.createDriver();
    this.driver = driver;
    // syncConfigRoster 让监听名单的增删立即反映到会话集合（不需要重启也能加群/加私聊）。
    this.syncConfigRoster();
    try {
      await driver.start();
    } catch (e) {
      this.log.warn('重启连接失败', { err: String(e) });
      return {
        ok: false,
        mode: this.config.mode,
        target: this.describeWsTarget(),
        message: `重启失败：${e instanceof Error ? e.message : String(e)}`,
      };
    }
    return {
      ok: true,
      mode: this.config.mode,
      target: this.describeWsTarget(),
      message: this.config.mode === 'reverse'
        ? '已按当前配置重启反向监听，等待 NapCat 连入。'
        : '已按当前配置重启正向连接。',
    };
  }

  /** 当前连接目标的可读描述，用于面板回显（不暴露 Token）。 */
  private describeWsTarget(): string {
    const c = this.config;
    return c.mode === 'reverse'
      ? `reverse ${c.wsHost}:${c.wsPort}${c.wsPath}`
      : `forward ${c.wsUrl}`;
  }

  async start(host: WorldHost): Promise<void> {
    this.host = this.wrapHost(host);
    this.connectedAtSec = Math.floor(Date.now() / 1000);
    this.startupHistoryCount = 0;
    this.historyOnlyConvs.clear();
    this.sendPolicyQueued = false;
    this.deliveredSendPolicy = '';
    this.log = this.host.log.child('qq');
    this.ensureReverseToken();
    if (this.dataDir) {
      this.streamGate = new QQStreamGate(() => resourcePath(this.config.localResourcesDir || this.dataDir, this.config.directorStatusFile) || '',
        join(this.dataDir, 'qq-live-deferred.json'), () => this.host?.isPaused?.() ?? true,
        async ev => {
          if (this.streamGate?.blocked() || this.host?.isPaused?.()) throw Error('QQ delivery deferred');
          await this.handleEvent(ev, true);
        }, error => this.log.warn('直播暂存 QQ 消息仍待处理', {error: String(error)}));
      if (this.streamGate.pending) this.log.info('QQ暂存队列已恢复，按当前开关和名单释放', {pending:this.streamGate.pending});
      this.streamGate.start();
    }
    this.vision = new Vision(this.config.vision,this.log,this.dataDir,()=>{const c=this.config.vision,key=this.resolveSecret(c.apiKeySecret);return c.endpoint&&c.model&&key?{endpoint:c.endpoint,model:c.model,apiKey:key}:null;},(usage,model)=>this.host?.reportUsage(usage,{model,label:'QQ辅助视觉'}));
    this.stickers = new StickerStore(this.stickerDirAbs || this.emojiDirAbs, this.config.vision, this.log, this.dataDir, (name) => this.resolveSecret(name),(usage,model)=>this.host?.reportUsage(usage,{model,label:'QQ表情标注'}),(bytes,ext)=>this.pushStickerToQQFavorites(bytes,ext),this.config.localResourcesDir || this.dataDir);
    this.syncConfigRoster();
    this.driver = this.createDriver();
    await this.driver.start();
    this.policyTimer = setInterval(() => this.publishSendPolicy(), 2000);
    this.loadState();
    this.initProactive();
    // 闹钟/记事本：装载存储并启动到点检查（每 30s 扫一次；离线期间到期的也会在启动后补发）。
    this.reminders = new ReminderStore(this.dataDir, this.log.child('reminder'));
    this.reminderTimer = setInterval(
      () => void this.checkReminders().catch((e) => this.log.warn('提醒检查异常', { err: String(e) })),
      30_000,
    );
    // 私人笔记存放在本扩展的 notebook.jsonl。
    this.notebook = new Notebook(this.dataDir, this.log.child('notebook'));
    // 外号记忆：外号→QQ 映射（持久化，跨重启保留）。
    this.aliasesFile = this.dataDir ? join(this.dataDir, 'qqbot-aliases.json') : '';
    this.loadAliases();


  }

  /** 装载外号→QQ 记忆（qqbot-aliases.json）。 */
  private loadAliases(): void {
    if (!this.aliasesFile || !existsSync(this.aliasesFile)) return;
    try {
      const raw = JSON.parse(readFileSync(this.aliasesFile, 'utf8'));
      const map: Record<string, number> = raw?.aliases ?? {};
      for (const [k, v] of Object.entries(map)) {
        if (typeof k === 'string' && Number.isFinite(v)) this.aliases.set(k.toLowerCase(), Number(v));
      }
    } catch (e) {
      this.log.warn('外号记忆装载失败', { err: String(e) });
    }
  }

  /** 持久化外号→QQ 记忆。 */
  private saveAliases(): void {
    if (!this.aliasesFile) return;
    try {
      const obj: Record<string, number> = {};
      for (const [k, v] of this.aliases) obj[k] = v;
      writeFileSync(this.aliasesFile, JSON.stringify({ aliases: obj }, null, 2));
    } catch (e) {
      this.log.warn('外号记忆保存失败', { err: String(e) });
    }
  }

  /** 查外号记忆：外号（小写）命中返回 QQ 号。 */
  private resolveAlias(alias: string): number | undefined {
    return this.aliases.get(String(alias ?? '').trim().toLowerCase());
  }

  /** 装配主动说话调度器（移植自 fat-fish ProactiveSpeaker）。 */
  private initProactive(): void {
    this.proactive = new ProactiveSpeaker({
      cfg: this.config.proactive, log: this.log, dataDir: this.dataDir,
      getTargets: () => this.proactiveTargets(), routine: this.config.routine,
      isPaused: () => !this.host || this.host.isPaused?.() === true || !!this.streamGate?.blocked(),
      isQuiet: () => this.isQuietHours(),
      request: async (target, reason) => {
        if (!this.host || !this.proactiveTargets().some(t => t.address === target.address)) return false;
        await this.host.pushEvent({type: 'qq.proactive', source: SOURCE, origin: 'internal',
          ts: eventTs(this.config.timezone), senderKey: target.address,
          text: 'QQ 主动交流机会：' + target.address + '；原因：' + reason + '。根据当前会话、记忆和发送限制，自行决定是否用 qq_send 说话；没有新内容可以保持安静。',
          meta: {conv: target.address, reason}}, {trigger: 'debounce'});
        return true;
      },
    });
    for (const sent of this.recentSends) this.proactive.notifySent(sent.conv, Date.parse(sent.at));
    this.proactive.start();
  }

  /** 按 mode 过滤出可主动说话的监听会话。 */
  private proactiveTargets(): ProactiveTarget[] {
    const mode = this.config.proactive.mode;
    const out: ProactiveTarget[] = [];
    for (const c of this.convs.values()) {
      if (!c.active) continue;
      if (!this.canRead(c.address) || this.historyOnlyConvs.has(c.address)) continue;
      if (this.checkReplyMode(c.address)) continue;
      if (mode === 'private' && c.kind !== 'private') continue;
      if (mode === 'group' && c.kind !== 'group') continue;
      out.push({ address: c.address, kind: c.kind, label: c.label });
    }
    return out;
  }

  /** 解析密钥：仅调用宿主提供的密钥解析器，不探测或读取部署目录中的 .env 文件。 */
  private resolveSecret(name: string): string | undefined {
    const n = (name || '').trim();
    if (!n) return undefined;
    try {
      const v = this.secretResolver?.(n);
      return v && v.trim() ? v.trim() : undefined;
    } catch (e) {
      this.log?.warn?.('密钥解析失败', { secret: n, err: String(e) });
      return undefined;
    }
  }

  /** 把配置里的语音设置解析成运行时配置（已解析密钥）。 */
  private voiceRuntime(): RuntimeVoiceCfg {
    const v = this.config.voice;
    return {
      enabled: v.enabled,
      provider: v.provider,
      tts: v.tts,
      voiceBaseUrl: v.voiceBaseUrl,
      voiceApiKey: this.resolveSecret(v.voiceApiKeySecret) ?? '',
      voiceVoice: v.voiceVoice,
      voiceTtsModel: v.voiceTtsModel,
      voiceTimeout: (typeof v.voiceTimeout === 'number' && v.voiceTimeout > 0 ? v.voiceTimeout : 120) * 1000,
      voiceExtraTts: parseJsonObject(v.voiceExtraTts),
      voxcpmUrl: v.voxcpmUrl || '',
      voxcpmVoiceDesc: v.voxcpmVoiceDesc || '自然女声',
      voxcpmSpeed: typeof v.voxcpmSpeed === 'number' && v.voxcpmSpeed > 0 ? v.voxcpmSpeed : 1.0,
      voxcpmTimesteps: typeof v.voxcpmTimesteps === 'number' && v.voxcpmTimesteps > 0 ? v.voxcpmTimesteps : 10,
      voxcpmSeed: typeof v.voxcpmSeed === 'number' && v.voxcpmSeed >= 0 ? v.voxcpmSeed : 0,
    };
  }

  /** 当前作息状态文本（睡眠/午休/活跃），用于注入主动说话与人格上下文；未开启返回空。 */
  private routineSegmentText(): string {
    const quiet = [
      `【QQ回复开关】群聊${this.config.replyGroups ? '开启' : '关闭'}；私聊${this.config.replyPrivates ? '开启' : '关闭'}。关闭的渠道不接收消息或通知，也禁止发送文字、图片、语音、戳一戳或主动互动。`,
      `【QQ私聊条数】对同一条来信的回复${this.config.maxPrivateMessagesPerReply > 0 ? '最多 ' + this.config.maxPrivateMessagesPerReply + ' 条（文字、图片、语音共用，多次调用及后续回合不重置）' : '不限条数'}。几个字也能独立成消息，用换行分段，默认简短回应后等对方；不要把上限用满。私聊不引用，所有 QQ 输出禁止原生表情；收藏表情用真实文件名，普通图片用 images。`,
      `【QQ连接】${this.connected ? '已连接' : '未连接，禁止尝试发送，等待连接恢复'}。`,
      this.config.replyPrivates ? `【已开放读取的监听私聊】${toIds(this.config.privates).map(id => `QQ ${id}（to=private:${id}）`).join('；') || '无'}。无历史记录不代表会话关闭；按本条当前限制判断能否发送，不沿用旧笔记里的关闭判断。` : '',
      this.streamGate?.blocked() ? '【QQ直播屏蔽】当前禁止回复，输入暂存，等待屏蔽解除。' : '',
      this.isQuietHours() ? this.config.quietReply.enabled
        ? `【QQ静默】禁止主动发消息或提醒。仅可被动回复静默白名单：群号 ${this.config.quietReply.groups || '无'}；私聊 QQ ${this.config.quietReply.privates || '无'}。白名单仍受回复开关限制，没有新入站消息不得发送。`
        : '【QQ静默】群聊禁止发送，仅允许私聊。'
        : '【QQ静默】当前不在静默时段。',
    ].filter(Boolean).join('\n');
    const r = this.config.routine;
    if (!r?.enabled) return quiet;
    const seg = routineSegment(r);
    const self = this.resolveSelfRef();
    const text =
      seg === 'sleep'
        ? `【当前作息】睡眠时段：${self}在休息，允许回复时语气可以带点困、简短些。`
        : seg === 'lazy'
        ? `【当前作息】午休/打盹时段：${self}在摸鱼歇着，聊可以但别太耗能。`
        : `【当前作息】活跃时段：${self}精神着呢。`;
    return quiet ? quiet + '\n' + text : text;
  }

  private publishSendPolicy(): void {
    void this.prunePendingIncoming();
    if (!this.host?.pushDeferred || this.sendPolicyQueued) return;
    this.sendPolicyQueued = true;
    this.host.pushDeferred({type: 'qq.send_policy', origin: 'internal', render: () => {
      this.sendPolicyQueued = false;
      const text = this.routineSegmentText();
      if (text === this.deliveredSendPolicy) return null;
      this.deliveredSendPolicy = text;
      return `【QQ当前发送限制，以本条最新状态为准】\n${text}\n受限会话的消息只供记录，不要回复、兜底发送或转发到其他渠道。被拦截后等待状态变化，不反复调用发送工具。`;
    }}, {trigger: 'piggyback'});
  }

  private canRead(address: string): boolean {
    const match = /^(group|private):([1-9]\d*)$/.exec(address);
    return !!match && this.isListened(match[1] as 'group'|'private', Number(match[2]))
      && (match[1] === 'group' ? this.config.replyGroups : this.config.replyPrivates);
  }

  private async prunePendingIncoming(): Promise<void> {
    if (!this.host?.drainPendingEvents || this.pruningIncoming) return;
    this.pruningIncoming = true;
    try {
      const events = await this.host.drainPendingEvents(e => e.source === SOURCE && !!e.senderKey
        && (!this.canRead(e.senderKey) || (e.type === 'qq.message' && !e.meta?.history
          && Date.parse(String(e.meta?.sourceTs ?? e.ts)) < this.connectedAtSec * 1000)));
      for (const e of events) if (this.canRead(e.senderKey!)) this.queueStartupHistory(e);
    } catch (error) {this.log.warn('QQ 排队消息权限核对失败', {error:String(error)});}
    finally {this.pruningIncoming = false;}
  }

  private messageDate(ev: OneBotMessage): Date | null {
    const raw = Number(ev.time);
    const date = new Date(raw > 1e12 ? raw : raw * 1000);
    return raw > 0 && Number.isFinite(date.getTime()) ? date : null;
  }

  private captureStartupMessage(ev: OneBotMessage, address: string): boolean {
    const sentAt = this.messageDate(ev);
    if (sentAt && sentAt.getTime() >= this.connectedAtSec * 1000) return false;
    if (this.processedIds.size > 60000) this.processedIds.clear();
    if (ev.message_id != null) this.processedIds.add(String(ev.message_id));
    if ((this.lastUserMsgAt.get(address) ?? 0) < this.connectedAtSec * 1000) this.historyOnlyConvs.add(address);
    if (this.startupHistoryCount >= 10) return true;
    this.queueStartupHistory({type:'qq.message',source:SOURCE,ts:eventTs(this.config.timezone,sentAt ?? new Date()),
      senderKey:address,text:`${sentAt ? sentAt.toISOString() : '原发送时间未知'} ${externalName(ev.sender?.card || ev.sender?.nickname)}(QQ:${ev.user_id})：#${ev.message_id ?? ''} ${renderIncoming(ev.message ?? ev.raw_message ?? '',{timezone:this.config.timezone,selfId:this.identity?.selfId ?? 0})}`,
      meta:{conv:address,platformMessageId:String(ev.message_id ?? ''),sourceTimeKnown:!!sentAt}});
    return true;
  }

  private queueStartupHistory(event: Omit<EventEnvelope, 'cursor'|'origin'|'contextDelivery'>): void {
    const address = event.senderKey ?? '';
    if (!this.canRead(address)) return;
    if ((this.lastUserMsgAt.get(address) ?? 0) < this.connectedAtSec * 1000) this.historyOnlyConvs.add(address);
    if (this.startupHistoryCount >= 10) return;
    this.startupHistoryCount++;
    this.enqueue(async () => {
      if (!this.canRead(address)) return;
      let text = event.text;
      if (this.config.contentReviewUrl) {
        try {text = await reviewMemory(this.config.contentReviewUrl, text, 'received');}
        catch {text = '[历史消息内容审核不可用，原文未读取]';}
      }
      await this.pushIncomingMessage({...event, text:`【启动历史补读，仅作背景，不回复、不补发】\n${text}`,
        blobs:undefined, meta:{...event.meta,history:true}}, 'debounce');
    });
  }

  private incomingReplyBlock(address: string): string | null {
    const blocked = this.checkReplyMode(address);
    if (blocked) return blocked;
    if (this.driver?.connected === false) return QQWorld.SEND_BLOCKED + 'QQ 未连接，等待连接恢复。';
    if (this.streamGate?.blocked()) return QQWorld.SEND_BLOCKED + '直播期间禁止回复。';
    if (!this.isQuietHours()) return null;
    if (this.config.quietReply.enabled) return quietReplyAllowed(address, this.config.quietReply)
      ? null : QQWorld.SEND_BLOCKED + '该会话不在静默回复白名单。';
    return address.startsWith('group:') ? QQWorld.SEND_BLOCKED + '静默期间禁止回复群聊。' : null;
  }

  private async pushIncomingMessage(event: Omit<EventEnvelope, 'cursor' | 'origin' | 'contextDelivery' | 'blobs'> & {blobs?: BlobInput[];origin?:'internal'|'external'}, trigger: 'flush' | 'debounce' | 'piggyback' = 'debounce'): Promise<void> {
    const address = String(event.senderKey ?? '');
    if (!this.canRead(address)) return;
    this.publishSendPolicy();
    const archived = await this.host!.pushEvent(event, {deliver:false});
    if (!this.canRead(address)) return;
    const blockedNow = event.meta?.history || this.incomingReplyBlock(address);
    const meta = {...event.meta, sourceTs:event.meta?.sourceTs ?? event.ts, sourceCursor:archived.cursor, replyAllowed:false};
    this.host!.pushDeferred({type:event.type, senderKey:address, meta, origin:event.origin ?? 'external', render:() => {
      if (!this.canRead(address)) return null;
      const blocked = event.meta?.history ? '历史补读不回复' : this.incomingReplyBlock(address);
      meta.replyAllowed = !blocked;
      if (!blocked && event.type === 'qq.message' && address.startsWith('private:') && event.meta?.inputRejected) this.pendingFilteredReplies.add(address);
      if (!blocked && event.type === 'qq.message' && (address.startsWith('private:') || event.meta?.atMe)) this._pendingReplyConvs.add(address);
      return {text:`【原消息时间 ${meta.sourceTs}】\n${blocked ? `【QQ仅供记录，禁止回复：${blocked}】\n` : ''}${event.meta?.inputRejected ? '【本条输入被审核拦截，回合结束时程序发送一次 filtered；不要回答敏感内容、复述原文或追加其他回复。】\n' : ''}${event.text}`, blobs:archived.blobs};
    }}, {trigger:blockedNow ? 'piggyback' : trigger});
  }

  /** 当前时间（按配置时区格式化），供对话前缀与主动说话共用。 */
  private nowText(): string {
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: this.config.timezone,
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(new Date());
    } catch {
      return new Date().toLocaleString('zh-CN');
    }
  }

  /** 节日/节气/农历感知文本（按配置时区推算），供对话前缀与主动说话共用。 */
  private festivalLine(): string {
    try {
      return festivalText(this.config.timezone);
    } catch {
      return '';
    }
  }

  /** 解析主动说话/作息文本里用的自称。
   *  未显式配置时使用「我」，QQ 昵称属于外部数据。 */
  private resolveSelfRef(): string {
    const explicit = (this.config.selfName ?? '').trim();
    if (explicit) return explicit;
    return '我';
  }

  /** 拉取该会话最近的真实对话（来自框架 EventStore），作为主动说话的「事实基底」，避免凭空编造。
   *  按 senderKey（会话）在事件库里直接查询——不是先取全局再本地过滤，否则该会话的条数会被别的会话挤掉。
   *  取最近 60 条、截断到 40 行，自己说过的话标 [我]，截断到 3000 字。 */
  private recentContextFor(address: string): string {
    if (!this.canRead(address)) return '';
    try {
      const events = this.host?.store?.range?.({source: SOURCE, senderKey: address, limit: 60}) ?? [];
      const confirmed = new Set<string>();
      const rows = events
        .filter(e => e.contextDelivery !== 'archive-only' && e.text.trim())
        .map(event => {
          const original = typeof event.meta?.sourceCursor === 'number' ? this.host?.store?.get?.(event.meta.sourceCursor) : undefined;
          const e = original?.source === SOURCE && original.senderKey === address ? original : event;
          const body = (e.type === 'qq.sent' && typeof e.meta?.text === 'string' ? e.meta.text : e.text).replace(/\s+/g, ' ').trim();
          if (e.type === 'qq.sent' && e.meta?.textOnly === true && typeof e.meta?.messageId === 'string') confirmed.add(e.meta.messageId);
          const isSelf = e.meta?.self === true || e.meta?.role === 'assistant';
          const speaker = e.meta?.role === 'system' ? '[记录]' : isSelf ? '[我]' : '[对方]';
          return {at: e.ts, speaker, text: body};
        });
      for (const sent of this.recentSends.filter(row => row.conv === address)) {
        if (sent.messageIds.length && sent.messageIds.every(id => confirmed.has(id))) continue;
        rows.push({at:sent.at, speaker:'[我，协议已确认发送]', text:sent.text});
      }
      rows.sort((a,b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
      const lines: string[] = []; let used = 0;
      for (const row of rows.slice(-40).reverse()) {
        const line = `[${row.at}] ${row.speaker} ${row.text.length > 1200 ? row.text.slice(0,1200) + '…[后文省略]' : row.text}`;
        if (used + line.length + 1 > 3000) break;
        lines.unshift(line); used += line.length + 1;
      }
      return lines.join('\n');
    } catch {
      return '';
    }
  }

  async stop(): Promise<void> {
    if (this.policyTimer) clearInterval(this.policyTimer);
    this.policyTimer = null;
    await this.streamGate?.stop(); this.streamGate = null;
    for (const c of this.convs.values()) {
      if (c.aggregationTimer) {
        clearTimeout(c.aggregationTimer);
        c.aggregationTimer = undefined;
      }
    }
    if (this.stateSaveTimer) {
      clearTimeout(this.stateSaveTimer);
      this.stateSaveTimer = undefined;
    }
    this.saveState();
    this.stickers?.flush();
    if (this.reminderTimer) clearInterval(this.reminderTimer);
    this.reminderTimer = undefined;
    this.reminders?.flush();
    this.proactive?.stop();
    if (this.driver) await this.driver.stop();
    this.driver = null;
    this.connected = false;
    for (const s of this.eventSockets) s.close('world stopped');
    this.eventSockets.clear();
  }

  /**
   * 到点自动提醒：扫描所有到期未完成提醒，发到对应会话，并把“已提醒”回灌进上下文
   * （让 bot 记得自己提醒过、便于接话）。注意：提醒只是“到点说一声”，到底做不做、怎么做，
   * 由 bot 自己根据情境判断决定——不强求执行，也不反复催促。bot 睡眠/暂停时不阻止提醒（约定到点了该响）。
   */
  private async checkReminders(): Promise<void> {
    if (this.host?.isPaused?.()) return;
    if (this.config.quietReply.enabled && this.isQuietHours()) return;
    if (!this.config.reminder?.enabled) return;
    const due = this.reminders.due();
    if (!due.length) return;
    for (const r of due) {
      if (this.host?.isPaused?.()) return;
      const addr = r.address || '';
      if (this.checkQuiet(addr)) continue;
      const body = `⏰ 到点提醒：${r.text}` + (r.scope ? `（${r.scope}）` : '');
      if (addr) {
        try {
          await this.sendTo(addr, body, undefined, undefined, new Map());
        } catch (e) {
          this.log.warn('提醒发送失败', { id: r.id, address: addr, err: String(e) });
          if (this.host?.isPaused?.()) return;
        }
      } else {
        this.log.warn('提醒缺少发送地址，已跳过发送', { id: r.id, text: r.text });
      }
      // 回灌上下文：注明提醒到点已发出，并点明“做不做由我自己看着办”，避免模型误以为必须执行/反复催。
      try {
        this.host?.pushEvent({
          type: 'qq.message',
          ts: eventTs(this.config.timezone),
          source: SOURCE,
          origin: 'internal',
          text:
            `我之前记的定时提醒「${r.text}」${r.scope ? `（${r.scope}）` : ''}到点了，我已经${addr ? '在该会话提醒了一声' : '准备提醒'}。` +
            `至于这件事到底做不做、怎么做，由我自己根据当下情况决定，不必硬照办，也不反复催。`,
          senderKey: addr,
          meta: { conv: addr, role: 'assistant', self: true },
        }, { trigger: 'piggyback' });
      } catch (e) {
        this.log.warn('提醒回灌上下文失败', { err: String(e) });
      }
      this.reminders.markDone(r.id);
    }
    this.reminders.flush();
  }

  // ---- 状态持久化（跨重启重建 knownMessages，防串台索引不丢）----
  private loadState(): void {
    if (!this.stateFile || !existsSync(this.stateFile)) return;
    try {
      const raw = JSON.parse(readFileSync(this.stateFile, 'utf8')) as { knownMessages?: Record<string, { conv: string; ts: number }>; recentSends?: Array<{conv:string;at:string;text:string;messageIds:string[]}> };
      const km = raw.knownMessages ?? {};
      for (const [k, v] of Object.entries(km)) this.knownMessages.set(k, { conv: v.conv, ts: v.ts });
      this.recentSends = (raw.recentSends ?? []).filter(row => typeof row.conv === 'string' && typeof row.text === 'string' && Number.isFinite(Date.parse(row.at)) && Array.isArray(row.messageIds)).slice(-24);
      this.log.info('已恢复 knownMessages', { count: this.knownMessages.size });
    } catch (e) {
      this.log.warn('读取 qqbot 状态失败', { err: String(e) });
    }
  }

  private saveState(): void {
    if (!this.stateFile) return;
    try {
      const obj = { knownMessages: Object.fromEntries(this.knownMessages), recentSends:this.recentSends };
      writeFileSync(this.stateFile, JSON.stringify(obj), 'utf8');
    } catch (e) {
      this.log.warn('保存 qqbot 状态失败', { err: String(e) });
    }
  }

  /** 防抖落盘：每条消息索引更新后调用，1.5s 内合并一次写入。 */
  private scheduleSaveState(): void {
    if (!this.stateFile) return;
    if (this.stateSaveTimer) return;
    this.stateSaveTimer = setTimeout(() => {
      this.stateSaveTimer = undefined;
      this.saveState();
    }, 1500);
  }

  private async reloadIdentity(): Promise<void> {
    if (!this.driver) return;
    try {
      this.identity = await this.driver.refreshIdentity();
      this.log.info('已加载身份', { selfId: this.identity.selfId, groups: this.identity.groups.size, friends: this.identity.friends.size });
      this.syncConfigRoster();
      // 身份（尤其好友备注）到位后，把「私聊<QQ>」这类占位标签补成真名。
      this.refreshConvLabels();
    } catch (e) {
      this.log.warn('加载身份失败', { err: String(e) });
    }
  }

  private syncConfigRoster(): void {
    for (const conv of this.convs.values()) conv.active = this.isListened(conv.kind, conv.id);
    for (const g of toIds(this.config.groups)) this.ensureConv('group', g);
    for (const p of toIds(this.config.privates)) this.ensureConv('private', p);
  }

  private ensureConv(kind: 'group' | 'private', id: number): Conv {
    const address = `${kind}:${id}`;
    let c = this.convs.get(address);
    if (!c) {
      c = {
        kind,
        id,
        address,
        label: kind === 'group' ? (this.identity?.groups.get(id) ?? `群${id}`) : this.privateLabel(id),
        active: true,
      };
      this.convs.set(address, c);
    }
    c.active = this.isListened(kind, id);
    return c;
  }

private async pushStickerToQQFavorites(bytes: Uint8Array, ext: string): Promise<string | null> {
    if (!this.config.sticker.addToQQFavorites) return null;
    if (!this.driver) return null;
    const base64 = Buffer.from(bytes).toString('base64');
    try {
      const res = (await this.driver.callApi('add_custom_face', { file: `base64://${base64}` })) as
        | { emoji_id?: string; data?: { emoji_id?: string } }
        | undefined;
      const eid = res?.emoji_id ?? res?.data?.emoji_id ?? null;
      if (eid) this.log.info('已加入 QQ 收藏表情', { emojiId: eid, ext });
      else this.log.warn('add_custom_face 未返回 emoji_id', { res });
      return eid ?? null;
    } catch (e) {
      this.log.warn('加入 QQ 收藏表情失败（协议端可能不支持 add_custom_face，或 QQ 收藏表情已达上限）', { err: String(e), ext });
      return null;
    }
  }

  private convLabel(address: string): string {
    const label = this.convs.get(address)?.label;
    return label ? `${address}（${externalName(label)}）` : address;
  }

  /** 私聊对方的真名：好友备注 > 好友昵称 > 已知昵称 > 私聊<QQ>。 */
  private privateLabel(id: number): string {
    const f = this.identity?.friends.get(id);
    const name = (f?.remark ?? '').trim() || (f?.nickname ?? '').trim() || (this.identity?.knownPeers.get(id)?.nickname ?? '').trim();
    return name || `私聊${id}`;
  }

  /** 某人的所有称呼变体（备注/昵称/已知昵称），去重，供称呼校验用。 */
  private nameVariantsFor(id: number): string[] {
    const out: string[] = [];
    const push = (v: string | undefined): void => {
      const t = (v ?? '').trim();
      if (t && !out.includes(t)) out.push(t);
    };
    const f = this.identity?.friends.get(id);
    push(f?.remark);
    for (const [alias,qq] of this.aliases) if (qq === id) push(alias);
    push(f?.nickname);
    push(this.identity?.knownPeers.get(id)?.nickname);
    push(this.identity?.knownPeers.get(id)?.card);
    push(this.identity?.groups.get(id));
    for (const c of this.convs.values()) if (c.kind === 'private' && c.id === id) push(c.label);
    return out;
  }

  /**
   * 「别人」的名字表（用于主动说话前校验有没有喊错人）：好友备注/昵称、已知昵称、群成员名片、外号。
   * 按长度倒序，便于优先匹配更具体的名字。excludeId 是对当前对话对象本人的 QQ 号。
   */
  private otherPersonNames(excludeId: number): string[] {
    const set = new Set<string>();
    const add = (v: string | undefined): void => {
      const t = (v ?? '').trim();
      if (t.length >= 2) set.add(t);
    };
    for (const [id, f] of this.identity?.friends ?? []) {
      if (id === excludeId) continue;
      add(f.remark);
      add(f.nickname);
    }
    for (const [id, p] of this.identity?.knownPeers ?? []) {
      if (id === excludeId) continue;
      add(p.nickname);
      add(p.card);
    }
    for (const c of this.convs.values()) {
      if (c.kind !== 'private' || c.id === excludeId) continue;
      add(c.label);
    }
    for (const key of this.aliases.keys()) {
      if (this.aliases.get(key) === excludeId) continue;
      add(key);
    }
    return [...set].sort((a, b) => b.length - a.length);
  }

  /** 会话的真名（群名 / 私聊对方真名），供「你现在在跟谁说话」与称呼守卫使用。 */
  private displayNameOf(address: string): string {
    const [kind, idStr] = String(address ?? '').split(':');
    const id = Number(idStr);
    if (!Number.isFinite(id)) return '';
    if (kind === 'group') return this.identity?.groups.get(id) ?? this.convs.get(address)?.label ?? `群${id}`;
    return this.privateLabel(id);
  }

  /**
   * 身份加载后回填会话标签：私聊从「私聊<QQ>」补成好友备注/昵称，群聊补成群名。
   * 启动时会话是按配置名单建的（那时还没身份），故必须在这里回填，否则提示词里只有一串数字。
   */
  private refreshConvLabels(): void {
    for (const c of this.convs.values()) {
      const next = c.kind === 'group' ? (this.identity?.groups.get(c.id) ?? c.label) : this.privateLabel(c.id);
      if (next && next !== c.label) {
        this.log.info('会话标签更新', { address: c.address, from: c.label, to: next });
        c.label = next;
      }
    }
  }

  /**
   * 主动说话前的称呼硬守卫（只对私聊生效）：若开头喊的是「别人」的名字（好友/群成员/外号里存在、且不属于当前对象），
   * 就把那一处改成当前对象的真名，并返回改动信息（调用方会回灌一条「称呼纠正」内部事件让她记住）。
   */
  private correctMisaddressed(text: string, address: string): { text: string; wrong?: string; right?: string } {
    const [kind, idStr] = String(address ?? '').split(':');
    if (kind !== 'private') return { text };
    const id = Number(idStr);
    if (!Number.isFinite(id)) return { text };
    const right = this.displayNameOf(address);
    if (!right || right === `私聊${id}`) return { text }; // 连真名都不知道就不动，免得改错
    const own = new Set(this.nameVariantsFor(id).map((n) => n.toLowerCase()));
    // 只看开头（跳过引号/括号等装饰），避免正文里正常提到别人的名字被误改。
    const lead = text.replace(/^[\s"'“”‘’「」『』【】（）()\[\]<>《》@]+/, '');
    const wrong = this.otherPersonNames(id).find((n) => !own.has(n.toLowerCase()) && lead.startsWith(n));
    if (!wrong) return { text };
    const idx = text.indexOf(wrong);
    if (idx < 0) return { text };
    this.log.warn('主动私聊称呼错人，已自动改口', { address, wrong, right });
    return { text: text.slice(0, idx) + right + text.slice(idx + wrong.length), wrong, right };
  }

  // ---- 群管理员：待审进群请求缓存 ----
  /** key=请求 flag（OneBot 事件唯一标识），value=加群请求上下文。供 qq_admin_join_* 工具读取与处理。 */
  private pendingJoinRequests: Map<string, { flag: string; groupId: number; userId: number; comment: string; subType: string; ts: number }> = new Map();

  /**
   * 记录每个会话「最近一次说话的人」(QQ 号) 及时间戳，用于管理员操作的指挥官鉴权：
   * 工具被调用时，以「当前会话最近发言者」作为命令来源，判断其是否有权指挥 bot 执行管理操作。
   * 仅保留 2 分钟内的记录，超时视为无法确定来源。
   */
  private callerByConv: Map<string, { userId: number; at: number }> = new Map();

  /**
   * 处理加群请求事件（post_type=request，request_type=group）。把待审请求存进 pendingJoinRequests，
   * 并通过内部事件通知 bot（trigger=piggyback，不打断当前回合），让它决定是否通过/拒绝。
   */
  private async handleGroupRequest(ev: OneBotMessage): Promise<void> {
    const anyEv = ev as unknown as Record<string, unknown>;
    if (anyEv.request_type !== 'group') return;
    const flag = String(anyEv.flag ?? '');
    const groupId = Number(anyEv.group_id);
    const userId = Number(anyEv.user_id);
    if (!flag || !Number.isFinite(groupId) || !Number.isFinite(userId)) return;
    if (!this.canRead(`group:${groupId}`)) return;
    const sentAt = this.messageDate(ev);
    if (sentAt && sentAt.getTime() < this.connectedAtSec * 1000) return;
    const subType = String(anyEv.sub_type ?? 'add');
    const comment = typeof anyEv.comment === 'string' ? anyEv.comment : '';
    this.pendingJoinRequests.set(flag, { flag, groupId, userId, comment, subType, ts: Date.now() });
    try {
      await this.pushIncomingMessage({
        type: 'qq.group-request',
        ts: eventTs(this.config.timezone, sentAt ?? new Date()),
        source: SOURCE,
        text: `有人申请加入群 ${groupId}（QQ ${userId}，类型=${subType === 'invite' ? '邀请' : '主动申请'}），留言：${comment || '（无）'}。这是一条加群请求（flag=${flag}），需要你决定是否通过。可用 qq_admin(action=join_list) 查看全部待审、qq_admin(action=join_approve 或 join_reject) 审核。`,
        senderKey: `group:${groupId}`,
        meta: { conv: `group:${groupId}`, role: 'system', requestFlag: flag },
      }, 'piggyback');
    } catch (e) {
      this.log.warn('进群请求通知失败 ' + String(e));
    }
  }

  // ---- 事件处理 ----
  private handleEvent(ev: OneBotMessage, fromStreamGate = false): Promise<void> | void {
    if (!this.host) return;
    if (ev.post_type === 'meta_event') return;
    if (ev.post_type === 'notice') {
      if (!this.canRead(`${ev.group_id ? 'group' : 'private'}:${ev.group_id ?? ev.user_id ?? 0}`)) return;
      this.enqueue(() => this.handleNotice(ev));
      return;
    }
    // 加群请求事件（审核进群）：交给 handleGroupRequest 缓存，供 qq_admin_join_* 工具处理。
    if (ev.post_type === 'request') {
      if (!this.canRead(`group:${ev.group_id ?? 0}`)) return;
      this.enqueue(() => this.handleGroupRequest(ev));
      return;
    }
    if (ev.post_type !== 'message' && ev.post_type !== 'message_sent') return;
    if (ev.post_type === 'message_sent') return; // 忽略自己发出的回显，避免回环
    if (ev.message_type !== 'group' && ev.message_type !== 'private') return;
    const kind = ev.message_type;
    const id = kind === 'group' ? ev.group_id! : ev.user_id!;
    // 自己回声丢弃（双重保险：NapCat reverse 有时把自身消息以普通 message 回报，
    // 且 identity 偶发未加载，故同时用事件自带的 self_id 判定 sender===self，过滤更稳健）。
    if ((this.identity && Number(ev.user_id) === this.identity.selfId) || Number(ev.user_id) === Number(ev.self_id)) return;
    const address = `${kind}:${id}`;
    if (!this.canRead(address)) return;
    if (ev.message_id != null && this.processedIds.has(String(ev.message_id))) return;
    if (this.captureStartupMessage(ev, address)) return;
    if (!fromStreamGate && this.streamGate?.defer(ev)) {
      this.log.info('QQ消息已暂存', {address,pending:this.streamGate.pending,reason:this.streamGate.blocked() ? '直播屏蔽' : '等待释放前面的暂存消息'});
      return;
    }
    this.historyOnlyConvs.delete(address);
    const conv = this.ensureConv(kind, id);
    conv.lastMessageAt = Date.now();
    this.proactive?.notifyReply(conv.address);
    // 收到对方发言：清零该会话的“bot 连续发言”计数，并刷新最后发言时间（防死循环）。
    this.botStreak.set(conv.address, 0);
    this.lastUserMsgAt.set(conv.address, Date.now());
    if(ev.user_id!=null)this.lastUserMsgAtByQQ.set(Number(ev.user_id),Date.now());
    const sender = this.resolveSender(ev, kind, id);
    // 按 message_id 去重：NapCat reverse 偶发会把同一条消息事件重投两次，
    // 若直接 enqueue 会被处理两遍 → 同一消息回两遍。已在内存里出现过的消息直接丢弃。
    if (ev.message_id != null) {
      const mid = String(ev.message_id);
      if (this.processedIds.has(mid)) {
        this.log.warn('重复消息事件，跳过', { message_id: mid });
        return;
      }
      this.processedIds.add(mid);
      // 内存增长保护：超过 6 万条清空（QQ message_id 单调递增，短期内不会复用）。
      if (this.processedIds.size > 60000) this.processedIds.clear();
    }
    const work = this.enqueue(() => this.handleMessage(ev, conv, sender));
    return fromStreamGate ? work.catch(error => {
      if (ev.message_id != null) this.processedIds.delete(String(ev.message_id));
      throw error;
    }) : work;
  }

  /** 把一条事件处理任务接到串行链上（对齐内置 qq 的 enqueueMessage）。 */
  private enqueue(task: () => Promise<void>): Promise<void> {
    const work = this.msgChain.then(task);
    this.msgChain = work.catch((e) => {
      this.log.error('消息处理链异常', { err: String(e) });
    });
    return work;
  }

  private isListened(kind: 'group' | 'private', id: number): boolean {
    return Number.isSafeInteger(id) && id > 0 && toIds(kind === 'group' ? this.config.groups : this.config.privates).includes(id);
  }

  private resolveSender(ev: OneBotMessage, kind: 'group' | 'private', id: number): QQSenderBrief {
    const s = ev.sender ?? {};
    const userId = ev.user_id ?? 0;
    let name = s.card || s.nickname || `用户${userId}`;
    let role = s.role;
    let title = s.title;
    if (kind === 'group' && this.driver) {
      // 名片可能为空，尝试补一次群成员信息
      if (!s.card && (s.nickname === undefined || s.nickname === '')) {
        void this.driver!.getMemberInfo(id, userId).then((info) => {
          if (info) {
            const c = this.convs.get(`group:${id}`);
            if (c?.members) {
              const prev = c.members.get(userId);
              if (prev) c.members.set(userId, { ...prev, card: info.card, name: info.nickname, role: info.role, title: info.title });
            }
          }
        });
      }
      const conv = this.convs.get(`group:${id}`);
      if (conv) {
        conv.members ??= new Map();
        conv.members.set(userId, { userId, name, card: s.card, role, title });
      }
    }
    void this.identity?.knownPeers.set(userId, { nickname: s.nickname ?? name, card: s.card });
    // 私聊：一旦知道对方昵称，就把会话标签从「私聊<QQ>」补成真名（好友备注优先）。
    if (kind === 'private') {
      const conv = this.convs.get(`private:${id}`);
      if (conv) {
        const next = this.privateLabel(id);
        if (next && next !== conv.label) {
          this.log.info('私聊标签更新', { address: conv.address, from: conv.label, to: next });
          conv.label = next;
        }
      }
    }
    return { userId, name, card: s.card, role, title };
  }

  private async handleMessage(ev: OneBotMessage, conv: Conv, sender: QQSenderBrief): Promise<void> {
    if (!this.canRead(conv.address)) return;
    // 记录本会话最近一次说话人，作为后续管理员操作（撤消息/禁言等）的「指挥官」归属。
    if (sender.userId) this.callerByConv.set(conv.address, { userId: sender.userId, at: Date.now() });
    // 收到即索引 message_id → 会话（防串台核心：引用回复与跨会话校验都靠它，对齐内置）。
    if (ev.message_id != null) {
      this.knownMessages.set(String(ev.message_id), { conv: conv.address, ts: Date.now() });
      this.scheduleSaveState();
    }
    const host = this.host!;
    const segs: OneBotSegment[] =
      typeof ev.message === 'string' ? [{ type: 'text', data: { text: ev.message } }] : (ev.message ?? []);
    const selfId = this.identity?.selfId ?? 0;
    const atMe = segs.some((s) => s.type === 'at' && Number((s as { data: { qq: string } }).data.qq) === selfId);

    // 引用回复
    conv.quotedSenderId = undefined; // 每条消息重新判定，避免沿用上一条旧引用
    const atTargets = segs.filter((s) => s.type === 'at').map((s) => Number((s as { data: { qq: number | string } }).data.qq)).filter((q) => q && q !== selfId);
    conv.lastAtUserId = atTargets[0]; // 触发消息里的 @ 目标，供禁言等管理工具兜底
    let replyText: string | undefined;
    let replyRef: string | undefined;
    const replySeg = segs.find((s) => s.type === 'reply');
    if (replySeg) {
      const rid = Number((replySeg as { data: { id: string } }).data.id);
      const q = await this.resolveQuoted(rid);
      replyRef = q.ref;
      replyText = q.text || undefined;
      if (q.userId) conv.quotedSenderId = q.userId;
    }

    let text = renderIncoming(segs, { timezone: this.config.timezone, selfId, replyText, replyRef });
    this.log.info('HANDLE_IN kind=' + conv.kind + ' text=' + JSON.stringify(text).slice(0, 40));
    // 转发内容先就绪，再投递卡片，避免模型只见占位文字就抢先回复。
    const fwdSeg = segs.find((s) => s.type === 'forward');
    if (fwdSeg) {
      const fwdId = String((fwdSeg as { data: { id: string } }).data.id ?? '');
      if (fwdId) await this.lookupForward(fwdId, conv, ev.message_id ?? '');
    }
    // 纯表情消息（无文字）：face 段无 url 无法收藏但仍需进入处理链（避免静默丢弃）；
    // sticker/image 段会在下方循环里判定是否收藏。
    if (!text && !segs.some((s) => s.type === 'image' || s.type === 'record' || s.type === 'forward' || s.type === 'sticker' || s.type === 'face')) return;

    const blobs: BlobInput[] = [];
    let videoHandled = false;
    for (const s of segs) {
      if (s.type === 'image' && (s.data as { url?: string }).url) {
        const url = (s.data as { url: string }).url!;
        const digest = url.split('?')[0];
        this.recentImages.push({ url, conv: conv.address, at: Date.now() });
        if (this.recentImages.length > 50) this.recentImages.shift();
        if (this.config.deliverImageAttachments && host.modelFacts.accepts('image/png')) {
          const bytes = await this.fetchBytes(url);
          if (bytes) blobs.push({ bytes, mime: 'image/jpeg', name: 'qq-image', fallbackText: '[图片]' });
        }
        if (this.config.vision.enabled && !this.host?.isPaused?.()) {
          try {
            const descP = Promise.resolve(this.vision.register(url, Date.now() + 60_000));
            const desc = await Promise.race([
              descP,
              new Promise<string | null>((res) => setTimeout(() => res(null), 2_500)),
            ]);
            if (desc) {
              if (text) text += '\n';
              text += `[图片内容（${conv.address}）]：${desc}`;
            }
          } catch (e) {
            this.log.warn('图片视觉描述失败 ' + String(e));
          }
        }
        // 图片作为表情包收藏：该图片本身就得是表情（NapCat 推来的表情包常是 image 段，
        // 但 subType 往往为 null，仅靠 subType 会漏采；故同时认 summary 里的表情标记）。
        if (this.config.sticker.enabled && this.stickers) {
          const sd = s.data as { subType?: string; summary?: string };
          const summary = typeof sd.summary === 'string' ? sd.summary : '';
          const isStickerLike = sd.subType === 'sticker' || /\[?(动画)?表情|贴纸|sticker|emoji/i.test(summary);
          const asSticker = isStickerLike || this.config.sticker.captureMode === 'allImages';
          if (asSticker && !this.host?.isPaused?.()) {
            this.stickers.ingest(url, conv.address, summary);
          }
        }
      } else if (s.type === 'sticker' && (s.data as { url?: string }).url) {
        // 真实表情包段（type=sticker）必须在顶层处理，不能塞进 image 分支里。
        if (this.config.sticker.enabled && this.stickers) {
          const url = (s.data as { url: string }).url!;
          const sd = s.data as { subType?: string; summary?: string };
          const summary = typeof sd.summary === 'string' ? sd.summary : '';
          if (!this.host?.isPaused?.()) this.stickers.ingest(url, conv.address, summary);
        }
      } else if (s.type === 'video') {
        let preview: { text: string; blob?: BlobInput } = { text: '[视频未读取：当前模型或配置未启用图片附件]' };
        if (videoHandled) preview.text = '[视频未读取：每条消息最多预览一个视频]';
        else if (this.host?.isPaused?.()) preview.text = '[视频未读取：运行已暂停]';
        else if (this.config.deliverImageAttachments && host.modelFacts.accepts('image/jpeg')) {
          preview = await previewVideo(String(s.data.url ?? ''), ['ffmpeg'], this.dataDir);
        }
        videoHandled = true;
        text += '\n' + preview.text;
        if (preview.blob) blobs.push(preview.blob);
      } else if (s.type === 'record') {
        text += '\n[语音消息：主包不读取音频；可用独立 QQ Audio Input 的 qq_audio_transcribe 工具，消息编号 ' + String(ev.message_id ?? '') + ']';
      }
    }

    let inputRejected = false;
    if (this.config.contentReviewUrl && text.trim()) {
      try {text = await reviewMemory(this.config.contentReviewUrl, text, 'received', () => {inputRejected = true;});}
      catch {inputRejected = true; text = '[收到一条消息，内容审核暂不可用，原文未进入对话]';}
    }

    const baseMeta = {
      sourceTs: eventTs(this.config.timezone, this.messageDate(ev) ?? new Date()),
      conv: conv.address,
      role: sender.role,
      user: sender.userId,
      // 私聊分流地址：群里回复时，AI 若判断话题涉及隐私/尴尬/敏感，可把回复改发到当事人私聊（private:<QQ>）。
      senderPrivate: sender.userId ? `private:${sender.userId}` : undefined,
      atMe,
      card: sender.card,
      title: sender.title,
      platformMessageId: String(ev.message_id ?? ''),
      channel: 'qq',
      inputRejected,
    };

    if (conv.kind === 'private' && !inputRejected && this.config.privateAggregationWindow > 0 && !this.incomingReplyBlock(conv.address)) {
      this.aggregatePrivate(conv, sender, text, blobs, baseMeta);
      return;
    }

    let sendClock = '';
    try { sendClock = shortTime(this.config.timezone, new Date((ev.time ?? Date.now() / 1000) * 1000)); } catch (e) { this.log.warn('shortTime FAIL ' + String(e)); }
    const senderTag = `${externalName(sender.name)}(QQ:${sender.userId})`;
    const channelPrefix = conv.kind === 'group'
      ? `【QQ群 ${conv.id} ${sendClock}】${externalName(conv.label)} ${senderTag}`
      : `【QQ私聊 ${sendClock} ${senderTag}】`;
    // 把这条消息在 QQ 上的真实身份编号（#message_id）带进上下文：模型据此才能引用/回复
    // 任意一条历史消息（对齐内置 qq world 的 idTag 渲染）。在自己发消息时 qq_send 的返回里
    // 也会给 message_id，这里补上入站消息，使「引用消息」功能完整闭环。
    const idTag = ev.message_id != null ? `#${ev.message_id} ` : '';
    this.log.info('HANDLE_PUSH pre kind=' + conv.kind);
    // 记录“应当回复”的会话，供回合收束时兜底自动发送（模型若只输出文本未调 qq_send）。
    try {
      await this.pushIncomingMessage({
        type: 'qq.message',
        ts: eventTs(this.config.timezone, new Date((ev.time ?? Date.now() / 1000) * 1000)),
        source: SOURCE,
        text: `${channelPrefix}：${idTag}${text}`,
        senderKey: conv.address,
        meta: { ...baseMeta, sender: senderTag },
        blobs: blobs.length ? blobs : undefined,
        }, atMe ? 'flush' : 'debounce');
        this.log.info('HANDLE_PUSH ok');
    } catch (e) {
      this.log.error('HANDLE_PUSH FAIL ' + String(e));
    }
  }

  private aggregatePrivate(conv: Conv, sender: QQSenderBrief, text: string, blobs: BlobInput[], meta: Record<string, unknown>): void {
    const host = this.host!;
    const now = Date.now();
    const win = this.config.privateAggregationWindow;
    const senderTag = `${String(meta.sourceTs ?? new Date(now).toISOString())} ${externalName(sender.name)}(QQ:${sender.userId})`;
    const pend = conv.pendingAggregatedText;
    if (pend && now - pend.firstAt < win) {
      // 仍在窗口内：累积到暂存文本，已排定的到期冲刷计时器保持不变
      pend.text += `\n${senderTag}：${text}`;
      pend.blobs.push(...blobs);
      return;
    }
    // 窗口已过期（或无暂存）：先把上一段冲刷出去（如有），再开新的一段并排定到期冲刷
    if (pend) {
      if (conv.aggregationTimer) {
        clearTimeout(conv.aggregationTimer);
        conv.aggregationTimer = undefined;
      }
      void this.pushIncomingMessage({
        type: 'qq.message',
        ts: pend.sourceTs ?? eventTs(this.config.timezone, new Date(pend.firstAt)),
        source: SOURCE,
        text: pend.text,
        senderKey: conv.address,
        meta: { ...meta, sourceTs:pend.sourceTs, sender: '对话' },
        blobs: pend.blobs,
      });
    }
    conv.pendingAggregatedText = { text: `${senderTag}：${text}`, blobs: [...blobs], firstAt: now, sourceTs:String(meta.sourceTs ?? new Date(now).toISOString()) };
    const segMeta = meta;
    conv.aggregationTimer = setTimeout(() => {
      conv.aggregationTimer = undefined;
      if (!this.host) return;
      const p = conv.pendingAggregatedText;
      if (!p) return;
      conv.pendingAggregatedText = undefined;
      void this.pushIncomingMessage({
        type: 'qq.message',
        ts: p.sourceTs ?? eventTs(this.config.timezone, new Date(p.firstAt)),
        source: SOURCE,
        text: p.text,
        senderKey: conv.address,
        meta: { ...segMeta, sourceTs:p.sourceTs, sender: '对话' },
        blobs: p.blobs,
      });
    }, win);
  }

  /**
   * 只从完整响应提取明确标为 final_answer 的正文，供私聊回复兜底使用。
   */
  outputTap() {
    return {
      onEvent: (event: any): void => {
        if (event?.type === 'response.created') this._tapBuf = '';
        if (event?.type === 'response.completed') this._tapBuf = (event.response?.output ?? [])
          .filter((item:any) => item.type === 'message' && item.role === 'assistant' && item.status === 'completed' && item.phase === 'final_answer')
          .flatMap((item:any) => item.content.filter((part:any) => part.type === 'output_text').map((part:any) => part.text)).join('\n');
      },
      onRoundEnd: (): void => {},
      onAbort: (): void => { this._tapBuf = ''; },
    };
  }

  /**
   * 回合收束钩子（框架在每轮结束都调用，含“模型只输出文本未调工具”的路径）。
   * 若本轮由“应回复”的入站消息触发、且模型没有对该会话调用 qq_send，
   * 则把模型生成的文本自动发往来源会话，避免“控制台有回复、QQ 收不到”。
   */
  onTurnEnded(): void {
    this.pendingSends.clear();
    const buf = this._tapBuf.trim();
    const pending = [...this._pendingReplyConvs];
    for (const address of this.pendingFilteredReplies) {
      if (!this.filteredReplyAttempts.has(address) && !this.checkQuiet(address)) {
        void this.sendTo(address, 'filtered').catch(error => this.log.warn('filtered 回执发送失败', {address,error:String(error)}));
      }
    }
    // 仅当“单一待回复会话且本轮未对其发送、且有文本”时兜底，避免多消息歧义或串轮误发。
    if (pending.length === 1) {
      const conv = pending[0];
      if (!this.pendingFilteredReplies.has(conv) && !this._sentThisTurn.has(conv) && buf && !this.checkQuiet(conv)) {
        this.log.warn('兜底自动发送：入站消息未调 qq_send，按模型文本回复', { conv, len: buf.length });
        void this.sendTo(conv, buf).catch((e) => this.log.warn('兜底自动发送失败', { err: String(e) }));
      }
    }
    this._tapBuf = '';
    this._sentThisTurn.clear();
    this.privateReplyCounts = new Map();
    this._pendingReplyConvs.clear();
    this.pendingFilteredReplies.clear();
    this.filteredReplyAttempts.clear();
  }

  /** 实时拉取被引用消息（对齐 fat-fish get_quoted_message 的 get_msg 路径）。 */
  private async resolveQuoted(rid: number): Promise<{ text?: string; ref?: string; userId?: number }> {
    if (!this.driver) return {};
    try {
      const r: any = await this.driver.callApi('get_msg', { message_id: rid });
      if (!r) return {};
      const sender = r.sender ?? {};
      const userId = sender.user_id != null ? Number(sender.user_id) : undefined;
      const ref = sender.nickname || (userId != null ? String(userId) : undefined);
      const text = renderIncoming(r.message, { timezone: this.config.timezone, selfId: 0 });
      return { text: text || '', ref, userId };
    } catch (e) {
      this.log.warn('获取引用消息失败', { err: String(e), rid });
      return {};
    }
  }

  private async handleNotice(ev: OneBotMessage): Promise<void> {
    const address = `${ev.group_id ? 'group' : 'private'}:${ev.group_id ?? ev.user_id ?? 0}`;
    if (!this.canRead(address)) return;
    const sentAt = this.messageDate(ev);
    if (sentAt && sentAt.getTime() < this.connectedAtSec * 1000) return;
    const host = this.host!;
    const t = ev.notice_type;
    if (t === 'group_recall' || t === 'friend_recall') {
      const id = ev.group_id ?? ev.user_id ?? 0;
      const conv = this.ensureConv(ev.group_id ? 'group' : 'private', id);
      const who = ev.user_id ?? 0;
      await this.pushIncomingMessage({
        type: 'qq.recall',
        ts: eventTs(this.config.timezone, sentAt ?? new Date()),
        source: SOURCE,
        text: `${conv.address} 中 ${who} 撤回了一条消息`,
        senderKey: conv.address,
      });
    } else if (t === 'group_increase' || t === 'group_decrease') {
      const conv = this.ensureConv('group', ev.group_id ?? 0);
      const op = ev.operator_id ?? 0;
      const who = ev.user_id ?? 0;
      const verb = t === 'group_increase' ? '加入' : '退出';
      await this.pushIncomingMessage({
        type: 'qq.member',
        ts: eventTs(this.config.timezone, sentAt ?? new Date()),
        source: SOURCE,
        text: `${conv.address}：${who} ${verb}（操作者 ${op}）`,
        senderKey: conv.address,
      });
    } else if (t === 'notify') {
      const sub = ev.sub_type;
      const conv = this.ensureConv(ev.group_id ? 'group' : 'private', ev.group_id ?? ev.user_id ?? 0);
      if (sub === 'poke') {
        await this.pushIncomingMessage({
          type: 'qq.poke',
          ts: eventTs(this.config.timezone, sentAt ?? new Date()),
          source: SOURCE,
          text: `${conv.address}：${ev.user_id} 戳了 ${ev.target_id}`,
          senderKey: conv.address,
        });
      } else if (sub === 'emoji') {
        await this.pushIncomingMessage({
          type: 'qq.react',
          ts: eventTs(this.config.timezone, sentAt ?? new Date()),
          source: SOURCE,
          text: `${conv.address}：${ev.user_id} 对消息做了表情回应`,
          senderKey: conv.address,
        });
      }
    }
  }

  private replyProgress(address?: string): string {
    const rows: typeof this.recentSends = [];
    let used = 0;
    for (const row of this.recentSends.filter(row => (!address || row.conv === address) && this.canRead(row.conv)).reverse()) {
      const shown = {...row,text:row.text.length > 1200 ? row.text.slice(0,1200) + '…[本条后文省略]' : row.text};
      const size = JSON.stringify(shown).length;
      if (rows.length >= 12 || used + size > 6000) break;
      rows.unshift(shown); used += size;
    }
    if (!rows.length) return '';
    return '【QQ已发送记录｜只作衔接，不是待回复消息】\n' + JSON.stringify(rows) +
      '\n按对方最新输入接话；已经答过的问题、外观介绍、索要奖励和反问，即使换词也算重复，不要重答、再索取或补发。没有新信息可以结束本轮。交接或重启不构成重发理由；引用时只填 reply_message_id，正文不含内部编号。';
  }

  private recordSent(address:string, text:string, messageIds:string[]): void {
    if (!text.trim()) return;
    this.recentSends.push({conv:address,at:new Date().toISOString(),text,messageIds});
    this.recentSends = this.recentSends.slice(-24);
    this.scheduleSaveState();
  }

  /**
   * 群管工具未显式指定目标时的兜底：优先用最近一条发言引用的原作者（如"引用某条消息说禁言"），
   * 其次用最近发言里 @ 提及的人（如"禁言 @某人"）。返回 null 表示无任何可用目标，需显式填 who。
   * 注意：不使用"最近发言者本人"兜底，否则会把发起禁言的管理员自己误当目标。
   */
  private fallbackTarget(gid: number | null): number | null {
    const conv = this.convs.get(`group:${gid}`);
    if (conv?.quotedSenderId) return conv.quotedSenderId;
    if (conv?.lastAtUserId) return conv.lastAtUserId;
    return null;
  }

  /** 校验被引用消息是否属于同一会话（跨会话引用会误发 quote，必须拒绝）。 */
  private sameConversation(conv: string, id: number): boolean {
    const m = this.knownMessages.get(String(id));
    return !!m && m.conv === conv;
  }

  /** 把「QQ 号或昵称」解析成真实 QQ 号。纯数字直接返回；群内昵称走成员名单缓存（懒加载）。 */
  private async resolveQQ(groupId: number | null, who: string): Promise<number | null> {
    const raw = String(who ?? '').replace(/^@/, '').trim();
    if (!raw) return null;
    if (/^\d{5,}$/.test(raw)) return Number(raw);
    if (groupId == null) return null;
    // 外号记忆优先（外号不等于群昵称，避免被成员列表覆盖）
    const byAlias = this.resolveAlias(raw);
    if (byAlias) return byAlias;
    const idx = await this.ensureMemberIndex(groupId);
    return idx.get(raw.toLowerCase()) ?? null;
  }

  /** 懒加载某群成员昵称→QQ 索引（card/昵称/头衔都登记，小写匹配）。 */
  private async ensureMemberIndex(groupId: number): Promise<Map<string, number>> {
    const cached = this.memberIndex.get(groupId);
    if (cached) return cached;
    const idx = new Map<string, number>();
    if (this.driver) {
      const list = await this.driver.getGroupMemberList(groupId);
      for (const m of list) {
        const qq = Number(m.user_id);
        if (!qq) continue;
        if (m.card) idx.set(String(m.card).toLowerCase(), qq);
        if (m.nickname) idx.set(String(m.nickname).toLowerCase(), qq);
        if (m.title) idx.set(String(m.title).toLowerCase(), qq);
      }
    }
    this.memberIndex.set(groupId, idx);
    return idx;
  }

  /** 解析发送目标（对齐内置 qq 的 `to` 字符串：group:<id> / private:<id>）。 */
  private resolveTarget(to: string): { kind: 'group' | 'private'; id: number } | null {
    const m = String(to ?? '').match(/^(group|private):(\d+)$/);
    if (!m) return null;
    return { kind: m[1] as 'group' | 'private', id: Number(m[2]) };
  }

  /** 合并转发节点渲染结果（对齐内置 qq 的 ForwardNode）。 */
  private renderForwardNode(value: unknown): ForwardNode {
    const outer = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    const data = outer.data;
    // 兼容两种节点形状：NapCat 记录为 { type:'node', data:{ name, uin, content } }（data 才是真正消息），
    // 标准 OneBot node 段则直接带 sender/message。命中 node 包裹时下沉到 data。
    const n = outer.type === 'node' && data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : outer;
    const sender =
      n.sender !== null && typeof n.sender === 'object' ? (n.sender as Record<string, unknown>) : {};
    const uidValue = sender.user_id ?? n.user_id ?? n.uin;
    const uid =
      typeof uidValue === 'string' || typeof uidValue === 'number' ? uidValue : undefined;
    const isSelf = uid !== undefined && this.identity !== null && String(uid) === String(this.identity.selfId);
    const nicknameValue = sender.nickname ?? sender.card ?? n.nickname ?? n.name;
    const nickname =
      typeof nicknameValue === 'string' && nicknameValue && nicknameValue !== PLACEHOLDER_NICKNAME
        ? nicknameValue
        : undefined;
    const name = isSelf ? '你' : nickname ?? (uid !== undefined ? String(uid) : '?');
    const messageType = typeof n.message_type === 'string' ? n.message_type : undefined;
    // 转发来源：群转发取 group_id，私聊转发取对方 QQ（排除自己），用于事件头标注「转发来源群/人」。
    const gidRaw = n.group_id;
    const originGroupId =
      typeof gidRaw === 'number' && gidRaw > 0
        ? gidRaw
        : typeof gidRaw === 'string' && /^\d+$/.test(gidRaw)
          ? Number(gidRaw)
          : undefined;
    let originPeerUin: number | undefined;
    if (!originGroupId && messageType !== 'group' && uid !== undefined && !isSelf) {
      const u = typeof uid === 'number' ? uid : Number(uid);
      if (Number.isFinite(u) && u > 0) originPeerUin = u;
    }
    // 正文兼容三种来源：NapCat 用 content，标准节点用 message（段数组或字符串），退化用 raw_message。
    const raw = n.content ?? n.message ?? n.raw_message;
    const body =
      typeof raw === 'string'
        ? raw
        : Array.isArray(raw)
          ? renderSegmentsPlain(raw as OneBotSegment[])
          : '';
    return {
      line: `${externalName(name)}${uid !== undefined ? `(${uid})` : ''}: ${body}`,
      body,
      imageUrls: Array.isArray(raw) ? raw.filter(s => s?.type === 'image' || s?.type === 'sticker')
        .map(s => String(s.data?.url ?? s.data?.file ?? '')) : [],
      named: isSelf || nickname !== undefined,
      time: n.time != null ? Number(n.time) : undefined,
      userId: uid !== undefined ? String(uid) : undefined,
      messageType,
      originGroupId,
      originPeerUin,
    };
  }

  /** 转发节点是否都是匿名（身份塌缩）：此时无法分辨发言人，提示可能是多人。 */
  private forwardIdentityCollapsed(nodes: ForwardNode[]): boolean {
    if (nodes.length < 2 || nodes.some((n) => n.named)) return false;
    const ids = new Set(nodes.map((n) => n.userId));
    return ids.size === 1 && !ids.has(undefined);
  }

  /** 展开合并转发消息并作为补充事件投递（对齐内置 qq 的 lookupForward）。 */
  private async lookupForward(resId: string, conv: Conv, ofMessageId: number | string): Promise<void> {
    if(!this.canRead(conv.address))return;
    const driver = this.driver;
    const host = this.host;
    if (!driver || !host) return;
    await driver
      .getForwardMessages(resId, this.config.forwardExpandLimit)
      .then(async (nodes) => {
        if (!this.host || !this.canRead(conv.address)) return;
        const rendered = nodes.map((n) => this.renderForwardNode(n));
        const collapsed = this.forwardIdentityCollapsed(rendered);
        const src = this.identity
          ? inferForwardSource(rendered, this.identity, conv.kind, conv.id)
          : null;
        const body = rendered.length ? rendered.map((n) => n.line).join('\n') : '(转发记录是空的)';
        const images = rendered.flatMap((node, index) => node.imageUrls.map((url, imageIndex) => ({url, index, imageIndex})));
        const blobs: BlobInput[] = [];
        const imageNotes = await Promise.all(images.slice(0, this.config.forwardExpandLimit).map(async ({url, index, imageIndex}, attachmentIndex) => {
          const label = `转发第${index + 1}条图片${imageIndex + 1}`;
          if (!/^https?:\/\//i.test(url)) return `[${label}未读取：协议端未提供可下载地址]`;
          this.recentImages.push({url, conv:conv.address, at:Date.now()});
          if (this.recentImages.length > 50) this.recentImages.shift();
          if (!this.config.deliverImageAttachments) return `[${label}未读取：图片附件已关闭]`;
          if (!host.modelFacts.accepts('image/jpeg') && !host.modelFacts.accepts('image/png')) return `[${label}未读取：当前模型不支持图片]`;
          try {
            const image = await downloadImageBytes(url, {timeoutMs:this.config.vision.timeoutMs, maxImageBytes:this.config.vision.maxBytes});
            if (!this.host || !this.canRead(conv.address)) return '';
            if (!host.modelFacts.accepts(image.mime)) return `[${label}未读取：当前模型不支持${image.mime}]`;
            blobs[attachmentIndex] = {bytes:image.buffer, mime:image.mime, name:`qq-forward-${index + 1}-${imageIndex + 1}`, fallbackText:`[${label}]`};
            return `[${label}已附在本事件中]`;
          } catch (error) {
            this.log.warn('下载转发图片失败', {messageId:ofMessageId, node:index + 1, image:imageIndex + 1, err:String(error)});
            return `[${label}未读取：图片下载失败]`;
          }
        }));
        if (images.length > this.config.forwardExpandLimit) imageNotes.push(`[另有${images.length - this.config.forwardExpandLimit}张图片超过转发展开上限，未读取]`);
        if (!this.host || !this.canRead(conv.address)) return;
        const headerBase = collapsed
          ? `[系统] #${ofMessageId} 引用的转发消息展开如下（里面的发言人身份没能取到，可能是多个人在说话）`
          : `[系统] #${ofMessageId} 引用的转发消息展开如下`;
        const header = src ? `${headerBase}（转发来源：${src.label}）：` : `${headerBase}：`;
        await this.pushIncomingMessage({
          type: 'qq.forward',
          ts: eventTs(this.config.timezone),
          source: SOURCE,
          text: `${header}\n${body}${imageNotes.length ? '\n' + imageNotes.filter(Boolean).join('\n') : ''}`,
          blobs:blobs.filter(Boolean),
          senderKey: conv.address,
          meta: { conv: conv.address, forward_id: resId, forward_source: src?.source ?? null },
        });
      })
      .catch((err) => {
        this.log.warn('展开合并转发失败', { err: String(err), resId });
        if (!this.host) return;
        void this.pushIncomingMessage({
          type: 'qq.forward',
          ts: eventTs(this.config.timezone),
          source: SOURCE,
          text: `[系统] #${ofMessageId} 引用的转发消息展开失败：${String(err)}`,
          senderKey: conv.address,
          meta: { conv: conv.address, forward_id: resId },
        });
      });
  }

  // ---- 发送（草稿-确认门）----
  // ---- 群聊发言限速 / 话题防死循环 ----
  private groupSpeakWindow(address: string): number[] {
    const gs = this.config.groupSpeak;
    if (!gs.enabled || !address.startsWith('group:')) return [];
    const now = Date.now();
    const winMs = Math.max(1, gs.windowSec) * 1000;
    const stamps = (this.groupSpeakStamps.get(address) ?? []).filter((t) => now - t < winMs);
    this.groupSpeakStamps.set(address, stamps);
    return stamps;
  }
  /** 群聊发言频率限制：超过窗口上限返回拦截文案（带 SEND_BLOCKED 前缀），否则 null。 */
  private checkGroupSpeak(address: string): string | null {
    const gs = this.config.groupSpeak;
    if (!gs.enabled || !address.startsWith('group:')) return null;
    const stamps = this.groupSpeakWindow(address);
    if (stamps.length >= Math.max(1, gs.maxPerWindow)) {
      return QQWorld.SEND_BLOCKED + `群 ${this.convLabel(address)} 发言频率已达上限（${gs.maxPerWindow}/${gs.windowSec}s），先不说了。`;
    }
    return null;
  }
  private recordGroupSpeak(address: string): void {
    if (!this.config.groupSpeak.enabled || !address.startsWith('group:')) return;
    const stamps = this.groupSpeakStamps.get(address) ?? [];
    stamps.push(Date.now());
    this.groupSpeakStamps.set(address, stamps);
  }
  /** 话题自动结束 / 防死循环：连续发言超限或对方长时间静默则拦截，返回带 SEND_BLOCKED 前缀的文案。 */
  private checkAntiLoop(address: string): string | null {
    const al = this.config.antiLoop;
    if (!al.enabled) return null;
    const streak = this.botStreak.get(address) ?? 0;
    let lastUser = this.lastUserMsgAt.get(address);
    if(address.startsWith('private:')){const at=this.lastUserMsgAtByQQ.get(Number(address.slice(8)));if(at!==undefined&&(lastUser===undefined||at>lastUser))lastUser=at;}
    // 没有“对方发言基线”时不启用 idle 收尾，否则会话启动后 bot 发第一条就会被永久拦住
    const sinceUser = lastUser == null ? -1 : Date.now() - lastUser;
    if (streak >= al.maxConsecutiveBotTurns) {
      return QQWorld.SEND_BLOCKED + `该会话已连续发言 ${streak} 次，自动结束话题（等对方先开口再继续）。`;
    }
    if (al.idleToEndSec > 0 && streak >= 1 && sinceUser >= 0 && sinceUser > al.idleToEndSec * 1000) {
      return QQWorld.SEND_BLOCKED + `对方已静默 ${Math.round(sinceUser / 1000)}s，话题自动收尾，先不说了。`;
    }
    return null;
  }
  private recordAntiLoop(address: string, replyCursor = this.latestReplyCursor(address)): void {
    if (this.config.quietReply.enabled) this.quietReplies.mark(address, replyCursor);
    if (!this.config.antiLoop.enabled) return;
    this.botStreak.set(address, (this.botStreak.get(address) ?? 0) + 1);
  }

  private latestReplyCursor(address: string): number {
    return this.host?.store?.range({source: SOURCE, senderKey: address, limit: 500}).filter(event => event.origin === 'external'
      && event.type === 'qq.message' && event.contextDelivery !== 'archive-only' && !event.meta?.history
      && event.senderKey === address).at(-1)?.cursor ?? 0;
  }

  private isQuietHours(): boolean {
    if (this.config.quietReply.enabled) return routineQuiet(this.config.routine, this.config.timezone);
    const { quietFrom, quietTo } = this.config.proactive;
    if (quietFrom === quietTo) return false;
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: this.config.timezone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    return quietFrom < quietTo ? hour >= quietFrom && hour < quietTo : hour >= quietFrom || hour < quietTo;
  }

  private checkReplyMode(address: string): string | null {
    if (address.startsWith('group:') && !this.config.replyGroups) return QQWorld.SEND_BLOCKED + '群聊回复已关闭，消息未发送。';
    if (address.startsWith('private:') && !this.config.replyPrivates) return QQWorld.SEND_BLOCKED + '私聊回复已关闭，消息未发送。';
    return null;
  }

  private checkQuiet(address: string): string | null {
    const replyMode = this.checkReplyMode(address);
    if (replyMode) return replyMode;
    if (this.historyOnlyConvs.has(address)) return QQWorld.SEND_BLOCKED + '该会话只有启动历史补读，不回复旧消息；等待新消息。';
    if (this.driver?.connected === false) return QQWorld.SEND_BLOCKED + 'QQ 未连接，等待连接恢复后再发送，不要重复试发。';
    if (this.streamGate?.blocked()) return QQWorld.SEND_BLOCKED + '直播期间 QQ 消息暂存，退出直播后处理。';
    if (this.config.quietReply.enabled) {
      if (!this.isQuietHours()) return null;
      if (!quietReplyAllowed(address, this.config.quietReply)) return QQWorld.SEND_BLOCKED + '作息静默期间仅回复独立白名单，消息未发送。';
      if (!this.quietReplies.allows(address, this.latestReplyCursor(address))) return QQWorld.SEND_BLOCKED + '静默期间没有待回复消息，不主动发送。';
      return null;
    }
    return address.startsWith('group:') && this.isQuietHours()
      ? QQWorld.SEND_BLOCKED + '静默时段仅回复私聊，群聊消息未发送。' : null;
  }

  private replyCounts(address: string): Map<string, number> {
    const cursor = address.startsWith('private:') ? this.latestReplyCursor(address) : 0;
    if (!cursor) return this.privateReplyCounts;
    let budget = this.privateReplyBudgets.get(address);
    if (!budget || budget.cursor !== cursor) {
      budget = {cursor, counts: new Map()};
      this.privateReplyBudgets.set(address, budget);
    }
    return budget.counts;
  }

  private imageFile(value: string): string {
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      if (!url.username && !url.password) return url.href;
    }
    if (/^base64:\/\/[A-Za-z0-9+/]+=*$/.test(value) && value.length <= 24 * 1024 * 1024) return value;
    if (/^(log|mem):/.test(value)) {
      const image = this.host?.blob(value);
      if (image && /^image\/(png|jpeg|gif|webp)$/.test(image.mime) && image.bytes.length <= 16 * 1024 * 1024) {
        return 'base64://' + Buffer.from(image.bytes).toString('base64');
      }
    }
    const root = this.stickerDirAbs || this.emojiDirAbs;
    const file = root && resolveEmojiFile(root, value);
    if (file && /\.(png|jpe?g|gif|webp)$/i.test(file)) {
      if (statSync(file).size <= 16 * 1024 * 1024) return 'base64://' + readFileSync(file).toString('base64');
    }
    throw new Error('图片需为实际图片 URL、log:/mem: 图片附件或表情库真实文件名；不允许任意本机文件路径。');
  }

  private async sendMessage(address: string, params: Record<string, unknown>, counts = this.replyCounts(address), beforeSend?: () => boolean, action: 'send_msg'|'send_forward_msg' = 'send_msg'): Promise<any> {
    if (Array.isArray(params.message)) {
      params = {...params, message: params.message.filter(segment => segment.type !== 'face'
        && !(address.startsWith('private:') && segment.type === 'reply'))};
      if (!(params.message as unknown[]).length) throw new Error('没有可发送内容；禁止使用 QQ 原生表情。');
    }
    const limit = address.startsWith('private:') ? this.config.maxPrivateMessagesPerReply : 0;
    const count = counts.get(address) ?? 0;
    if (limit > 0 && count >= limit) throw new Error('私聊本轮回复已达 ' + limit + ' 条上限，请等待下一轮消息，不要重试。');
    if (beforeSend && !beforeSend()) throw new Error('会话已更新，取消旧的主动草稿。');
    counts.set(address, count + 1);
    let result: any;
    try {result = await this.driver!.callApi(action,params);}
    catch (error) {counts.set(address,(counts.get(address) ?? 1) - 1);throw error;}
    this.proactive?.notifySent(address);
    const segments = Array.isArray(params.message) ? params.message as OneBotSegment[] : [];
    const text = action==='send_forward_msg' ? '[合并转发] '+String((params.messages as unknown[]).length)+' 条原消息' : renderSegmentsPlain(segments);
    const messageId = result?.message_id != null ? String(result.message_id) : undefined;
    this.log.info(`QQ已发送 ${this.convLabel(address)}（消息 ${messageId ?? '未返回编号'}）：${text.replace(/\s+/g, ' ')}`, {address, messageId, text});
    try {
      await this.host?.pushEvent?.({type:'qq.sent', source:SOURCE, origin:'external', senderKey:address,
        ts:eventTs(this.config.timezone), text:`【QQ发送回执｜本账号已发送】${text}\n这是实际发送记录，不是对方的新消息，无需回复本回执。`,
        meta:{conv:address, self:true, role:'assistant', text, messageId, textOnly:segments.every(s => ['text','at','reply'].includes(s.type)), delivery:'confirmed'}}, {trigger:'piggyback'});
    } catch (error) {this.log.warn('QQ已发送回执落库失败，不重发已确认消息', {address,messageId,error:String(error)});}
    return result;
  }

  private async sendTo(address: string, text: string, replyMessageId?: number, atQQs?: number[], counts = this.replyCounts(address), images: string[] = [], isCurrent?: () => boolean, voice?: boolean): Promise<string> {
    let started = false;
    const beforeSend = () => {
      if (started) return true;
      if (isCurrent && !isCurrent()) return false;
      started = true; return true;
    };
    if (address.startsWith('private:')) replyMessageId = undefined;
    if (this.host?.isPaused?.()) throw new Error('Run paused');
    const quiet = this.checkQuiet(address);
    if (quiet) return quiet;
    if (this.pendingFilteredReplies.has(address)) {
      this.filteredReplyAttempts.add(address);
      text = 'filtered'; images = []; replyMessageId = undefined; atQQs = undefined;
    }
    try { text = outgoingChatText(text, address); }
    catch (error) {
      this.log.warn('拦截聊天正文中的工具指令', {address, error: String(error)});
      return QQWorld.SEND_BLOCKED + String(error);
    }
    const leakedId = [...text.matchAll(/#(-?\d+)/g)].find(match => this.knownMessages.has(match[1]));
    if (leakedId) return QQWorld.SEND_BLOCKED + '正文包含内部消息编号，尚未发送。需要引用时将编号填入 reply_message_id，并从 text 移除编号；不需要引用时只保留自然语言正文。';
    if (!this.driver) return QQWorld.SEND_BLOCKED + '未连接到 QQ 协议端，等待连接恢复后再发送。';
    const replyCursor = this.latestReplyCursor(address);
    if (this.config.contentReviewUrl && text.trim()) {
      const decision = await reviewContent(this.config.contentReviewUrl, text, 'message');
      if (this.host?.isPaused?.()) throw new Error('Run paused');
      if (!decision.allow) {
        text = 'filtered';
        images = [];

        replyMessageId = undefined;
        atQQs = undefined;
        this.log.info('QQ 内容未获放行，改为文字反馈', {reason: decision.reason, address});
      }
    }
    const changed = this.checkQuiet(address);
    if (changed) return changed;
    if (isCurrent && !isCurrent()) return QQWorld.SEND_BLOCKED + '会话已更新，取消旧的主动草稿。';
    text = text.replace(/\\n/g, '\n');
    const missingStickers: string[] = [];
    let outgoing: OneBotSegment[];
    try {
      outgoing = buildOutgoing(text, this.stickerDirAbs || this.emojiDirAbs, marker => missingStickers.push(marker));
      outgoing.push(...images.map(value => ({type: 'image' as const, data: {file: this.imageFile(value), sub_type: 0}})));
    } catch (error) {return QQWorld.SEND_BLOCKED + String(error);}
    if (missingStickers.length) {
      for (const marker of missingStickers) text = text.replaceAll(marker, '');
      text = text.trim();
      this.log.warn('无效表情包已跳过，保留其余有效回复', {address, markers:missingStickers});
    }
    const stickerNote = missingStickers.length
      ? `（未附上 ${missingStickers.length} 个无效表情包标记，只发送其余有效内容；无需补图，不要重发正文。以后确需表情包时只复制 qq_sticker_stats 返回的完整标记。）` : '';
    if (!outgoing.some(segment => segment.type !== 'text' || segment.data.text.trim())) {
      return QQWorld.SEND_BLOCKED + (missingStickers.length ? '表情包不存在，且没有有效正文，本次未发送；下次先用 qq_sticker_stats 取真实标记，不编造文件名。' : '正文只有禁止的 QQ 原生表情，未发送；请用文字或收藏表情包。');
    }
    const limit = address.startsWith('private:') ? this.config.maxPrivateMessagesPerReply : 0;
    if (limit > 0 && (counts.get(address) ?? 0) >= limit) return QQWorld.SEND_BLOCKED + '私聊本轮回复已达 ' + limit + ' 条上限，请等待下一轮消息，不要重试。';
    const norm = text.replace(/([。！？!?；;])\s+/g, '$1').replace(/\s+/g, ' ').trim() + (images.length ? JSON.stringify(images) : '');
    const prev = this.dedupSends.get(address);
    if (prev && prev.norm === norm && ((replyCursor > 0 && prev.replyCursor === replyCursor)
      || (Date.now() - prev.ts < 6000 && (text !== 'filtered' || !replyCursor || prev.replyCursor === replyCursor)))) {
      this.log.info('发送去重：跳过同一入站消息的重复回复或 6s 内重复内容', { address, len: norm.length });
      return '（去重：与刚刚发送的内容相同，已跳过重复发送）';
    }
    const gl = this.checkGroupSpeak(address);
    if (gl) return gl;
    const al = this.checkAntiLoop(address);
    if (al) return al;
    const [kind, idStr] = address.split(':');
    const id = Number(idStr);
    const paramsBase: Record<string, unknown> =
      kind === 'group' ? { message_type: 'group', group_id: id } : { message_type: 'private', user_id: id };
    if (voice === true && text !== 'filtered') {
      if (!this.config.voice.enabled || !this.config.voice.tts) return QQWorld.SEND_BLOCKED + 'QQ 语音发送未开启。';
      if (outgoing.some(segment => segment.type === 'image')) return QQWorld.SEND_BLOCKED + '语音请只填写要朗读的正文，图片另发。';
    }
    const wantVoice = !outgoing.some(segment => segment.type === 'image') && text !== 'filtered' && this.config.voice.enabled && this.config.voice.tts && voice === true;
    let voiceFallback = '';

    if (wantVoice) {

      const rec = await synthesizeVoice(text, address, this.driver, this.voiceRuntime(), this.log);
      if (rec) {
        const segs: Array<Record<string, unknown>> = [];
        if (replyMessageId != null) segs.push({ type: 'reply', data: { id: replyMessageId } });
        if (atQQs && atQQs.length) for (const qq of atQQs) segs.push({ type: 'at', data: { qq } });
        segs.push(rec as unknown as Record<string, unknown>);
        try {
          if (this.host?.isPaused?.()) throw new Error('Run paused');
          const quiet = this.checkQuiet(address);
          if (quiet) return quiet;
          const r: any = await this.sendMessage(address, { ...paramsBase, message: segs }, counts, beforeSend);
          if (r?.message_id != null) {
            this.knownMessages.set(String(r.message_id), { conv: address, ts: Date.now() });
            this.scheduleSaveState();
          }
          this.recordGroupSpeak(address);
          this.recordAntiLoop(address, replyCursor);
          this.dedupSends.set(address, { norm, ts: Date.now(), replyCursor });
          this.recordSent(address, text, r?.message_id != null ? [String(r.message_id)] : []);
          return `已向 ${this.convLabel(address)} 发送语音 1 段。${stickerNote}`;
        } catch (e) {
          this.log.warn('语音发送失败，回退文字', {
            err: String(e),
            address,
            segs: segs.map((s) => ({ t: (s as { type?: unknown }).type, id: (s.data as { id?: unknown })?.id, hasFile: !!(s.data as { file?: unknown })?.file })),
          });
        }
      } else {
        this.log.warn('TTS 合成失败，回退文字发送');
      }
      voiceFallback = '语音未成功，已回退文字。';
    }

    if (atQQs && atQQs.length) {
      for (const qq of atQQs) outgoing.unshift({ type: 'at', data: { qq } });
    }
    const remaining = limit > 0 ? Math.max(0,limit - (counts.get(address) ?? 0)) : undefined;
    if (remaining === 0) return QQWorld.SEND_BLOCKED + '私聊本轮回复已达 ' + limit + ' 条上限，请等待下一轮消息，不要重试。';
    let messages;
    try {messages = splitReplyIntoMessages(outgoing, {
      splitBySentence: this.config.splitReplyBySentence,
      sentencesPerMessage: this.config.sentencesPerMessage,
      maxBytes: this.config.maxMessageBytes,
      maxMessages: remaining,
    });} catch (error) {return QQWorld.SEND_BLOCKED + String(error);}
    if (replyMessageId != null && messages.length) {
      messages[0] = [{ type: 'reply', data: { id: replyMessageId } }, ...messages[0]];
    }
    let ok = 0;
    const validMessages = messages.map(segs => segs.filter(s => !(s.type === 'text' && !((s.data as {text?:string}).text ?? '').trim()))).filter(segs => segs.length);
    const total = validMessages.length;
    const ids: string[] = [];
    const confirmedText: string[] = [];
    for (const valid of validMessages) {
      try {
        if (this.host?.isPaused?.()) throw new Error('Run paused');
        const quiet = this.checkQuiet(address);
        if (quiet) {if (ok === 0) return quiet; break;}
        const r: any = await this.sendMessage(address, { ...paramsBase, message: valid }, counts, beforeSend);
        ok++;
        confirmedText.push(...valid.filter(segment => segment.type === 'text').map(segment => String((segment.data as {text?:string}).text ?? '')));
        if (r?.message_id != null) {
          this.knownMessages.set(String(r.message_id), { conv: address, ts: Date.now() });
          ids.push(String(r.message_id));
          this.scheduleSaveState();
        }
      } catch (e) {
        this.log.warn('发送失败', {
          err: String(e),
          address,
          paramsBase,
          segs: valid.map((s) => ({ t: s.type, id: (s.data as { id?: unknown })?.id, qq: (s.data as { qq?: unknown })?.qq })),
        });
      }
      if (this.config.sendIntervalMs > 0) await sleep(this.config.sendIntervalMs);
    }
    if (ok > 0) {
      this.recordSent(address, confirmedText.join(''), ids);
      this.recordGroupSpeak(address);
      this.recordAntiLoop(address, replyCursor);
      this.dedupSends.set(address, { norm, ts: Date.now(), replyCursor });
      if (text.trim() === 'filtered') {
        void this.host?.pushEvent({
          ts: eventTs(this.config.timezone), source: SOURCE, type: 'qqbot.output', origin: 'internal',
          text: `[QQ发送回执] 你刚才向 ${address} 实际发送的正文是 filtered。若它不是拟发原句，原句未按原样发送。`
            + '这是系统回执，不是对方新消息；无需回应本通知，不复读 filtered，也不反复试发被拦原句。',
          meta: {conv: address, text: 'filtered', messageIds: ids},
        }, {trigger: 'piggyback'}).catch(error => this.log.warn('filtered 发送回执投递失败', {error: String(error)}));
      }
    }
    const tail = ids.length ? `（message_id: ${ids.join(', ')}，仅作发送凭据，不写进正文）` : '';
    if (ok < total) {
      return (ok > 0 ? QQWorld.SEND_PARTIAL : QQWorld.SEND_FAILED)
        + `已向 ${this.convLabel(address)} 确认发送 ${ok}/${total} 段，另 ${total - ok} 段未确认成功。${tail}${stickerNote}不要整段重发。`;
    }
    return `已向 ${this.convLabel(address)} 发送 ${ok}/${total} 段。${tail}${stickerNote}${voiceFallback}${text.trim() === 'filtered' ? '实际发送的正文是 filtered。' : ''}`;
  }

  /** 包装宿主：在 pushEvent 后向控制台事件流广播（仅广播本扩展产生的事件）。 */
  private wrapHost(host: WorldHost): WorldHost {
    const base = host;
    const self = this;
    return {
      ...base,
      async pushEvent(e, opts) {
        const saved = await base.pushEvent(e, opts);
        if (saved.source === SOURCE) self.broadcastEvent(saved);
        return saved;
      },
    };
  }

  // ---- 工具 ----
  private syncFavoriteStickers(): Promise<string> {
    if (this.stickerSync) return this.stickerSync;
    if (!this.driver || !this.stickers || !this.connected) return Promise.resolve('收藏表情同步失败：QQ 协议端未连接。');
    const driver = this.driver;
    const stickers = this.stickers;
    this.stickerSync = (async () => {
      let raw: unknown;
      try {
        raw = await driver.callApi('fetch_custom_face_detail', { count: 10000 });
      } catch {
        raw = await driver.callApi('fetch_custom_face', { count: 10000, return_type: 'url' });
      }
      if (!Array.isArray(raw)) throw new Error('收藏表情接口未返回数组');
      const favorites = raw.map((entry: unknown) => {
        const detail = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
        const url = typeof entry === 'string' ? entry : detail.url;
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('收藏表情缺少图片 URL');
        return { url, summary: typeof detail.desc === 'string' ? detail.desc : '' };
      });
      const result = await stickers.importFavorites(favorites);
      return `QQ 收藏表情 ${favorites.length} 张：新增 ${result.added} 张，已收录 ${result.existing} 张，失败 ${result.failed} 张；本地共 ${stickers.size} 张。`;
    })().catch((e) => `收藏表情同步失败：${String(e)}`).then((result) => {
      this.stickerSyncResult = result;
      return result;
    }).finally(() => { this.stickerSync = null; });
    return this.stickerSync;
  }

  tools(): ToolDef[] {
    const sendAudio: ToolDef = {
      name: 'qq_send_audio', tags: ['speak'], barrierAfter: true, endsTurn: true,
      description: '发送独立 tts_synthesize 生成的语音附件。handle 可为 log: 或用 save_blob 保存的 mem: 句柄；不会自动拨打电话。',
      parameters: {type: 'object', properties: {to: {type: 'string'}, handle: {type: 'string'}}, required: ['to', 'handle'], additionalProperties: false},
      handler: async args => {
        const host = this.host;
        if (!host || host.isPaused?.()) return QQWorld.SEND_BLOCKED + '当前暂停。';
        const address = String(args.to ?? '');
        const counts = this.replyCounts(address);
        const match = /^(private|group):(\d+)$/u.exec(address);
        if (!match || !this.isListened(match[1] as 'private'|'group', Number(match[2]))) return '[拒绝] 会话不在监听名单';
        const quiet = this.checkQuiet(address); if (quiet) return quiet;
        const replyCursor = this.latestReplyCursor(address);
        const audio = host.blob(String(args.handle ?? ''));
        if (!audio || audio.mime !== 'audio/wav' || audio.bytes.length > 16 * 1024 * 1024) return '[失败] 未找到 WAV 附件';
        const hash = createHash('sha256').update(audio.bytes).digest('hex');
        const source = host.store.range({source: 'tts', limit: 1000}).find(event => event.type === 'tts.audio' && event.meta?.audioHash === hash);
        const text = source?.meta?.transcript;
        if (typeof text !== 'string') return '[拒绝] 未找到对应的语音合成记录';
        const decision = this.config.contentReviewUrl ? await reviewContent(this.config.contentReviewUrl, text, 'message') : {allow: true};
        if (host.isPaused?.()) return QQWorld.SEND_BLOCKED + '当前暂停。';
        const changed = this.checkQuiet(address); if (changed) return changed;
        if (!decision.allow) return this.sendTo(address, 'filtered');
        if (!this.driver) return '[失败] QQ 未连接';
        const result = await this.sendMessage(address, {...(match[1] === 'group' ? {group_id: Number(match[2])} : {user_id: Number(match[2])}),
          message: [{type: 'record', data: {file: `base64://${Buffer.from(audio.bytes).toString('base64')}`}}]}, counts);
        this.recordAntiLoop(address, replyCursor);
        return JSON.stringify({sent: true, address, message_id: (result as {message_id?: number})?.message_id});
      },
    };
const forwardById: ToolDef = {
      name: 'qq_forward_by_id',
      tags: ['speak'],
      barrierAfter: true,
      endsTurn: true,
      description:
        '把本会话中实际接收或发出、本地有记录的消息编号合成一张 QQ 转发卡片，发往群或私聊。编号取消息行首 #编号，不得编造。卡片由 bot 自己发出，逐条标注原发送者昵称和 QQ 号并保留原文、图片和引用，不伪造身份。默认关闭，须先开启「允许按消息 id 原样转发」；协议端须支持 send_forward_msg 和 get_msg，不支持时返回错误。',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: '转发目标，原样复制事件 meta 里的 conv 字段。群聊填 "group:<群号>"，私聊填 "private:<QQ号>"。' },
          message_ids: { type: 'array', items: { type: 'number' }, description: '要合并转发的消息编号数组（即消息行首的 #编号，对应 QQ 真实 message_id）。每条必须在本会话本地记录内存在，否则该条被跳过并提示。多条会合成「一张」合并转发卡片。' },
        },
        required: ['to', 'message_ids'],
      },
      handler: async (args) => {
        if (!this.config.forwardByMessageId) {
          return '「允许按消息 id 原样转发」功能未开启（设置项 worlds.qqbot.forwardByMessageId）。请先在控制台开启后再调用本工具。';
        }
        const to = String(args.to ?? '').trim();
        const ids = Array.isArray(args.message_ids) ? args.message_ids.map((x: unknown) => Number(x)).filter((n: number) => Number.isFinite(n)) : [];
        if (!ids.length) return 'message_ids 不能为空，且必须是数字编号数组（消息行首的 #编号）。';
        const target = this.resolveTarget(to);
        if (!target) return 'to 格式应为 "group:<群号>" 或 "private:<QQ号>"（直接复制事件 meta 里的 conv 字段）。';
        const address = `${target.kind}:${target.id}`;
        const blocked=this.checkQuiet(address);if(blocked)return blocked;
        if(this.host?.isPaused?.())return 'Run paused';
        if (!this.isListened(target.kind, target.id)) {
          return `该${target.kind === 'group' ? '群' : '私聊'}不在监听名单内，无法转发。`;
        }
        if (!this.driver) return '协议端未连接，无法转发。';
        const selfId = this.identity?.selfId ?? 0;
        if (!selfId) return 'bot 身份尚未加载，暂无法合并转发，稍候重试。';
        const skipped: Array<{ id: number; reason: string }> = [];
        const nodes: Array<Record<string, unknown>> = [];
        for (const id of ids) {
          const rec = this.knownMessages.get(String(id));
          if (!rec) {
            skipped.push({ id, reason: '本 bot 本地记录中不存在该消息编号（只能转发本 bot 见过/发出过的消息）' });
            continue;
          }
          if (rec.conv !== address) {
            skipped.push({ id, reason: `该消息属于其他会话（${rec.conv}），不能作为「${address}」的转发目标` });
            continue;
          }
          // 逐条拉回原文：send_forward_msg 无法引用远端消息，必须由本 bot 取出内容再合成卡片。
          let msg: any = null;
          try {
            msg = await this.driver.callApi('get_msg', { message_id: id });
          } catch (e) {
            skipped.push({ id, reason: '拉取原消息失败：' + String(e) });
            continue;
          }
          if (!msg || !msg.message) {
            skipped.push({ id, reason: '拉取原消息为空（可能已撤回/不可读）' });
            continue;
          }
          const sender = (msg.sender ?? {}) as Record<string, unknown>;
          const uid = sender.user_id != null ? Number(sender.user_id) : undefined;
          const name = (sender.nickname as string) || (sender.card as string) || (uid != null ? String(uid) : '某人');
          const srcLabel = `【来自 ${name}${uid != null ? `(${uid})` : ''}】\n`;
          const segs: unknown = msg.message;
          // node 身份只能是 bot 自己（OneBot 限制），因此用真实昵称作展示名 + 文本行标注来源，
          // 原文内容原样保留（数组段直接内嵌，含图片/引用等富媒体）。
          const content: unknown = Array.isArray(segs)
            ? [{ type: 'text', data: { text: srcLabel } }, ...segs]
            : srcLabel + (typeof segs === 'string' ? segs : '');
          nodes.push({ type: 'node', data: { user_id: selfId, nickname: name, content } });
        }
        if (!nodes.length) {
          return '没有可转发的消息。' + (skipped.length ? '\n跳过：' + skipped.map((s) => `#${s.id}（${s.reason}）`).join('；') : '');
        }
        const params: Record<string, unknown> = { messages: nodes };
        if (target.kind === 'group') params.group_id = target.id;
        else params.user_id = target.id;
        try {
          if(this.host?.isPaused?.())return 'Run paused';
          const blocked=this.checkQuiet(address);if(blocked)return blocked;
          if(this.config.contentReviewUrl&&!(await reviewContent(this.config.contentReviewUrl,JSON.stringify(nodes),'message')).allow)return '内容审核未放行，未转发';
          if(this.host?.isPaused?.())return 'Run paused';
          const blockedAfterReview=this.checkQuiet(address);if(blockedAfterReview)return blockedAfterReview;
          const receipt=await this.sendMessage(address,params,undefined,()=>!this.host?.isPaused?.()&&!this.checkQuiet(address),'send_forward_msg');
          if(receipt?.message_id!=null){this.knownMessages.set(String(receipt.message_id),{conv:address,ts:Date.now()});this.scheduleSaveState();}
        } catch (e) {
          return '合并转发发送失败：' + String(e) + (skipped.length ? '\n（另有跳过：' + skipped.map((s) => `#${s.id}（${s.reason}）`).join('；') + '）' : '');
        }
        let result = `已把 ${nodes.length} 条消息合并成「一张」卡片转发到 ${this.convLabel(address)}（卡片由本 bot 发出，已标注每条来源、原文不变）。`;
        if (skipped.length) {
          result += `\n${skipped.length} 条未纳入：` + skipped.map((s) => `#${s.id}（${s.reason}）`).join('；');
        }
        return result;
      },
    };

    const stickerToFavorites: ToolDef = {
      name: 'qq_sticker_to_favorites',
      tags: ['speak'],
      barrierAfter: true,
      description:
        '批量把尚未同步的历史表情包补推到登录账号的 QQ 收藏表情。须开启「同步到 QQ 收藏表情」，协议端支持 add_custom_face。新收藏会自动同步，无需重复调用。QQ 数量上限或协议不支持会返回失败；数量超限时可清理 QQ 收藏后重试。',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number', description: '本次最多补推多少张，默认 50，最大 200。批量失败或量大时可分多次调。' } },
        required: [],
      },
      handler: async (args) => {
        if (!this.config.sticker.addToQQFavorites) {
          return '请先在设置里开启「同步到 QQ 收藏表情」（worlds.qqbot.sticker.addToQQFavorites）再调本工具。';
        }
        if (!this.stickers) return '表情包收藏未启用，无法同步。';
        if (!this.driver) return '协议端未连接，无法同步到 QQ。';
        const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.max(1, Math.min(200, args.limit)) : 50;
        const r = await this.stickers.favoriteSync(limit);
        let msg = `本次检查 ${r.checked} 张、成功加入 QQ 收藏 ${r.added} 张、失败 ${r.failed} 张（已同步过的跳过 ${r.skipped} 张）。`;
        if (r.failed > 0) msg += '\n失败的通常是 QQ 收藏表情数量已达上限或图片格式不被接受；删掉部分 QQ 收藏表情后重试即可。';
        return msg;
      },
    };

    const stickerTag: ToolDef = {
      name: 'qq_sticker_tag',
      tags: ['write', 'read'],
      barrierAfter: true,
      description:
        '修改某张已收藏表情包的标注（情感 emotion / 用处 usage / 短标签 tag / 显示名 label），并持久化保存。\n' +
        '用途：自动标注不准（如情感写成「未知」）或你想按自己的习惯整理表情库时，用本工具改标注；改完后 qq_sticker_stats 里看到的就是新标注。\n' +
        '先调 qq_sticker_stats 拿到真实文件名（如 sticker-xxxx.jpg），再调本工具指定要改的字段；只传想改的字段，其余保持不变。文件名也接受 [表情包:sticker-xxxx.jpg] 写法。',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string', description: '表情包文件名（来自 qq_sticker_stats），如 sticker-abc123.jpg。' },
          emotion: { type: 'string', description: '可选：新的情感标签（如 开心/撒娇/嘲讽/无奈）。' },
          usage: { type: 'string', description: '可选：新的适用场景（如 回应夸奖/表达无语）。' },
          tag: { type: 'string', description: '可选：新的 2-4 字短标签。' },
          label: { type: 'string', description: '可选：新的显示短名。' },
        },
        required: ['file'],
      },
      handler: async (args) => {
        this.log.info('调用 qq_sticker_tag');
        if (!this.stickers) return '表情包收藏未启用，无法修改标注。';
        const file = typeof args.file === 'string' ? args.file : '';
        if (!file.trim()) return '请指定要修改的文件名（可先调 qq_sticker_stats 查询）。';
        const patch: { emotion?: string; usage?: string; tag?: string; label?: string } = {};
        if (typeof args.emotion === 'string' && args.emotion.trim()) patch.emotion = args.emotion;
        if (typeof args.usage === 'string' && args.usage.trim()) patch.usage = args.usage;
        if (typeof args.tag === 'string' && args.tag.trim()) patch.tag = args.tag;
        if (typeof args.label === 'string' && args.label.trim()) patch.label = args.label;
        if (!Object.keys(patch).length) return '没有传入任何要修改的字段（emotion/usage/tag/label 至少填一个）。';
        const m = this.stickers.updateMeta(file, patch);
        if (!m) return `没有找到表情包「${file}」，请先用 qq_sticker_stats 查看已有表情包的真实文件名。`;
        return `已更新标注并保存：[表情包:${m.file}] ${m.label}（情感:${m.emotion} / 用处:${m.usage}${m.tag ? ' / 标签:' + m.tag : ''}）`;
      },
    };

    const send: ToolDef = {
      name: 'qq_send',
      tags: ['speak'],
      barrierAfter: true,
      endsTurn: true,
      description:
        '回复 QQ 消息事件的唯一渠道：发送一条发往 QQ 群或私聊的消息（不要用 terminal_send，那只会发到控制台终端）。调用即直接发送，无需再确认。to 直接填事件 meta 里的 conv 字段：群聊为 "group:<群号>"，私聊为 "private:<QQ号>"。\n' +
        '【私聊分流】当对话话题涉及隐私、秘密、尴尬、暧昧、个人账目/健康/情感等不宜在群内公开的内容时，应把回复改为私聊发给当事人，而非发在群里：先在群里说一句"这个我私聊你～"，再调用本工具 to=事件 meta 里的 senderPrivate 字段（形如 "private:<QQ号>"）把真正的内容私发过去。反之普通闲聊就直接发回当前群即可。',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: '发送目标，原样复制事件 meta 里的 conv 字段。群聊填 "group:<群号>"，私聊填 "private:<QQ号>"。' },
          text: { type: 'string', description: '自然语言正文；日常私聊几个字也能独立成句，用换行分短消息，无需凑成段落。遵守剩余条数，文字、图片、语音共用额度；不重复意思，不用 QQ 原生表情。只发图片时可留空。' },
          voice: {type:'boolean',description:'true=把 text 合成为 QQ 语音消息；false=发文字；不填则沿用自动语音判断。根据完整对话中的语音请求选择，即使对方最新一句只是“现在可以了吗”。发语音时不附图片，实际发送形式以回执为准。'},
          images: {type: 'array', maxItems: 9, items: {type: 'string'}, description: '普通图片：实际 http(s) URL、log:/mem: 图片句柄或表情库文件名。与收藏表情包不同；收藏表情用 text 中的 [表情包:真实文件名]。不能编造图片或本机路径。'},
          reply_message_id: { type: 'integer', description: '群聊确需定位旧消息时才填写；私聊使用普通消息，不引用。编号不能写进 text。' },
          at: { type: 'array', items: { type: 'string' }, description: '可选：要 @ 的人，元素为 QQ 号或群内昵称（如 "123456" 或 "张三"）。发送时会在开头插入 @。' },
        },
        required: ['to'],
      },
      handler: async (args, ctx) => {
        const to = String(args.to ?? '').trim();
        const text = String(args.text ?? '').trim();
        this.log.info('qq_send调用参数', { to, textLength: text.length });
        const images = Array.isArray(args.images) ? args.images : [];
        if (args.voice !== undefined && typeof args.voice !== 'boolean') return '[send blocked] voice 必须是 true 或 false。';
        if (args.voice === true && images.length) return '[send blocked] 语音请只填写要朗读的正文，图片另发。';
        if (images.length > 9 || images.some(value => typeof value !== 'string')) return '[send blocked] images 最多 9 个图片地址或句柄。';
        if (!text && !images.length) return 'text 或 images 至少填写一项。';
        const target = this.resolveTarget(to);
        if (!target) return 'to 格式应为 "group:<群号>" 或 "private:<QQ号>"（直接复制事件 meta 里的 conv 字段，不要自己改）。';
        const address = `${target.kind}:${target.id}`;
        this._sentThisTurn.add(address); // 标记本轮已对该会话发送，兜底逻辑据此跳过重复发送
        if (!this.isListened(target.kind, target.id) && !(target.kind === 'private' && this.config.allowPrivateRedirect)) {
          return `该${target.kind === 'group' ? '群' : '私聊'}不在监听名单内，无法发送。请先用控制台加入监听。`;
        }
        const atRaw = Array.isArray(args.at) ? args.at.map((x: unknown) => String(x)) : [];
        let atQQs: number[] = [];
        if (atRaw.length) {
          const groupId = target.kind === 'group' ? target.id : null;
          const resolved = await Promise.all(atRaw.map((w) => this.resolveQQ(groupId, w)));
          atQQs = resolved.filter((q): q is number => q != null);
          const failed = atRaw.filter((_, i) => resolved[i] == null);
          if (failed.length) this.log.warn('qq_send @ 解析失败（已跳过）', { failed });
        }
        const rid = target.kind === 'group' && args.reply_message_id != null ? Number(args.reply_message_id) : undefined;
        if (rid !== undefined && !Number.isSafeInteger(rid)) return '[send blocked] reply_message_id 必须是消息编号整数。';
        if (rid !== undefined && !this.sameConversation(address, rid)) {
          return `[send failed] 引用消息 #${rid} 属于其他会话，不能作为「${this.convLabel(address)}」的引用回复。`;
        }
        const id = `d${Math.random().toString(36).slice(2, 8)}`;
        this.pendingSends.set(id, { address, label: this.convLabel(address), text, images, voice:args.voice as boolean | undefined, createdAt: Date.now(), replyMessageId: rid, sent: false });
        // 直接发送（去掉强制草稿门：LLM 起草后常常不调 qq_confirm_send，导致消息发不出去）
        const res = await this.sendTo(address, text, rid, atQQs, this.replyCounts(address), images, undefined, args.voice as boolean | undefined);
        const entry = this.pendingSends.get(id);
        if (entry) entry.sent = !res.startsWith(QQWorld.SEND_BLOCKED) && !res.startsWith(QQWorld.SEND_FAILED);
        if (res.startsWith(QQWorld.SEND_FAILED)) this.pendingSends.delete(id);
        // 暂停期间已到达的外部事件先排到下一轮
        if (this.host && typeof (this.host as { drainPendingEvents?: unknown }).drainPendingEvents === 'function') {
          const drained = await this.host.drainPendingEvents(
            (e) => e.source === SOURCE && !(e.type === 'qq.message' && (e as { senderKey?: string }).senderKey === address)
          );
          ctx?.queueExternalEvents?.(drained);
        }
        if (res.startsWith(QQWorld.SEND_BLOCKED)) {
          return `未能发送（编号 ${id}）到 ${this.convLabel(address)}：${res.slice(QQWorld.SEND_BLOCKED.length)}\n${rid !== undefined ? `（引用回复 #${rid} 未发出）\n` : ''}`;
        }
        if (res.startsWith(QQWorld.SEND_PARTIAL)) {
          return {
            text: `部分已发送（编号 ${id}）到 ${this.convLabel(address)}：${res.slice(QQWorld.SEND_PARTIAL.length)}\n（已成功的段落已在 QQ 发出，不要整段重发或重新确认。）`,
            failed: true,
          };
        }
        if (res.startsWith(QQWorld.SEND_FAILED)) {
          // failed:true 让上下文和控制台记录实际失败。
          return {
            text: `发送结果未确认（编号 ${id}）到 ${this.convLabel(address)}：${res.slice(QQWorld.SEND_FAILED.length)}\n（不能断言对方未收到；先核对 QQ 历史，不要直接重发。）`,
            failed: true,
          };
        }
        return `已发送（编号 ${id}）到 ${this.convLabel(address)}：${res}\n${rid !== undefined ? `（已绑定引用回复 #${rid}）\n` : ''}`;
      },
    };

    const confirm: ToolDef = {
      name: 'qq_confirm_send',
      tags: ['speak'],
      barrierAfter: true,
      description: '（兼容别名）qq_send 现已直接发送，通常无需调用本工具；仅当仍有未发送草稿时可补发。',
      parameters: {
        type: 'object',
        properties: {
          draft: { type: 'string', description: 'qq_send 返回的草稿编号；留空则发送最近一条草稿。' },
        },
        required: [],
      },
      handler: async (args) => {
        const id = typeof args.draft === 'string' && args.draft ? args.draft : Array.from(this.pendingSends.keys()).pop();
        if (!id || !this.pendingSends.has(id)) return '没有待确认的草稿（qq_send 现已直接发送，通常无需调用本工具）。';
        const p = this.pendingSends.get(id)!;
        if (p.sent) return '该草稿已由 qq_send 直接发送，无需重复确认。';
        this.pendingSends.delete(id);
        return await this.sendTo(p.address, p.text, p.replyMessageId, undefined, this.replyCounts(p.address), p.images, undefined, p.voice);
      },
    };

    const viewImage: ToolDef = {
      name: 'qq_view_image',
      tags: ['read'],
      barrierAfter: true,
      description:
        '主动重新看一张刚收到的 QQ 图片（当被动视觉没拿到描述、或你想细看时）。不传 url 则看最近收到的一张；也可传 url 指定任意图片链接。返回图片的文字描述。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '可选：要查看的图片链接；留空则取最近收到的一张。' },
          index: { type: 'number', description: '可选：取最近图片缓冲里的第几条（从 0 起，默认最后一条）。' },
        },
        required: [],
      },
      handler: async (args) => {
        if (!this.config.vision.enabled) return '被动视觉未开启（config.vision.enabled=false），无法看图。';
        let url = typeof args.url === 'string' && args.url.trim() ? args.url.trim() : '';
        if (!url) {
          const idx = typeof args.index === 'number' && Number.isFinite(args.index) ? args.index : this.recentImages.length - 1;
          const rec = this.recentImages[idx];
          if (!rec) return '还没有收到过任何图片，无法查看。';
          if (!this.canRead(rec.conv)) return '该图片所在会话未开放读取。';
          url = rec.url;
        }
        if (this.recentImages.some(rec => rec.url === url && !this.canRead(rec.conv))) return '该图片所在会话未开放读取。';
        const desc = await this.vision.viewImage(url);
        return desc ? `图片描述：${desc}` : '看图失败（下载或视觉端点异常，可稍后重试）。';
      },
    };

    const stickerSync: ToolDef = {
      name: 'qq_sticker_sync',
      tags: ['write'],
      barrierAfter: true,
      description: '同步当前 QQ 账号的收藏表情到本地表情库，并识别情绪和适用场景。账号新加收藏后调用；不向任何会话发送消息。',
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => this.syncFavoriteStickers(),
    };

    const stickerStats: ToolDef = {
      name: 'qq_sticker_stats',
      tags: ['read'],
      barrierAfter: true,
      description:
        '查看已自动收藏的表情包统计：总数、按情感分布、最近若干条（含情感/用处/标签/文件名）。想给 QQ 回复发表情包图片时，先调本工具拿到真实文件名（返回里的 [表情包:xxx.jpg]），再把整段 [表情包:文件名] 写进回复文本即可自动发出；只原样复制工具返回的完整标记，不从情绪或标签推导文件名。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '返回几条，默认 10，最多 50。' },
          query: { type: 'string', description: '按情绪、场景、标签或图片备注检索，例如 开心、撒娇、无语、晚安；空则返回最近收藏。' },
        },
        required: [],
      },
      handler: async (args) => {
        this.log.info('调用 qq_sticker_stats');
        if (!this.stickers) return '表情包收藏未启用。';
        const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.max(1, Math.min(50, args.limit)) : 10;
        const query = typeof args.query === 'string' ? args.query.trim() : '';
        const s = this.stickers.stats(this.stickers.size, query);
        const choices = s.recent.sort((a,b) => Number(b.sources.includes('qq:favorites')) - Number(a.sources.includes('qq:favorites'))).slice(0,limit);
        const lines = choices.map(
          (m) =>
            `- [表情包:${m.file}] ${m.label}（来源:${m.sources.includes('qq:favorites') ? 'QQ收藏' : '聊天收藏'} / 情感:${m.emotion} / 用处:${m.usage}${m.tag ? ' / 标签:' + m.tag : ''} / 出现${m.count}次）`,
        );
        const byEmo = Object.entries(s.byEmotion).map(([k, v]) => `${k}:${v}`).join('，') || '无';
        return `已收藏表情包共 ${s.total} 张；情感分布：${byEmo}\n${query ? '检索结果' : '可用表情'}（优先当前账号 QQ 收藏，发送为表情包）：\n${lines.join('\n') || '（暂无匹配；可换关键词或不填 query）'}`;
      },
    };

    const proactiveStatus: ToolDef = {
      name: 'qq_proactive_status',
      tags: ['read'],
      barrierAfter: true,
      description: '查看主动说话调度器状态：运行态（暖场/稳定/静默）、今日已发/配额、各会话未回复与静默情况、最近主动说过的话。',
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        if (!this.proactive) return '主动说话调度器未启用。';
        const s = this.proactive.status(this.proactiveTargets().length);
        const per = Object.entries(s.perAddr)
          .map(([a, v]) => `- ${a}：态=${v.state} 未回复=${v.unreplied}${v.silentUntil ? ' 静默至=' + new Date(v.silentUntil).toISOString() : ''}`)
          .join('\n') || '（无会话状态）';
        const recent = s.recent.length ? s.recent.slice(-5).map((t, i) => `  ${i + 1}. ${t}`).join('\n') : '（暂无）';
        return `主动说话：${s.runState}；今日 ${s.dailyCount}/${s.dailyQuota}；可主动会话 ${s.targets}\n会话状态：\n${per}\n最近投递交流事件：\n${recent}`;
      },
    };

    const poke: ToolDef = {
      name: 'qq_poke',
      tags: ['speak'],
      barrierAfter: false,
      description:
        '戳一戳某个人（群戳一戳或私聊戳一戳）。target 为会话地址 group:<群号> 或 private:<QQ号>（原样复制事件 meta 的 conv）；user 为要戳的人的 QQ 号或群内昵称（私聊戳一戳时留空表示戳对话对象）。这是一个动作而非文字消息。',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: '会话地址，原样复制事件 meta 里的 conv 字段。' },
          user: { type: 'string', description: '要戳的人的 QQ 号或群内昵称；私聊戳一戳时留空表示戳对话对象。' },
        },
        required: ['target'],
      },
      handler: async (args) => {
        const to = String(args.target ?? '').trim();
          const quiet = this.checkQuiet(to);
          if (quiet) return quiet;
        const target = this.resolveTarget(to);
        if (!target) return 'target 格式应为 "group:<群号>" 或 "private:<QQ号>"。';
        if (!this.isListened(target.kind, target.id)) return `该${target.kind === 'group' ? '群' : '私聊'}不在监听名单内，无法戳一戳。`;
        const driver = this.driver;
        if (!driver) return '未连接到 QQ 协议端。';
        const groupId = target.kind === 'group' ? target.id : null;
        const userRaw = args.user != null ? String(args.user).replace(/^@/, '').trim() : '';
        let userId: number | null;
        if (!userRaw) {
          if (target.kind === 'private') userId = target.id;
          else {
            // 群戳一戳未指定 user：回落到被引用/@ 提及的人
            const fb = this.fallbackTarget(groupId);
            userId = fb ?? null;
            if (userId == null) return '群戳一戳需要指定 user（QQ 号、群内昵称或外号）；或在消息里 @/引用要戳的人。';
          }
        } else {
          userId = await this.resolveQQ(groupId, userRaw);
        }
        if (userId == null) return `无法把 "${userRaw}" 解析成 QQ 号（群内昵称需为该群成员；私聊只能填 QQ 号）。`;
        if (this.host?.isPaused?.()) return 'Run paused';
        try {
          const quiet = this.checkQuiet(to);
          if (quiet) return quiet;
          if (target.kind === 'group') await driver.callApi('group_poke', { group_id: target.id, user_id: userId });
          else await driver.callApi('friend_poke', { user_id: userId });
          // 把「自己戳了谁」作为内部事件回灌会话上下文：origin=internal 渲染进上下文但不
          // 唤醒回合（无回声），否则 bot 下一轮完全不记得是自己戳的，别人回"别戳我"时也接不上。
          try {
            const text = target.kind === 'group'
              ? `我刚才在QQ群 ${target.id} 里戳了 QQ ${userId}。`
              : `我刚才在QQ私聊里戳了 QQ ${userId}。`;
            await this.host?.pushEvent({
              type: 'qq.message',
              ts: eventTs(this.config.timezone),
              source: SOURCE,
              origin: 'internal',
              text,
              senderKey: to,
              meta: { conv: to, role: 'assistant', self: true },
            }, { trigger: 'piggyback' });
          } catch (fe) {
            this.log.warn('qq_poke 回灌上下文失败 ' + String(fe));
          }
          return `已戳一戳 ${userRaw || '对话对象'}（QQ ${userId}）。`;
        } catch (e) {
          return `戳一戳失败：${String(e)}`;
        }
      },
    };

    // ---- 闹钟 / 记事本 ----
    const reminderAdd: ToolDef = {
      name: 'qq_reminder_add',
      tags: ['speak'],
      description:
        '记一个定时提醒 / 闹钟（也是记事本）。把需要以后做的事、约定、待办记下，到点会自动在该会话提醒对方。' +
        'when 支持：绝对 ISO 时间（如 2026-09-24T09:30）、"HH:MM"（今天，已过则明天）、"明天 9:00"、"in 30m" / "30分钟后" / "2小时后" / "3天后"。' +
        'text 是提醒内容。address 默认就是当前会话（一般不用填）；scope 可填“这是谁的事 / 相关人”等备注。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要提醒的内容，例如“提醒我三点开会”“和用户约好的事：明天还书”' },
          when: { type: 'string', description: '提醒时间，见上方描述里的格式（给一个未来的时间）' },
          address: { type: 'string', description: '可选，提醒发到哪个会话（group:群号 / private:QQ），默认当前会话' },
          scope: { type: 'string', description: '可选，备注（谁的事 / 相关人）' },
        },
        required: ['text', 'when'],
      },
      handler: async (args, ctx) => {
        const text = String(args.text ?? '').trim();
        const whenStr = String(args.when ?? '').trim();
        if (!text) return toolError('text 不能为空');
        const when = parseWhen(whenStr);
        if (when == null) {
          return toolError(`无法解析时间：“${whenStr}”。支持 ISO、HH:MM、明天 9:00、in 30m、30分钟后 等。`);
        }
        if (when <= Date.now()) return toolError('这个时间已经过去了，请给一个未来的时间。');
        const address = typeof args.address === 'string' && args.address.trim() ? args.address.trim() : ctx.role;
        const scope = typeof args.scope === 'string' ? args.scope.trim() : '';
        const r = this.reminders.add(text, when, { address, scope });
        return { text: `已记下提醒（id=${r.id}）：${text} @ ${formatWhen(when)}`, ok: true, id: r.id, content: text, when: formatWhen(when), whenMs: when, address };
      },
    };
    const reminderList: ToolDef = {
      name: 'qq_reminder_list',
      tags: ['read'],
      description: '列出当前所有未触发的提醒 / 记事（闹钟清单），用于向用户汇报“你记了这些事”。返回每条的 id、内容、时间。',
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        const list = this.reminders.list(true);
        if (!list.length) return { text: '当前没有待提醒/记事。', ok: true, count: 0, reminders: [] };
        return {
          text: `共 ${list.length} 条待提醒/记事：` + list.map((r) => `- [${r.id}] ${r.text} @ ${formatWhen(r.when)}`).join('\n'),
          ok: true,
          count: list.length,
          reminders: list.map((r) => ({ id: r.id, text: r.text, when: formatWhen(r.when), address: r.address || '', scope: r.scope || '' })),
        };
      },
    };
    const reminderCancel: ToolDef = {
      name: 'qq_reminder_cancel',
      tags: ['speak'],
      description: '取消 / 删除一条提醒（记事）。传要删的 id（来自 qq_reminder_list 或 qq_reminder_update(action=add) 时返回的 id）。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: '要取消的提醒 id' } },
        required: ['id'],
      },
      handler: async (args, ctx) => {
        const id = String(args.id ?? '').trim();
        if (!id) return toolError('id 不能为空');
        const ok = this.reminders.remove(id);
        return ok ? { text: `已取消提醒 ${id}。`, ok: true, removed: id } : toolError(`没找到 id=${id} 的提醒`);
      },
    };

    // ---- 外号记忆：外号（昵称之外的代称）→ QQ 号，解析 who 时优先查 ----
    const aliasSet: ToolDef = {
      name: 'qq_alias_set',
      tags: ['write'],
      description:
        '记住一个「外号/代称 → QQ 号」的对应关系（长期记忆，跨重启保留）。之后用禁言、设头衔、戳一戳等工具时，who 直接填这个外号就能解析到对应的人。' +
        'alias 填外号（如“阿强”“老板”），qq 填对方的 QQ 号。已存在同名外号会覆盖。',
      parameters: {
        type: 'object',
        properties: {
          alias: { type: 'string', description: '外号/代称，例如“阿强”“老板”“那个总发广告的”' },
          qq: { type: 'string', description: '对应的真实 QQ 号（纯数字）' },
        },
        required: ['alias', 'qq'],
      },
      handler: async (args, ctx) => {
        const alias = typeof args.alias === 'string' ? args.alias.trim() : '';
        const qqRaw = typeof args.qq === 'string' ? args.qq.trim() : String(args.qq ?? '');
        if (!alias) return toolError('alias 不能为空');
        if (!/^\d{5,}$/.test(qqRaw)) return toolError('qq 必须是纯数字 QQ 号（>=5 位）。');
        const qq = Number(qqRaw);
        this.aliases.set(alias.toLowerCase(), qq);
        this.saveAliases();
        return { text: `已记住外号「${alias}」→ QQ ${qq}。`, ok: true, alias, qq };
      },
    };
    const aliasForget: ToolDef = {
      name: 'qq_alias_forget',
      tags: ['write'],
      description: '忘记一个外号对应关系（删除之前用 qq_alias_set 记的）。alias 填要删的外号。',
      parameters: {
        type: 'object',
        properties: { alias: { type: 'string', description: '要忘记的外号/代称' } },
        required: ['alias'],
      },
      handler: async (args, ctx) => {
        const alias = typeof args.alias === 'string' ? args.alias.trim() : '';
        if (!alias) return toolError('alias 不能为空');
        const had = this.aliases.delete(alias.toLowerCase());
        if (had) this.saveAliases();
        return had ? { text: `已忘记外号「${alias}」。`, ok: true, alias, forgotten: true } : { text: `没有记过外号「${alias}」。`, ok: true, alias, forgotten: false };
      },
    };
    const aliasList: ToolDef = {
      name: 'qq_alias_list',
      tags: ['read'],
      description: '列出当前记住的所有外号→QQ 对应关系。',
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        const entries = [...this.aliases.entries()].map(([alias, qq]) => ({ alias, qq }));
        if (!entries.length) return { text: '还没有记过任何外号。', ok: true, count: 0, aliases: [] };
        return { text: '外号记忆：\n' + entries.map((e) => `- ${e.alias} → QQ ${e.qq}`).join('\n'), ok: true, count: entries.length, aliases: entries };
      },
    };

    // ---- 本地私人笔记本----
    const noteSave: ToolDef = {
      name: 'qq_note_save',
      tags: ['write'],
      description:
        '把你想长期记住的东西写进「私人笔记本」——任何你（智能体）想记的事：对某个人的观感、一条约定、一个灵感、' +
        '用户叮嘱的偏好、自己立下的小目标等。记忆插件(cortico-world-memory)启用时，笔记会进它的记忆库并常驻进你的环境提示词；' +
        '没启用时落到本地笔记本文件。text 填要记的内容（尽量具体、自包含，日后回看能懂）。',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: '要记的内容' } },
        required: ['text'],
      },
      handler: async (args, ctx) => {
        let text = typeof args.text === 'string' ? args.text.trim() : '';
        if (!text) return toolError('text 不能为空');
        try {text = await reviewMemory(this.config.contentReviewUrl, text);}
        catch {return toolError('记忆内容审核不可用，未保存正文');}
        const r = await this.notebook.save(text);
        const where = '本地笔记本';
        const preview = text.length > 60 ? text.slice(0, 60) + '…' : text;
        return { text: `已记到笔记本（${where}）：${preview}`, ok: true, id: r.id, backend: r.backend };
      },
    };
    const noteList: ToolDef = {
      name: 'qq_note_list',
      tags: ['read'],
      description: '列出本扩展 notebook.jsonl 的全部笔记。用于回看你记过什么。',
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        const entries = await this.notebook.list();
        if (!entries.length) return { text: '笔记本还是空的，还没记过东西。', ok: true, count: 0, backend: this.notebook.backend, entries: [] };
        const lines = entries.map((e) => `${e.seq != null ? e.seq + '. ' : '- '}${e.text}`);
        const where = '本地笔记本';
        return { text: `笔记本（${where}）共 ${entries.length} 条：\n` + lines.join('\n'), ok: true, count: entries.length, backend: this.notebook.backend, entries: entries.map((e) => ({ id: e.id, text: e.text, ts: e.ts })) };
      },
    };
    const noteGet: ToolDef = {
      name: 'qq_note_get',
      tags: ['read'],
      description: '按 id 查看某条笔记本内容。id 来自 qq_note_read(view=list) 的编号/条目 id。',
      parameters: { type: 'object', properties: { id: { type: 'string', description: '条目 id' } }, required: ['id'] },
      handler: async (args, ctx) => {
        const id = typeof args.id === 'string' ? args.id.trim() : '';
        if (!id) return toolError('id 不能为空');
        const e = await this.notebook.get(id);
        if (!e) return { text: `没找到 id=${id} 的笔记。`, ok: true, found: false };
        return { text: `笔记 #${id}：${e.text}`, ok: true, found: true, id: e.id, content: e.text, ts: e.ts };
      },
    };
    const noteForget: ToolDef = {
      name: 'qq_note_forget',
      tags: ['write'],
      description: '删除一条笔记本（你确定不再需要它时）。id 来自 qq_note_read(view=list) 的编号/条目 id。',
      parameters: { type: 'object', properties: { id: { type: 'string', description: '条目 id' } }, required: ['id'] },
      handler: async (args, ctx) => {
        const id = typeof args.id === 'string' ? args.id.trim() : '';
        if (!id) return toolError('id 不能为空');
        const ok = await this.notebook.forget(id);
        return ok ? { text: `已删除笔记本 #${id}。`, ok: true, id } : { text: `没找到 id=${id} 的笔记，未删除。`, ok: true, found: false };
      },
    };

    // ===================== 群管理员能力（admin.enabled 控制是否生效） =====================
    /** 仅检查管理员总开关 */
    const adminEnabled = (): string | null => (this.config.admin.enabled ? null : '管理员功能未开启（在控制台开启 worlds.qqbot.admin.enabled 后即可使用）。');

    /** 指挥官鉴权结果 */
    interface AuthResult {
      ok: boolean;
      text?: string;
      gid?: number;
      callerId?: number;
      callerRole?: string;
    }

    /**
     * 管理员操作指挥官鉴权：判断「谁在命令 bot 执行管理操作」是否有权。
     * 授权逻辑（满足任一即可）：
     *  1) 指挥官 QQ 在 admin.allowlist 白名单中；
     *  2) admin.allowGroupAdmins 开启，且指挥官在群内身份为 owner/admin（ownerOnly 时仅 owner）；
     *  3) admin.allowSelf 开启，且 bot 自身（AI）主动决定执行管理操作（无需某个人下令）。
     * 指挥官取自「本会话最近一次发言者」（callerByConv），仅 2 分钟内有效，防会话串台/陈旧来源。
     */
    const adminAuthorize = async (ctx: ToolCallContext, args: Record<string, unknown>): Promise<AuthResult> => {
      if (!this.config.admin.enabled) return { ok: false, text: '管理员功能未开启（在控制台开启 worlds.qqbot.admin.enabled 后即可使用）。' };
      const rg = resolveGroup(args.group ?? ctx.role);
      if (rg.err) return { ok: false, text: rg.err };
      const gid = rg.gid;
      const cfg = this.config.admin;
      const caller = this.callerByConv.get(ctx.role);
      const fresh = caller && Date.now() - caller.at < 120000 ? caller : undefined;
      const callerId = fresh?.userId;
      if (callerId == null) {
        // 没有近期发言者：无法判定为人类指挥官；若允许 bot 自主行动则授权，否则拒绝
        if (cfg.allowSelf) return { ok: true, gid, callerRole: 'self' };
        return { ok: false, text: '无法确定命令来源：仅当有人在群里 @ 你或在群里说话时，才能触发管理操作（防滥用）。' };
      }
      const callerStr = String(callerId);
      // 1) 白名单
      if (Array.isArray(cfg.allowlist) && cfg.allowlist.map(String).includes(callerStr)) {
        return { ok: true, gid, callerId, callerRole: 'allowlisted' };
      }
      // 2) 群内身份
      if (cfg.allowGroupAdmins) {
        try {
          const info = await this.driver!.getMemberInfo(gid, Number(callerId));
          const role = (info && (info.role as string)) || 'member';
          const allowed = cfg.ownerOnly ? role === 'owner' : role === 'owner' || role === 'admin';
          if (allowed) return { ok: true, gid, callerId, callerRole: role };
        } catch { /* 落到下方逻辑 */ }
      }
      // 3) bot 自身主动决定（AI 自己想禁言/撤回也行）
      if (cfg.allowSelf) return { ok: true, gid, callerId, callerRole: 'self' };
      // 均不满足：拒绝并说明
      if (!cfg.allowGroupAdmins) {
        return { ok: false, text: `群管理员指挥未开启，且你（QQ ${callerStr}）不在授权白名单中，无法命令我执行管理操作。` };
      }
      // 群内身份不足，且无自主授权
      const info = await this.driver!.getMemberInfo(gid, Number(callerId)).catch(() => null);
      const role = (info && (info.role as string)) || 'member';
      return { ok: false, text: `你（QQ ${callerStr}，群内身份=${role}）没有管理员权限，不能命令我执行管理操作。` };
    };

    /**
     * 目标保护：某些身份（群主、管理员）不允许被普通管理员撤/禁/改头衔。
     * 返回拒绝文本，或 null 表示允许。
     */
    const protectTarget = async (gid: number, targetUid: number, callerRole?: string): Promise<string | null> => {
      const cfg = this.config.admin;
      if (!cfg.protectOwner && !cfg.protectAdmins) return null;
      try {
        const info = await this.driver!.getMemberInfo(gid, targetUid);
        const role = (info && (info.role as string)) || 'member';
        if (cfg.protectOwner && role === 'owner') return '不能对群主执行该操作（受保护）。';
        if (cfg.protectAdmins && role === 'admin' && callerRole !== 'owner') return '只有群主才能对该管理员执行该操作（受保护）。';
      } catch { /* 查询失败不阻断，按允许处理 */ }
      return null;
    };

    /** 解析群参数：支持群号(number)或 "group:xxx" 形式，返回 group_id（number）或报错文本。 */
    const resolveGroup = (to: unknown): { gid: number; err?: string } => {
      let gidRaw: number | null = null;
      if (typeof to === 'number') gidRaw = to;
      else if (typeof to === 'string') {
        const s = to.trim();
        if (s.startsWith('group:')) gidRaw = Number(s.slice(6));
        else gidRaw = Number(s);
      }
      if (gidRaw == null || !Number.isFinite(gidRaw) || gidRaw <= 0) return { gid: 0, err: `无法识别的群标识：${String(to)}（填群号或 group:<群号>）` };
      return { gid: gidRaw };
    };
    /** 把昵称/QQ/外号解析成 userId（外号记忆优先，其次群内昵称），失败返回报错文本。 */
    const resolveUser = async (gid: number, who: unknown): Promise<{ uid: number; err?: string }> => {
      const s = typeof who === 'string' ? who.trim() : String(who ?? '');
      if (!s) return { uid: 0, err: '目标用户不能为空（填昵称、QQ 号或外号）' };
      if (/^\d+$/.test(s)) return { uid: Number(s) };
      const byAlias = this.resolveAlias(s);
      if (byAlias) return { uid: byAlias };
      const uid = await this.resolveQQ(gid, s);
      if (!uid) return { uid: 0, err: `在群 ${gid} 里找不到叫「${s}」的成员（确认昵称、改用 QQ 号，或在记忆里记一下这个外号对应谁）` };
      return { uid };
    };
    /** 通用：调用 OneBot action，吞掉异常返回可读错误。 */
    const api = async (action: string, params: Record<string, unknown>): Promise<{ ok: boolean; text: string }> => {
      const driver = this.driver;
      if (!driver) return { ok: false, text: '未连接到 QQ 协议端，无法执行管理员操作。' };
      try {
    if (this.config.contentReviewUrl) {
          for (const key of ['content','special_title']) {
            const text = params[key];
            if (typeof text === 'string' && !(await reviewContent(this.config.contentReviewUrl,text,'message')).allow) params[key] = 'filtered';
          }
        }
        if (this.host?.isPaused?.()) return {ok:false,text:'Run paused'};
        const r: unknown = await driver.callApi(action, params);
        return { ok: true, text: `OK (${action})` };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, text: `操作失败（${action}）：${msg}` };
      }
    };

    const adminRecall: ToolDef = {
      name: 'qq_admin_recall',
      tags: ['write'],
      barrierAfter: true,
      description: '群管理内部操作。',
      parameters: { type: 'object', properties: { messageId: { type: 'string', description: '要撤回的 message_id，可填纯数字或「#123456」形式' }, group: { type: 'string', description: '可选，群号或 group:<群号>；不填则使用当前会话所在群' } }, required: ['messageId'] },
      handler: async (args, ctx) => {
        const auth = await adminAuthorize(ctx, args);
        if (!auth.ok) return auth.text ?? "管理员授权失败。";
        const raw = typeof args.messageId === 'string' ? args.messageId.replace(/^#/, '').trim() : String(args.messageId ?? '');
        const messageId = Number(raw);
        if (!Number.isFinite(messageId)) return 'messageId 无效（应为数字 message_id，例如消息开头的 #123456）。';
        const res = await api('delete_msg', { message_id: messageId });
        return res.text ?? "协议端没有返回操作结果。";
      },
    };

    const adminAtAll: ToolDef = {
      name: 'qq_admin_at_all',
      tags: ['write'],
      barrierAfter: true,
      description: '群管理内部操作。',
      parameters: { type: 'object', properties: { text: { type: 'string', description: '@全体时附带的正文内容' }, group: { type: 'string', description: '群号或 group:<群号>；不填用当前会话所在群' } }, required: ['text'] },
      handler: async (args, ctx) => {
        const auth = await adminAuthorize(ctx, args);
        if (!auth.ok) return auth.text ?? "管理员授权失败。";
        let text = typeof args.text === 'string' ? args.text : '';
        const driver = this.driver;
        if (!driver) return '未连接到 QQ 协议端，无法发送。';
        try {
          const rejected = this.config.contentReviewUrl && !(await reviewContent(this.config.contentReviewUrl,text,'message')).allow;
          if (rejected) text = 'filtered';
          if (this.host?.isPaused?.()) return 'Run paused';
          const quiet = this.checkQuiet(`group:${auth.gid}`);
          if (quiet) return quiet;
          await driver.callApi('send_group_msg', { group_id: auth.gid!, message: [...(rejected ? [] : [{type:'at',data:{qq:'all'}}]), { type: 'text', data: { text: text ? text : '' } }] });
          return `已向群 ${auth.gid} @全体成员。`;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return `发送失败：${msg}（@全体成员需要管理员权限且群设置允许）`;
        }
      },
    };

    const adminNotice: ToolDef = {
      name: 'qq_admin_notice',
      tags: ['write'],
      barrierAfter: true,
      description: '群管理内部操作。',
      parameters: { type: 'object', properties: { content: { type: 'string', description: '群通知/公告正文' }, group: { type: 'string', description: '群号或 group:<群号>；不填用当前会话所在群' } }, required: ['content'] },
      handler: async (args, ctx) => {
        const auth = await adminAuthorize(ctx, args);
        if (!auth.ok) return auth.text ?? "管理员授权失败。";
        const content = typeof args.content === 'string' ? args.content : '';
        if (!content.trim()) return '公告内容不能为空。';
        const res = await api(this.config.admin.noticeAction || 'send_group_notice', { group_id: auth.gid!, content });
        return res.text ?? "协议端没有返回操作结果。";
      },
    };

    const adminJoinList: ToolDef = {
      name: 'qq_admin_join_list',
      tags: ['write'],
      barrierAfter: true,
      description: '群管理内部操作。',
      parameters: { type: 'object', properties: {} },
      handler: async () => {
        const e = adminEnabled();
        if (e) return e;
        if (!this.config.admin.allowJoin) return '未开启自动审核加群（在控制台开启 worlds.qqbot.admin.allowJoin 后即可处理）。';
        if (this.pendingJoinRequests.size === 0) return '当前没有待审核的加群请求。';
        const items = [...this.pendingJoinRequests.values()].filter(r => this.canRead(`group:${r.groupId}`)).map((r) => `#${r.flag} 群${r.groupId} 申请人QQ${r.userId}（${r.subType === 'invite' ? '邀请' : '申请'}）留言：${r.comment || '（无）'}`);
        return '待审核加群请求：\n' + items.join('\n');
      },
    };

    const adminJoinApprove: ToolDef = {
      name: 'qq_admin_join_approve',
      tags: ['write'],
      barrierAfter: true,
      description: '群管理内部操作。',
      parameters: { type: 'object', properties: { flag: { type: 'string', description: '加群请求 flag（qq_admin_join_list 给出的 # 后字符串，或直接贴原 flag）' } }, required: ['flag'] },
      handler: async (args, ctx) => {
        const e = adminEnabled();
        if (e) return e;
        if (!this.config.admin.allowJoin) return '未开启自动审核加群（在控制台开启 worlds.qqbot.admin.allowJoin 后即可处理）。';
        const flag = typeof args.flag === 'string' ? args.flag.trim().replace(/^#/, '') : '';
        if (!flag) return 'flag 不能为空。';
        const req0 = this.pendingJoinRequests.get(flag);
        if (!req0) return `没找到 flag=${flag} 的待审请求（可能已处理或已过期）。`;
        const res = await api('set_group_add_request', { flag, sub_type: req0.subType, approve: true });
        if (res.ok) this.pendingJoinRequests.delete(flag);
        return res.text ?? "协议端没有返回操作结果。";
      },
    };

    const adminJoinReject: ToolDef = {
      name: 'qq_admin_join_reject',
      tags: ['write'],
      barrierAfter: true,
      description: '群管理内部操作。',
      parameters: { type: 'object', properties: { flag: { type: 'string', description: '加群请求 flag' }, reason: { type: 'string', description: '拒绝理由（可选）' } }, required: ['flag'] },
      handler: async (args, ctx) => {
        const e = adminEnabled();
        if (e) return e;
        if (!this.config.admin.allowJoin) return '未开启自动审核加群（在控制台开启 worlds.qqbot.admin.allowJoin 后即可处理）。';
        const flag = typeof args.flag === 'string' ? args.flag.trim().replace(/^#/, '') : '';
        if (!flag) return 'flag 不能为空。';
        const req0 = this.pendingJoinRequests.get(flag);
        if (!req0) return `没找到 flag=${flag} 的待审请求（可能已处理或已过期）。`;
        const res = await api('set_group_add_request', { flag, sub_type: req0.subType, approve: false, reason: typeof args.reason === 'string' ? args.reason : '' });
        if (res.ok) this.pendingJoinRequests.delete(flag);
        return res.text ?? "协议端没有返回操作结果。";
      },
    };

    const adminTitle: ToolDef = {
      name: 'qq_admin_title',
      tags: ['write'],
      barrierAfter: true,
      description: '群管理内部操作。',
      parameters: { type: 'object', properties: { who: { type: 'string', description: '成员昵称、QQ 号或外号；不填则默认针对最近被引用/@ 提及的人' }, title: { type: 'string', description: '要设置的群头衔（空字符串清除）' }, group: { type: 'string', description: '群号或 group:<群号>；不填用当前会话所在群' } }, required: [] },
      handler: async (args, ctx) => {
        const auth = await adminAuthorize(ctx, args);
        if (!auth.ok) return auth.text ?? "管理员授权失败。";
        const gid = auth.gid!;
        const whoProvided = typeof args.who === 'string' && args.who.trim();
        const fb = !whoProvided ? this.fallbackTarget(gid) : null;
        const whoRaw = whoProvided || (fb ? String(fb) : '');
        const ru = await resolveUser(gid, whoRaw);
        if (ru.err) return ru.err;
        const prot = await protectTarget(gid, ru.uid, auth.callerRole);
        if (prot) return prot;
        const title = typeof args.title === 'string' ? args.title : '';
        const res = await api('set_group_special_title', { group_id: gid, user_id: ru.uid, special_title: title });
        return res.text ?? "协议端没有返回操作结果。";
      },
    };

    const adminBan: ToolDef = {
      name: 'qq_admin_ban',
      tags: ['write'],
      barrierAfter: true,
      description: '群管理内部操作。',
      parameters: { type: 'object', properties: { who: { type: 'string', description: '成员昵称、QQ 号或外号；不填则默认针对最近被引用/@ 提及的人' }, durationSec: { type: 'number', description: '禁言时长（秒），默认 600，0=解禁' }, group: { type: 'string', description: '群号或 group:<群号>；不填用当前会话所在群' } }, required: [] },
      handler: async (args, ctx) => {
        const auth = await adminAuthorize(ctx, args);
        if (!auth.ok) return auth.text ?? "管理员授权失败。";
        const gid = auth.gid!;
        const whoProvided = typeof args.who === 'string' && args.who.trim();
        const fb = !whoProvided ? this.fallbackTarget(gid) : null;
        const whoRaw = whoProvided || (fb ? String(fb) : '');
        const ru = await resolveUser(gid, whoRaw);
        if (ru.err) return ru.err;
        const prot = await protectTarget(gid, ru.uid, auth.callerRole);
        if (prot) return prot;
        const dur = typeof args.durationSec === 'number' && Number.isFinite(args.durationSec) ? Math.max(0, Math.floor(args.durationSec)) : 600;
        const res = await api('set_group_ban', { group_id: gid, user_id: ru.uid, duration: dur });
        return res.text ?? "协议端没有返回操作结果。";
      },
    };

    const adminBanAll: ToolDef = {
      name: 'qq_admin_ban_all',
      tags: ['write'],
      barrierAfter: true,
      description: '群管理内部操作。',
      parameters: { type: 'object', properties: { enable: { type: 'boolean', description: 'true=开启全员禁言，false=关闭' }, group: { type: 'string', description: '群号或 group:<群号>；不填用当前会话所在群' } }, required: ['enable'] },
      handler: async (args, ctx) => {
        const auth = await adminAuthorize(ctx, args);
        if (!auth.ok) return auth.text ?? "管理员授权失败。";
        const enable = args.enable === true;
        const res = await api('set_group_whole_ban', { group_id: auth.gid!, enable });
        return res.text ?? "协议端没有返回操作结果。";
      },
    };

    const adminKick: ToolDef = {
      name: 'qq_admin_kick',
      tags: ['write'],
      barrierAfter: true,
      description: '群管理内部操作。',
      parameters: { type: 'object', properties: { who: { type: 'string', description: '成员昵称、QQ 号或外号；不填则默认针对最近被引用/@ 提及的人' }, rejectRejoin: { type: 'boolean', description: 'true=踢出并拒绝再次加群（默认），false=仅踢出' }, group: { type: 'string', description: '群号或 group:<群号>；不填用当前会话所在群' } }, required: [] },
      handler: async (args, ctx) => {
        const auth = await adminAuthorize(ctx, args);
        if (!auth.ok) return auth.text ?? '未授权执行该管理操作。';
        const gid = auth.gid!;
        // 踢人比其他管理操作更重：默认不认「无人下令、bot 自主」这条路径（需控制台显式放行）。
        if (auth.callerRole === 'self' && !this.config.admin.allowSelfKick) {
          return '踢人属于高影响且不可逆的操作，需要授权指挥官（白名单/群管理员/群主）在对话里明确下令；AI 不能自主踢人（控制台开启 admin.allowSelfKick 可放行）。';
        }
        const whoProvided = typeof args.who === 'string' && args.who.trim();
        const fb = !whoProvided ? this.fallbackTarget(gid) : null;
        const whoRaw = whoProvided || (fb ? String(fb) : '');
        if (!whoRaw) return '未指定要踢出的人：请给出昵称、QQ 号或外号，或在群里 @ / 引用该成员后再让我踢。';
        const ru = await resolveUser(gid, whoRaw);
        if (ru.err) return ru.err;
        if (ru.uid === this.identity?.selfId) return '不能把我自己踢出群（换个人吧）。';
        const prot = await protectTarget(gid, ru.uid, auth.callerRole);
        if (prot) return prot;
        const reject = typeof args.rejectRejoin === 'boolean' ? args.rejectRejoin : this.config.admin.kickRejectRejoin;
        const res = await api('set_group_kick', { group_id: gid, user_id: ru.uid, reject_add_request: reject });
        return res.ok ? `已把 ${ru.uid} 踢出群 ${gid}${reject ? '（并拒绝其再次加群）' : ''}。` : res.text;
      },
    };



    const tools: ToolDef[] = [forwardById,stickerToFavorites,stickerTag,send, confirm, viewImage, stickerStats, proactiveStatus, poke, reminderAdd, reminderList, reminderCancel, aliasSet, aliasForget, aliasList, noteSave, noteList, noteGet, noteForget, adminRecall, adminAtAll, adminNotice, adminJoinList, adminJoinApprove, adminJoinReject, adminTitle, adminBan, adminBanAll, adminKick, ...makeHistoryTools({

      getHost: () => this.host,
      sourceId: SOURCE,
      timezone: this.config.timezone,
      convLabel: (a) => this.convLabel(a),
      canRead: (a) => this.canRead(a),
      sendBlock: (a) => this.checkQuiet(a),
    })];
    tools.push(stickerSync, sendAudio);
    for (const tool of tools) {
      if (['qq_send', 'qq_confirm_send', 'qq_send_audio', 'qq_poke', 'qq_proactive_trigger', 'qq_admin_at_all', 'qq_admin_notice'].includes(tool.name)) {
        tool.description += ' 使用前遵守最新 QQ 发送限制：对应回复开关必须开启，静默时须在独立白名单且有新消息待回复，连接就绪。关闭或被拦截后停止试发，等待状态恢复。';
      }
    }
    return compactQQTools(tools);
  }

  /** 自描述用:用一个未启动的实例读工具表,与 tools() 同源(含动态追加的历史工具)。 */
  static describeToolSpecs(): ToolSpec[] {
    // normalizeConfig 已给全默认值,tools() 内部对资源的访问都在 handler 闭包里。
    return new QQWorld().tools() as ToolSpec[];
  }

  // ---- 控制台 ----
  webUi(language: Language = 'zh'): WorldWebUiDecl {
    const lamps: WorldLamp[] = [
      {
        label: 'OneBot 连接',
        state: this.connected ? 'online' : this.config.mode === 'reverse' ? 'loading' : 'offline',
        hint: this.connected ? '已连接' : this.config.mode === 'reverse' ? '等待 QQ 协议端反向连入' : '未连接',
      },
      {
        label: '身份',
        state: this.identity ? 'online' : 'offline',
        hint: this.identity ? `QQ ${this.identity.selfId}（${this.identity.nickname}）` : '未加载',
      },
      {
        label: '群聊限速/防死循环',
        state: this.config.groupSpeak.enabled || this.config.antiLoop.enabled ? 'online' : 'offline',
        hint: `群发言限速=${this.config.groupSpeak.enabled ? `${this.config.groupSpeak.maxPerWindow}/${this.config.groupSpeak.windowSec}s` : '关'}；话题防死循环=${this.config.antiLoop.enabled ? `连续≤${this.config.antiLoop.maxConsecutiveBotTurns}/静默${this.config.antiLoop.idleToEndSec}s收尾` : '关'}`,
      },
      {
        label: '闹钟/记事本',
        state: this.config.reminder.enabled ? 'online' : 'offline',
        hint: this.config.reminder.enabled
          ? `到点提醒开·待提醒 ${this.reminders?.list(true).length ?? 0} 条`
          : '记录/查询可用，但到点自动提醒已关',
      },
    ];
    // 按模块拆分的控制台面板：每个模块一组完整可编辑配置（通用配置表单 + 运行时状态）。
    const modulePanels: Array<{ id: string; title: string; description: string; group: string; prefix: string; topOnly: boolean; status?: string; extra?: string }> = [
      {id: 'quiet', title: '静默白名单', description: '作息睡眠和午休期间停止主动发送，只回复独立的群聊或私聊名单。', group: 'world:qqbot-quiet', prefix: '', topOnly: false, status: 'getQuietState'},
      { id: 'general', title: '连接与监听', description: 'OneBot 连接参数与监听名单；连接类改动需重启生效。', group: 'world:qqbot', prefix: '', topOnly: true },
      { id: 'vision', title: '视觉', description: '辅助视觉（VLM）：接收图片时用视觉模型理解。', group: 'world:qqbot', prefix: 'worlds.qqbot.vision.', topOnly: false },
      { id: 'sticker', title: '表情包', description: '收藏聊天图片与 QQ 账号收藏表情，并标注情感和适用场景。', group: 'world:qqbot', prefix: 'worlds.qqbot.sticker.', topOnly: false, status: 'getStickerState' },
      { id: 'proactive', title: '主动说话', description: '后台按状态机向监听会话主动冒泡闲聊（移植自 fat-fish ProactiveSpeaker）。', group: 'world:qqbot', prefix: 'worlds.qqbot.proactive.', topOnly: false },
      { id: 'group-speak', title: '群聊限速', description: '限制每个群在单位窗口内被 bot 发出的消息总量，防刷屏/死循环。', group: 'world:qqbot', prefix: 'worlds.qqbot.groupSpeak.', topOnly: false },
      { id: 'anti-loop', title: '防刷/话题结束', description: '统计单会话 bot 连续发言次数与对方静默时长，超限自动收尾。', group: 'world:qqbot', prefix: 'worlds.qqbot.antiLoop.', topOnly: false },
      { id: 'routine', title: '作息功能', description: '按真实时间切换睡眠/午休/活跃状态，到点播报。', group: 'world:qqbot', prefix: 'worlds.qqbot.routine.', topOnly: false },
      { id: 'reminder', title: '到点提醒', description: '记下的定时提醒到点自动发到对应会话。', group: 'world:qqbot', prefix: 'worlds.qqbot.reminder.', topOnly: false },
      { id: 'admin', title: '群管理员', description: '群管理员能力：撤回/@全体/通知/审核进群/头衔/禁言/踢人。', group: 'world:qqbot', prefix: 'worlds.qqbot.admin.', topOnly: false },
      { id: 'voice', title: '语音发送', description: 'AI 回复转语音；音频输入需单独安装 QQ Audio Input。可整体开关，运行时状态见上方。', group: 'world:qqbot-voice', prefix: '', topOnly: false, status: 'getVoiceState' },
    ];
    const activeModulePanels = modulePanels;
    const toPanelDecl = (m: (typeof modulePanels)[number]): WorldPanelDecl => ({
      id: m.id,
      title: m.title,
      description: m.description,
      getMethods: ['config', ...(m.id === 'proactive' ? ['triggerProactive'] : []), ...(m.id === 'general' ? ['restartConnection', 'getReverseToken'] : []), ...(m.status ? [m.status] : [])],
    });
    // 面板顺序：连接与监听排第一（装完扩展第一件事就是配连接与监听），监听名单排第二，
    // 其余模块与「实时事件」保持原有相对顺序。
    const panels: WorldPanelDecl[] = [
      ...activeModulePanels.filter((m) => m.id === 'general').map(toPanelDecl),
      { id: 'roster', title: '监听名单', description: '当前监听的群与私聊及未读情况。', getMethods: ['getRoster'] },
      ...activeModulePanels.filter((m) => m.id !== 'general').map(toPanelDecl),
      { id: 'events', title: '实时事件', description: 'QQ 消息与通知的实时流。' },
    ];
    return {
      label: 'QQ ProMAX',
      lamps,

      badges: [
        { label: '自身 QQ', value: this.identity?.selfId ?? '-', tone: 'on' },
        { label: '监听会话', value: this.convs.size, tone: 'on' },
        { label: '表情包', value: this.stickers?.size ?? 0, tone: 'on' },
        { label: '主动', value: this.proactive?.status().runState ?? '关', tone: this.proactive?.status().enabled ? 'on' : 'plain' },
        { label: '群限速', value: this.config.groupSpeak.enabled ? `开(${this.config.groupSpeak.maxPerWindow}/${this.config.groupSpeak.windowSec}s)` : '关', tone: this.config.groupSpeak.enabled ? 'on' : 'plain' },
        { label: '防死循环', value: this.config.antiLoop.enabled ? `开(≤${this.config.antiLoop.maxConsecutiveBotTurns})` : '关', tone: this.config.antiLoop.enabled ? 'on' : 'plain' },
        { label: '模式', value: this.config.mode === 'reverse' ? '反向' : '正向', tone: 'plain' },
      ],
      panels,
      invoke: (panel, method, args) => {
        return this.invoke(panel, method, args);
      },
      stream: (panel, socket) => {
        this.stream(panel, socket);
      },
      promptDocs: [
        {
          key: 'worlds.qqbot.envPrompt',
          title: 'QQ 环境描述',
          description: '注入 system 前缀的 QQ 身份与监听名单说明。',
          role: 'envPrompt',
          path: ENV_PROMPT_FILE,
          vars: [
            { name: 'qq.self', description: '当前 QQ 身份说明。' },
            { name: 'qq.activeGroups', description: '正在监听的群列表。', multiline: true },
            { name: 'qq.activePrivates', description: '正在监听的私聊列表。', multiline: true },
            { name: 'qq.unread', description: '未读摘要。' },
            { name: 'qq.now', description: '当前时间（时区见配置），用于回答"现在几点/星期几/几号"等问题。' },
            { name: 'qq.festival', description: '今天是什么日子：公历/农历节日、二十四节气（按配置时区推算），用于让主动说话自然呼应今天；可能为空（平日无节日）。', multiline: true },
            { name: 'qq.voice', description: '语音能力说明：对方明确要求语音时回复会被转成语音消息，且那正是你自己说的，别误认成对方发的、也别以为没发出去。', multiline: true },
            { name: 'qq.groupSpeak', description: '群聊发言限速说明（是否开启、窗口与上限）。' },
            { name: 'qq.antiLoop', description: '话题防死循环规则说明（连续发言上限、静默收尾、何时该停）。' },
            { name: 'qq.routine', description: 'AI 作息说明（当前时段、是否在线/睡眠/午休，以及主动冒泡规则）。' },
          ],
        },
      ],
      config: [QQ_QUIET_GROUP, QQ_CONFIG_GROUP, QQ_VOICE_GROUP],

    };
  }

  private async getVoiceState(): Promise<unknown> {
    const v = this.config.voice || {};
    const ttsReady = !v.enabled ? 'disabled'
      : await voiceReady(this.voiceRuntime(), this.log) ? 'ready' : 'offline';
    return {
      enabled: !!v.enabled,
      provider: v.provider || 'native',
      tts: !!v.tts,
      voxcpmUrl: v.voxcpmUrl || 'http://127.0.0.1:8765',
      ttsReady,
    };
  }

  /** 各模块 ConfigGroup 的静态映射（按 id 取 schema）。 */
  private configGroupById(id: string): { schema?: { title?: string; properties?: Record<string, any> } } | undefined {
    const map: Record<string, any> = {
      'world:qqbot-quiet': QQ_QUIET_GROUP,
      'world:qqbot': QQ_CONFIG_GROUP,
      'world:qqbot-voice': QQ_VOICE_GROUP,
    };
    return map[id];
  }

  /** 把 schema 里的完整 dotted key 解析到嵌套 config 当前值。 */
  private resolveConfigValue(key: string): unknown {
    const tail = key.replace(/^worlds\.qqbot\./, '');
    const parts = tail.split('.');
    let cur: any = this.config;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  }

  /** 通用：返回某配置组的 schema 字段（按前缀/层级过滤）+ 当前值，供控制台动态渲染可编辑表单。 */
  private async getConfigSchema(groupId: string, keyPrefix: string, topOnly: boolean): Promise<unknown> {
    const grp = this.configGroupById(groupId);
    if (!grp || !grp.schema) return { error: 'unknown group', groupId };
    const props = grp.schema.properties || {};
    const out: Array<{ key: string; type: string; title: string; description?: string; enum?: string[]; minimum?: number; maximum?: number; xHot: boolean }> = [];
    const values: Record<string, unknown> = {};
    for (const [key, def] of Object.entries(props) as Array<[string, any]>) {
      if (keyPrefix && !key.startsWith(keyPrefix)) continue;
      if (topOnly) {
        const depth = key.replace(/^worlds\.qqbot\./, '').split('.').length;
        if (depth !== 1) continue;
      }
      const xHot = def['x-hot'] === true;
      out.push({
        key,
        type: def.type || 'string',
        title: def.title || key.split('.').pop(),
        description: def.description,
        enum: def.enum,
        minimum: def.minimum,
        maximum: def.maximum,
        xHot,
      });
      values[key] = this.resolveConfigValue(key);
    }
    return { groupId, title: grp.schema.title, properties: out, values };
  }

  private async invoke(panel: string, method: string, args: unknown[]): Promise<unknown> {
    if (panel === 'proactive' && method === 'triggerProactive') return this.proactive?.trigger(typeof args[0] === 'string' ? args[0] : undefined) ?? '主动说话未启用。';
    if (panel === 'quiet' && method === 'getQuietState') return {enabled: this.config.quietReply.enabled,
      quiet: this.isQuietHours(), sleep: `${this.config.routine.sleepStart}–${this.config.routine.sleepEnd}`,
      noon: `${this.config.routine.lazyStart}–${this.config.routine.lazyEnd}`, timezone: this.config.timezone,
      groups: this.config.quietReply.groups, privates: this.config.quietReply.privates};
    if (panel === 'sticker' && method === 'getStickerState') {
      return { syncing: this.stickerSync !== null, result: this.stickerSyncResult, ...this.stickers?.stats(10) };
    }
    if (method === 'restartConnection') return this.restartConnection();
    // 反向连接自动生成的 token 要展示给用户（他得拿去填 NapCat），仅回显当前生效值。
    if (method === 'getReverseToken') return this.reverseTokenForPanel;

    if (panel === 'roster' && method === 'getRoster') {
      const list = [...this.convs.values()].map((c) => ({
        address: c.address,
        label: c.label,
        kind: c.kind,
        active: c.active,
        members: c.members?.size ?? 0,
        lastMessageAt: c.lastMessageAt ? new Date(c.lastMessageAt).toISOString() : null,
      }));
      return { selfId: this.identity?.selfId ?? null, mode: this.config.mode, groups: toIds(this.config.groups), privates: toIds(this.config.privates), convs: list };
    }
    if (panel === 'voice') {
      if (method === 'getVoiceState') return this.getVoiceState();
    }
    if (method === 'config') {
      const groupId = typeof args[0] === 'string' ? args[0] : '';
      const prefix = typeof args[1] === 'string' ? args[1] : '';
      const topOnly = args[2] === true;
      return this.getConfigSchema(groupId, prefix, topOnly);
    }
    return toolError('unknown method');
  }

  private stream(panel: string, socket: WorldStreamSocket): void {
    if (panel !== 'events') {
      socket.close('no such stream');
      return;
    }
    this.eventSockets.add(socket);
    socket.onClose(() => this.eventSockets.delete(socket));
    // 先回放最近 20 条
    if (this.host) {
      const qq = this.host.store.range({ source: SOURCE, limit: 20 });
      const recent = qq.sort((a, b) => a.cursor - b.cursor).reverse().slice(0, 20);
      for (const e of recent) socket.send(JSON.stringify({ ts: e.ts, type: e.type, senderKey: e.senderKey, text: e.text }));
    }
  }

  private broadcastEvent(e: EventEnvelope): void {
    const payload = JSON.stringify({ ts: e.ts, type: e.type, senderKey: e.senderKey, text: e.text });
    for (const s of this.eventSockets) s.send(payload);
  }

  // ---- 环境提示词 ----
  envPromptVars(): Record<string, string> | null {
    const self = this.identity
      ? `你当前以 QQ 号 ${this.identity.selfId} 的身份在 QQ 上活动。`
      : 'QQ 身份尚未加载，等待 QQ 协议端连接。';
    const activeGroups = [...this.convs.values()].filter((c) => c.kind === 'group' && this.canRead(c.address));
    const activePrivates = [...this.convs.values()].filter((c) => c.kind === 'private' && this.canRead(c.address));
    const groupLines = activeGroups.map((c) => `- 群号 ${c.id}（${c.address}）`).join('\n') || '- 无';
    const privLines = activePrivates.map((c) => `- QQ ${c.id}（${c.address}）`).join('\n') || '- 无';
    const nowStr = this.nowText();
    const festivalLine = this.festivalLine();
    const gs = this.config.groupSpeak;
    const groupSpeakLine = gs.enabled
      ? `群聊发言限速已开启：每个群在 ${gs.windowSec}s 内最多发出 ${gs.maxPerWindow} 条消息（含主动冒泡与你的回复），超过会被拦截并返回「发言频率已达上限」。注意别在群里刷屏。`
      : '群聊发言限速未开启。';
    const al = this.config.antiLoop;
    const antiLoopLine = al.enabled
      ? `话题防死循环已开启：同一会话里你连续发言达到 ${al.maxConsecutiveBotTurns} 条（对方发来任意消息即清零），或对方静默超过 ${al.idleToEndSec}s 且你已经发过言，下一次发言会被自动拦截并提示「话题自动收尾」。请主动把握分寸：对方不接话、只回敷衍或已明显不想聊时，就该停，不要硬聊、不要反复抛同一话题制造死循环。`
      : '话题防死循环未开启。';
    const voice = this.config.voice;
    const voiceLine = voice?.enabled && voice?.tts
      ? 'QQ 语音能力已开启：对方要求语音时，用 qq_send(to, text, voice=true) 将正文合成为 QQ 语音消息；根据完整对话判断，后续“现在可以了吗”等接话不取消此前的语音请求。voice=false 或不填时发文字。语音与文字共用回复额度，仍须通过审核和发送权限检查。以回执确认实际发送了语音；若回退文字，不说成语音已发出。自己的语音不要误认为对方的消息。'
      : '语音能力未开启（开启后对方要求语音时你会以语音消息回复）。';
    return {
      'qq.self': self,
      'qq.activeGroups': groupLines,
      'qq.activePrivates': privLines,
      'qq.unread': [this.unreadSummary(),this.replyProgress()].filter(Boolean).join('\n'),
      'qq.now': `当前时间：${nowStr}（时区 ${this.config.timezone}）。若用户问「现在几点」「今天星期几」「几号了」等，据此回答，不要乱编。`,
      'qq.festival': festivalLine,
      'qq.groupSpeak': groupSpeakLine,
      'qq.antiLoop': antiLoopLine,
      'qq.routine': this.routineSegmentText(),
      'qq.voice': voiceLine,
    };
  }

  private unreadSummary(): string {
    const parts: string[] = [];
    for (const c of this.convs.values()) {
      if (!this.canRead(c.address)) continue;
      const u = c.unread;
      if (u && u.count > 0) parts.push(`${c.address} 有 ${u.count} 条未读`);
    }
    return parts.length ? parts.join('；') : '无未读。';
  }

  // ---- 工具：抓取与解码 ----
  private async fetchBytes(url: string): Promise<Uint8Array | null> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  shutdownVerification() {
    return [
      {
        key: 'qq-conn',
        label: 'OneBot 连接',
        status: this.connected ? ('verified-ended' as const) : ('still-live' as const),
        detail: this.connected ? '已连接，停止后连接将关闭。' : '未连接。',
        manualAction: '在 QQ 协议端中停止 OneBot 连接或关闭本扩展。',
      },
    ];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function consoleLogger(): Logger {
  const noop = () => {};
  const l: Logger = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, emit: noop, child: () => l };
  return l;
}
