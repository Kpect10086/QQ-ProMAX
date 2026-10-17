import type { TranscribeResult } from './result.ts';
import { looksHallucinated } from './result.ts';

/**
 * 识别器接口：transcribe(pcm:Int16Array) → TranscribeResult。
 * HttpRecognizer 包住任意「OpenAI 兼容」转写端点（云端 GLM/OpenAI 或本扩展拉起的本地侧车）。
 */
export interface Recognizer {
  transcribe(pcm: Int16Array): Promise<TranscribeResult>;
}

export interface HttpRecognizerOptions {
  /** 鉴权：云端填 API Key（作为 Bearer 头）；本地侧车留空。 */
  apiKey?: string;
  /** 模型名：云端必填（GLM=glm-asr-2512，OpenAI=whisper-1）；本地侧车忽略。 */
  model?: string;
  /** 超时（毫秒）。 */
  timeoutMs?: number;
  rawWav?: boolean;
  /** 日志（可选，仅记录异常）。 */
  log?: { warn: (m: string, x?: unknown) => void };
}

/** 把 16-bit PCM 包成 16k mono WAV（Uint8Array，可直接当 fetch body）。 */
function pcmToWav(pcm: Int16Array, rate = 16000) {
  const out = new Uint8Array(44 + pcm.byteLength);
  const dv = new DataView(out.buffer);
  const w = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[off + i] = s.charCodeAt(i);
  };
  w(0, 'RIFF');
  dv.setUint32(4, 36 + pcm.byteLength, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  w(36, 'data');
  dv.setUint32(40, pcm.byteLength, true);
  out.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 44);
  return out;
}

/**
 * 包住 OpenAI 兼容转写端点：POST multipart(file=wav + model) → {text} / {data:{text}} / 纯文本。
 * 同时覆盖云端（GLM/OpenAI，带 Bearer 鉴权）与本地侧车（asr_sidecar.py，无鉴权）。
 */
export class HttpRecognizer implements Recognizer {
  constructor(private url: string, private opts: HttpRecognizerOptions = {}) {}

  async transcribe(pcm: Int16Array): Promise<TranscribeResult> {
    const t0 = Date.now();
    const wav = pcmToWav(pcm, 16000);
    try {
      const form = new FormData();
      form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
      if (this.opts.model) form.append('model', this.opts.model);
      const headers: Record<string, string> = {};
      if (this.opts.apiKey) headers.Authorization = `Bearer ${this.opts.apiKey}`;
      if (this.opts.rawWav) headers['content-type'] = 'audio/wav';
      const r = await fetch(this.url, {
        method: 'POST',
        body: this.opts.rawWav ? wav : form,
        headers,
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15000),
      });
      if (!r.ok) return { text: '', ms: Date.now() - t0, error: `ASR HTTP ${r.status}` };
      let text = '';
      try {
        const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
        if (j && typeof j === 'object') {
          text =
            (typeof j.text === 'string' && j.text) ||
            (j.data && typeof j.data === 'object' && typeof (j.data as Record<string, unknown>).text === 'string'
              ? ((j.data as Record<string, unknown>).text as string)
              : '') ||
            '';
          if (!text && Array.isArray(j.results)) {
            text = (j.results as { text?: string }[]).map((x) => x.text || '').join('');
          }
        }
      } catch {
        text = (await r.text()).trim();
      }
      text = (text || '').trim();
      return { text, ms: Date.now() - t0, error: looksHallucinated(text) ? 'hallucination' : null };
    } catch (e) {
      this.opts.log?.warn?.('HttpRecognizer 异常', String(e));
      return { text: '', ms: Date.now() - t0, error: String(e) };
    }
  }
}
