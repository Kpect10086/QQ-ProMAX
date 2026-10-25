import {existsSync, lstatSync, realpathSync, statSync} from 'node:fs';
import {dirname, isAbsolute, parse, relative, resolve, sep} from 'node:path';

/** Only user-designated resources; no parent-directory discovery or symlink escape. */
export function resourcePath(root: string, name: string, directory = false): string | null {
  try {
    if (!root || !name || name.split(/[\\/]/).includes('..')) return null;
    const base = realpathSync(root);
    if (base === parse(base).root || !statSync(base).isDirectory()) return null;
    const target = resolve(base, name);
    const inside = (path: string) => {
      const rel = relative(base, path);
      return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);
    };
    if (!inside(target)) return null;
    let parent = target;
    while (!existsSync(parent)) {
      if (lstatSync(parent, {throwIfNoEntry: false})?.isSymbolicLink()) return null;
      if (!directory || parent === dirname(parent)) return null;
      parent = dirname(parent);
    }
    if (!inside(realpathSync(parent))) return null;
    if (existsSync(target) && (directory ? !statSync(target).isDirectory() : !statSync(target).isFile())) return null;
    return target;
  } catch { return null; }
}
