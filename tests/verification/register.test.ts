/**
 * Register integrity (BR-VE-10..13, Q-VE-07). Fails verify if a referenced
 * test file disappears, a manual id is missing from docs/MANUAL-TESTS.md, a
 * story or requirement id is unknown, an id repeats, or a spec §13/§17 item
 * has no entry.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CHECKS,
  CUTS,
  LIMITATIONS,
  MANUAL_IDS,
  OUT_OF_REGISTER,
  REQUIREMENT_IDS,
  STORY_IDS,
} from '../../scripts/verification/checks.ts';
import { registerProblems } from '../../scripts/verification/run-report.ts';

const byId = new Map(CHECKS.map((c) => [c.id, c]));
const of = (prefix: string) => CHECKS.filter((c) => c.id.startsWith(prefix));

describe('check register', () => {
  it('has unique ids and no run-time register problems', () => {
    expect(new Set(CHECKS.map((c) => c.id)).size).toBe(CHECKS.length);
    expect(registerProblems(CHECKS)).toEqual([]);
  });

  it('has one entry per spec §13 gameplay check (28), the bot configuration check and 6 deployment checks', () => {
    const gameplay = CHECKS.filter((c) => c.source === '§13-gameplay' && c.id !== 'GV-15m');
    expect(gameplay.map((c) => c.id)).toEqual(
      Array.from({ length: 28 }, (_, i) => `GV-${String(i + 1).padStart(2, '0')}`),
    );
    expect(CHECKS.filter((c) => c.source === '§13-bot-config').map((c) => c.id)).toEqual(['GV-29']);
    expect(CHECKS.filter((c) => c.source === '§13-deployment').map((c) => c.id)).toEqual([
      'DV-01',
      'DV-02',
      'DV-03',
      'DV-04',
      'DV-05',
      'DV-06',
    ]);
  });

  it('has one entry per spec §17 row: 14 playability, 7 infrastructure, 6 quality', () => {
    const dod = of('DOD-');
    expect(dod.filter((c) => c.id.startsWith('DOD-P'))).toHaveLength(14);
    expect(dod.filter((c) => c.id.startsWith('DOD-I'))).toHaveLength(7);
    expect(dod.filter((c) => c.id.startsWith('DOD-Q'))).toHaveLength(6);
    for (const c of dod) {
      expect(c.source).toBe('§17');
      expect(c.composedOf?.length ?? 0, c.id).toBeGreaterThan(0);
      for (const p of c.composedOf ?? []) {
        expect(byId.has(p), `${c.id} -> ${p}`).toBe(true);
        expect(byId.get(p)?.composedOf, `${c.id} -> ${p} is itself composed`).toBeUndefined();
      }
    }
  });

  it('gives every non-DOD entry at least one ref, every test-ref file exists (BR-VE-12)', () => {
    for (const c of CHECKS) {
      if (c.composedOf !== undefined) continue;
      expect(c.refs.length, c.id).toBeGreaterThan(0);
      for (const r of c.refs) {
        if (r.kind === 'test') expect(existsSync(r.file), `${c.id}: ${r.file}`).toBe(true);
      }
    }
  });

  it('names a manual id that exists in docs/MANUAL-TESTS.md for every manual ref (BR-VE-11)', () => {
    const doc = readFileSync('docs/MANUAL-TESTS.md', 'utf8');
    for (const id of MANUAL_IDS) expect(doc, id).toContain(`## ${id} `);
    for (const c of CHECKS) {
      const manualRefs = c.refs.filter((r) => r.kind === 'manual');
      for (const r of manualRefs) expect(MANUAL_IDS, c.id).toContain(r.id);
      if (manualRefs.length > 0) expect(c.manual, c.id).toBe(manualRefs[0]?.id);
      if (c.manual !== undefined)
        expect(
          manualRefs.map((r) => r.id),
          c.id,
        ).toContain(c.manual);
    }
  });

  it('cites only known story and requirement ids', () => {
    for (const c of CHECKS) {
      for (const s of c.stories) expect(STORY_IDS, `${c.id}: ${s}`).toContain(s);
      for (const q of c.requirements) expect(REQUIREMENT_IDS, `${c.id}: ${q}`).toContain(q);
    }
  });

  it('maps every requirement to an entry or an explicit out-of-register reason (BR-VE-13)', () => {
    const covered = new Set(CHECKS.flatMap((c) => c.requirements));
    const missing = REQUIREMENT_IDS.filter(
      (r) => !covered.has(r) && !Object.hasOwn(OUT_OF_REGISTER, r),
    );
    expect(missing).toEqual([]);
  });

  it('covers every story the verification unit owns', () => {
    const cited = new Set(CHECKS.flatMap((c) => c.stories));
    for (const s of [
      'story-test-evidence',
      'story-bot-count-matrix',
      'story-browser-console-clean',
      'story-post-deploy-smoke',
      'story-final-report',
      'story-twenty-bots-playable',
      'story-graphics-presets',
      'story-refresh-safe-url',
    ]) {
      expect(cited.has(s), s).toBe(true);
    }
  });

  it('turns reported-only targets into metric refs (BR-VE-22)', () => {
    const metricChecks = CHECKS.filter((c) => c.refs.some((r) => r.kind === 'metric')).map(
      (c) => c.id,
    );
    for (const id of ['GV-15m', 'GV-29', 'PF-01', 'PF-02', 'PF-03', 'PF-04'])
      expect(metricChecks).toContain(id);
    for (const c of CHECKS) {
      for (const r of c.refs) {
        if (r.kind !== 'metric') continue;
        expect(r.report, c.id).toMatch(/^[a-z0-9-]+\.json$/);
        for (const seg of r.path)
          expect(['__proto__', 'constructor', 'prototype']).not.toContain(seg);
      }
    }
  });

  it('keeps limitations and cuts well formed (BR-VE-52, BR-VE-53)', () => {
    expect(LIMITATIONS.map((l) => l.id)).toEqual(
      Array.from({ length: LIMITATIONS.length }, (_, i) => `KL-${String(i + 1).padStart(2, '0')}`),
    );
    expect(LIMITATIONS.length).toBeGreaterThanOrEqual(8);
    const text = LIMITATIONS.map((l) => l.text).join(' ');
    expect(text).toContain('720');
    expect(text).toContain('indirect');
    for (const cut of CUTS) {
      expect(STORY_IDS).toContain(cut.story);
      expect(cut.removedControls.length).toBeGreaterThan(0);
    }
  });
});
