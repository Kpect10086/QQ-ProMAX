import {afterEach, expect, it, vi} from 'vitest';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Notebook} from '../../src/notebook.ts';
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, {recursive:true, force:true}); vi.unstubAllGlobals(); });
function fixture() { const dir = mkdtempSync(join(tmpdir(), 'qq-notebook-')); dirs.push(dir); return {dir, notebook: new Notebook(dir)}; }
it('preserves every existing byte when a damaged notebook cannot be parsed', async () => {
  const {dir, notebook} = fixture();
  const original = '{"id":"one","text":"keep","ts":1}\n{truncated';
  writeFileSync(join(dir, 'notebook.jsonl'), original);
  await expect(notebook.save('new note')).rejects.toThrow();
  expect(readFileSync(join(dir, 'notebook.jsonl'), 'utf8')).toBe(original);
});
it('creates a missing data directory and round-trips Unicode notes', async () => {
  const {dir} = fixture(); const notebook = new Notebook(join(dir, 'data'));
  const saved = await notebook.save('笔记 🌱');
  expect((await notebook.get(saved.id))?.text).toBe('笔记 🌱');
  expect(await notebook.forget(saved.id)).toBe(true); expect(await notebook.list()).toEqual([]);
});
it('rejects invalid bridge indices instead of coercing them to another note', async () => {
  const {notebook} = fixture(); const forget = vi.fn(); const get = vi.fn();
  vi.stubGlobal('cortico:memory:notebook', {save() {}, list() {return [];}, get, forget});
  for (const id of ['', ' ', '-1', 'NaN', '1.5', '9007199254740992']) {
    expect(await notebook.get(id)).toBeNull(); expect(await notebook.forget(id)).toBe(false);
  }
  expect(get).not.toHaveBeenCalled(); expect(forget).not.toHaveBeenCalled();
});
