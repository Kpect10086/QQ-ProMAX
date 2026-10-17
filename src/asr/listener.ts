/**
 * 把"听"做成自包含模块：喂 16-bit PCM 帧 → 切句(Segmenter) → 识别(Recognizer) → 并句(Packer) → onText(text)。
 *
 * 设计目标：**统一 + 模块化**，让 QQ 系统级通话与桌宠(desktop-pet)共用同一套"听"管线，未来合并时
 * 不必重写。具体约定与 cortico-world-desktop-pet 的 src/asr/ **完全一致**：
 *   - 切句/并句 = 桌宠同款 Segmenter / Packer（纯逻辑，本目录即同源复制）；
 *   - 识别器 = 与桌宠同契约的 `Recognizer` 接口（transcribe(pcm)->TranscribeResult）；
 *     当前用 HttpRecognizer(包住 asr 侧车 /asr)；合并桌宠时把实例换成 SystemRecognizer
 *     (Windows 自带 SAPI，零下载) 或 FunAsrRecognizer(SenseVoice) 即可，本模块一字不改。
 *
 * 对外接口极简：构造时注入 recognizer + onText 回调，运行时 `pushFrame(pcm)` 喂帧，
 * `start()`/`stop()` 控制生命周期。调用方(qq world.ts)无需关心 VAD、并句、转写并发等细节。
 */
import { Segmenter, Packer, SEGMENT_DEFAULTS, PACK_DEFAULTS, type Utterance } from './segmenter.ts';
import { looksHallucinated } from './result.ts';
import type { Recognizer } from './recognizer.ts';

export interface AudioListenerLogger {
  info?: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
}

export interface AudioListenerOptions {
  /** 每帧毫秒（必须与 call_bridge 的 frameMs 一致，默认 20ms @16k）。 */
  frameMs?: number;
  /** 覆盖 Segmenter 切句参数（阈值/门限等）。 */
  segment?: Partial<typeof SEGMENT_DEFAULTS>;
  /** 覆盖 Packer 并句参数（并句时长/最小字数等）。 */
  pack?: Partial<typeof PACK_DEFAULTS>;
}

export class AudioListener {
  private readonly seg: Segmenter;
  private readonly pack: Packer;
  private readonly frameMs: number;
  private queue: Utterance[] = [];
  private transcribing = false;
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly recognizer: Recognizer | null,
    private readonly onText: (text: string) => void,
    private readonly log?: AudioListenerLogger,
    opts: AudioListenerOptions = {},
  ) {
    this.frameMs = opts.frameMs ?? 20;
    this.seg = new Segmenter({ ...SEGMENT_DEFAULTS, ...(opts.segment ?? {}) }, this.frameMs);
    this.pack = new Packer({ ...PACK_DEFAULTS, ...(opts.pack ?? {}) });
  }

  /** 当前输入电平(dBFS)，供面板/调试显示（未经门限判定）。 */
  get level(): number {
    return this.seg.level;
  }

  /** 是否正在收一句（调试用）。 */
  get active(): boolean {
    return this.seg.active;
  }

  /** 启动：开启并句发车定时器（每 100ms 检查一次 Packer 是否到期）。 */
  start(): void {
    this.running = true;
    if (!this.timer) {
      this.timer = setInterval(() => this.maybeFlush(this.seg.active || this.transcribing), 100);
    }
  }

  /** 停止：清定时器并投递剩余批次（最后半句）。 */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const tail = this.seg.flush();
    if (tail) this.enqueue(tail);
    const t = this.pack.take();
    if (t) this.onText(t);
  }

  /** 喂一帧 16-bit 单声道 PCM（默认 16kHz）。返回当前电平(dBFS)。 */
  pushFrame(frame: Int16Array): number {
    if (!this.running) return -100;
    const utts = this.seg.push(frame);
    for (const u of utts) this.enqueue(u);
    return this.seg.level;
  }

  private enqueue(u: Utterance): void {
    this.queue.push(u);
    void this.drain();
  }

  /** 串行消费队列：每句交给识别器，结果过滤幻觉后交给 Packer 并句。 */
  private async drain(): Promise<void> {
    if (this.transcribing) return;
    this.transcribing = true;
    try {
      while (this.queue.length) {
        const u = this.queue.shift()!;
        if (!this.recognizer) continue; // 未配识别器：仅 VAD，不转写（单向播报）
        const res = await this.recognizer.transcribe(u.pcm);
        if (res.error) {
          this.log?.warn('system 听写识别失败', { error: res.error });
          continue;
        }
        const text = (res.text || '').trim();
        if (!text || looksHallucinated(text)) continue;
        // 够长且非幻觉 → 入 Packer；定时器负责按收尾静音/最大持仓发车
        this.pack.add(text, Date.now());
      }
    } finally {
      this.transcribing = false;
    }
  }

  /** 打包层到期则把攒批文本投出（hold=true 时继续持有，如仍在收音/转写中）。 */
  private maybeFlush(hold: boolean): void {
    const t = this.pack.due(Date.now(), hold);
    if (t) this.onText(t);
  }
}
