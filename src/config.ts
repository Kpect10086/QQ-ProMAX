import type { ConfigGroup } from 'cortico/core/types.ts';
import type { WorldSection } from 'cortico/world.ts';
import type { RoutineConfig } from './proactive.ts';
import {QQ_QUIET_DEFAULTS, type QuietReplyConfig} from './quiet-hours.ts';
import { voiceProviderIds } from './voice.ts';

export interface QQWorldConfig {
  whoAmITalkingTo?: string;
  contentReviewUrl: string;
  generationInstructionFile: string;
  directorStatusFile: string;
  quietReply: QuietReplyConfig;
  replyGroups: boolean;
  replyPrivates: boolean;
  /** 连接模式：reverse=Cortico 开 WS 服务端等 NapCat 连（fat-fish 风格）；forward=Cortico 连 NapCat 的 wsUrl（内置风格）。 */
  mode: 'reverse' | 'forward';
  /** forward 模式：NapCat 暴露的 WebSocket 地址。 */
  wsUrl: string;
  /** reverse 模式：Cortico 在哪个 host/port/path 监听 NapCat 反向连接。 */
  wsHost: string;
  wsPort: number;
  wsPath: string;
  /** NapCat 接入 Token（OneBot access_token），二选一生效。 */
  token: string;
  /** 监听中的群（fat-fish 的 GROUP_WHITELIST / 内置的 activeGroupIds）；控制台以空格/逗号分隔字符串编辑。 */
  groups: string | number[];
  /** 监听中的私聊对方 QQ（activePrivatePeers）；同上，字符串或数组皆可。 */
  privates: string | number[];
  /** 私聊聚合窗口（ms），fat-fish PRIVATE_AGGREGATION_WINDOW。 */
  privateAggregationWindow: number;
  /** 连续消息最大间隔（ms），超出视为新主题（fat-fish MAX_SEQUENCE_GAP）。 */
  maxSequenceGap: number;
  /** 引用回看窗口（秒），fat-fish REPLY_MAX_GAP_SEC。 */
  replyMaxGapSec: number;
  /** 长文本按此字节数强制分句（fat-fish IMAGE_URL_MAX_CHARS 思路复用）。 */
  maxMessageBytes: number;
  /** 合并转发消息最多展开条数。 */
  forwardExpandLimit: number;
  forwardByMessageId: boolean;
  /** 本地表情包图片目录（相对扩展或绝对路径），供发送 `[表情包:文件名]` 标记使用。 */
  emojiDir: string;
  /** 用户指定的本地资源根目录；留空只使用本扩展数据目录，不向上查找。 */
  localResourcesDir: string;
  /** 是否把图片作为附件交给模型（需要模型支持图像）。 */
  deliverImageAttachments: boolean;
  /** 发送时按句拆分多条（fat-fish SPLIT_REPLY_BY_SENTENCE）。 */
  splitReplyBySentence: boolean;
  /** 每条消息最多容纳句数（fat-fish SENTENCES_PER_MESSAGE）。 */
  sentencesPerMessage: number;
  maxPrivateMessagesPerReply: number;
  /** 逐条发送之间的间隔毫秒（fat-fish SEND_INTERVAL_SECONDS），0 表示不限速。 */
  sendIntervalMs: number;
  /** 被动视觉：自动用 VLM 描述图片（off 则不调用外部 API，仅留占位）。 */
  vision: {
    enabled: boolean;
    endpoint: string;
    apiKeySecret: string;
    model: string;
    maxConcurrent: number;
    maxBytes: number;
    timeoutMs: number;
  };
  /** 表情包自动收藏：下载 + 情感/用处标注 + 内容去重。 */
  sticker: {
    /** 是否自动收藏表情包。 */
    enabled: boolean;
    /** 采集范围：sticker=仅 OneBot sticker/image.subType=sticker；allImages=所有图片都当表情候选。 */
    captureMode: 'sticker' | 'allImages';
    addToQQFavorites: boolean;
    /** 表情包落盘目录（相对扩展或绝对），空则复用 emojiDir。 */
    dir: string;
  };
  /** 主动说话调度器：后台按状态机向监听会话主动冒泡闲聊（移植自 fat-fish ProactiveSpeaker）。 */
  proactive: {
    enabled: boolean;
    mode: 'private' | 'group' | 'both';
    tickSec: number;
    warmupMin: number;
    stableChancePerTick: number;
    warmupChance: number;
    privateCooldownSec: number;
    groupCooldownSec: number;
    unrepliedThreshold: number;
    silentHours: number;
    dailyQuota: number;
    dedupWindow: number;
    /** 静默时段只允许私聊回复；起止小时相同表示关闭。 */
    quietFrom: number;
    quietTo: number;
  };
  /** 群聊发言频率限制：限制每个群在单位时间窗口内被 bot 主动+回复发出的消息总量，防止刷屏。 */
  groupSpeak: {
    /** 是否启用群聊发言频率限制。 */
    enabled: boolean;
    /** 滑动窗口内允许发出的最大消息条数。 */
    maxPerWindow: number;
    /** 滑动窗口长度（秒）。 */
    windowSec: number;
  };
  /** 话题自动结束 / 防死循环：统计单会话内 bot 连续发言次数，超过阈值或对方长时间未接话则自动收尾。 */
  antiLoop: {
    /** 是否启用防死循环。 */
    enabled: boolean;
    /** 单会话内 bot 连续发言上限（对方发来任意消息即清零），超过则本次发言被拦截并提示收尾。 */
    maxConsecutiveBotTurns: number;
    /** 对方静默超过该秒数且 bot 已发过言，则自动收尾（0=关闭该规则）。 */
    idleToEndSec: number;
  };
  /** 时区，用于时间戳与 env 提示。 */
  timezone: string;
  /** 作息功能：按真实时间切换「睡眠/午休/活跃」状态，睡眠段暂停主动冒泡并到点播报。 */
  routine: RoutineConfig;
  /** 闹钟 / 记事本：记录需要定时做的事或约定，到点自动提醒。 */
  reminder: {
    /** 是否启用“到点自动发提醒”。记录 / 查询 / 取消不受此开关影响（始终可用）。 */
    enabled: boolean;
  };
  /** 自称（第一人称昵称）：用于主动说话调度器与作息状态文本。
   *  - 留空（默认）：回退到登录 QQ 昵称，再不行回退「我」。
   *  - 填了：强制用这个值（如「小鱼」），换称呼零改码。 */
  selfName: string;
  /** 语音发送：仅负责 TTS，语音输入由独立扩展处理。
   *  此处只管 TTS 与供应商选择；实现由 voice.ts 注册表供应商决定（当前内置 native/custom/local/voxcpm，可扩展）。 */
  voice: {
    /** 总开关。 */
    enabled: boolean;
    /** 实现方式（语音供应商 id）：当前内置 native=OneBot 原生 tts(零依赖)；custom=远程 OpenAI 兼容 TTS（填语音模型网址+API Key）；local=本地/自建 TTS（免 Key）；voxcpm=本地 VoxCPM2 TTS 服务。可在 voice.ts 注册更多供应商。语音输入由独立扩展配置。 */
    provider: string;
    /** 启用 qq_send(voice=true) 文字转语音。 */
    tts: boolean;
    /** 自定义(custom/local)语音供应商的 OpenAI 兼容音频端点基址（仅 TTS 用）；选 custom/local 供应商时必填。 */
    voiceBaseUrl: string;
    /** 自定义语音供应商 API Key 的环境变量名（控制台密钥库填写）。 */
    voiceApiKeySecret: string;
    /** 音色/声音名：仅当所选语音模型支持时填写（如 tongtong）；留空用默认音色。 */
    voiceVoice: string;
    /** 自定义供应商 TTS 模型名（/audio/speech 用，缺省 tts-1）。 */
    voiceTtsModel: string;
    /** TTS 请求超时（秒）：单次合成最长等待，本地推理慢可调大（默认 120）。custom 与 local 共用。 */
    voiceTimeout: number;
    /** TTS 额外参数(JSON 字符串)：合并进 /audio/speech 请求体，用于本地模型的声音克隆/声音设计等高级特性（如 VoxCPM2 的 reference_audio / voice_design / language）。留空 {} 表示无。 */
    voiceExtraTts: string;
    /** VoxCPM 本地 TTS 服务基址（provider 选 voxcpm 时必填），如 http://127.0.0.1:8765。 */
    voxcpmUrl: string;
    /** VoxCPM 音色描述（自然语言），如「温柔女声」。 */
    voxcpmVoiceDesc: string;
    /** VoxCPM 语速（0.5~2），默认 1.0。 */
    voxcpmSpeed: number;
    /** VoxCPM 推理步数（越小越快越夸张），默认 10。 */
    voxcpmTimesteps: number;
    /** VoxCPM 随机种子（0=随机，>0 固定可复现）。 */
    voxcpmSeed: number;
  };
  /** 群管理员能力：群撤回 / @全体成员 / 发群通知 / 审核进群 / 给予群头衔 / 禁言（及全员禁言）/ 踢出群聊。
   *  需要 bot 账号是对应群的管理员或群主，否则 QQ 会拒绝操作。qq_admin_* 工具始终注册，此开关决定是否生效。 */
  admin: {
    /** 是否启用群管理员能力。关闭则所有 qq_admin_* 工具返回“功能未开启”，不执行任何操作。 */
    enabled: boolean;
    /** 发群通知（公告）使用的 OneBot action 名。不同 NapCat 版本可能为 send_group_notice 或 _send_group_notice。 */
    noticeAction: string;
    /**
     * 授权指挥官白名单：允许通过对话命令 bot 执行管理员操作的 QQ 号数组。
     * 在名单内的人，无论群内身份，都能命令 bot 撤消息/禁言等。空数组表示不单独授权任何人。
     */
    allowlist: string[];
    /**
     * 是否允许群内管理员/群主通过对话命令 bot 执行管理员操作。
     * 默认 true：群管/群主在群里发话即可指挥 bot。设为 false 则只有 allowlist 里的人能指挥。
     */
    allowGroupAdmins: boolean;
    /**
     * 仅群主可指挥：为 true 时，即便 allowGroupAdmins 开启，也只有群主（外加 allowlist）能命令 bot，
     * 普通管理员不行。默认 false（群主+管理员均可）。
     */
    ownerOnly: boolean;
    /**
     * 保护群主：禁止任何人（含管理员）用 bot 撤回/禁言群主。默认 true。
     */
    protectOwner: boolean;
    /**
     * 保护管理员：只有群主能用 bot 撤回/禁言另一名管理员。默认 true。
     */
    protectAdmins: boolean;
    /**
     * 允许 bot 自行处理加群请求（通过/拒绝），而无需某个人在对话里指挥。默认 true。
     * 设为 false 则 qq_admin_join_approve/reject 返回“未开启自动审核”。
     */
    allowJoin: boolean;
    /**
     * 允许 AI（bot 自身）主动执行管理操作：当 bot 自行判断需要撤消息/禁言/发公告等时，
     * 无需某个人下令即可执行。默认 true。设为 false 则仅「授权指挥官」（白名单/群管/群主）能触发，
     * 普通成员无法让 bot 行动，但 bot 自身也不会在有人刚发言的会话里自主行动。
     */
    allowSelf: boolean;
    /**
     * 允许 AI（bot 自身）自主踢人：踢人比禁言更重且不可逆，默认 false，
     * 即只有「授权指挥官」（白名单/群管/群主）明确下令才能踢。设为 true 则 bot 可自行判断踢人。
     */
    allowSelfKick: boolean;
    /**
     * 踢人时是否同时拒绝对方再次加群（OneBot reject_add_request）。默认 true。
     * 说明：这不等于拉黑名单，只是让本次踢出附带「拒绝加群」；对方仍可能通过其他方式进群。
     */
    kickRejectRejoin: boolean;
  };
  /**
   * 允许 AI 在群里判断话题涉及隐私/尴尬/敏感时，把回复改为私聊发送给当事人（而非群里公开）。
   * 开启后，qq_send 对 private:<QQ> 目标跳过私聊监听名单限制，可向任意群成员发起私聊分流。默认 true。
   */
  allowPrivateRedirect?: boolean;
}


