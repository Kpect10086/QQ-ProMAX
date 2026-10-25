import {afterEach, expect, it, vi} from 'vitest';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {spawnLoggedProcess} from '../../packages/qq-audio-input/src/sidecar-process.ts';
import {QQWorld} from '../../src/world.ts';
import {nullLogger} from 'cortico/core/util.ts';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, {recursive:true, force:true}); });
function options() {
  const cwd = mkdtempSync(join(tmpdir(), 'qq-sidecar-')); dirs.push(cwd);
  return {cwd, logFile: join(cwd, 'sidecar.log'), env: process.env, onError: vi.fn()};
}
it('rejects an asynchronous spawn failure without an unhandled error', async () => {
  const opts = options();
  await expect(spawnLoggedProcess(join(opts.cwd, 'missing-python'), [], opts)).rejects.toThrow();
  expect(opts.onError).toHaveBeenCalledOnce();
});
it('starts a real process and writes stdout and stderr to its log', async () => {
  const opts = options();
  const child = await spawnLoggedProcess(process.execPath,
    ['-e', "console.log('stdout');console.error('stderr')"], opts);
  const [code] = await once(child, 'exit');
  expect(code).toBe(0);
  expect(readFileSync(opts.logFile, 'utf8')).toContain('stdout');
  expect(readFileSync(opts.logFile, 'utf8')).toContain('stderr');
  expect(opts.onError).not.toHaveBeenCalled();
});

it('creates a configured log parent directory', async () => {
  const opts = options();
  opts.logFile = join(opts.cwd, 'nested', 'logs', 'service.log');
  const child = await spawnLoggedProcess(process.execPath, ['-e', "console.log('ready')"], opts);
  const [code] = await once(child, 'exit');
  expect(code).toBe(0);
  expect(readFileSync(opts.logFile, 'utf8')).toContain('ready');
});
