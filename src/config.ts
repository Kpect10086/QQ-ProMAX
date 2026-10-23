import type { ConfigGroup } from 'cortico/core/types.ts';
import type { WorldSection } from 'cortico/world.ts';
import type { QZoneConfig } from './qzone.ts';
import type { RoutineConfig } from './proactive.ts';
import {QQ_QUIET_DEFAULTS, type QuietReplyConfig} from './quiet-hours.ts';
import { voiceProviderIds } from './voice.ts';

/** fat-fish qq_bot 的关键参数 + Cortico 内置 world 的可选项，统一为一份配置。 */
/** 语音通话（模拟）配置：基于语音消息的"打电话"会话，支持即时听说与流式语音 */
export interface QQCallConfig {
  /** 是否启用语音通话（模拟）功能 */
  enabled: boolean;
  /** 触发词（逗号分隔）：收到这些词即视为"来电"，机器人接听进入通话 */
  triggerWords: string;
  /** 挂断词（逗号分隔）：通话中收到这些词即挂断 */
  hangupWords: string;
  /** 接听招呼语（空=交由 AI 自动生成开场白） */
  greeting: string;
  /** 挂断告别语（空=交由 AI 自动生成告别语） */
  farewell: string;
  /** 本地语音模型未就绪时的拒绝文案 */
  notReadyText: string;
  /** 闲置自动挂断秒数（0=不自动挂断） */
  idleTimeoutSec: number;
  /** 通话中是否强制语音回复（默认 true） */
  forceVoice: boolean;
  /** 是否分句流式发送语音（默认 true，降低首字延迟、更像真通话） */
  streamChunks: boolean;
  /** 分句语音之间的间隔毫秒 */
  chunkGapMs: number;
  /** 接通中（等待本地语音模型初始化完成）时发送的提示文案；空=默认「喂？稍等，我正在接通…」 */
  loadingText: string;
  /** 接听前等待本地语音模型初始化完成的最长秒数；0=不等待（未就绪直接按未就绪处理）。超时仍未就绪则发 notReadyText 婉拒。 */
  initTimeoutSec: number;
  /** 通话模式：simulated=基于语音消息的模拟（OneBot，默认，零风险，无需动真实 QQ 客户端）；system=系统级真接电话（动真实 QQ 客户端+系统音频桥，受 answerMethod 控制）。OneBot/NapCat 拿不到系统级电话的来电事件，system 模式需配合 LiteLoader/CUA 接听与音频桥使用。 */
  mode: 'simulated' | 'system';
  /** 系统级真接电话的接听手段（仅 mode=system 生效）：liteloader=用 LiteLoaderQQNT 插件监听来电并自动接听+切虚拟麦克风；cua=用桌宠(cortico-world-cua)视觉识别来电弹窗点击接听；auto=优先 liteloader（装了就用），否则退化 cua。 */
  answerMethod: 'liteloader' | 'cua' | 'auto';
  /** 系统级真接电话的音频桥服务地址（audio_bridge_poc/call_bridge.py 的 HTTP 地址）。mode=system 时 TTS 经它喂给 CABLE，对方声音经它从 WASAPI Loopback 抓取。 */
  bridgeUrl: string;
  /** 音频桥脚本绝对路径（call_bridge.py）。留空则运行时按"扩展目录向上回溯"在 audio_bridge_poc/ 等常见布局里自动找；也可显式指定。 */
  bridgeScript: string;
  /** 运行音频桥的 python 解释器路径（建议指向带 comtypes/pyaudio 的 venv）。留空则自动回溯 venv_vox，再回退 PATH 上的 python。 */
  bridgePython: string;
}


/** 语音识别（ASR）共享配置：语音收发（收语音）用同一套 ASR，避免重复配置。
 *  实现由 asrLocalEngine 决定（侧车 asr_sidecar.py 的 load_engine 分支），类型开放为 string，新增引擎无需改类型。
 *  默认 local + funasr（SenseVoiceSmall，中文更准，自动从 ModelScope 下载），后续可切 228MB 的 sherpa-onnx 版。 */