export const QQ_DEFAULTS: QQWorldConfig = {
  contentReviewUrl: '',
  generationInstructionFile: '',
  directorStatusFile: '',
  quietReply: {...QQ_QUIET_DEFAULTS},
  replyGroups: true,
  replyPrivates: true,
  mode: 'reverse',
  allowPrivateRedirect: false,
  wsUrl: 'ws://127.0.0.1:3001',
  // 反向监听默认只绑回环：绑 0.0.0.0 会让同网段任何机器都能连进来，
  // 拿到 bot 要发的消息、伪造事件，甚至借群管鉴权接口越权。要对外监听请显式改这一项。
  wsHost: '127.0.0.1',
  wsPort: 8080,
  wsPath: '/onebot/v11/ws',
  // 反向模式下留空会自动生成并持久化一个随机 token（见 world.ts 的 ensureReverseToken），
  // 不会退化成「无鉴权监听」。正向连接留空表示不校验。
  token: '',
  localResourcesDir: '',
  groups: [],
  privates: [],
  privateAggregationWindow: 0,
  maxSequenceGap: 8000,
  replyMaxGapSec: 600,
  maxMessageBytes: 1500,
  forwardExpandLimit: 20,
  forwardByMessageId:false,
  emojiDir: 'emoji',
  deliverImageAttachments: true,
  splitReplyBySentence: true,
  sentencesPerMessage: 1,
  maxPrivateMessagesPerReply: 3,
  sendIntervalMs: 600,
  vision: {
    enabled: false,
    endpoint: '',
    apiKeySecret: '',
    model: '',
    maxConcurrent: 3,
    maxBytes: 8_000_000,
    timeoutMs: 30000,
  },
  sticker: {
    enabled: true,
    captureMode: 'sticker',
    addToQQFavorites:false,
    dir: '',
  },
  proactive: {
    enabled: false,
    mode: 'private',
    tickSec: 45,
    warmupMin: 2,
    stableChancePerTick: 0.2,
    warmupChance: 0.7,
    privateCooldownSec: 120,
    groupCooldownSec: 20,
    unrepliedThreshold: 3,
    silentHours: 6,
    dailyQuota: 20,
    dedupWindow: 12,
    quietFrom: 0,
    quietTo: 0,
  },
  groupSpeak: {
    enabled: true,
    maxPerWindow: 12,
    windowSec: 60,
  },
  antiLoop: {
    enabled: true,
    maxConsecutiveBotTurns: 5,
    idleToEndSec: 300,
  },
  timezone: 'Asia/Shanghai',
  routine: {
    enabled: false,
    sleepStart: '23:00',
    sleepEnd: '07:30',
    lazyStart: '12:00',
    lazyEnd: '14:00',
    greetSleep: '时间不早啦，我先去睡一会儿，你们也别熬太狠~有事留言，我醒了回。',
    greetWake: '早呀，我醒啦，今天也要好好摸鱼。',
    greetLazy: '中午啦，我去扒口饭眯一眯，有事儿留言~',
  },
  reminder: {
    enabled: true,
  },
  selfName: '',
  voice: {
    enabled: false,
    provider: 'native',
    tts: true,
    voiceBaseUrl: '',
    voiceApiKeySecret: 'VOICE_API_KEY',
    voiceVoice: '',
    voiceTtsModel: 'tts-1',
    voiceTimeout: 120,
    voiceExtraTts: '{}',
    voxcpmUrl: 'http://127.0.0.1:8765',
    voxcpmVoiceDesc: '一个可爱的二次元萌妹，声音娇俏甜美软糯，语速轻快活泼，带点撒娇黏人的语气，像游戏里的吉祥物少女',
    voxcpmSpeed: 1.0,
    voxcpmTimesteps: 10,
    voxcpmSeed: 0,
  },
  admin: {
    enabled: false,
    noticeAction: 'send_group_notice',
    allowlist: [],
    allowGroupAdmins: true,
    ownerOnly: false,
    protectOwner: true,
    protectAdmins: true,
    allowJoin: true,
    allowSelf: true,
    allowSelfKick: false,
    kickRejectRejoin: true,
  },
};

