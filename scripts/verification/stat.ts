/**
 * Freshness inputs (BR-VE-26, SD-VE-08): the newest file mtime under the
 * source trees and the lockfile SHA-256. The fs is injected for tests.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const FRESHNESS_DIRS = ['src', 'tests', 'scripts', 'infra'] as const;
const SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-test',
  'coverage',
  'reports',
  'cdk.out',
]);

export interface TreeFs {
  list(dir: string): readonly { name: string; isDir: boolean; mtimeMs: number }[];
}

export const nodeTreeFs: TreeFs = {
  list(dir) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return [];
    }
    const out: { name: string; isDir: boolean; mtimeMs: number }[] = [];
    for (const name of names) {
      const s = statSync(join(dir, name), { throwIfNoEntry: false });
      if (s === undefined) continue;
      out.push({ name, isDir: s.isDirectory(), mtimeMs: s.mtimeMs });
    }
    return out;
  },
};

/** Newest file mtime (ms) under root/<dirs>; 0 when nothing exists. */
export function newestMtime(
  root: string,
  dirs: readonly string[] = FRESHNESS_DIRS,
  fs: TreeFs = nodeTreeFs,
): number {
  let newest = 0;
  const stack = dirs.map((d) => join(root, d));
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    for (const e of fs.list(dir)) {
      if (e.isDir) {
        if (!SKIP.has(e.name)) stack.push(join(dir, e.name));
      } else if (e.mtimeMs > newest) {
        newest = e.mtimeMs;
      }
    }
  }
  return newest;
}

export function sha256OfFile(path: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return null;
  }
}
