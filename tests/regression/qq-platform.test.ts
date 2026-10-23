import {afterEach, expect, it} from 'vitest';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {nullLogger} from 'cortico/core/util.ts';
import {venvPython} from '../../src/platform.ts';
import {QQWorld} from '../../src/world.ts';

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const dirs: string[] = [];
afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform);
  for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true});
});
function temp() { const dir = mkdtempSync(join(tmpdir(), 'qq platform 空格 ')); dirs.push(dir); return dir; }
function touch(file: string) { writeFileSync(file, 'fixture'); return file; }

it('package and lockfile both permit Linux installation', () => {
  const meta = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  expect(meta.os).toContain('linux');
  expect(lock.packages[''].os).toEqual(meta.os);
});

it('supports POSIX python3/python and the Windows venv layout', () => {
  const dir = temp(); mkdirSync(join(dir, 'bin')); mkdirSync(join(dir, 'Scripts'));
  expect(venvPython(dir, 'linux')).toBe(join(dir, 'bin', 'python3'));
  touch(join(dir, 'bin', 'python'));
  expect(venvPython(dir, 'linux')).toBe(join(dir, 'bin', 'python'));
  touch(join(dir, 'bin', 'python3'));
  expect(venvPython(dir, 'linux')).toBe(join(dir, 'bin', 'python3'));
  expect(venvPython(dir, 'win32')).toBe(join(dir, 'Scripts', 'python.exe'));
});

it.each(['linux', 'win32'] as const)('resolves ASR, TTS and bridge venvs on %s', platform => {
  Object.defineProperty(process, 'platform', {value: platform});
  const dir = temp(); const venv = join(dir, 'venv_vox');
  mkdirSync(join(venv, platform === 'win32' ? 'Scripts' : 'bin'), {recursive: true});
  const python = touch(venvPython(venv));
  const script = touch(join(dir, 'vox_tts_server.py'));
  const models = join(dir, 'models'); mkdirSync(models); touch(join(models, 'model.safetensors'));
  const q: any = new QQWorld({asr: {localVenv: venv, localEngine: 'funasr'},
    voxcpmSidecar: {script, venv, modelDir: models}});
  q.packageDir = dir; q.log = nullLogger();
  expect(q.resolveAsrSidecar()?.python).toBe(python);
  expect(q.resolveSidecar()?.python).toBe(python);
  expect(q.findBridgePython()).toBe(python);
});
