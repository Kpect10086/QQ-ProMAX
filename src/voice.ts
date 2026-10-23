/**
 * QQ 语音收发模块。
 *
 * 语音供应商（仅负责 TTS 发 + 收语音回退）通过「注册表」动态挂载，不写死具体实现：
 *  - 当前内置：native（OneBot 原生 translate_record / tts，零依赖开箱即用）、
 *    custom（远程 OpenAI 兼容 TTS 端点，需 API Key）、
 *    local（本地/自建 TTS 模型，OpenAI 兼容、免 Key、慢推理可加超时）、
 *    voxcpm（本地 VoxCPM2 TTS 服务）。
 *  - 注意：ASR（语音识别）已统一到顶层「语音识别（asr）」配置，由侧车 /asr 提供，
 *    供应商的 transcribe 仅作为 asr.mode=off 时的回退（统一走 native translate_record），
 *    不再各自维护一套 ASR 配置。
 *  - 新增第三方供应商只要在下方 registerVoiceProvider(...) 注册一个实现对象即可，
 *    收/发入口（transcribeRecord / synthesizeVoice / checkVoiceDeps）无需改动。
 *  语义判定（judgeVoiceWish）决定本次回复是否用语音，是独立的触发开关，不属于供应商。
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/** 精简的 driver 能力（只需 callApi）。 */
export interface VoiceDriver {
  callApi<T = unknown>(action: string, params: Record<string, unknown>): Promise<T>;
}
export interface VoiceLog {
  info: (m: string, e?: unknown) => void;
  warn: (m: string, e?: unknown) => void;
}
/** 运行时语音配置（已由 world 解析好密钥）。provider 为供应商 id（字符串，不写死枚举）。 */
export interface RuntimeVoiceCfg {
  enabled: boolean;
  provider: string;
  asr: boolean;
  tts: boolean;
  semanticJudge: boolean;
  audioFallback: boolean;
  judgeEndpoint: string;
  judgeApiKey: string;
  judgeModel: string;
  /** 自定义(custom)供应商的 OpenAI 兼容音频端点基址，如 https://open.bigmodel.cn/api/paas/v4 或 https://api.openai.com/v1。 */
  voiceBaseUrl: string;
  /** custom 供应商的 API Key（已解析）。 */
  voiceApiKey: string;
  /** custom 供应商的音色/声音名（仅当所选模型支持时填写，如 tongtong）。 */
  voiceVoice: string;
  /** custom 供应商的 TTS 模型名（OpenAI 兼容 /audio/speech 用，缺省 tts-1）。 */
  voiceTtsModel: string;
  /** 语音请求超时（毫秒）：TTS/ASR 单次请求最长等待。本地推理慢可调大，custom 与 local 共用。 */
  voiceTimeout: number;
  /** TTS 额外参数（合并进 /audio/speech 的 JSON body），用于本地模型高级特性（如 VoxCPM2 的 reference_audio / voice_design / language）。 */
  voiceExtraTts: Record<string, unknown>;
  /** 专用识别服务地址：POST {url}/asr 收 WAV 字节 → {text}。QQ SILK 优先由 OneBot 转码，普通音频回退 ffmpeg。 */
  transcribeUrl: string;
  /** 识别服务单次超时（毫秒）。 */
  transcribeTimeout: number;
  /** ffmpeg 候选路径（按 配置 → PATH → 仓库 ffmpeg-static 顺序尝试），用于把支持的音频格式解码成 WAV。 */
  ffmpegCandidates: string[];
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
}

/** 一段 record 语音（合成后返回，由 world 负责发送）。 */
export interface RecordSeg {
  type: 'record';
  data: { file: string };
}

/** 收语音的上下文。 */
export interface VoiceTranscribeCtx {
  seg: { type: string; data?: { url?: string; file?: string } };
  messageId: number | undefined;
  driver: VoiceDriver;
  cfg: RuntimeVoiceCfg;
  log: VoiceLog;
}
/** 发语音的上下文。 */
export interface VoiceSynthCtx {
  text: string;
  address: string;
  driver: VoiceDriver;
  cfg: RuntimeVoiceCfg;
  log: VoiceLog;
}

