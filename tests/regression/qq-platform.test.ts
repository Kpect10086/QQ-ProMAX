import {afterEach, expect, it} from 'vitest';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {nullLogger} from 'cortico/core/util.ts';
import {venvPython} from '../../packages/qq-audio-input/src/platform.ts';
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
