import {existsSync} from 'node:fs';
import {join} from 'node:path';

/** Python virtual environments use different layouts on Windows and POSIX. */
export function venvPython(venv: string, platform: NodeJS.Platform = process.platform): string {
  const candidates = platform === 'win32'
    ? [join(venv, 'Scripts', 'python.exe')]
    : [join(venv, 'bin', 'python3'), join(venv, 'bin', 'python')];
  return candidates.find(path => existsSync(path)) ?? candidates[0];
}

export function findVenvPython(venvs: string[]): string {
  return venvs.map(venv => venvPython(venv)).find(path => existsSync(path)) ?? '';
}