export const QQ_SECRETS = ['QQ_ACCESS_TOKEN', 'VOICE_API_KEY'];

/** worlds.qq 配置段：业务参数 + 必需的 enabled 开关。 */
export type QQConfigSection = QQWorldConfig & WorldSection;

export function qqDefaults(): QQConfigSection {
  return { ...QQ_DEFAULTS, enabled: false };
}

/** 控制台可编辑的连接/监听配置组（JSON Schema 形态）。 */
export const QQ_CONFIG_GROUP: ConfigGroup = {
  id: 'world:qqbot',
  owner: 'world:qqbot',
  schema: {
    type: 'object',
    title: 'QQ · 连接与监听',
    description: 'OneBot v11 连接参数与监听名单，支持 SnowLuma 等协议端；连接类改动需重启生效。',
    properties: {
      'worlds.qqbot.replyGroups': {type: 'boolean', title: '回复群聊', 'x-hot': true, description: '关闭后不读取群消息、图片、语音和通知，也不发送；排队消息实际投递前重新核对。'},
      'worlds.qqbot.replyPrivates': {type: 'boolean', title: '回复私聊', 'x-hot': true, description: '关闭后不读取私聊消息、图片、语音和通知，也不发送；排队消息实际投递前重新核对。'},
      'worlds.qqbot.contentReviewUrl': {type: 'string', title: '内容审核地址', 'x-hot': true, description: '文字、语音和主动消息发送前审核；拒绝或不可用时发送文字 filtered。'},
      'worlds.qqbot.generationInstructionFile': {type:'string', title:'独立生成器的表达要求文件', 'x-hot':true,
        description:'可选的本地 JSON {active,language,instruction}，供主动冒泡与空间文案读取语言环境；配置后文件不可读时跳过本次生成。'},
      'worlds.qqbot.directorStatusFile': {type: 'string', title: '直播屏蔽状态文件', 'x-hot': true},
      'worlds.qqbot.mode': {
        type: 'string',
        title: '连接模式',
        enum: ['reverse', 'forward'],
        'x-hot': false,
        description: 'reverse=Cortico 开 WS 服务端等 QQ 协议端反向连；forward=Cortico 主动连 QQ 协议端的 wsUrl。',
      },
      'worlds.qqbot.timezone': {
        type: 'string',
        title: '时区',
        'x-options': 'qq-timezone',
        'x-hot': true,
        description: '注入到提示词「现在时间」与事件时间戳的时区（按 UTC 偏移标注，默认中国 UTC+8）。改完即时生效，无需重启。',
      },
      'worlds.qqbot.wsUrl': { type: 'string', title: '正向 WS 地址', 'x-hot': false },
      'worlds.qqbot.wsHost': { type: 'string', title: '反向监听地址', 'x-hot': false, description: '默认 127.0.0.1（只允许本机接入）。改成 0.0.0.0 会让同网段任何机器都能连上并伪造事件，必须同时设置 OneBot Token，否则会拒绝启动。' },
      'worlds.qqbot.wsPort': { type: 'integer', title: '反向监听端口', minimum: 1, maximum: 65535, 'x-hot': false, description: '需与 NapCat「设置反向客户端」里填的端口一致。' },
      'worlds.qqbot.wsPath': { type: 'string', title: '反向监听路径', 'x-hot': false, description: '需与 NapCat「设置反向客户端」里填的路径一致，默认 /onebot/v11/ws。' },
      'worlds.qqbot.token': { type: 'string', title: 'OneBot Token', 'x-hot': false, description: '反向连接留空会自动生成一个随机 token 并保存到 dataDir/reverse-token.txt（启动日志与控制台「连接与监听」页会显示），请把它填进 NapCat「设置反向客户端」的 Token。仅正向连接时填 NapCat「设置正向服务器」那个 Token；留空表示不校验。' },
      'worlds.qqbot.groups': { type: 'string', title: '监听群', 'x-hot': true, description: '只读取名单内的群号，用空格或逗号分隔；留空不监听任何群。改完即时生效，不用重启。' },

      'worlds.qqbot.privates': { type: 'string', title: '监听私聊', 'x-hot': true, description: '监听的私聊对方 QQ 号，用空格或逗号分隔。改完即时生效，不用重启。' },
      'worlds.qqbot.deliverImageAttachments': { type: 'boolean', title: '图片作为模型附件', 'x-hot': true },
      'worlds.qqbot.localResourcesDir': {type:'string', title:'本地资源允许目录', 'x-hot':false, description:'只允许使用这个目录中的表情与状态文件。修改后需重启。该目录必须事先创建。留空使用本扩展的数据目录；禁止磁盘根目录、目录穿越和链接越界。不向上扫描。'},
    'worlds.qqbot.emojiDir': { type: 'string', title: '表情包目录', 'x-hot': false, description: '本地表情包图片目录（相对扩展或绝对路径），供发送 [表情包:文件名] 标记。' },
      'worlds.qqbot.splitReplyBySentence': { type: 'boolean', title: '按句拆分发送', 'x-hot': true, description: '开启后回复按句标拆成多条消息（对齐 fat-fish）。' },
      'worlds.qqbot.sentencesPerMessage': { type: 'integer', title: '每条句数', minimum: 1, maximum: 10, 'x-hot': true },
      'worlds.qqbot.maxPrivateMessagesPerReply': {type:'integer',title:'私聊每次回复最多条数',minimum:0,maximum:20,'x-hot':true,description:'同一条私聊来信对应的回复上限，文字、图片和语音共用；跨多次工具调用与模型回合累计，收到新消息才重置。超出的分句尽量合并，0 表示不限。'},
      'worlds.qqbot.sendIntervalMs': { type: 'integer', title: '发送间隔(ms)', minimum: 0, maximum: 5000, 'x-hot': true, description: '逐条发送之间的间隔，0 表示不限速。' },
      'worlds.qqbot.vision.enabled': { type: 'boolean', title: '开启辅助视觉', 'x-hot': false },
      'worlds.qqbot.vision.endpoint': { type: 'string', title: '辅助视觉 API 地址', 'x-hot': false },
      'worlds.qqbot.vision.apiKeySecret': { type: 'string', title: '辅助视觉密钥名', 'x-hot': false },
      'worlds.qqbot.vision.model': { type: 'string', title: 'VLM 模型', 'x-hot': false },
      'worlds.qqbot.sticker.enabled': { type: 'boolean', title: '自动收藏表情包', 'x-hot': false, description: '开启后自动下载消息里的表情包并标注情感/用处、内容去重。' },
      'worlds.qqbot.sticker.captureMode': {
        type: 'string',
        title: '采集范围',
        enum: ['sticker', 'allImages'],
        'x-hot': false,
        description: 'sticker=仅 OneBot 表情包段；allImages=所有图片都当表情候选收藏。',
      },
      'worlds.qqbot.proactive.enabled': { type: 'boolean', title: '主动说话调度器', 'x-hot': false, description: '开启后后台按状态机向监听会话主动冒泡闲聊（移植自 fat-fish ProactiveSpeaker）。' },
      'worlds.qqbot.proactive.mode': {
        type: 'string',
        title: '主动范围',
        enum: ['private', 'group', 'both'],
        'x-hot': true,
        description: 'private=仅私聊；group=仅群；both=都主动。',
      },
      'worlds.qqbot.proactive.privateCooldownSec': { type: 'integer', title: '私聊主动消息间隔(秒)', minimum: 0, maximum: 86400, 'x-hot': false, description: '同一私聊两次主动消息的最小间隔；修改后重启生效。' },
      'worlds.qqbot.proactive.dailyQuota': { type: 'integer', title: '每日上限', minimum: 0, maximum: 200, 'x-hot': true, description: '每日主动消息条数上限（0=不限）。' },
      'worlds.qqbot.proactive.quietFrom': { type: 'integer', title: '静默开始(时)', minimum: 0, maximum: 23, 'x-hot': true, description: '按配置时区。静默期间停止主动冒泡和群聊发送，允许私聊回复；与结束小时相同则关闭。' },
      'worlds.qqbot.proactive.quietTo': { type: 'integer', title: '静默结束(时)', minimum: 0, maximum: 23, 'x-hot': true },
      'worlds.qqbot.groupSpeak.enabled': { type: 'boolean', title: '群聊发言限速', 'x-hot': true, description: '开启后限制每个群在单位窗口内被 bot 发出的消息总量，防止刷屏/死循环灌水。' },
      'worlds.qqbot.groupSpeak.maxPerWindow': { type: 'integer', title: '窗口内最大条数', minimum: 1, maximum: 200, 'x-hot': true, description: '滑动窗口内允许发出的群消息上限（含主动与回复）。' },
      'worlds.qqbot.groupSpeak.windowSec': { type: 'integer', title: '窗口长度(秒)', minimum: 1, maximum: 3600, 'x-hot': true, description: '限速滑动窗口长度。' },
      'worlds.qqbot.antiLoop.enabled': { type: 'boolean', title: '话题自动结束', 'x-hot': true, description: '开启后统计单会话 bot 连续发言次数与对方静默时长，超限自动收尾，避免话题死循环。' },
      'worlds.qqbot.antiLoop.maxConsecutiveBotTurns': { type: 'integer', title: '连续发言上限', minimum: 1, maximum: 50, 'x-hot': true, description: '单会话内 bot 连续发言达到该次数（对方发消息即清零），下次发言被拦截并提示收尾。' },
      'worlds.qqbot.antiLoop.idleToEndSec': { type: 'integer', title: '对方静默收尾(秒)', minimum: 0, maximum: 86400, 'x-hot': true, description: '对方静默超过该秒数且 bot 已发过言则自动收尾；0=关闭该规则。' },
      'worlds.qqbot.routine.enabled': { type: 'boolean', title: '作息功能', 'x-hot': true, description: '开启后按真实时间切换「睡眠/午休/活跃」状态：睡眠段暂停主动冒泡并到点播报，午休段仅在语气里体现。改完即时生效。' },
      'worlds.qqbot.routine.sleepStart': { type: 'string', title: '睡眠开始(HH:MM)', 'x-hot': true, description: '进入睡眠时段的时间（24h，可早于 sleepEnd 形成跨午夜，如 23:00）。睡眠段内不主动冒泡，但仍能被动回复。' },
      'worlds.qqbot.routine.sleepEnd': { type: 'string', title: '睡眠结束(HH:MM)', 'x-hot': true, description: '离开睡眠时段的时间（24h）。离开时主动说「醒来」播报文案。' },
      'worlds.qqbot.routine.lazyStart': { type: 'string', title: '午休开始(HH:MM)', 'x-hot': true, description: '进入午休/打盹时段的时间；仅作为状态注入，不影响主动冒泡是否发出。' },
      'worlds.qqbot.routine.lazyEnd': { type: 'string', title: '午休结束(HH:MM)', 'x-hot': true, description: '离开午休时段的时间。' },
      'worlds.qqbot.routine.greetSleep': { type: 'string', title: '去睡播报(兜底)', 'x-hot': true, description: '进入睡眠段的兜底文案：正常播报由 LLM 现场生成（每次说法不固定），仅当生成失败才回退到这句。空=无兜底直接跳过。' },
      'worlds.qqbot.routine.greetWake': { type: 'string', title: '醒来播报(兜底)', 'x-hot': true, description: '离开睡眠段的兜底文案：正常由 LLM 生成，失败才回退。空=无兜底。' },
      'worlds.qqbot.routine.greetLazy': { type: 'string', title: '午休播报(兜底)', 'x-hot': true, description: '进入午休段的兜底文案：正常由 LLM 生成，失败才回退。空=无兜底。' },
      'worlds.qqbot.reminder.enabled': { type: 'boolean', title: '到点提醒', 'x-hot': true, description: '开启后，记下的定时提醒会在到点时自动发到对应会话；记录/查询/取消不受此开关影响（始终可用）。' },
      'worlds.qqbot.admin.enabled': { type: 'boolean', title: '群管理员能力', 'x-hot': true, description: '开启后可在群里执行管理员操作：群撤回 / @全体成员 / 发群通知 / 审核进群 / 给予群头衔 / 禁言（及全员禁言）/ 踢出群聊。需要 bot 是群管理员或群主，否则 QQ 会拒绝。qq_admin_* 工具始终可用，关闭则提示“功能未开启”。' },
      'worlds.qqbot.admin.allowlist': { type: 'string', title: '授权指挥官(QQ号,逗号分隔)', 'x-hot': true, description: '白名单：这些 QQ 号的人可在对话里命令 bot 执行管理员操作（撤消息/禁言等），不受群身份限制。多个用逗号分隔，如 123456,654321。留空=不单独授权任何人。' },
      'worlds.qqbot.admin.allowGroupAdmins': { type: 'boolean', title: '允许群管/群主指挥', 'x-hot': true, description: '为 true 时，群里的管理员/群主在对话里发话即可指挥 bot 执行管理操作。设为 false 则只有白名单里的人能指挥。' },
      'worlds.qqbot.admin.ownerOnly': { type: 'boolean', title: '仅群主可指挥', 'x-hot': true, description: '为 true 时，即便“允许群管指挥”开启，也只有群主（外加白名单）能命令 bot，普通管理员不行。' },
      'worlds.qqbot.admin.protectOwner': { type: 'boolean', title: '保护群主(禁撤/禁言)', 'x-hot': true, description: '为 true 时，任何人（含管理员）都不能用 bot 撤回/禁言群主。' },
      'worlds.qqbot.admin.protectAdmins': { type: 'boolean', title: '保护管理员(仅群主可动)', 'x-hot': true, description: '为 true 时，只有群主能用 bot 撤回/禁言另一名管理员。' },
      'worlds.qqbot.admin.allowJoin': { type: 'boolean', title: 'bot自动审加群', 'x-hot': true, description: '为 true 时 bot 可自行通过/拒绝加群请求（qq_admin_join_* 可用）；为 false 则这两个工具返回“未开启自动审核”。' },
      'worlds.qqbot.admin.allowSelf': { type: 'boolean', title: 'AI可自主管理', 'x-hot': true, description: '为 true 时，bot（AI 本人）可自行判断并执行管理操作（撤回/禁言/公告等），无需某个人下令。为 false 则仅“授权指挥官”（白名单/群管/群主）能触发，普通成员无法让 bot 行动，但 bot 也不会在有人刚发言的会话里自主管理。群主/管理员始终受 protectOwner/protectAdmins 保护。注意：踢人（qq_admin_kick）不受此项放行，由“AI可自主踢人”单独控制。' },
      'worlds.qqbot.admin.allowSelfKick': { type: 'boolean', title: 'AI可自主踢人', 'x-hot': true, description: '为 true 时，bot 可自行判断把成员踢出群（无需人下令）。默认 false：踢人不可逆，只认“授权指挥官”（白名单/群管理员/群主）在对话里明确下令，普通成员与 AI 自主都不行。群主/管理员仍受 protectOwner/protectAdmins 保护。' },
      'worlds.qqbot.admin.kickRejectRejoin': { type: 'boolean', title: '踢人时拒绝再加群', 'x-hot': true, description: '为 true（默认）时，踢出群聊的同时附带“拒绝该用户再次加群”。为 false 则只踢出，对方仍可重新申请（能否进来取决于审核设置）。' },
      'worlds.qqbot.forwardByMessageId': {type:'boolean',title:'允许按消息编号合并转发','x-hot':true},
      'worlds.qqbot.sticker.addToQQFavorites': {type:'boolean',title:'同步到 QQ 收藏表情','x-hot':true,description:'默认关闭，开启后才会上传收藏图片；不支持 add_custom_face 时仍保留本地表情。'},
      'worlds.qqbot.allowPrivateRedirect': { type: 'boolean', title: '允许私聊分流', 'x-hot': true, description: '为 true 时，群里若话题涉及隐私 / 尴尬 / 敏感，bot 可把回复改为私聊发送给当事人（而非群里公开）：qq_send 对 private:<QQ> 目标会跳过监听名单限制，直接向该群成员私聊。为 false 则只能在群里回复，无法私聊分流。' },
      'worlds.qqbot.selfName': { type: 'string', title: '自称(第一人称)', 'x-hot': true, description: '主动说话调度器与作息状态文本里使用的自称。留空=回退到登录 QQ 昵称、再回退「我」；填了则强制用此值，换称呼零改码。' },
  },
  },
  };

  /** 语音发送配置分组：收语音转文字、发语音，两种实现可切。路径/模型均不写死，由下方各字段或环境变量决定。 */
  export const QQ_VOICE_GROUP: ConfigGroup = {
  id: 'world:qqbot-voice',
  owner: 'world:qqbot',
  schema: {
  type: 'object',
  title: 'QQ · 语音发送',
  description: '只负责语音发送(TTS)，语音输入需单独安装 QQ Audio Input。此处配置 TTS 与供应商。「实现方式」下拉选择供应商：native=OneBot 原生 tts（零依赖，开箱即用）；custom=用「模型网址+API Key」对接远程 OpenAI 兼容音频 TTS 服务（GLM/OpenAI/自建等）；local=对接本地/自建 TTS 模型（OpenAI 兼容，免 API Key，慢推理可加超时，支持额外参数做声音克隆/设计，如 VoxCPM2 经 vLLM-Omni）；voxcpm=对接本地 VoxCPM2 TTS 服务（自有接口，如 Fat-Fish 的 vox_tts_server.py：GET /health + POST /tts 返回 48kHz WAV，免 API Key，音色用自然语言描述）。是否说语音由语义判定决定。改完需重启生效。',
  properties: {
  'worlds.qqbot.voice.enabled': { type: 'boolean', title: '启用语音', 'x-hot': true, description: '总开关：关闭则完全不处理语音（收按原方式、发只文字）。控制台「语音发送」面板可实时切换。' },
  'worlds.qqbot.voice.provider': {
    type: 'string', title: '实现方式', enum: voiceProviderIds(), 'x-hot': false,
    description: '语音供应商（实现方式）：下拉项由 voice.ts 注册的供应商动态生成。native=OneBot 原生 translate_record/tts（零依赖）；custom=用配置页填写的模型网址+API Key 对接远程 OpenAI 兼容音频服务；local=本地/自建模型（免 API Key，慢推理可加超时，支持额外参数做声音克隆/设计，如 VoxCPM2 经 vLLM-Omni）；voxcpm=本地 VoxCPM2 TTS 服务（自有接口，音色用自然语言描述，免 API Key，收语音回退 native 识别）。新增供应商只需在 voice.ts 用 registerVoiceProvider 注册。',
  },
  'worlds.qqbot.voice.tts': { type: 'boolean', title: '发语音', 'x-hot': false, description: '开启后，当语义判定认为应当说语音时，回复发成语音。' },
  'worlds.qqbot.voice.voiceBaseUrl': { type: 'string', title: '语音模型网址', 'x-hot': false, description: '选 custom / local 供应商时必填：OpenAI 兼容音频端点基址。远程如 https://open.bigmodel.cn/api/paas/v4 或 https://api.openai.com/v1；本地如 http://localhost:8000/v1（VoxCPM2 经 vLLM-Omni）。TTS 走 {网址}/audio/speech。' },
  'worlds.qqbot.voice.voiceApiKeySecret': { type: 'string', title: '语音 API Key 变量', 'x-hot': false, description: 'custom 供应商 API Key 所在的环境变量名（密钥在控制台密钥库填写，默认 VOICE_API_KEY）。local 供应商免 API Key，留空即可。' },
  'worlds.qqbot.voice.voiceVoice': { type: 'string', title: '音色', 'x-hot': false, description: '仅当所选语音模型支持音色时填写（如 tongtong）；留空使用服务商默认音色。' },
  'worlds.qqbot.voice.voiceTtsModel': { type: 'string', title: 'TTS 模型名', 'x-hot': false, description: '语音合成模型名（OpenAI 兼容 /audio/speech 用，缺省 tts-1；GLM 用 glm-tts；VoxCPM2 一般为 openbmb/VoxCPM2）。' },
  'worlds.qqbot.voice.voiceTimeout': { type: 'integer', title: 'TTS 请求超时(秒)', minimum: 1, maximum: 1800, 'x-hot': false, description: 'TTS 单次请求最长等待秒数（默认 120）。本地模型推理慢可调大，超时则回退。custom 与 local 共用。语音输入由独立扩展处理。' },
  'worlds.qqbot.voice.voiceExtraTts': { type: 'string', title: 'TTS 额外参数(JSON)', 'x-hot': false, description: '合并进 /audio/speech 请求体的额外 JSON，用于本地模型高级特性：如 VoxCPM2 声音克隆传 {"reference_audio":"<音频url或base64>"}, 或声音设计传 {"voice_design":"一个温柔的少年音"}。留空 {} 表示无。' },
  'worlds.qqbot.voice.voxcpmUrl': { type: 'string', title: 'VoxCPM 服务地址', 'x-hot': false, description: '选 voxcpm 供应商时必填：本地 VoxCPM2 TTS 服务基址，如 http://127.0.0.1:8765。服务暴露 GET /health（就绪返回 {"ready":true,"state":"ready"}）与 POST /tts（返回 48kHz WAV）。' },
  'worlds.qqbot.voice.voxcpmVoiceDesc': { type: 'string', title: 'VoxCPM 音色描述', 'x-hot': false, description: 'VoxCPM2 说话人音色（自然语言描述），如「温柔女声」「温柔御姐音」。' },
  'worlds.qqbot.voice.voxcpmSpeed': { type: 'number', title: 'VoxCPM 语速', minimum: 0.5, maximum: 2, 'x-hot': false, description: 'VoxCPM2 合成语速（0.5~2，默认 1.0）。' },
  'worlds.qqbot.voice.voxcpmTimesteps': { type: 'integer', title: 'VoxCPM 推理步数', minimum: 1, maximum: 50, 'x-hot': false, description: 'VoxCPM2 推理步数（越小越快越夸张，默认 10）。' },
  'worlds.qqbot.voice.voxcpmSeed': { type: 'integer', title: 'VoxCPM 随机种子', minimum: 0, maximum: 2147483647, 'x-hot': false, description: 'VoxCPM2 随机种子（0=随机，>0 固定音色/韵律可复现）。' },
  },
  },
  };

