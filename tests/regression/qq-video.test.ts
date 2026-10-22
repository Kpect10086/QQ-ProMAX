import { afterEach, expect, it, vi } from 'vitest';
import { nullLogger } from 'cortico/core/util.ts';

const { preview } = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock('../../src/video.ts', () => ({ previewVideo: preview }));
const { QQWorld } = await import('../../src/world.ts');
const video = { type: 'video', data: { file: 'fixture.mp4', url: 'https://media.invalid/video.mp4' } };
const blob = { bytes: new Uint8Array([1, 2]), mime: 'image/jpeg', name: 'qq-video-preview' };
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

function fixture(config: any = {}, accepts = true, paused = false) {
  const q: any = new QQWorld({ privates: '1', groups: '2', contentReviewUrl: '',
    privateAggregationWindow: 0, voice: { enabled: false }, affinity: { enabled: false }, ...config });
  const events: any[] = [];
  q.log = nullLogger();
  q.host = { isPaused: () => paused, modelFacts: { accepts: () => accepts },
    pushEvent: async (event: any) => { events.push(event); return { ...event, cursor: events.length }; },
    pushDeferred() {} };
  preview.mockResolvedValue({ text: '[视频预览：4 个采样画面；未读取声音]', blob });
  const incoming = (segments: any[]) => q.handleMessage({ message_id: 1, time: Date.now() / 1000, message: segments },
    { address: 'private:1', id: 1, kind: 'private', label: 'fixture' }, { userId: 1, name: 'fixture' });
  return { q, events, incoming };
}

it('a QQ video reaches the event as one image preview without calling the auxiliary vision model', async () => {
  const { q, events, incoming } = fixture();
  q.vision = { register: vi.fn(() => { throw Error('No auxiliary model call expected'); }) };
  await incoming([video]);
  expect(events).toHaveLength(1);
  expect(events[0].blobs).toEqual([blob]);
  expect(events[0].text).toContain('未读取声音');
  expect(preview).toHaveBeenCalledTimes(1);
  expect(q.vision.register).not.toHaveBeenCalled();
});

it('disabled attachments, unsupported models and pause skip all video downloads', async () => {
  for (const args of [[{ deliverImageAttachments: false }, true, false], [{}, false, false], [{}, true, true]] as const) {
    const { events, incoming } = fixture(...args);
    await incoming([video]);
    expect(events[0].text).toContain('视频未读取');
    expect(events[0].blobs).toBeUndefined();
  }
  expect(preview).not.toHaveBeenCalled();
});

it('multiple videos have a per-message preview cap and a download failure stays explicit', async () => {
  const { events, incoming } = fixture();
  await incoming([video, video]);
  expect(preview).toHaveBeenCalledTimes(1);
  expect(events[0].blobs).toHaveLength(1);
  expect(events[0].text).toContain('每条消息最多预览一个视频');
  preview.mockResolvedValueOnce({ text: '[视频未读取：下载失败]' });
  await incoming([video]);
  expect(events[1].text).toContain('下载失败');
  expect(events[1].blobs).toBeUndefined();
});

it('private aggregation retains each preview attachment through timer flush and expired-window flush', async () => {
  vi.useFakeTimers();
  const { q, events } = fixture({ privateAggregationWindow: 1000 });
  const conv = { address: 'private:1', id: 1, kind: 'private', label: 'fixture' };
  const sender = { userId: 1, name: 'fixture' };
  q.aggregatePrivate(conv, sender, '视频一', [blob], {});
  q.aggregatePrivate(conv, sender, '视频二', [blob], {});
  await vi.advanceTimersByTimeAsync(1001);
  expect(events[0].blobs).toEqual([blob, blob]);
  expect(events[0].text).toContain('视频二');
  q.aggregatePrivate(conv, sender, '视频三', [blob], {});
  vi.setSystemTime(Date.now() + 1001);
  q.aggregatePrivate(conv, sender, '视频四', [blob], {});
  expect(events[1].blobs).toEqual([blob]);
  await vi.advanceTimersByTimeAsync(1001);
  expect(events[2].blobs).toEqual([blob]);
});