/**
 * 语音供应商接口：一种 ASR(收)+TTS(发) 实现。
 * 通过 registerVoiceProvider 挂到注册表，收/发入口按 cfg.provider 查表分发。
 */
export interface VoiceProvider {
  /** 唯一 id，与控制台 provider 选择一致。 */
  id: string;
  /** 收：把一条 record 段转成文字；返回 null 表示无可用文字（调用方回退音频 blob 或文字）。 */
  transcribe(ctx: VoiceTranscribeCtx): Promise<string | null>;
  /** 发：把文字合成语音 record 段；返回 null 表示合成失败（调用方回退文字）。 */
  synthesize(ctx: VoiceSynthCtx): Promise<RecordSeg | null>;
  /** 依赖自检：返回该供应商是否可用（可选；缺省视为可用）。 */
  checkDeps?(cfg: RuntimeVoiceCfg, log: VoiceLog): boolean;
  /** 就绪自检（可选，异步）：返回该供应商当前是否真正可用（如本地服务探活）。缺省回退到 checkDeps。让语音通话的 isCallReady 等逻辑按"当前选中的供应商"判定，而不是写死具体供应商。 */
  checkReady?(cfg: RuntimeVoiceCfg, log: VoiceLog): Promise<boolean>;
}

const VOICE_PROVIDERS: Record<string, VoiceProvider> = {};

/** 注册一种语音供应商（内置与扩展都走这里，避免写死分支）。 */
export function registerVoiceProvider(p: VoiceProvider): void {
  VOICE_PROVIDERS[p.id] = p;
}
/** 列出已注册供应商 id（供控制台 enum 动态生成，不写死 UI 选项）。 */
export function voiceProviderIds(): string[] {
  return Object.keys(VOICE_PROVIDERS);
}
/** 按 id 取供应商；未知 id 回退 native 并告警。 */
export function getVoiceProvider(id: string, log?: VoiceLog): VoiceProvider {
  const p = VOICE_PROVIDERS[id];
  if (p) return p;
  log?.warn(`[voice] 未知语音供应商 "${id}"，回退到 native`);
  return VOICE_PROVIDERS['native'];
}

/* ------------------------------------------------------------------ *
 * 供应商：native（OneBot 原生 translate_record / tts，零依赖）
 * ------------------------------------------------------------------ */
const nativeProvider: VoiceProvider = {
  id: 'native',
  async transcribe({ seg, messageId, driver, log }: VoiceTranscribeCtx): Promise<string | null> {
    try {
      const params: Record<string, unknown> = {};
      if (messageId != null) params.message_id = messageId;
      else if (seg?.data?.url) params.url = seg.data.url;
      const r: any = await driver.callApi('translate_record', params);
      const t = typeof r === 'string' ? r : r?.text ?? r?.data?.text;
      if (t && String(t).trim()) return String(t).trim();
    } catch (e) {
      log.warn('[voice] translate_record 失败，回退', String(e));
    }
    return null;
  },
  async synthesize({ text, address, driver, log }: VoiceSynthCtx): Promise<RecordSeg | null> {
    try {
      const [kind, idStr] = address.split(':');
      const params: Record<string, unknown> = { text };
      if (kind === 'group') params.group_id = Number(idStr);
      else params.user_id = Number(idStr);
      const r: any = await driver.callApi('tts', params);
      const file = r?.file ?? r?.data?.file ?? (typeof r === 'string' ? r : null);
      if (file) return { type: 'record', data: { file: String(file) } };
    } catch (e) {
      log.warn('[voice] tts 失败，回退文字', String(e));
    }
    return null;
  },
};

// 注册内置供应商（顺序即默认回退链）。
registerVoiceProvider(nativeProvider);

