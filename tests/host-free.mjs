import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const directory = mkdtempSync(join(tmpdir(), 'qq-host-free-'));
try {
  const result = spawnSync(process.execPath, ['--import',
    new URL('./no-host-source.mjs', import.meta.url).href, fileURLToPath(new URL('./smoke.mjs', import.meta.url)), ...process.argv.slice(2)],
    {cwd:directory, stdio:'inherit', timeout:30000});
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {rmSync(directory, {recursive:true, force:true});}
