/**
 * Bounded JSON reader (SD-VE-07). Every input file is untrusted: size is
 * checked before reading and parsing never throws.
 */
import { readFileSync, statSync } from 'node:fs';

export const MB = 1024 * 1024;
export const CAP_VITEST = 50 * MB;
export const CAP_MANUAL = 64 * 1024;
export const CAP_DEFAULT = 5 * MB;

export type ReadResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: 'absent' | 'oversize' | 'unreadable' };

export interface ReadFs {
  statSize(path: string): number | null;
  readText(path: string): string;
}

export const nodeReadFs: ReadFs = {
  statSize(path) {
    const s = statSync(path, { throwIfNoEntry: false });
    return s?.isFile() === true ? s.size : null;
  },
  readText(path) {
    return readFileSync(path, 'utf8');
  },
};

export function readJsonBounded(
  path: string,
  maxBytes: number,
  fs: ReadFs = nodeReadFs,
): ReadResult {
  const size = fs.statSize(path);
  if (size === null) return { ok: false, reason: 'absent' };
  if (size > maxBytes) return { ok: false, reason: 'oversize' };
  try {
    return { ok: true, value: JSON.parse(fs.readText(path)) as unknown };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}