/**
 * 把一段文本按句末标点切成句子，用于语音流式逐句合成/发送。
 * 以中文 。！？；… 与英文 .!? 及换行切分；过滤空串；整段无标点则整体作为一句。
 */
export function splitIntoSentences(text: string): string[] {
  const norm = (text ?? '').replace(/\r/g, '').replace(/[ \t ]+/g, ' ');
  const parts = norm.split(/(?<=[。！？!?；;…\n])/);
  const out: string[] = [];
  for (const p of parts) {
    const s = p.trim();
    if (s) out.push(s);
  }
  if (out.length === 0 && norm.trim()) out.push(norm.trim());
  return out;
}

/* ------------------------------------------------------------------ *
 * OpenAI 兼容音频端点（custom / local 共用）：
 *  - ASR：POST {baseUrl}/audio/transcriptions（form-data: file + model + 额外参数）
 *  - TTS：POST {baseUrl}/audio/speech（JSON: model + voice + input + 额外参数）
 *  - 与具体厂商无关：OpenAI / GLM / 自建兼容服务只要实现该接口即可。
 * ------------------------------------------------------------------ */
async function fetchBytes(url: string, timeoutMs: number): Promise<Buffer | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** OpenAI 兼容 TTS。requireKey=false 时允许免 Key（本地服务）。extra 合并进请求体。 */
async function openAiSynthesize(
  ctx: VoiceSynthCtx,
  opts: { requireKey: boolean; extra: Record<string, unknown> },
): Promise<RecordSeg | null> {
  const { cfg, text, log } = ctx;
  if (!cfg.voiceBaseUrl) {
    log.warn('[voice] 未配置语音模型网址，回退');
    return null;
  }
  if (opts.requireKey && !cfg.voiceApiKey) {
    log.warn('[voice] 该供应商需配置「API Key」，回退');
    return null;
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.voiceApiKey) headers.Authorization = `Bearer ${cfg.voiceApiKey}`;
  const body = {
    model: cfg.voiceTtsModel || 'tts-1',
    voice: cfg.voiceVoice || '',
    input: text,
    ...opts.extra,
  };
  try {
    const resp = await fetch(`${cfg.voiceBaseUrl}/audio/speech`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.voiceTimeout),
    });
    if (!resp.ok) throw new Error(`TTS HTTP ${resp.status}`);
    const audio = Buffer.from(await resp.arrayBuffer());
    if (!resp.headers.get('content-type')?.startsWith('audio/') || !audio.length) throw new Error('TTS returned no audio');
    // 以 base64 内嵌，避免依赖 NapCat 读取本机临时目录（本地绝对路径常被拒收导致「API failed」）。
    return { type: 'record', data: { file: `base64://${audio.toString('base64')}` } };
  } catch (e) {
    log.warn('[voice] TTS 失败', String(e));
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * 供应商：custom（远程 OpenAI 兼容音频端点，配置页填网址/Key/音色）
 * ------------------------------------------------------------------ */
const customProvider: VoiceProvider = {
  id: 'custom',
  // ASR 已统一到顶层 asr.* 共享引擎（侧车 /asr）；custom 供应商仅做 TTS。收语音回退到 OneBot 原生 translate_record。
  transcribe: (ctx) => nativeProvider.transcribe(ctx),
  synthesize: (ctx) => openAiSynthesize(ctx, { requireKey: true, extra: ctx.cfg.voiceExtraTts }),
  checkDeps(cfg: RuntimeVoiceCfg, log: VoiceLog): boolean {
    if (!cfg.voiceBaseUrl || !cfg.voiceApiKey) {
      log.warn('[voice] custom 供应商需配置「语音模型网址」与「API Key」，否则回退文字');
      return false;
    }
    return true;
  },
};

// 注册 custom 供应商（配置页可切）。
registerVoiceProvider(customProvider);

/* ------------------------------------------------------------------ *
 * 供应商：local（本地/自建模型，OpenAI 兼容音频端点，免 API Key）
 *  - 与 custom 协议相同（/audio/transcriptions + /audio/speech），但：
 *    · 不强制 API Key（本地服务常无需鉴权，留空即不发送 Authorization）；
 *    · 默认「请求超时」更长（voiceTimeout），适配本地推理慢；
 *    · 支持「额外参数 JSON」透传，便于本地模型高级特性
 *      （如 VoxCPM2 经 vLLM-Omni 提供 OpenAI 兼容接口，可在 TTS 额外参数里传
 *        reference_audio / voice_design / language 等做声音克隆或声音设计）。
 *  - 典型用法：vllm serve openbmb/VoxCPM2 --omni --port 8000，
 *    语音模型网址填 http://localhost:8000/v1，实现方式选 local。
 * ------------------------------------------------------------------ */
const localProvider: VoiceProvider = {
  id: 'local',
  // ASR 已统一到顶层 asr.* 共享引擎（侧车 /asr）；local 供应商仅做 TTS（免 Key 本地模型）。收语音回退到 OneBot 原生 translate_record。
  transcribe: (ctx) => nativeProvider.transcribe(ctx),
  synthesize: (ctx) => openAiSynthesize(ctx, { requireKey: false, extra: ctx.cfg.voiceExtraTts }),
  checkDeps(cfg: RuntimeVoiceCfg, log: VoiceLog): boolean {
    if (!cfg.voiceBaseUrl) {
      log.warn('[voice] local 供应商需配置「语音模型网址」（本地服务地址，如 http://localhost:8000/v1），否则回退文字');
      return false;
    }
    return true;
  },
  async checkReady(cfg: RuntimeVoiceCfg): Promise<boolean> {
    if (!cfg.voiceBaseUrl) return false;
    try {
      const res = await fetch(`${cfg.voiceBaseUrl.replace(/\/+$/, '')}/models`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return false;
      const body = await res.json() as { data?: unknown[] };
      return Array.isArray(body.data) && body.data.length > 0;
    } catch { return false; }
  },
};

// 注册 local 供应商（配置页可切）。
registerVoiceProvider(localProvider);

/* ------------------------------------------------------------------ *
 * 供应商：voxcpm（本地 VoxCPM2 TTS 服务，如 Fat-Fish 的 vox_tts_server.py）
 *  - 与 OpenAI 不兼容，走自有接口：
 *      · GET  {url}/health  → {"ready":true,"state":"ready",...}（模型加载完前 ready 为 false）
 *      · POST {url}/tts     → 请求体 {text, voice_desc?, speed?, inference_timesteps?, seed?}
 *                            响应为 48kHz WAV 字节（content-type: audio/wav）
 *  - 仅负责 TTS（本地 VoxCPM2 不含 ASR）：收语音回退到 native 供应商的 translate_record。
 *  - 适合本机已有一份 VoxCPM2 服务、想要稳定中文音色且不想走 vLLM-Omni 的场景。
 * ------------------------------------------------------------------ */
async function voxcpmReady(base: string, timeoutMs: number): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(`${base}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return false;
    const j = (await r.json().catch(() => null)) as { ready?: boolean; state?: string } | null;
    // 侧车契约：就绪时 {"ready": true, "state": "ready", ...}（注意不是 status 字段）。
    return !!j && (j.ready === true || j.state === 'ready');
  } catch {
    return false;
  }
}

async function voxcpmSynthesize(ctx: VoiceSynthCtx): Promise<RecordSeg | null> {
  const { cfg, text, log } = ctx;
  const base = (cfg.voxcpmUrl || '').trim().replace(/\/+$/, '');
  if (!base) {
    log.warn('[voice] voxcpm 供应商未配置「VoxCPM 服务地址(voxcpmUrl)」，回退文字');
    return null;
  }
  // 轻量探活：未就绪（如刚启动还在加载模型）直接回退文字，不阻塞消息。
  if (!(await voxcpmReady(base, 4000))) {
    log.warn('[voice] VoxCPM 服务未就绪（/health 非 ready），回退文字');
    return null;
  }
  const payload: Record<string, unknown> = {
    text,
    voice_desc: cfg.voxcpmVoiceDesc || '自然女声',
    speed: cfg.voxcpmSpeed > 0 ? cfg.voxcpmSpeed : 1.0,
    inference_timesteps: cfg.voxcpmTimesteps > 0 ? cfg.voxcpmTimesteps : 10,
  };
  if (cfg.voxcpmSeed > 0) payload.seed = cfg.voxcpmSeed;
  try {
    const resp = await fetch(`${base}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(cfg.voiceTimeout),
    });
    if (!resp.ok) {
      // 400=文本空；500=合成出错；503=仍未就绪。均回退文字，不阻塞。
      log.warn(`[voice] VoxCPM /tts 返回 ${resp.status}，回退文字`);
      return null;
    }
    const audio = Buffer.from(await resp.arrayBuffer());
    if (!audio.length) { log.warn('[voice] VoxCPM 返回空音频，回退文字'); return null; }
    // 以 base64 内嵌，避免依赖 NapCat 读取本机临时目录（本地绝对路径常被拒收导致「API failed」）。
    return { type: 'record', data: { file: `base64://${audio.toString('base64')}` } };
  } catch (e) {
    log.warn('[voice] VoxCPM TTS 请求失败，回退文字', String(e));
    return null;
  }
}

