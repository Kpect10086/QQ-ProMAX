import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const directory = mkdtempSync(join(tmpdir(), 'qq-package-'));
const npm = process.env.npm_execpath;
assert.ok(npm, 'Run with npm run test:package');
function run(args, options={}) {
  const result = spawnSync(process.execPath, args, {encoding:'utf8', timeout:120000, ...options});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return result.stdout;
}
try {
 for (const entry of [{name:'cortico-world-qq-promax',cwd:process.cwd()}, {name:'cortico-world-qq-audio-input',cwd:join(process.cwd(),'packages','qq-audio-input')}]) {
  const packed = JSON.parse(run([npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', directory],{cwd:entry.cwd}))[0];
  if (entry.name==='cortico-world-qq-promax') assert.ok(packed.files.every(f=>!f.path.startsWith('src/asr/') && f.path!=='asr_sidecar.py' && !f.path.startsWith('packages/')));
  const install = join(directory, entry.name);
  run([npm, 'install', '--prefix', install, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', join(directory, packed.filename)]);
  for (const name of ['cortico', 'pino', 'tsx']) {
    assert.equal(existsSync(join(install, 'node_modules', name)), false, `Unexpected runtime dependency: ${name}`);
  }
  const plugin = join(install, 'node_modules', entry.name);
  if (entry.name==='cortico-world-qq-promax') process.stdout.write(run([fileURLToPath(new URL('./host-free.mjs', import.meta.url)), plugin]));
  else process.stdout.write(run(['--import',new URL('./no-host-source.mjs',import.meta.url).href,fileURLToPath(new URL('./audio-input-smoke.mjs',import.meta.url)),plugin]));
  console.log(JSON.stringify({packagedInstall:true, hostSourcePresent:false, pinoInstalled:false, version:packed.version}));
 }
} finally {rmSync(directory, {recursive:true, force:true});}