/**
 * 原地补全缺省值并保持对象身份：让 World 持有的 this.config 就是 ctx.cfg 的同一引用，
 * 这样控制台的 x-hot 配置改动（groups / privates / 发送节奏等）能即时对 World 生效，无需重启。
 */
/**
 * 把“空格/逗号分隔字符串”或“数字数组”统一成数字数组。控制台以字符串编辑，运行时以数组使用。
 *
 * **只收正整数**：群号与 QQ 号恒为正，`Number("")` 却得到 0（`isFinite(0)` 为真），所以
 * 「留空 = 不监听」会被解析成「监听 0 号」——面板清空后读回来永远是个 0，表现为“保存不了”。
 * （同文件的 `parseNumberSeq` 靠 `filter(Boolean)` 先滤空串，等效；这里额外拒掉 0/负数/小数。）
 */
export function toIds(raw: unknown): number[] {
  const ok = (n: number): boolean => Number.isInteger(n) && n > 0;
  if (Array.isArray(raw)) return raw.map(Number).filter(ok);
  if (typeof raw === 'string') return raw.split(/[\s,]+/).map(Number).filter(ok);
  return [];
}

export function normalizeConfig(raw: QQConfigSection): QQWorldConfig {
  raw.quietReply = {...QQ_QUIET_DEFAULTS, ...raw.quietReply};
  const c = raw as unknown as QQWorldConfig & Record<string, unknown>;
  for (const [k, v] of Object.entries(QQ_DEFAULTS)) {
    if (c[k] === undefined) c[k] = v;
  }
  c.groups = toIds(c.groups);
  c.privates = toIds(c.privates);
  if (typeof c.privateAggregationWindow !== 'number') c.privateAggregationWindow = QQ_DEFAULTS.privateAggregationWindow;
  if (typeof c.maxSequenceGap !== 'number') c.maxSequenceGap = QQ_DEFAULTS.maxSequenceGap;
  if (typeof c.replyMaxGapSec !== 'number') c.replyMaxGapSec = QQ_DEFAULTS.replyMaxGapSec;
  if (typeof c.maxMessageBytes !== 'number') c.maxMessageBytes = QQ_DEFAULTS.maxMessageBytes;
  if(typeof c.forwardByMessageId!=='boolean')c.forwardByMessageId=false;
  if(typeof c.sticker.addToQQFavorites!=='boolean')c.sticker.addToQQFavorites=false;
  if (typeof c.forwardExpandLimit !== 'number') c.forwardExpandLimit = QQ_DEFAULTS.forwardExpandLimit;
  if (typeof c.splitReplyBySentence !== 'boolean') c.splitReplyBySentence = true;
  if (typeof c.sentencesPerMessage !== 'number') c.sentencesPerMessage = 1;
  if (!Number.isInteger(c.maxPrivateMessagesPerReply) || c.maxPrivateMessagesPerReply < 0 || c.maxPrivateMessagesPerReply > 20) c.maxPrivateMessagesPerReply = QQ_DEFAULTS.maxPrivateMessagesPerReply;
  if (typeof c.sendIntervalMs !== 'number') c.sendIntervalMs = QQ_DEFAULTS.sendIntervalMs;
  if (typeof c.deliverImageAttachments !== 'boolean') c.deliverImageAttachments = QQ_DEFAULTS.deliverImageAttachments;
  if (typeof c.emojiDir !== 'string' || !c.emojiDir) c.emojiDir = QQ_DEFAULTS.emojiDir;
  if (typeof c.timezone !== 'string' || !c.timezone) c.timezone = QQ_DEFAULTS.timezone;
  if (typeof c.mode !== 'string') c.mode = 'reverse';
  if (typeof c.token !== 'string') c.token = '';
  if (typeof c.wsUrl !== 'string') c.wsUrl = QQ_DEFAULTS.wsUrl;
  if (typeof c.wsHost !== 'string') c.wsHost = QQ_DEFAULTS.wsHost;
  if (typeof c.wsPort !== 'number') c.wsPort = QQ_DEFAULTS.wsPort;
  if (typeof c.wsPath !== 'string') c.wsPath = QQ_DEFAULTS.wsPath;
  // vision 子对象原地合并，保持引用身份（x-hot 生效）
  c.vision = c.vision ?? {};
  Object.assign(c.vision, { ...QQ_DEFAULTS.vision, ...(c.vision as object) });
  // sticker 子对象原地合并
  c.sticker = c.sticker ?? {};
  Object.assign(c.sticker, { ...QQ_DEFAULTS.sticker, ...(c.sticker as object) });
  if (typeof c.sticker.enabled !== 'boolean') c.sticker.enabled = true;
  if (c.sticker.captureMode !== 'sticker' && c.sticker.captureMode !== 'allImages') c.sticker.captureMode = 'sticker';
  if (typeof c.sticker.dir !== 'string') c.sticker.dir = '';
  // proactive 子对象原地合并
  c.proactive = c.proactive ?? {};
  Object.assign(c.proactive, { ...QQ_DEFAULTS.proactive, ...(c.proactive as object) });
  const p = c.proactive as Record<string, unknown>;
  if (typeof p.enabled !== 'boolean') p.enabled = false;
  if (p.mode !== 'private' && p.mode !== 'group' && p.mode !== 'both') p.mode = 'private';
  if (typeof p.tickSec !== 'number') p.tickSec = QQ_DEFAULTS.proactive.tickSec;
  if (typeof p.warmupMin !== 'number') p.warmupMin = QQ_DEFAULTS.proactive.warmupMin;
  if (typeof p.stableChancePerTick !== 'number') p.stableChancePerTick = QQ_DEFAULTS.proactive.stableChancePerTick;
  if (typeof p.warmupChance !== 'number') p.warmupChance = QQ_DEFAULTS.proactive.warmupChance;
  if (typeof p.privateCooldownSec !== 'number') p.privateCooldownSec = QQ_DEFAULTS.proactive.privateCooldownSec;
  if (typeof p.groupCooldownSec !== 'number') p.groupCooldownSec = QQ_DEFAULTS.proactive.groupCooldownSec;
  if (typeof p.unrepliedThreshold !== 'number') p.unrepliedThreshold = QQ_DEFAULTS.proactive.unrepliedThreshold;
  if (typeof p.silentHours !== 'number') p.silentHours = QQ_DEFAULTS.proactive.silentHours;
  if (typeof p.dailyQuota !== 'number') p.dailyQuota = QQ_DEFAULTS.proactive.dailyQuota;
  if (typeof p.dedupWindow !== 'number') p.dedupWindow = QQ_DEFAULTS.proactive.dedupWindow;
  for (const key of ['quietFrom', 'quietTo'] as const) {
    if (!Number.isInteger(p[key]) || Number(p[key]) < 0 || Number(p[key]) > 23) p[key] = QQ_DEFAULTS.proactive[key];
  }
  // groupSpeak / antiLoop 子对象原地合并
  c.groupSpeak = c.groupSpeak ?? {};
  Object.assign(c.groupSpeak, { ...QQ_DEFAULTS.groupSpeak, ...(c.groupSpeak as object) });
  const gs = c.groupSpeak as Record<string, unknown>;
  if (typeof gs.enabled !== 'boolean') gs.enabled = true;
  if (typeof gs.maxPerWindow !== 'number' || (gs.maxPerWindow as number) < 1) gs.maxPerWindow = QQ_DEFAULTS.groupSpeak.maxPerWindow;
  if (typeof gs.windowSec !== 'number' || (gs.windowSec as number) < 1) gs.windowSec = QQ_DEFAULTS.groupSpeak.windowSec;
  c.antiLoop = c.antiLoop ?? {};
  Object.assign(c.antiLoop, { ...QQ_DEFAULTS.antiLoop, ...(c.antiLoop as object) });
  const al = c.antiLoop as Record<string, unknown>;
  if (typeof al.enabled !== 'boolean') al.enabled = true;
  if (typeof al.maxConsecutiveBotTurns !== 'number' || (al.maxConsecutiveBotTurns as number) < 1) al.maxConsecutiveBotTurns = QQ_DEFAULTS.antiLoop.maxConsecutiveBotTurns;
  if (typeof al.idleToEndSec !== 'number' || (al.idleToEndSec as number) < 0) al.idleToEndSec = QQ_DEFAULTS.antiLoop.idleToEndSec;
  // routine 子对象原地合并
  c.routine = c.routine && typeof c.routine === 'object' ? c.routine : {...QQ_DEFAULTS.routine};
  Object.assign(c.routine, { ...QQ_DEFAULTS.routine, ...(c.routine as object) });
  const rt = c.routine as unknown as Record<string, unknown>;
  if (typeof rt.enabled !== 'boolean') rt.enabled = false;
  if (typeof rt.sleepStart !== 'string' || !/^\d{1,2}:\d{2}$/.test(rt.sleepStart as string)) rt.sleepStart = QQ_DEFAULTS.routine.sleepStart;
  if (typeof rt.sleepEnd !== 'string' || !/^\d{1,2}:\d{2}$/.test(rt.sleepEnd as string)) rt.sleepEnd = QQ_DEFAULTS.routine.sleepEnd;
  if (typeof rt.lazyStart !== 'string' || !/^\d{1,2}:\d{2}$/.test(rt.lazyStart as string)) rt.lazyStart = QQ_DEFAULTS.routine.lazyStart;
  if (typeof rt.lazyEnd !== 'string' || !/^\d{1,2}:\d{2}$/.test(rt.lazyEnd as string)) rt.lazyEnd = QQ_DEFAULTS.routine.lazyEnd;
  if (typeof rt.greetSleep !== 'string') rt.greetSleep = QQ_DEFAULTS.routine.greetSleep;
  if (typeof rt.greetWake !== 'string') rt.greetWake = QQ_DEFAULTS.routine.greetWake;
  if (typeof rt.greetLazy !== 'string') rt.greetLazy = QQ_DEFAULTS.routine.greetLazy;
  // reminder 子对象原地合并
  c.reminder = c.reminder && typeof c.reminder === 'object' ? c.reminder : {...QQ_DEFAULTS.reminder};
  Object.assign(c.reminder, { ...QQ_DEFAULTS.reminder, ...(c.reminder as object) });
  const rm = c.reminder as Record<string, unknown>;
  if (typeof rm.enabled !== 'boolean') rm.enabled = true;
  // voice 子对象原地合并
  c.voice = c.voice && typeof c.voice === 'object' ? c.voice : {...QQ_DEFAULTS.voice};
  Object.assign(c.voice, { ...QQ_DEFAULTS.voice, ...(c.voice as object) });
  const vc = c.voice as Record<string, unknown>;
  if (typeof vc.enabled !== 'boolean') vc.enabled = false;
  if (!voiceProviderIds().includes(vc.provider as string)) vc.provider = 'native';
  if (typeof vc.tts !== 'boolean') vc.tts = true;
  if (typeof vc.voiceBaseUrl !== 'string') vc.voiceBaseUrl = QQ_DEFAULTS.voice.voiceBaseUrl;
  if (typeof vc.voiceApiKeySecret !== 'string' || !vc.voiceApiKeySecret) vc.voiceApiKeySecret = QQ_DEFAULTS.voice.voiceApiKeySecret;
  if (typeof vc.voiceVoice !== 'string') vc.voiceVoice = QQ_DEFAULTS.voice.voiceVoice;
  if (typeof vc.voiceTtsModel !== 'string' || !vc.voiceTtsModel) vc.voiceTtsModel = QQ_DEFAULTS.voice.voiceTtsModel;
  if (typeof vc.voiceTimeout !== 'number' || !(vc.voiceTimeout > 0)) vc.voiceTimeout = QQ_DEFAULTS.voice.voiceTimeout;
  if (typeof vc.voiceExtraTts !== 'string') vc.voiceExtraTts = QQ_DEFAULTS.voice.voiceExtraTts;
  if (typeof vc.voxcpmUrl !== 'string' || !vc.voxcpmUrl) vc.voxcpmUrl = QQ_DEFAULTS.voice.voxcpmUrl;
  if (typeof vc.voxcpmVoiceDesc !== 'string' || !vc.voxcpmVoiceDesc) vc.voxcpmVoiceDesc = QQ_DEFAULTS.voice.voxcpmVoiceDesc;
  if (typeof vc.voxcpmSpeed !== 'number' || !(vc.voxcpmSpeed > 0)) vc.voxcpmSpeed = QQ_DEFAULTS.voice.voxcpmSpeed;
  if (typeof vc.voxcpmTimesteps !== 'number' || !(vc.voxcpmTimesteps > 0)) vc.voxcpmTimesteps = QQ_DEFAULTS.voice.voxcpmTimesteps;
  if (typeof vc.voxcpmSeed !== 'number' || vc.voxcpmSeed < 0) vc.voxcpmSeed = QQ_DEFAULTS.voice.voxcpmSeed;
  // admin 子对象原地合并：先摊平默认，再被用户配置覆盖（模式同 voice/routine）
  const adm = c.admin && typeof c.admin === 'object' ? (c.admin as Record<string, unknown>) : {};
  Object.assign(adm, { ...QQ_DEFAULTS.admin, ...adm });
  if (typeof adm.enabled !== 'boolean') adm.enabled = false;
  if (typeof adm.noticeAction !== 'string' || !adm.noticeAction) adm.noticeAction = QQ_DEFAULTS.admin.noticeAction;
  // allowlist 在控制台里是逗号分隔字符串，运行时统一规整成字符串数组
  if (typeof adm.allowlist === 'string') {
    adm.allowlist = adm.allowlist.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (!Array.isArray(adm.allowlist)) adm.allowlist = [];
  if (typeof adm.allowGroupAdmins !== 'boolean') adm.allowGroupAdmins = true;
  if (typeof adm.ownerOnly !== 'boolean') adm.ownerOnly = false;
  if (typeof adm.protectOwner !== 'boolean') adm.protectOwner = true;
  if (typeof adm.protectAdmins !== 'boolean') adm.protectAdmins = true;
  if (typeof adm.allowJoin !== 'boolean') adm.allowJoin = true;
  if (typeof adm.allowSelf !== 'boolean') adm.allowSelf = true;
  if (typeof adm.allowSelfKick !== 'boolean') adm.allowSelfKick = false;
  if (typeof adm.kickRejectRejoin !== 'boolean') adm.kickRejectRejoin = true;
  c.admin = adm as QQWorldConfig['admin'];
  if (typeof c.allowPrivateRedirect !== 'boolean') c.allowPrivateRedirect = false;
  return c;
}

export function parseNumberSeq(v: unknown): number[] {
  if (Array.isArray(v)) return v.map((x) => Number(x)).filter((x) => Number.isFinite(x));
  if (typeof v === 'string') {
    return v
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n));
  }
  return [];
}