const voxcpmProvider: VoiceProvider = {
  id: 'voxcpm',
  // 本地 VoxCPM2 服务不含 ASR：收语音回退到 OneBot 原生 translate_record。
  transcribe: (ctx) => nativeProvider.transcribe(ctx),
  synthesize: voxcpmSynthesize,
  checkDeps(cfg: RuntimeVoiceCfg, log: VoiceLog): boolean {
    if (!cfg.voxcpmUrl || !cfg.voxcpmUrl.trim()) {
      log.warn('[voice] voxcpm 供应商需配置「VoxCPM 服务地址(voxcpmUrl)」（如 http://127.0.0.1:8765），否则回退文字');
      return false;
    }
    return true;
  },
  // 本地服务探活：模型加载完前 /health 的 ready 为 false，须等真正 ready。
  async checkReady(cfg: RuntimeVoiceCfg, log: VoiceLog): Promise<boolean> {
    if (!cfg.voxcpmUrl || !cfg.voxcpmUrl.trim()) return false;
    return voxcpmReady(cfg.voxcpmUrl, 4000);
  },
};
registerVoiceProvider(voxcpmProvider);

/* ------------------------------------------------------------------ *
 * 专用识别服务：OneBot 转码 QQ SILK → WAV，普通音频回退 ffmpeg，再 POST {url}/asr
 *  - 与 provider 解耦：配了 transcribeUrl 就优先走这条；QQ 原生 SILK 需要 OneBot 支持转码；
 *    没配则回退到供应商自带 ASR（native 的 translate_record / custom·local 的 OpenAI /audio/transcriptions）。
 *  - 服务契约：POST {transcribeUrl}/asr，请求体为 WAV 字节（content-type: audio/wav），
 *    返回 JSON { text: "..." }。识别失败/超时一律回退，绝不阻塞消息。
 * ------------------------------------------------------------------ */