export interface QQAsrConfig {
  /** ASR 模式：off=关闭（仅 TTS 播报/单向，听不到对方）；local=本扩展自动拉起的本地侧车（默认 funasr）；cloud=远程 OpenAI 兼容端点。 */
  mode: 'off' | 'cloud' | 'local';
  /** 本地 ASR 引擎：funasr（默认，SenseVoiceSmall，自动从 ModelScope 下载）；sherpaOnnx（228MB int8，省内存更快，后续接入）。
   *  类型开放为 string，新增引擎（vosk/fasterWhisper 等）只需在侧车 load_engine 加分支，无需改此处类型。 */
  localEngine: string;
  /** 本地模型/权重目录绝对路径：留空则运行时自动下载/缓存（funasr 自动从 ModelScope 拉 iic/SenseVoiceSmall）。
   *  vosk/fasterWhisper 等需本地目录的引擎必须填。 */
  localModelPath: string;
  /** 本地侧车 python 依赖所在 venv 目录绝对路径；空=自动探测 <扩展>/venv_vox。 */
  localVenv: string;
  /** 本地侧车监听端口。 */
  localPort: number;
  /** 云端 ASR 端点基址（POST {url}/asr 或 {url}/audio/transcriptions 收音频→{text}）。 */
  cloudUrl: string;
  /** 云端 ASR 的 API Key 环境变量名；留空=不带鉴权头（本地/免密服务）。 */
  cloudApiKeySecret: string;
  /** 云端 ASR 模型名（OpenAI 兼容 /audio/transcriptions 用，如 whisper-1 / glm-asr-2512）。 */
  cloudModel: string;
  cloudFormat: 'openai' | 'wav';
  /** ffmpeg 可执行文件路径（把 QQ 原生 SILK/AMR 解码成 WAV 送识别）；空=依次找 PATH 与仓库 ffmpeg-static。 */
  ffmpegPath: string;
  /** 识别单次超时（毫秒，默认 60000）：解码与 /asr 请求共用。 */
  transcribeTimeout: number;
}

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
    systemPrompt: string;
    endpoint: string;
    apiKeySecret: string;
    model: string;
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
    /** 主动消息与近期已发内容的相似度上限（0~1，字符二元组 Jaccard），超过则跳过，防同一话题反复换汤不换药。 */
    topicSimilarity: number;
    /** 主动消息生成时模型输出 token 上限（越大单次说得越长），页面可填，默认 2000。 */
    tokenLimit: number;
    /** 主动说话是否带对象昵称/称呼；关闭后不称呼对方具体名字，直接用「你」。默认 true。 */
    withNickname: boolean;
    /** 静默时段只允许私聊回复；起止小时相同表示关闭。 */
    quietFrom: number;
    quietTo: number;
  };
  /** QQ 空间（动态/说说）：按对话与记忆发表自己的看法/吐槽/简介，可附图与@，支持删除与评论回复。 */
  qzone: QZoneConfig;
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
  /** 情绪系统：移植自 fat-fish qq_bot 的 emotion 模块，全局维护一份心情，注入上下文并支持 /心情 查询。 */
  emotion: {
    /** 是否启用情绪感知与注入。 */
    enabled: boolean;
    /** 情绪感知所用 chat 端点（OpenAI 兼容）。 */
    endpoint: string;
    /** 端点密钥的环境变量名。 */
    apiKeySecret: string;
    /** 感知模型。 */
    model: string;
    /** 心情自然衰减半衰期（小时），越小忘得越快。对齐 fat-fish EMOTION_DECAY_HOURS。 */
    decayHours: number;
    /** 主导情绪标签冷却（分钟）：冷却期内不切换到新标签，避免来回横跳。对齐 EMOTION_LABEL_MINUTES。 */
    labelMinutes: number;
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
  /** 好感度（关系分）系统：每位用户独立、可正可负、随互动上下浮动，注入上下文影响聊天态度。 */
  affinity: {
    /**
     * 是否启用好感度系统。
     * - 记录 / 查询 / 调整工具（qq_affinity_*）始终可用；
     * - 此开关决定是否在「与该用户对话时把当前好感度自动注入上下文」，影响语气与分寸。
     */
    enabled: boolean;
  };
  /** 自称（第一人称昵称）：用于主动说话调度器与作息状态文本。
   *  - 留空（默认）：回退到登录 QQ 昵称，再不行回退「我」。
   *  - 填了：强制用这个值（如「小鱼」），换称呼零改码。 */
  selfName: string;
  /** 语音收发：发语音(TTS)+收语音(ASR)。ASR 统一走顶层 asr.* 配置（共享识别引擎，默认 funasr），
   *  此处只管 TTS 与供应商选择；实现由 voice.ts 注册表供应商决定（当前内置 native/custom/local/voxcpm，可扩展）。 */
  voice: {
    /** 总开关。 */
    enabled: boolean;
    /** 实现方式（语音供应商 id）：当前内置 native=OneBot 原生 tts(零依赖)；custom=远程 OpenAI 兼容 TTS（填语音模型网址+API Key）；local=本地/自建 TTS（免 Key）；voxcpm=本地 VoxCPM2 TTS 服务。可在 voice.ts 注册更多供应商。ASR 不在本处配置（见顶层 asr）。 */
    provider: string;
    /** 收：把用户语音转成文字进入对话（走顶层 asr.* 引擎）。 */
    asr: boolean;
    /** 发：用语音回复（受 semanticJudge 控制是否触发）。 */
    tts: boolean;
    /** 语义判定：通过 LLM 判断本次回复是否应当说语音（对齐 qq_bot _judge_voice）。 */
    semanticJudge: boolean;
    /** ASR 失败且无文字时的回退：把音频作为 blob 丢给多模态模型听（需模型支持 audio/wav）。 */
    audioFallback: boolean;
    /** 语义判定所用 chat 端点（OpenAI 兼容）。 */
    judgeEndpoint: string;
    /** 端点密钥的环境变量名。 */
    judgeApiKeySecret: string;
    /** 判定模型。 */
    judgeModel: string;
    /** 自定义(custom/local)语音供应商的 OpenAI 兼容音频端点基址（仅 TTS 用）；选 custom/local 供应商时必填。 */
    voiceBaseUrl: string;
    /** 自定义语音供应商 API Key 的环境变量名（控制台密钥库填写）。 */
    voiceApiKeySecret: string;
    /** 音色/声音名：仅当所选语音模型支持时填写（如 tongtong）；留空用默认音色。 */
    voiceVoice: string;
    /** 自定义供应商 TTS 模型名（/audio/speech 用，缺省 tts-1）。 */
    voiceTtsModel: string;
    /** TTS 请求超时（秒）：单次合成最长等待，本地推理慢可调大（默认 120）。custom 与 local 共用。ASR 超时见顶层 asr.transcribeTimeout。 */
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
  /** 语音识别（ASR）共享配置：语音收发（收语音）用同一套 ASR，避免重复配置。
   *  默认 local + funasr（SenseVoiceSmall，中文更准，自动从 ModelScope 下载）；后续可切 228MB 的 sherpa-onnx 版（更省内存）。 */
  asr: QQAsrConfig;
  /** VoxCPM 侧车自拉起：provider=voxcpm 且本机没有常驻 vox_tts_server.py 时，由本扩展负责拉起独立 venv_vox 子进程。与 fat-fish 主 bot 的 tts_vox 守护二选一，避免重复抢显存。 */
  voxcpmSidecar: {
    /** 是否由本扩展自动拉起 voxcpm 侧车子进程（默认 false；仅在确认没有别的进程管理侧车时开启）。 */
    enabled: boolean;
    /** 虚拟环境（venv）目录绝对路径；空=自动探测。指定后从中推导解释器 <venv>/Scripts/python.exe（Windows）或 <venv>/bin/python3、bin/python（Linux）。 */
    venv: string;
    /** venv_vox 的 python 解释器绝对路径；空=由 venv 推导，再退化为 <vox_tts_server.py 所在目录>/venv_vox 下的平台解释器。 */
    python: string;
    /** vox_tts_server.py 绝对路径；本扩展不内置该脚本（来自 fat-fish qq_bot 运行时），请显式指定；空=按"扩展目录向上回溯到 qq_bot / Fat-Fish / feiyu_standalone"这一常见布局相对探测。 */
    script: string;
    /** VOXCPM 权重目录（model.safetensors 所在）；空=优先进程环境变量 VOXCPM_MODEL_DIR，否则 <脚本目录>/models/VoxCPM2。 */
    modelDir: string;
    /** VOXCPM_FFMPEG 路径；空=不设置（侧车自行找 ffmpeg）。 */
    ffmpeg: string;
    /** 侧车 stdout/stderr 日志文件绝对路径；空=优先扩展数据目录，再回退脚本目录。 */
    logFile: string;
    /** 拉起后等待 /health 变 ready（模型加载完）的最长秒数，首启常需 2~4 分钟，默认 240。 */
    startupTimeoutSec: number;
  };
  /** 语音通话（模拟）：基于语音消息的"打电话"会话，支持即时听说与流式语音 */
  call: QQCallConfig;
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
    endpoint: 'https://openrouter.ai/api/v1',
    apiKeySecret: 'OPENROUTER_API_KEY',
    model: 'google/gemini-2.5-flash',
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
    systemPrompt:
      '你要主动找对方说话（不是回复，是主动冒泡）。' +
      '从真实对话里挑一个仍有意思的细节，分享自己的看法、感受或好奇，语气自然，长短随内容。' +
      '已有消息没有得到回应、又没有新的内容时，可以保持安静，返回 JSON {"text":""}。',
    endpoint: 'https://openrouter.ai/api/v1',
    apiKeySecret: 'OPENROUTER_API_KEY',
    model: 'google/gemini-2.5-flash',
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
    topicSimilarity: 0.6,
    tokenLimit: 2000,
    withNickname: true,
    quietFrom: 0,
    quietTo: 0,
  },
  qzone: {
    enabled: false,
    systemPrompt:
      '你现在要以第一人称在 QQ 空间发一条动态（说说）。内容要像你自己真实的朋友圈碎碎念：可以对最近聊天里某件事、某个人发表你的真实看法、吐槽、安利或简介，也可以分享当下的心情。自然、有梗、带点小情绪，别太长（1-3 句最佳，最多不超 100 字）。不要写成回复、不要加「在吗」、不要客服腔，可带少量 emoji。',
    endpoint: 'https://openrouter.ai/api/v1',
    apiKeySecret: 'OPENROUTER_API_KEY',
    model: 'google/gemini-2.5-flash',
    tickSec: 900,
    chancePerTick: 0.15,
    dailyQuota: 5,
    permission: 1,
    imageMode: 'none',
    autoReplyComments: {
      enabled: false,
      systemPrompt:
        '你在 QQ 空间收到别人对你动态的评论，要回一句。自然，像真朋友随口接话，别太长别客套，可带 emoji。',
      dailyQuota: 20,
      cooldownSec: 30,
    },
    commentAction: 'send_qzone_comment',
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
  emotion: {
    enabled: true,
    endpoint: 'https://api.deepseek.com/v1',
    apiKeySecret: 'DEEPSEEK_API_KEY',
    model: 'deepseek-chat',
    decayHours: 2.0,
    labelMinutes: 40,
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
  affinity: {
    enabled: true,
  },
  selfName: '',
  voice: {
    enabled: false,
    provider: 'native',
    asr: true,
    tts: true,
    semanticJudge: true,
    audioFallback: true,
    judgeEndpoint: 'https://api.deepseek.com/v1',
    judgeApiKeySecret: 'DEEPSEEK_API_KEY',
    judgeModel: 'deepseek-chat',
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
  // 语音识别（ASR）共享配置：语音收发（收语音）用同一套 ASR。默认 local + funasr。
  asr: {
    mode: 'local',
    localEngine: 'funasr',
    localModelPath: '',
    localVenv: '',
    localPort: 8778,
    cloudUrl: '',
    cloudApiKeySecret: 'ASR_API_KEY',
    cloudModel: 'glm-asr-2512',
    cloudFormat: 'openai',
    ffmpegPath: '',
    transcribeTimeout: 60000,
  },
  // 语音通话（模拟）：基于语音消息的"打电话"会话
  call: {
    enabled: false,
    triggerWords: '打电话,语音通话,打语音,接电话,call me,语音聊天,想听你说话,给我打个电话',
    hangupWords: '挂电话,挂断,结束通话,结束语音,再见,拜拜,不说了,先这样',
    greeting: '',
    farewell: '',
    notReadyText: '唔，我的语音模型还没准备好呢，等会儿再打给我吧~',
    idleTimeoutSec: 120,
    forceVoice: true,
    streamChunks: true,
    chunkGapMs: 220,
    loadingText: '喂？稍等，我正在接通…',
    initTimeoutSec: 60,
    mode: 'simulated',
    answerMethod: 'auto',
    bridgeUrl: 'http://127.0.0.1:8799',
    bridgeScript: '',
    bridgePython: '',
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

voxcpmSidecar: {
    enabled: false,
    venv: '',
    python: '',
    script: '',
    modelDir: '',
    ffmpeg: '',
    logFile: '',
    startupTimeoutSec: 240,
  },
};

export const QQ_SECRETS = ['QQ_ACCESS_TOKEN', 'OPENROUTER_API_KEY', 'DEEPSEEK_API_KEY', 'VOICE_API_KEY'];

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
      'worlds.qqbot.emojiDir': { type: 'string', title: '表情包目录', 'x-hot': false, description: '本地表情包图片目录（相对扩展或绝对路径），供发送 [表情包:文件名] 标记。' },
      'worlds.qqbot.splitReplyBySentence': { type: 'boolean', title: '按句拆分发送', 'x-hot': true, description: '开启后回复按句标拆成多条消息（对齐 fat-fish）。' },
      'worlds.qqbot.sentencesPerMessage': { type: 'integer', title: '每条句数', minimum: 1, maximum: 10, 'x-hot': true },
      'worlds.qqbot.maxPrivateMessagesPerReply': {type:'integer',title:'私聊每次回复最多条数',minimum:0,maximum:20,'x-hot':true,description:'同一条私聊来信对应的回复上限，文字、图片和语音共用；跨多次工具调用与模型回合累计，收到新消息才重置。超出的分句尽量合并，0 表示不限。'},
      'worlds.qqbot.sendIntervalMs': { type: 'integer', title: '发送间隔(ms)', minimum: 0, maximum: 5000, 'x-hot': true, description: '逐条发送之间的间隔，0 表示不限速。' },
      'worlds.qqbot.vision.enabled': { type: 'boolean', title: '开启辅助视觉', 'x-hot': false },
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
      'worlds.qqbot.proactive.model': { type: 'string', title: '主动消息模型', 'x-hot': false, description: '生成主动闲聊用的 chat 模型（OpenAI 兼容端点）。' },
      'worlds.qqbot.proactive.systemPrompt': { type: 'string', title: '主动聊天的公开人设与表达', 'x-hot': false, description: '独立生成器使用的公开性格与表达要求。不要填入私人档案或其他会话内容；修改后重启生效。' },
      'worlds.qqbot.proactive.privateCooldownSec': { type: 'integer', title: '私聊主动消息间隔(秒)', minimum: 0, maximum: 86400, 'x-hot': false, description: '同一私聊两次主动消息的最小间隔；修改后重启生效。' },
      'worlds.qqbot.proactive.dailyQuota': { type: 'integer', title: '每日上限', minimum: 0, maximum: 200, 'x-hot': true, description: '每日主动消息条数上限（0=不限）。' },
      'worlds.qqbot.proactive.quietFrom': { type: 'integer', title: '静默开始(时)', minimum: 0, maximum: 23, 'x-hot': true, description: '按配置时区。静默期间停止主动冒泡和群聊发送，允许私聊回复；与结束小时相同则关闭。' },
      'worlds.qqbot.proactive.quietTo': { type: 'integer', title: '静默结束(时)', minimum: 0, maximum: 23, 'x-hot': true },
      'worlds.qqbot.qzone.enabled': { type: 'boolean', title: 'QQ空间动态', 'x-hot': false, description: '开启后可在 QQ 空间发动态、自动冒泡、回复评论。需重启生效。' },
      'worlds.qqbot.qzone.model': { type: 'string', title: '动态生成模型', 'x-hot': false, description: '生成动态/评论所用 chat 模型（OpenAI 兼容端点）。' },
      'worlds.qqbot.qzone.dailyQuota': { type: 'integer', title: '每日自动动态上限', minimum: 0, maximum: 50, 'x-hot': true, description: '后台自动发动态的每日条数上限（0=不限）。' },
      'worlds.qqbot.qzone.permission': { type: 'integer', title: '动态可见权限', minimum: 0, maximum: 10, 'x-hot': true, description: 'ugc_right：1=公开（默认），其余值随 NapCat 版本。' },
      'worlds.qqbot.qzone.imageMode': { type: 'string', title: '自动附图', enum: ['none', 'recent'], 'x-hot': true, description: 'none=不附图；recent=自动附上最近一条 QQ 图片。' },
      'worlds.qqbot.qzone.autoReplyComments.enabled': { type: 'boolean', title: '自动回复空间评论', 'x-hot': false, description: '收到空间评论时自动生成并回复。需重启生效。' },
      'worlds.qqbot.qzone.commentAction': { type: 'string', title: '评论回复 action', 'x-hot': true, description: '回复评论用的 OneBot action（不同 NapCat 版本可能不同，默认 send_qzone_comment）。' },
      'worlds.qqbot.proactive.topicSimilarity': { type: 'number', title: '话题相似度上限', minimum: 0, maximum: 1, 'x-hot': true, description: '0~1：主动消息与近期已发内容相似度超过该值则跳过（防同一话题反复换汤不换药）。0=关闭。' },
      'worlds.qqbot.proactive.tokenLimit': { type: 'integer', title: '主动消息 Token 上限', minimum: 50, maximum: 8000, 'x-hot': true, description: '主动消息生成时模型输出 token 上限（越大单次说得越长）。默认 2000，改完即时生效。' },
      'worlds.qqbot.proactive.withNickname': { type: 'boolean', title: '主动说话带昵称/称呼', 'x-hot': true, description: '开启时主动消息会称呼对方昵称；关闭后不称呼对方具体名字，直接用「你」即可。改完即时生效。' },
      'worlds.qqbot.groupSpeak.enabled': { type: 'boolean', title: '群聊发言限速', 'x-hot': true, description: '开启后限制每个群在单位窗口内被 bot 发出的消息总量，防止刷屏/死循环灌水。' },
      'worlds.qqbot.groupSpeak.maxPerWindow': { type: 'integer', title: '窗口内最大条数', minimum: 1, maximum: 200, 'x-hot': true, description: '滑动窗口内允许发出的群消息上限（含主动与回复）。' },
      'worlds.qqbot.groupSpeak.windowSec': { type: 'integer', title: '窗口长度(秒)', minimum: 1, maximum: 3600, 'x-hot': true, description: '限速滑动窗口长度。' },
      'worlds.qqbot.antiLoop.enabled': { type: 'boolean', title: '话题自动结束', 'x-hot': true, description: '开启后统计单会话 bot 连续发言次数与对方静默时长，超限自动收尾，避免话题死循环。' },
      'worlds.qqbot.antiLoop.maxConsecutiveBotTurns': { type: 'integer', title: '连续发言上限', minimum: 1, maximum: 50, 'x-hot': true, description: '单会话内 bot 连续发言达到该次数（对方发消息即清零），下次发言被拦截并提示收尾。' },
      'worlds.qqbot.antiLoop.idleToEndSec': { type: 'integer', title: '对方静默收尾(秒)', minimum: 0, maximum: 86400, 'x-hot': true, description: '对方静默超过该秒数且 bot 已发过言则自动收尾；0=关闭该规则。' },
      'worlds.qqbot.emotion.enabled': { type: 'boolean', title: '情绪系统', 'x-hot': true, description: '开启后每轮对话感知情绪、把心情注入全局上下文，并支持 /心情 查询（移植自 fat-fish）。' },
      'worlds.qqbot.emotion.decayHours': { type: 'number', title: '心情衰减半衰期(小时)', minimum: 0.1, maximum: 48, 'x-hot': true, description: '心情值自然回落到中性（0）的半衰期，越小忘得越快。' },
      'worlds.qqbot.emotion.labelMinutes': { type: 'number', title: '主导情绪冷却(分)', minimum: 0, maximum: 120, 'x-hot': true, description: '冷却期内不切换到新的主导情绪标签，避免来回横跳。' },
      'worlds.qqbot.emotion.model': { type: 'string', title: '情绪感知模型', 'x-hot': false, description: '用于分析用户消息情绪、抽取心情变化的 chat 模型（OpenAI 兼容端点）。' },
      'worlds.qqbot.routine.enabled': { type: 'boolean', title: '作息功能', 'x-hot': true, description: '开启后按真实时间切换「睡眠/午休/活跃」状态：睡眠段暂停主动冒泡并到点播报，午休段仅在语气里体现。改完即时生效。' },
      'worlds.qqbot.routine.sleepStart': { type: 'string', title: '睡眠开始(HH:MM)', 'x-hot': true, description: '进入睡眠时段的时间（24h，可早于 sleepEnd 形成跨午夜，如 23:00）。睡眠段内不主动冒泡，但仍能被动回复。' },
      'worlds.qqbot.routine.sleepEnd': { type: 'string', title: '睡眠结束(HH:MM)', 'x-hot': true, description: '离开睡眠时段的时间（24h）。离开时主动说「醒来」播报文案。' },
      'worlds.qqbot.routine.lazyStart': { type: 'string', title: '午休开始(HH:MM)', 'x-hot': true, description: '进入午休/打盹时段的时间；仅作为状态注入，不影响主动冒泡是否发出。' },
      'worlds.qqbot.routine.lazyEnd': { type: 'string', title: '午休结束(HH:MM)', 'x-hot': true, description: '离开午休时段的时间。' },
      'worlds.qqbot.routine.greetSleep': { type: 'string', title: '去睡播报(兜底)', 'x-hot': true, description: '进入睡眠段的兜底文案：正常播报由 LLM 现场生成（每次说法不固定），仅当生成失败才回退到这句。空=无兜底直接跳过。' },
      'worlds.qqbot.routine.greetWake': { type: 'string', title: '醒来播报(兜底)', 'x-hot': true, description: '离开睡眠段的兜底文案：正常由 LLM 生成，失败才回退。空=无兜底。' },
      'worlds.qqbot.routine.greetLazy': { type: 'string', title: '午休播报(兜底)', 'x-hot': true, description: '进入午休段的兜底文案：正常由 LLM 生成，失败才回退。空=无兜底。' },
      'worlds.qqbot.reminder.enabled': { type: 'boolean', title: '到点提醒', 'x-hot': true, description: '开启后，记下的定时提醒会在到点时自动发到对应会话；记录/查询/取消不受此开关影响（始终可用）。' },
  'worlds.qqbot.affinity.enabled': { type: 'boolean', title: '好感度系统', 'x-hot': true, description: '开启后，你对每个用户的好感度（-100~100，可正可负）会随互动增减，并在与该用户对话时自动注入上下文、影响你的态度与分寸。记录/查询/调整工具始终可用。' },
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

  /** 语音收发配置分组：收语音转文字、发语音，两种实现可切。路径/模型均不写死，由下方各字段或环境变量决定。 */
  export const QQ_VOICE_GROUP: ConfigGroup = {
  id: 'world:qqbot-voice',
  owner: 'world:qqbot',
  schema: {
  type: 'object',
  title: 'QQ · 语音收发',
  description: '发语音(TTS)+收语音(ASR)。ASR（识别引擎）已统一到「语音识别（ASR 共享）」配置组，此处只管 TTS 与供应商选择。「实现方式」下拉选择供应商：native=OneBot 原生 tts（零依赖，开箱即用）；custom=用「模型网址+API Key」对接远程 OpenAI 兼容音频 TTS 服务（GLM/OpenAI/自建等）；local=对接本地/自建 TTS 模型（OpenAI 兼容，免 API Key，慢推理可加超时，支持额外参数做声音克隆/设计，如 VoxCPM2 经 vLLM-Omni）；voxcpm=对接本地 VoxCPM2 TTS 服务（自有接口，如 Fat-Fish 的 vox_tts_server.py：GET /health + POST /tts 返回 48kHz WAV，免 API Key，音色用自然语言描述）。是否说语音由语义判定决定。改完需重启生效。',
  properties: {
  'worlds.qqbot.voice.enabled': { type: 'boolean', title: '启用语音', 'x-hot': true, description: '总开关：关闭则完全不处理语音（收按原方式、发只文字）。控制台「语音收发」面板可实时切换。' },
  'worlds.qqbot.voice.provider': {
    type: 'string', title: '实现方式', enum: voiceProviderIds(), 'x-hot': false,
    description: '语音供应商（实现方式）：下拉项由 voice.ts 注册的供应商动态生成。native=OneBot 原生 translate_record/tts（零依赖）；custom=用配置页填写的模型网址+API Key 对接远程 OpenAI 兼容音频服务；local=本地/自建模型（免 API Key，慢推理可加超时，支持额外参数做声音克隆/设计，如 VoxCPM2 经 vLLM-Omni）；voxcpm=本地 VoxCPM2 TTS 服务（自有接口，音色用自然语言描述，免 API Key，收语音回退 native 识别）。新增供应商只需在 voice.ts 用 registerVoiceProvider 注册。',
  },
  'worlds.qqbot.voice.asr': { type: 'boolean', title: '收语音转文字', 'x-hot': false, description: '开启后，用户发语音会被转成文字进入对话（文字更可靠、可检索）。' },
  'worlds.qqbot.voice.tts': { type: 'boolean', title: '发语音', 'x-hot': false, description: '开启后，当语义判定认为应当说语音时，回复发成语音。' },
  'worlds.qqbot.voice.semanticJudge': { type: 'boolean', title: '语义判定是否说语音', 'x-hot': false, description: '开启后通过 LLM 判断用户是否想听语音（对齐 qq_bot _judge_voice）；关闭则仅当用户显式要求时才说语音。' },
  'worlds.qqbot.voice.audioFallback': { type: 'boolean', title: 'ASR 失败回退音频', 'x-hot': false, description: 'ASR 取不到文字时，把音频作为 blob 丢给多模态模型听（需模型支持 audio/wav）。' },
  'worlds.qqbot.voice.judgeModel': { type: 'string', title: '语义判定模型', 'x-hot': false, description: '判定“是否说语音”用的轻量 chat 模型（OpenAI 兼容端点）。' },
  'worlds.qqbot.voice.voiceBaseUrl': { type: 'string', title: '语音模型网址', 'x-hot': false, description: '选 custom / local 供应商时必填：OpenAI 兼容音频端点基址。远程如 https://open.bigmodel.cn/api/paas/v4 或 https://api.openai.com/v1；本地如 http://localhost:8000/v1（VoxCPM2 经 vLLM-Omni）。ASR 走 {网址}/audio/transcriptions，TTS 走 {网址}/audio/speech。' },
  'worlds.qqbot.voice.voiceApiKeySecret': { type: 'string', title: '语音 API Key 变量', 'x-hot': false, description: 'custom 供应商 API Key 所在的环境变量名（密钥在控制台密钥库填写，默认 VOICE_API_KEY）。local 供应商免 API Key，留空即可。' },
  'worlds.qqbot.voice.voiceVoice': { type: 'string', title: '音色', 'x-hot': false, description: '仅当所选语音模型支持音色时填写（如 tongtong）；留空使用服务商默认音色。' },
  'worlds.qqbot.voice.voiceTtsModel': { type: 'string', title: 'TTS 模型名', 'x-hot': false, description: '语音合成模型名（OpenAI 兼容 /audio/speech 用，缺省 tts-1；GLM 用 glm-tts；VoxCPM2 一般为 openbmb/VoxCPM2）。' },
  'worlds.qqbot.voice.voiceTimeout': { type: 'integer', title: 'TTS 请求超时(秒)', minimum: 1, maximum: 1800, 'x-hot': false, description: 'TTS 单次请求最长等待秒数（默认 120）。本地模型推理慢可调大，超时则回退。custom 与 local 共用。ASR 识别超时单独在「语音识别」配置组设置。' },
  'worlds.qqbot.voice.voiceExtraTts': { type: 'string', title: 'TTS 额外参数(JSON)', 'x-hot': false, description: '合并进 /audio/speech 请求体的额外 JSON，用于本地模型高级特性：如 VoxCPM2 声音克隆传 {"reference_audio":"<音频url或base64>"}, 或声音设计传 {"voice_design":"一个温柔的少年音"}。留空 {} 表示无。' },
  'worlds.qqbot.voice.voxcpmUrl': { type: 'string', title: 'VoxCPM 服务地址', 'x-hot': false, description: '选 voxcpm 供应商时必填：本地 VoxCPM2 TTS 服务基址，如 http://127.0.0.1:8765。服务暴露 GET /health（就绪返回 {"ready":true,"state":"ready"}）与 POST /tts（返回 48kHz WAV）。' },
  'worlds.qqbot.voice.voxcpmVoiceDesc': { type: 'string', title: 'VoxCPM 音色描述', 'x-hot': false, description: 'VoxCPM2 说话人音色（自然语言描述），如「温柔女声」「温柔御姐音」。' },
  'worlds.qqbot.voice.voxcpmSpeed': { type: 'number', title: 'VoxCPM 语速', minimum: 0.5, maximum: 2, 'x-hot': false, description: 'VoxCPM2 合成语速（0.5~2，默认 1.0）。' },
  'worlds.qqbot.voice.voxcpmTimesteps': { type: 'integer', title: 'VoxCPM 推理步数', minimum: 1, maximum: 50, 'x-hot': false, description: 'VoxCPM2 推理步数（越小越快越夸张，默认 10）。' },
  'worlds.qqbot.voice.voxcpmSeed': { type: 'integer', title: 'VoxCPM 随机种子', minimum: 0, maximum: 2147483647, 'x-hot': false, description: 'VoxCPM2 随机种子（0=随机，>0 固定音色/韵律可复现）。' },
  },
  },
  };

/** 语音通话（模拟）配置组：基于语音消息的"打电话"会话 */
export const QQ_CALL_GROUP: ConfigGroup = {
  id: 'world:qqbot-call',
  owner: 'world:qqbot',
  schema: {
    type: 'object',
    title: '语音通话（模拟）',
    description: '用 QQ 语音消息模拟"打电话"：触发词接听、即时听说、分句流式语音。注：OneBot/NapCat 无法真正接听系统级 QQ 电话，此为语音消息会话模拟。',
    properties: {
    'worlds.qqbot.call.enabled': { type: 'boolean', title: '启用语音通话', 'x-hot': true, description: '模拟模式响应完整触发指令；系统模式只接听真实 QQ 来电。' },
    'worlds.qqbot.call.triggerWords': { type: 'string', title: '来电触发词', 'x-hot': true, description: '仅模拟模式生效，逗号分隔，整条消息须与其中一项相同（忽略大小写和首尾空格）。例如：打电话,语音通话,call me。普通聊天提到这些词仍按聊天处理；受发送限制时也保留消息。' },
    'worlds.qqbot.call.hangupWords': { type: 'string', title: '挂断词', 'x-hot': true, description: '逗号分隔。通话中收到这些词即挂断。例如：挂电话,再见,拜拜。' },
    'worlds.qqbot.call.greeting': { type: 'string', title: '接听招呼语', 'x-hot': true, description: '接听后第一句语音。留空则由 AI 根据当前情境自动生成开场白（不写死）；填了就用固定文案。' },
    'worlds.qqbot.call.farewell': { type: 'string', title: '挂断告别语', 'x-hot': true, description: '挂断时最后一句语音。留空则由 AI 自动生成告别语；填了就用固定文案。' },
    'worlds.qqbot.call.notReadyText': { type: 'string', title: '未就绪文案', 'x-hot': true, description: '本地语音模型（ASR/TTS）未就绪时，拒绝来电的回复文案。' },
    'worlds.qqbot.call.idleTimeoutSec': { type: 'integer', title: '闲置自动挂断(秒)', minimum: 0, maximum: 86400, 'x-hot': true, description: '通话中多久没有新语音/文字则自动挂断。0=不自动挂断。' },
    'worlds.qqbot.call.forceVoice': { type: 'boolean', title: '强制语音回复', 'x-hot': true, description: '通话中是否始终用语音回复（true=像打电话一样只说话）。' },
    'worlds.qqbot.call.streamChunks': { type: 'boolean', title: '分句流式发送', 'x-hot': true, description: '把回复拆成句子，逐句合成逐句发送，降低首字延迟、更像实时通话。' },
    'worlds.qqbot.call.chunkGapMs': { type: 'integer', title: '分句间隔(毫秒)', minimum: 0, maximum: 2000, 'x-hot': true, description: '分句语音之间的发送间隔。' },
    'worlds.qqbot.call.loadingText': { type: 'string', title: '接通中提示', 'x-hot': true, description: '本地语音模型尚未就绪（正在初始化/加载）时，先发的"正在接通"提示文案。留空用默认「喂？稍等，我正在接通…」。' },
    'worlds.qqbot.call.initTimeoutSec': { type: 'integer', title: '接听前等待(秒)', minimum: 0, maximum: 1800, 'x-hot': true, description: '来电后若语音模型未就绪，等待其初始化完成再接听的最长秒数。0=不等待（未就绪直接婉拒）。超时仍未就绪则发"未就绪文案"。' },
    'worlds.qqbot.call.mode': {
      type: 'string', title: '通话模式', enum: ['simulated', 'system'], 'x-hot': true,
      description: 'simulated=聊天触发语音消息会话；system=接听真实 QQ 来电，需要运行本机音频桥、配置 QQ 通话音频设备，并匹配私聊白名单。暂停时不接听。',
    },
    'worlds.qqbot.call.answerMethod': {
      type: 'string', title: '系统级接听手段', enum: ['liteloader', 'cua', 'auto'], 'x-hot': true,
      description: '仅 mode=system 生效：auto/cua=通过本机桥的 Windows 可访问控件接听；liteloader 尚未接入，不会自动接听。QQ 麦克风需选 CABLE Output；不修改 Windows 默认音频设备。',
    },
    'worlds.qqbot.call.bridgeUrl': {
      type: 'string', title: '音频桥地址', 'x-hot': true,
      description: 'system 模式专用：call_bridge.py 的 HTTP 地址。TTS 经它喂给 CABLE Input（QQ 麦克风选 CABLE Output 即采到），对方声音经它从 WASAPI Loopback 抓取。默认 http://127.0.0.1:8799。',
    },
    'worlds.qqbot.call.bridgeScript': {
      type: 'string', title: '音频桥脚本路径', 'x-hot': true,
      description: 'call_bridge.py 的绝对路径。留空则自动按"扩展目录向上回溯"在 audio_bridge_poc/ 等常见布局查找；找不到时需在此显式指定，否则 system 模式不会自动拉起桥（将静默跳过自愈）。',
    },
    'worlds.qqbot.call.bridgePython': {
      type: 'string', title: '音频桥 Python 解释器', 'x-hot': true,
      description: '运行 call_bridge.py 的 python 路径（建议指向含 comtypes/pyaudio 的 venv，如 venv_vox/Scripts/python.exe；Linux 使用 bin/python3 或 bin/python）。留空则自动回溯 venv_vox，再回退 PATH 上的 python。',
    },
    },
  },
};


/** 语音识别（ASR）共享配置组：语音收发（收语音）用同一套识别引擎，只在此处配置一次。 */
export const QQ_ASR_GROUP: ConfigGroup = {
  id: 'world:qqbot-asr',
  owner: 'world:qqbot',
  schema: {
    type: 'object',
    title: '语音识别（ASR 共享）',
    description: '语音收发（收语音）用同一套识别引擎，只在此处配置一次。默认 local + funasr（SenseVoiceSmall，中文更准，自动从 ModelScope 下载）；可切 228MB 的 sherpa-onnx 版（int8 量化，更省内存更快，已接入）——先在控制台「语音模型」面板点「下载」拉取模型，再切引擎。改完需重启生效。',
    properties: {
    'worlds.qqbot.asr.mode': {
      type: 'string', title: 'ASR 模式', enum: ['off', 'cloud', 'local'], 'x-hot': true,
      description: "'off'=关闭实时听写（仅单向播报，听不到对方）；'cloud'=远程 OpenAI 兼容转写端点；'local'=本地侧车（默认 funasr，由扩展自动拉起）。",
    },
    'worlds.qqbot.asr.localEngine': {
      type: 'string', title: '本地 ASR 引擎', 'x-hot': true,
      description: 'funasr（默认，SenseVoiceSmall，自动从 ModelScope 下载）；sherpaOnnx（228MB int8 量化版，省内存更快，已支持）。sherpaOnnx 需先在控制台「语音模型」面板点「下载」（从 ModelScope xiaowangge/sherpa-onnx-sense-voice-small 取 model_q8.onnx + tokens.txt），或手动在 asr.localModelPath 指向含二者的目录。新增引擎只需在侧车 load_engine 加分支，无需改此处类型。',
    },
    'worlds.qqbot.asr.localModelPath': {
      type: 'string', title: '本地模型路径', 'x-hot': true,
      description: '本地 ASR 模型/权重目录绝对路径。funasr/sherpaOnnx 留空则默认 <扩展>/models/<模型名>（sherpaOnnx 默认 sherpa-onnx-sense-voice，需先下载）；填了则以指定目录优先。vosk/fasterWhisper 等需本地目录的引擎必须填。',
    },
    'worlds.qqbot.asr.localVenv': {
      type: 'string', title: '本地依赖 venv 路径', 'x-hot': true,
      description: '装了 ASR 依赖的虚拟环境目录绝对路径；空=自动探测 <扩展>/venv_vox。',
    },
    'worlds.qqbot.asr.localPort': {
      type: 'number', title: '本地侧车端口', 'x-hot': true,
      description: 'asr.mode=local 时由本扩展拉起 asr_sidecar.py 监听此端口（默认 8778）。',
    },
    'worlds.qqbot.asr.cloudUrl': {
      type: 'string', title: '云端 ASR 网址', 'x-hot': true,
      description: 'OpenAI 兼容转写端点基址（POST {url}/asr 或 /audio/transcriptions 收音频→{text}）。asr.mode=cloud 时填。',
    },
    'worlds.qqbot.asr.cloudApiKeySecret': {
      type: 'string', title: '云端 ASR 密钥变量名', 'x-hot': true,
      description: 'API Key 的环境变量名；实际密钥在控制台「密钥库」填写。留空=不带鉴权头（本地/免密服务）。',
    },
    'worlds.qqbot.asr.cloudModel': {
      type: 'string', title: '云端 ASR 模型名', 'x-hot': true,
      description: '智谱 GLM 用 glm-asr-2512；OpenAI 用 whisper-1。',
    },
    'worlds.qqbot.asr.cloudFormat': {
      type: 'string', title: '通话 ASR 接口格式', enum: ['openai', 'wav'], 'x-hot': false,
      description: 'openai=向填写的完整端点发送 multipart；wav=向填写的基址加 /asr 发送 WAV，用于本机语音识别服务。',
    },
    'worlds.qqbot.asr.ffmpegPath': {
      type: 'string', title: 'ffmpeg 路径', 'x-hot': false,
      description: '解码语音用的 ffmpeg 可执行文件路径（把 SILK/AMR 解码成 WAV 送识别）。空=依次找 PATH 与仓库 node_modules/ffmpeg-static（win 用 ffmpeg.exe）。',
    },
    'worlds.qqbot.asr.transcribeTimeout': {
      type: 'integer', title: '识别超时(毫秒)', minimum: 1000, maximum: 600000, 'x-hot': false,
      description: '单次识别（ffmpeg 解码 + /asr 请求）最长等待毫秒数（默认 60000）。超时回退文字。',
    },
    },
  },
};

/** worlds.qqbot.voxcpmSidecar —— VoxCPM 侧车自拉起（仅在 provider=voxcpm 且无其它进程管理侧车时开启）。 */
export const QQ_VOXCPM_SIDECAR_GROUP: ConfigGroup = {
  id: 'world:qqbot-voxcpm-sidecar',
  owner: 'world:qqbot',
  schema: {
    type: 'object',
    title: 'QQ·VoxCPM 侧车自拉起',
    description: 'provider=voxcpm 且本机没有常驻 vox_tts_server.py 时，由本扩展负责拉起独立 venv_vox 子进程（与 fat-fish 主 bot 的 tts_vox 守护二选一，避免重复抢显存）。',
    properties: {
    'worlds.qqbot.voxcpmSidecar.enabled': { type: 'boolean', title: '自动拉起侧车', 'x-hot': true, description: '是否由本扩展自动拉起 voxcpm 侧车子进程。仅在确认没有别的进程管理侧车时开启，否则会与其它拉起者抢显存/端口。' },
    'worlds.qqbot.voxcpmSidecar.python': { type: 'string', title: 'Python 解释器', 'x-hot': true, description: 'venv_vox 的 python 解释器绝对路径；留空=由"虚拟环境目录"推导，再退化为 <vox_tts_server.py 所在目录>/venv_vox 下的平台解释器。' },
    'worlds.qqbot.voxcpmSidecar.venv': { type: 'string', title: '虚拟环境目录', 'x-hot': true, description: '虚拟环境（venv）目录绝对路径。指定后从中推导 <venv>/Scripts/python.exe（Windows）或 <venv>/bin/python3、bin/python（Linux） 来拉起侧车；留空则自动探测 <扩展>/venv_vox 或 <扩展>/venv。' },
    'worlds.qqbot.voxcpmSidecar.script': { type: 'string', title: '侧车脚本', 'x-hot': true, description: 'vox_tts_server.py 绝对路径；本扩展不内置该脚本（来自 fat-fish qq_bot 运行时），请显式指定；留空=按"扩展目录向上回溯到 qq_bot / Fat-Fish / feiyu_standalone"这一常见布局相对探测。' },
    'worlds.qqbot.voxcpmSidecar.modelDir': { type: 'string', title: '权重目录', 'x-hot': true, description: 'VOXCPM 权重目录（model.safetensors 所在）；留空=优先进程环境变量 VOXCPM_MODEL_DIR，否则 <脚本目录>/models/VoxCPM2。' },
    'worlds.qqbot.voxcpmSidecar.ffmpeg': { type: 'string', title: 'FFmpeg 路径', 'x-hot': true, description: 'VOXCPM_FFMPEG 路径；留空=不设置（侧车自行找 ffmpeg）。' },
    'worlds.qqbot.voxcpmSidecar.logFile': { type: 'string', title: '日志文件', 'x-hot': true, description: '侧车 stdout/stderr 日志文件绝对路径；留空时优先使用扩展数据目录下的 vox_tts_server.log，没有数据目录时回退脚本目录。' },
    'worlds.qqbot.voxcpmSidecar.startupTimeoutSec': { type: 'integer', title: '启动等待(秒)', minimum: 0, maximum: 1800, 'x-hot': true, description: '拉起后等待 /health 变 ready（模型加载完）的最长秒数，首启常需 2~4 分钟，默认 240。' },
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
  if (typeof p.systemPrompt !== 'string' || !p.systemPrompt) p.systemPrompt = QQ_DEFAULTS.proactive.systemPrompt;
  if (typeof p.endpoint !== 'string' || !p.endpoint) p.endpoint = QQ_DEFAULTS.proactive.endpoint;
  if (typeof p.apiKeySecret !== 'string' || !p.apiKeySecret) p.apiKeySecret = QQ_DEFAULTS.proactive.apiKeySecret;
  if (typeof p.model !== 'string' || !p.model) p.model = QQ_DEFAULTS.proactive.model;
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
  if (typeof p.topicSimilarity !== 'number' || (p.topicSimilarity as number) < 0 || (p.topicSimilarity as number) > 1) p.topicSimilarity = QQ_DEFAULTS.proactive.topicSimilarity;
  if (typeof p.tokenLimit !== 'number' || (p.tokenLimit as number) < 50) p.tokenLimit = QQ_DEFAULTS.proactive.tokenLimit;
  if (typeof p.withNickname !== 'boolean') p.withNickname = QQ_DEFAULTS.proactive.withNickname;
  for (const key of ['quietFrom', 'quietTo'] as const) {
    if (!Number.isInteger(p[key]) || Number(p[key]) < 0 || Number(p[key]) > 23) p[key] = QQ_DEFAULTS.proactive[key];
  }
  // qzone 子对象原地合并
  c.qzone = c.qzone && typeof c.qzone === 'object' ? c.qzone : {...QQ_DEFAULTS.qzone};
  Object.assign(c.qzone, { ...QQ_DEFAULTS.qzone, ...(c.qzone as unknown as Record<string, unknown>) });
  const q = c.qzone as unknown as Record<string, unknown>;
  if (typeof q.enabled !== 'boolean') q.enabled = false;
  if (typeof q.systemPrompt !== 'string' || !q.systemPrompt) q.systemPrompt = QQ_DEFAULTS.qzone.systemPrompt;
  if (typeof q.endpoint !== 'string' || !q.endpoint) q.endpoint = QQ_DEFAULTS.qzone.endpoint;
  if (typeof q.apiKeySecret !== 'string' || !q.apiKeySecret) q.apiKeySecret = QQ_DEFAULTS.qzone.apiKeySecret;
  if (typeof q.model !== 'string' || !q.model) q.model = QQ_DEFAULTS.qzone.model;
  if (typeof q.tickSec !== 'number') q.tickSec = QQ_DEFAULTS.qzone.tickSec;
  if (typeof q.chancePerTick !== 'number') q.chancePerTick = QQ_DEFAULTS.qzone.chancePerTick;
  if (typeof q.dailyQuota !== 'number') q.dailyQuota = QQ_DEFAULTS.qzone.dailyQuota;
  if (typeof q.permission !== 'number') q.permission = QQ_DEFAULTS.qzone.permission;
  if (q.imageMode !== 'none' && q.imageMode !== 'recent') q.imageMode = 'none' as const;
  const ar = (q.autoReplyComments ??= {}) as Record<string, unknown>;
  Object.assign(ar, { ...QQ_DEFAULTS.qzone.autoReplyComments, ...ar });
  if (typeof ar.enabled !== 'boolean') ar.enabled = false;
  if (typeof ar.systemPrompt !== 'string' || !ar.systemPrompt) ar.systemPrompt = QQ_DEFAULTS.qzone.autoReplyComments.systemPrompt;
  if (typeof ar.dailyQuota !== 'number') ar.dailyQuota = QQ_DEFAULTS.qzone.autoReplyComments.dailyQuota;
  if (typeof ar.cooldownSec !== 'number') ar.cooldownSec = QQ_DEFAULTS.qzone.autoReplyComments.cooldownSec;
  if (typeof q.commentAction !== 'string' || !q.commentAction) q.commentAction = QQ_DEFAULTS.qzone.commentAction;
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
  // emotion 子对象原地合并
  c.emotion = c.emotion ?? {};
  Object.assign(c.emotion, { ...QQ_DEFAULTS.emotion, ...(c.emotion as object) });
  const em = c.emotion as Record<string, unknown>;
  if (typeof em.enabled !== 'boolean') em.enabled = true;
  if (typeof em.endpoint !== 'string' || !em.endpoint) em.endpoint = QQ_DEFAULTS.emotion.endpoint;
  if (typeof em.apiKeySecret !== 'string' || !em.apiKeySecret) em.apiKeySecret = QQ_DEFAULTS.emotion.apiKeySecret;
  if (typeof em.model !== 'string' || !em.model) em.model = QQ_DEFAULTS.emotion.model;
  if (typeof em.decayHours !== 'number' || (em.decayHours as number) <= 0) em.decayHours = QQ_DEFAULTS.emotion.decayHours;
  if (typeof em.labelMinutes !== 'number' || (em.labelMinutes as number) < 0) em.labelMinutes = QQ_DEFAULTS.emotion.labelMinutes;
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
  // affinity 子对象原地合并
  c.affinity = c.affinity && typeof c.affinity === 'object' ? c.affinity : {...QQ_DEFAULTS.affinity};
  Object.assign(c.affinity, { ...QQ_DEFAULTS.affinity, ...(c.affinity as object) });
  const af = c.affinity as Record<string, unknown>;
  if (typeof af.enabled !== 'boolean') af.enabled = true;
  // voice 子对象原地合并
  c.voice = c.voice && typeof c.voice === 'object' ? c.voice : {...QQ_DEFAULTS.voice};
  Object.assign(c.voice, { ...QQ_DEFAULTS.voice, ...(c.voice as object) });
  const vc = c.voice as Record<string, unknown>;
  if (typeof vc.enabled !== 'boolean') vc.enabled = false;
  if (!voiceProviderIds().includes(vc.provider as string)) vc.provider = 'native';
  if (typeof vc.asr !== 'boolean') vc.asr = true;
  if (typeof vc.tts !== 'boolean') vc.tts = true;
  if (typeof vc.semanticJudge !== 'boolean') vc.semanticJudge = true;
  if (typeof vc.audioFallback !== 'boolean') vc.audioFallback = true;
  if (typeof vc.judgeEndpoint !== 'string' || !vc.judgeEndpoint) vc.judgeEndpoint = QQ_DEFAULTS.voice.judgeEndpoint;
  if (typeof vc.judgeApiKeySecret !== 'string' || !vc.judgeApiKeySecret) vc.judgeApiKeySecret = QQ_DEFAULTS.voice.judgeApiKeySecret;
  if (typeof vc.judgeModel !== 'string' || !vc.judgeModel) vc.judgeModel = QQ_DEFAULTS.voice.judgeModel;
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
  // asr 子对象原地合并（语音收发与语音通话共用的识别配置）
  c.asr = c.asr && typeof c.asr === 'object' ? c.asr : {...QQ_DEFAULTS.asr};
  Object.assign(c.asr, { ...QQ_DEFAULTS.asr, ...(c.asr as object) });
  const ac = c.asr as unknown as Record<string, unknown>;
  if (!['off', 'cloud', 'local'].includes(ac.mode as string)) ac.mode = 'local';
  if (typeof ac.localEngine !== 'string' || !ac.localEngine) ac.localEngine = 'funasr';
  if (typeof ac.localModelPath !== 'string') ac.localModelPath = '';
  if (typeof ac.localVenv !== 'string') ac.localVenv = '';
  if (typeof ac.localPort !== 'number' || (ac.localPort as number) <= 0) ac.localPort = 8778;
  if (typeof ac.cloudUrl !== 'string') ac.cloudUrl = '';
  if (typeof ac.cloudApiKeySecret !== 'string') ac.cloudApiKeySecret = 'ASR_API_KEY';
  if (typeof ac.cloudModel !== 'string' || !(ac.cloudModel as string).trim()) ac.cloudModel = 'glm-asr-2512';
  if (ac.cloudFormat !== 'wav') ac.cloudFormat = 'openai';
  if (typeof ac.ffmpegPath !== 'string') ac.ffmpegPath = '';
  if (typeof ac.transcribeTimeout !== 'number' || (ac.transcribeTimeout as number) < 1000) ac.transcribeTimeout = 60000;
  // call 子对象原地合并
  const call = (c.call && typeof c.call === 'object' ? c.call : {}) as QQCallConfig;
  Object.assign(call, { ...QQ_DEFAULTS.call, ...(call as object) });
  const ca = call as unknown as Record<string, unknown>;
  if (typeof ca.enabled !== 'boolean') ca.enabled = false;
  if (typeof ca.triggerWords !== 'string' || !ca.triggerWords) ca.triggerWords = QQ_DEFAULTS.call.triggerWords;
  if (typeof ca.hangupWords !== 'string' || !ca.hangupWords) ca.hangupWords = QQ_DEFAULTS.call.hangupWords;
  if (typeof ca.greeting !== 'string') ca.greeting = QQ_DEFAULTS.call.greeting;
  if (typeof ca.farewell !== 'string') ca.farewell = QQ_DEFAULTS.call.farewell;
  if (typeof ca.notReadyText !== 'string') ca.notReadyText = QQ_DEFAULTS.call.notReadyText;
  if (typeof ca.idleTimeoutSec !== 'number' || (ca.idleTimeoutSec as number) < 0) ca.idleTimeoutSec = QQ_DEFAULTS.call.idleTimeoutSec;
  if (typeof ca.forceVoice !== 'boolean') ca.forceVoice = true;
  if (typeof ca.streamChunks !== 'boolean') ca.streamChunks = true;
  if (typeof ca.chunkGapMs !== 'number' || (ca.chunkGapMs as number) < 0) ca.chunkGapMs = QQ_DEFAULTS.call.chunkGapMs;
  if (typeof ca.loadingText !== 'string') ca.loadingText = QQ_DEFAULTS.call.loadingText;
  if (typeof ca.initTimeoutSec !== 'number' || (ca.initTimeoutSec as number) < 0) ca.initTimeoutSec = QQ_DEFAULTS.call.initTimeoutSec;
  if (ca.mode !== 'simulated' && ca.mode !== 'system') ca.mode = 'simulated';
  if (!['liteloader', 'cua', 'auto'].includes(ca.answerMethod as string)) ca.answerMethod = 'auto';
  if (typeof ca.bridgeUrl !== 'string' || !ca.bridgeUrl) ca.bridgeUrl = 'http://127.0.0.1:8799';
  if (typeof ca.bridgeScript !== 'string') ca.bridgeScript = '';
  if (typeof ca.bridgePython !== 'string') ca.bridgePython = '';
  c.call = call;
  // voxcpmSidecar 子对象原地合并：先摊平默认，再被用户配置覆盖（模式同 voice/routine）
  const sc = c.voxcpmSidecar && typeof c.voxcpmSidecar === 'object' ? (c.voxcpmSidecar as Record<string, unknown>) : {};
  if (typeof sc.enabled !== 'boolean') sc.enabled = QQ_DEFAULTS.voxcpmSidecar.enabled;
  if (typeof sc.venv !== 'string') sc.venv = QQ_DEFAULTS.voxcpmSidecar.venv;
  if (typeof sc.python !== 'string') sc.python = QQ_DEFAULTS.voxcpmSidecar.python;
  if (typeof sc.script !== 'string') sc.script = QQ_DEFAULTS.voxcpmSidecar.script;
  if (typeof sc.modelDir !== 'string') sc.modelDir = QQ_DEFAULTS.voxcpmSidecar.modelDir;
  if (typeof sc.ffmpeg !== 'string') sc.ffmpeg = QQ_DEFAULTS.voxcpmSidecar.ffmpeg;
  if (typeof sc.logFile !== 'string') sc.logFile = QQ_DEFAULTS.voxcpmSidecar.logFile;
  if (typeof sc.startupTimeoutSec !== 'number' || (sc.startupTimeoutSec as number) < 0) sc.startupTimeoutSec = QQ_DEFAULTS.voxcpmSidecar.startupTimeoutSec;
  c.voxcpmSidecar = sc as typeof QQ_DEFAULTS.voxcpmSidecar;
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
