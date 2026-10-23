import {spawn, type ChildProcess} from 'node:child_process';
import {closeSync, mkdirSync, openSync} from 'node:fs';
import {dirname} from 'node:path';

/** Wait for spawn and always release the parent's log descriptor, including ENOENT/EACCES. */
export async function spawnLoggedProcess(command: string, args: string[], options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  logFile: string;
  onError: (error: Error) => void;
}): Promise<ChildProcess> {
  mkdirSync(dirname(options.logFile), {recursive: true});
  const fd = openSync(options.logFile, 'a');
  let child: ChildProcess;
  try {
    child = spawn(command, args, {
      cwd: options.cwd, env: options.env,
      stdio: ['ignore', fd, fd], detached: true, windowsHide: true,
    });
  } finally {
    closeSync(fd);
  }
  child.on('error', options.onError);
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', () => {
      child.removeListener('error', reject);
      resolve();
    });
  });
  child.unref();
  return child;
}
