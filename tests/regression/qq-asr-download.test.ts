import {expect, it, vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {QQWorld} from '../../src/world.ts';

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: vi.fn(),
}));

it('passes ASR download destinations containing spaces and quotes as a separate argument', async () => {
  const child = Object.assign(new EventEmitter(), {stdout:new EventEmitter(),stderr:new EventEmitter()});
  vi.mocked(spawn).mockImplementationOnce(() => {
    queueMicrotask(() => child.emit('close', 0));
    return child as ReturnType<typeof spawn>;
  });
  const q: any = new QQWorld({});
  q.resolveAsrPython = () => '/fixture/python';
  q.packageDir = '/fixture/package';
  q.asrDownload = {phase:'working',detail:'',log:[],startedAt:Date.now()};
  const target = "/tmp/中文 model's path/weights";
  await q.runAsrDownload(target);
  const args = vi.mocked(spawn).mock.calls[0][1] as string[];
  expect(args[0]).toBe('-c');
  expect(args[1]).toContain('local_dir=sys.argv[1]');
  expect(args[1]).not.toContain(target);
  expect(args[2]).toBe(target);
  expect(q.asrDownload.phase).toBe('ready');
});
