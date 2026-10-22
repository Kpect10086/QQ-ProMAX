import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { BlobInput } from 'cortico/core/types.ts';

const run = promisify(execFile);
const MAX_BYTES = 32 * 1024 * 1024;

/** MP4 抽帧 fallback：把有限画面交给支持图片的主模型，不另外调用视觉端点。 */
export async function previewVideo(url: string, candidates: string[], dataDir: string): Promise<{ text: string; blob?: BlobInput }> {
  let dir: string | undefined;
  try {
    if (!/^https?:\/\//i.test(url)) return { text: '[视频未读取：缺少可下载的 HTTP(S) 链接]' };
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok || !res.body) return { text: '[视频未读取：下载失败，链接可能已过期]' };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (Number(res.headers.get('content-length')) > MAX_BYTES) return { text: '[视频未读取：超过 32 MiB 上限]' };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) return { text: '[视频未读取：超过 32 MiB 上限]' };
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const base = dataDir ? join(dataDir, 'qq-video') : tmpdir();
    await mkdir(base, { recursive: true });
    dir = await mkdtemp(join(base, 'preview-'));
    const input = join(dir, 'input.mp4');
    await writeFile(input, Buffer.concat(chunks));
    for (const binary of candidates) {
      try {
        const common = ['-hide_banner', '-nostdin', '-threads', '1', '-protocol_whitelist', 'file,pipe', '-f', 'mov', '-i', input];
        const probe = await run(binary, [...common, '-map', '0:v:0', '-t', '0', '-f', 'null', '-'], {
          windowsHide: true, timeout: 5_000, maxBuffer: 256 * 1024,
        });
        const match = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(probe.stderr);
        if (!match) continue;
        const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        if (!(duration > 0)) continue;
        // shortcut: 最多四个等间隔采样画面；需要声音或逐秒细节时再接入原生视频能力。
        const frames = Math.min(4, Math.max(1, Math.ceil(duration)));
        const filter = `fps=${frames / duration},scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2,tile=2x2:nb_frames=${frames}`;
        const result = await run(binary, [...common, '-an', '-vf', filter, '-frames:v', '1', '-threads', '1', '-q:v', '5', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'], {
          windowsHide: true, timeout: 15_000, maxBuffer: 2 * 1024 * 1024, encoding: 'buffer',
        });
        if (!result.stdout.length) continue;
        const text = `[视频预览：全长 ${duration.toFixed(1)} 秒，${frames} 个等间隔采样画面，按左上、右上、左下、右下排列；未读取声音，未采样部分未知]`;
        return { text, blob: { bytes: result.stdout, mime: 'image/jpeg', name: 'qq-video-preview', fallbackText: text } };
      } catch {
        // 尝试下一个已配置的 FFmpeg 候选，不把带下载签名的地址写入日志。
      }
    }
    return { text: '[视频未读取：FFmpeg 不可用、MP4 解码失败或抽帧超时]' };
  } catch {
    return { text: '[视频未读取：下载超时或文件处理失败]' };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}
