/**
 * Diagnostic code lists (SD-AI-07): every code starts with ai/, the per-
 * component lists are internally unique, and every warnOnce/count literal in
 * src/ai is listed.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAIN_CODES } from '../../src/ai/brain';
import { LOCOMOTION_CODES } from '../../src/ai/locomotion';
import { PERCEPTION_CODES } from '../../src/ai/perception';
import { AI_COUNTED_CODES, AI_DIAGNOSTIC_CODES } from './codes';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('AI diagnostic codes', () => {
  it('are ai/ codes without duplicates inside each list', () => {
    for (const list of [PERCEPTION_CODES, LOCOMOTION_CODES, BRAIN_CODES]) {
      expect(new Set(list).size).toBe(list.length);
      for (const c of list) expect(c).toMatch(/^ai\/[a-z-]+$/);
    }
    for (const c of AI_COUNTED_CODES) expect(AI_DIAGNOSTIC_CODES).toContain(c);
  });

  it('cover every warnOnce and count literal under src/ai', () => {
    const used = new Set<string>();
    for (const f of files('src/ai')) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/(?:warnOnce|count)\('([^']+)'\)/g))
        if (m[1] !== undefined) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(5);
    for (const c of used) expect(AI_DIAGNOSTIC_CODES).toContain(c);
  });

  it('expected gameplay events use count(), never the sink', () => {
    for (const f of files('src/ai')) {
      const text = readFileSync(f, 'utf8');
      for (const c of AI_COUNTED_CODES) expect(text, f).not.toContain(`warnOnce('${c}')`);
    }
  });
});