// 已试通的 ffmpeg（试通一个就记住，免得每条语音都从头试候选）。
let resolvedFfmpeg: string | null = null;
let ffmpegWarned = false;

/** 用 ffmpeg 把语音 url 解码成 16k 单声道 WAV 字节；无可用 ffmpeg 或失败返回 null（best-effort，不阻塞）。 */
function decodeToWav(url: string, candidates: string[], timeoutMs: number): Promise<Uint8Array | null> {
  candidates = [...new Set([...(resolvedFfmpeg ? [resolvedFfmpeg] : []), ...candidates])];
  if (!candidates.length) return Promise.resolve(null);
  const tryOne = (idx: number): Promise<Uint8Array | null> => {
    if (idx >= candidates.length) return Promise.resolve(null);
    const bin = candidates[idx];
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const fail = () => { if (!settled) { settled = true; clearTimeout(timer); void tryOne(idx + 1).then(resolve); } };
      let proc: ReturnType<typeof spawn> | null = null;
      try {
        proc = spawn(bin, ['-y', '-i', url, '-f', 'wav', '-ac', '1', '-ar', '16000', 'pipe:1'], {
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        const chunks: Buffer[] = [];
        proc.stdout?.on('data', (d) => chunks.push(d as Buffer));
        proc.on('error', fail);
        timer = setTimeout(() => { try { proc?.kill(); } catch { /* noop */ } fail(); }, timeoutMs);
        proc.on('close', (code) => {
          clearTimeout(timer);
          if (settled) return;
          if (code === 0 && chunks.length) {
            settled = true;
            resolvedFfmpeg = bin;
            resolve(Buffer.concat(chunks));
          } else fail();
        });
      } catch { fail(); }
    });
  };
  return tryOne(0);
}