/**
 * 常见国家/地区时区预设。value 为 IANA 时区名（供 Intl 使用），
 * flag+country 用于控制台下拉展示。默认中国（UTC+8）。
 */
export interface TzPreset {
  flag: string;
  country: string;
  iana: string;
}

export const TZ_PRESETS: TzPreset[] = [
  { flag: '🇨🇳', country: '中国', iana: 'Asia/Shanghai' },
  { flag: '🇭🇰', country: '中国香港', iana: 'Asia/Hong_Kong' },
  { flag: '🇯🇵', country: '日本', iana: 'Asia/Tokyo' },
  { flag: '🇰🇷', country: '韩国', iana: 'Asia/Seoul' },
  { flag: '🇸🇬', country: '新加坡', iana: 'Asia/Singapore' },
  { flag: '🇮🇳', country: '印度', iana: 'Asia/Kolkata' },
  { flag: '🇦🇪', country: '阿联酋', iana: 'Asia/Dubai' },
  { flag: '🇷🇺', country: '俄罗斯', iana: 'Europe/Moscow' },
  { flag: '🇬🇧', country: '英国', iana: 'Europe/London' },
  { flag: '🇫🇷', country: '法国', iana: 'Europe/Paris' },
  { flag: '🇩🇪', country: '德国', iana: 'Europe/Berlin' },
  { flag: '🇺🇸', country: '美国东部', iana: 'America/New_York' },
  { flag: '🇺🇸', country: '美国西部', iana: 'America/Los_Angeles' },
  { flag: '🇧🇷', country: '巴西', iana: 'America/Sao_Paulo' },
  { flag: '🇦🇺', country: '澳大利亚', iana: 'Australia/Sydney' },
  { flag: '🇳🇿', country: '新西兰', iana: 'Pacific/Auckland' },
  { flag: '🌐', country: 'UTC（协调世界时）', iana: 'UTC' },
];

/** 默认时区：中国 UTC+8（与 QQ_DEFAULTS.timezone 一致）。 */
export const TZ_DEFAULT_IANA = 'Asia/Shanghai';

/**
 * 返回某 IANA 时区当前的 UTC 偏移标签，如 "UTC+8" / "UTC+5:30" / "UTC-4"。
 * 自动反映夏令时；非法时区返回空串。
 */
export function tzOffsetLabel(iana: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: iana, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName');
    const raw = parts?.value ?? '';
    // raw 形如 "GMT+8" / "GMT+5:30" / "GMT"；去掉 "GMT" 前缀换成 "UTC"。
    return raw ? 'UTC' + raw.slice(3) : '';
  } catch {
    return '';
  }
}

/**
 * 给 x-options 下拉（kind='qq-timezone'）提供「国家 (UTC偏移)」友好选项。
 * 存储值仍为 IANA 名，供 Intl 直接使用。
 */
export function qqTimezoneOptions(): Array<{ value: string; label: string }> {
  return TZ_PRESETS.map((p) => ({
    value: p.iana,
    label: `${p.flag} ${p.country} (${tzOffsetLabel(p.iana)})`,
  }));
}
