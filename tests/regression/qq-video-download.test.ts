import { afterEach, expect, it, vi } from 'vitest';
import { previewVideo } from '../../src/video.ts';

afterEach(() => vi.unstubAllGlobals());

it('local paths are rejected before fetch and HTTP errors remain unread', async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 403 }));
  vi.stubGlobal('fetch', fetcher);
  expect((await previewVideo('C:/private.mp4', [], '')).text).toContain('缺少');
  expect(fetcher).not.toHaveBeenCalled();
  expect((await previewVideo('https://media.invalid/v.mp4', [], '')).text).toContain('下载失败');
});

it('declared and streamed oversized videos cancel the download without invoking FFmpeg', async () => {
  for (const declared of [true, false]) {
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(controller) { if (!declared) controller.enqueue(new Uint8Array(32 * 1024 * 1024 + 1)); }, cancel,
    });
    vi.stubGlobal('fetch', async () => new Response(body, { headers: declared ? { 'content-length': String(33 * 1024 * 1024) } : {} }));
    expect((await previewVideo('https://media.invalid/v.mp4', [], '')).text).toContain('32 MiB');
    expect(cancel).toHaveBeenCalledTimes(1);
  }
});