/** QQ SILK 由协议端的原生解码器转换；ASR 与音频 blob 回退共用。 */
export async function decodeRecord(
  seg: VoiceTranscribeCtx['seg'], driver: VoiceDriver, cfg: RuntimeVoiceCfg, log: VoiceLog,
): Promise<Uint8Array | null> {
  const file = seg.data?.file || seg.data?.url;
  if (!file) return null;
  try {
    const record = await driver.callApi<{ base64?: string; file?: string; url?: string }>('get_record', { file, out_format: 'wav' });
    const encoded = record.base64 || (record.file?.startsWith('base64://') ? record.file.slice(9) : '');
    if (encoded && encoded.length <= 90_000_000) {
      const wav = Buffer.from(encoded, 'base64');
      if (wav.length > 44 && wav.toString('ascii', 0, 4) === 'RIFF' && wav.toString('ascii', 8, 12) === 'WAVE') return wav;
    }
    const source = record.file?.startsWith('base64://') ? record.url : record.file || record.url;
    if (source) {
      const wav = await decodeToWav(source, cfg.ffmpegCandidates, cfg.transcribeTimeout);
      if (wav) return wav;
    }
  } catch {
    // 部分 OneBot 实现不支持 get_record 转码，保留普通音频的 ffmpeg 路径。
  }
  const wav = await decodeToWav(seg.data?.url || file, cfg.ffmpegCandidates, cfg.transcribeTimeout);
  if (!wav && !ffmpegWarned) {
    ffmpegWarned = true;
    log.warn('[voice] 语音解码失败：OneBot WAV 转码与 ffmpeg 均未成功，识别服务未调用');
  }
  return wav;
}

