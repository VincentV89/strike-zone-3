/**
 * The only file writer of the verification unit (SD-VE-01). Every output is
 * masked first; only reports/*.json and docs/FINAL-REPORT.md may be written.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, normalize, relative, resolve, sep } from 'node:path';
import { mask, type MaskHit } from './mask.ts';

export interface WriteOutcome {
  readonly path: string;
  readonly hits: readonly MaskHit[];
}

export function isAllowedOutput(root: string, path: string): boolean {
  const abs = isAbsolute(path) ? normalize(path) : resolve(root, path);
  const rel = relative(resolve(root), abs).split(sep).join('/');
  if (rel.startsWith('..') || rel.includes('/../')) return false;
  if (rel === 'docs/FINAL-REPORT.md') return true;
  return /^reports\/[a-z0-9-]+\.json$/.test(rel);
}

export function writeMasked(root: string, path: string, text: string): WriteOutcome {
  if (!isAllowedOutput(root, path)) {
    throw new Error(`verification/output-path-not-allowed: ${path}`);
  }
  const abs = resolve(root, path);
  const { text: masked, hits } = mask(text);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, masked);
  return { path, hits };
}
