import {afterEach, expect, it, vi} from 'vitest';
import {downloadImageBytes} from '../../src/image-download.ts';
import {nowIso, shortTime} from '../../src/time.ts';
import {nowIso as hostNowIso, shortTime as hostShortTime} from 'cortico/core/util.ts';

afterEach(() => vi.useRealTimers());
it.each(['UTC', 'Asia/Singapore', 'Asia/Kathmandu', 'America/New_York'])(
  'preserves timestamp and offset behavior for %s', timezone => {
    for (const value of ['2026-03-08T06:59:59.123Z','2026-03-08T07:00:00.456Z','2026-11-01T06:00:00.789Z']) {
      const date = new Date(value);
      expect(nowIso(timezone, date)).toBe(hostNowIso(timezone, date));
      expect(shortTime(timezone, date)).toBe(hostShortTime(timezone, date));
      expect(Date.parse(nowIso(timezone, date))).toBe(date.getTime());
    }
  });
it('downloads bytes and selects a MIME type without a host module', async () => {
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1,2,3]), {headers:{'content-type':'image/png; charset=binary'}}));
  const options = {timeoutMs:1000, maxImageBytes:3};
  expect(await downloadImageBytes('https://fixture.invalid/image', options, fetcher)).toEqual({buffer:new Uint8Array([1,2,3]),mime:'image/png'});
  expect(await downloadImageBytes('https://fixture.invalid/image.webp?q=1', options,
    async () => new Response(new Uint8Array([1])))).toMatchObject({mime:'image/webp'});
});
it('retains empty URL, HTTP error and size limit rejection', async () => {
  const options = {timeoutMs:1000, maxImageBytes:2};
  const fetcher = vi.fn();
  await expect(downloadImageBytes('', options, fetcher)).rejects.toThrow('图片地址为空');
  expect(fetcher).not.toHaveBeenCalled();
  await expect(downloadImageBytes('https://fixture.invalid', options, async()=>new Response('',{status:403}))).rejects.toThrow('HTTP 403');
  await expect(downloadImageBytes('https://fixture.invalid', options, async()=>new Response(new Uint8Array(3)))).rejects.toThrow('图片过大');
});
it('aborts timed out downloads and clears the timer', async () => {
  vi.useFakeTimers();
  const work = downloadImageBytes('https://fixture.invalid', {timeoutMs:100,maxImageBytes:5},
    (_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
  const failure = expect(work).rejects.toThrow('下载超时');
  await vi.advanceTimersByTimeAsync(100);
  await failure;
  expect(vi.getTimerCount()).toBe(0);
});