/** 专用识别服务：解码后 POST {url}/asr（audio/wav）→ {text}。一切失败返回 null（best-effort）。 */
async function transcribeViaService(ctx: VoiceTranscribeCtx): Promise<string | null> {
  const { cfg, seg, driver, log } = ctx;
  const base = (cfg.transcribeUrl || '').trim();
  if (!base) return null;
  const wav = await decodeRecord(seg, driver, cfg, log);
  if (!wav) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.transcribeTimeout);
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/asr`, {
      method: 'POST',
      headers: { 'content-type': 'audio/wav' },
      body: Buffer.from(wav),
      signal: ctrl.signal,
    });
    if (!res.ok) { log.warn(`[voice] ASR 服务返回 ${res.status}`); return null; }
    const j = (await res.json()) as { text?: string };
    return j.text?.trim() || null;
  } catch (e) {
    log.warn('[voice] ASR 请求失败', String(e));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * 对外收/发入口：按 cfg.provider 查表分发
 * ------------------------------------------------------------------ */
/** 收：把一条 record 段转成文字。返回 null 表示无可用文字（调用方应回退音频 blob）。 */
export async function transcribeRecord(
  seg: VoiceTranscribeCtx['seg'],
  messageId: number | undefined,
  driver: VoiceDriver,
  cfg: RuntimeVoiceCfg,
  log: VoiceLog,
): Promise<string | null> {
  // 配了专用识别服务（alont1 风格）→ 优先走 ffmpeg+ /asr；失败再回退供应商自带 ASR。
  if (cfg.transcribeUrl && cfg.transcribeUrl.trim()) {
    const via = await transcribeViaService({ seg, messageId, driver, cfg, log });
    if (via) return via;
  }
  return getVoiceProvider(cfg.provider, log).transcribe({ seg, messageId, driver, cfg, log });
}

/** 发：把文字合成语音 record 段。返回 null 表示合成失败（调用方回退文字）。 */
export async function synthesizeVoice(
  text: string,
  address: string,
  driver: VoiceDriver,
  cfg: RuntimeVoiceCfg,
  log: VoiceLog,
): Promise<RecordSeg | null> {
  return getVoiceProvider(cfg.provider, log).synthesize({ text, address, driver, cfg, log });
}

/** 依赖检查：按当前供应商的 checkDeps 判定可用性。 */
export function checkVoiceDeps(cfg: RuntimeVoiceCfg, log: VoiceLog): boolean {
  const p = getVoiceProvider(cfg.provider, log);
  return p.checkDeps ? p.checkDeps(cfg, log) : true;
}

/** 就绪判定（通用，异步）：优先用供应商自己的 checkReady（如本地服务探活 /health ready），没有则回退 checkDeps。供语音通话 isCallReady 等使用，不写死任何具体供应商。 */
export function voiceReady(cfg: RuntimeVoiceCfg, log: VoiceLog): Promise<boolean> {
  const p = getVoiceProvider(cfg.provider, log);
  if (p.checkReady) return p.checkReady(cfg, log);
  return Promise.resolve(checkVoiceDeps(cfg, log));
}

/* ------------------------------------------------------------------ *
 * 语义判定：本次回复是否应当用语音
 * ------------------------------------------------------------------ */
export async function judgeVoiceWish(
  userText: string,
  cfg: RuntimeVoiceCfg,
  log: VoiceLog,
  reportUsage?: (usage: { promptTokens: number; completionTokens: number; cacheHitTokens: number }, model: string) => void,
): Promise<boolean> {
  if (!cfg.judgeApiKey) {
    log.info('[voice] 语义判定未配置 judgeApiKey，默认不发语音');
    return false;
  }
  try {
    const resp = await fetch(`${cfg.judgeEndpoint}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.judgeApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.judgeModel,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              '你是语音意图判定器。判断：用户这条消息是否希望收到"语音"形式的回复（即机器人用语音念出来）。' +
              '只有当用户明显想要听语音（如"用语音"/"念给我听"/"说给我听"/"语音回复"）或上下文强烈暗示要语音时才返回 yes。' +
              '只回复一个词：yes 或 no。',
          },
          { role: 'user', content: userText.slice(0, 500) },
        ],
      }),
    });
    if (!resp.ok) throw new Error(`judge HTTP ${resp.status}`);
    const j = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const ans = j.choices?.[0]?.message?.content?.trim().toLowerCase() ?? '';
    const ok = ans.startsWith('yes');
    // 语义判定每次消息调一次模型，须上报用量（认证评审 #104 要求）。
    if (ok && reportUsage) {
      reportUsage(
        {
          promptTokens: j.usage?.prompt_tokens ?? 0,
          completionTokens: j.usage?.completion_tokens ?? 0,
          cacheHitTokens: 0,
        },
        cfg.judgeModel,
      );
    }
    return ok;
  } catch (e) {
    log.warn('[voice] 语义判定失败，默认不发语音', String(e));
    return false;
  }
}
