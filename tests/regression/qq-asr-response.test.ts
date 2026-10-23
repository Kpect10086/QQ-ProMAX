import {afterEach, expect, it, vi} from 'vitest';
import {HttpRecognizer} from '../../src/asr/recognizer.ts';
afterEach(() => vi.unstubAllGlobals());
const pcm = new Int16Array(160);
it.each([
  ['text/plain', '今天想吃苹果', '今天想吃苹果'],
  ['application/json', '{"text":"今天想吃苹果"}', '今天想吃苹果'],
  ['application/json', '{"data":{"text":"今天想吃苹果"}}', '今天想吃苹果'],
  ['application/json', '{"results":[null,{"text":"今天"},{"text":"想吃苹果"}]}', '今天想吃苹果'],
])('parses an ASR %s response without consuming it twice', async (type, body, expected) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {headers: {'content-type': type}})));
  const result = await new HttpRecognizer('http://localhost/asr').transcribe(pcm);
  expect(result.text).toBe(expected);
  expect(result.error).toBeNull();
});
it('does not treat malformed JSON as a transcript', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{bad', {headers: {'content-type': 'application/json'}})));
  const result = await new HttpRecognizer('http://localhost/asr').transcribe(pcm);
  expect(result.text).toBe(''); expect(result.error).toBe('ASR invalid JSON');
});
