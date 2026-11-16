/** Input layer: bounded reader, validators, outputs, stat (SD-VE-05, SD-VE-07). */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateOutputs } from '../../scripts/verification/outputs.ts';
import { readJsonBounded } from '../../scripts/verification/read.ts';
import { newestMtime, sha256OfFile } from '../../scripts/verification/stat.ts';
import {
  isCalendarDate,
  validateE2e,
  validateManual,
  validatePrecheck,
  validateSmoke,
  validateVitest,
} from '../../scripts/verification/validate.ts';
import { put, tmpRoot, vitestJson } from './helpers.ts';

const IDS = new Set(['MT-01', 'MT-03']);
const goodManual = {
  id: 'MT-01',
  tester: 'Riley',
  date: '2026-11-20',
  browser: 'Chrome',
  browserVersion: '142',
  hardware: 'desktop',
  outcome: 'pass',
};

describe('readJsonBounded', () => {
  it('reports absent, oversize and unreadable files without throwing', () => {
    const root = tmpRoot();
    put(root, 'a.json', '{"x":1}');
    put(root, 'big.json', `"${'x'.repeat(200)}"`);
    put(root, 'bad.json', '{nope');
    expect(readJsonBounded(join(root, 'a.json'), 100)).toEqual({ ok: true, value: { x: 1 } });
    expect(readJsonBounded(join(root, 'missing.json'), 100)).toEqual({
      ok: false,
      reason: 'absent',
    });
    expect(readJsonBounded(join(root, 'big.json'), 100)).toEqual({ ok: false, reason: 'oversize' });
    expect(readJsonBounded(join(root, 'bad.json'), 100)).toEqual({
      ok: false,
      reason: 'unreadable',
    });
    expect(readJsonBounded(root, 100)).toEqual({ ok: false, reason: 'absent' });
  });
});

describe('validators', () => {
  it('reads the Vitest JSON reporter shape with repo-relative paths and full names', () => {
    const root = '/repo';
    const v = validateVitest(vitestJson(root, 1000), root);
    expect(v?.files[0]?.file).toBe('tests/app/dom/app.test.ts');
    expect(v?.files[0]?.assertions[0]).toEqual({
      fullName: 'boot (story-boot-check) > boots to the main menu',
      status: 'passed',
    });
    expect(v?.startTime).toBe(1000);
    expect(validateVitest({ success: true }, root)).toBeNull();
    expect(validateVitest([], root)).toBeNull();
    const odd = validateVitest(
      {
        success: true,
        startTime: 1,
        testResults: [
          null,
          { name: 'tests/x.test.ts', assertionResults: [null, { title: 't', status: 'weird' }] },
        ],
      },
      root,
    );
    expect(odd?.files).toEqual([
      { file: 'tests/x.test.ts', assertions: [{ fullName: 't', status: 'other' }] },
    ]);
    expect(odd?.numTotalTests).toBe(0);
  });

  it('rebuilds manual results field by field and rejects bad entries with a reason', () => {
    const r = validateManual(
      {
        schemaVersion: 1,
        results: [
          goodManual,
          { ...goodManual, id: 'MT-99' },
          { ...goodManual, date: '2026-02-30' },
          { ...goodManual, tester: 'x'.repeat(81) },
          { ...goodManual, outcome: 'maybe' },
          { ...goodManual, notes: 'n'.repeat(501) },
          { ...goodManual, hardware: 7 },
          'nope',
          JSON.parse(
            '{"__proto__":{"polluted":true},"id":"MT-03","tester":"T","date":"2026-01-01","browser":"b","browserVersion":"1","hardware":"h","outcome":"fail","extra":1}',
          ),
        ],
      },
      IDS,
    );
    expect(r.results.map((x) => x.id)).toEqual(['MT-01', 'MT-03']);
    expect(Object.keys(r.results[1] ?? {})).not.toContain('extra');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(r.rejected).toHaveLength(7);
    expect(r.rejected[0]).toContain('unknown id');
    expect(r.rejected[1]).toContain('YYYY-MM-DD');
    expect(validateManual({ schemaVersion: 2, results: [] }, IDS).rejected).toEqual([
      'manual results: bad envelope',
    ]);
    expect(validateManual({ schemaVersion: 1 }, IDS).rejected).toHaveLength(1);
  });

  it('checks calendar dates', () => {
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-1-01')).toBe(false);
  });

  it('keeps only known smoke ids and probe ids, and only valid account and region', () => {
    const s = validateSmoke({
      mode: 'live',
      url: 'https://abc.cloudfront.net',
      checks: [
        { id: 'SM-1', pass: true, observed: '301' },
        { id: 'SM-99', pass: true },
        { id: 'SM-9', pass: false, notVerified: true },
        4,
      ],
      missing: ['a', 3],
    });
    expect(s?.checks.map((c) => c.id)).toEqual(['SM-1', 'SM-9']);
    expect(s?.checks[1]?.notVerified).toBe(true);
    expect(s?.missing).toEqual(['a']);
    expect(validateSmoke({ mode: 'other' })).toBeNull();
    expect(validateSmoke({ mode: 'blocked' })?.checks).toEqual([]);

    const p = validatePrecheck({
      probes: [
        { id: 'C1', pass: true },
        { id: 'C9', pass: true },
        { id: 'C2', pass: false, sourceKind: 'bad' },
      ],
      account: '1234',
      region: 'mars',
    });
    expect(p).toEqual({
      probes: [
        { id: 'C1', pass: true },
        { id: 'C2', pass: false },
      ],
    });
    expect(validatePrecheck({ probes: [], account: '123456789012', region: 'eu-west-1' })).toEqual({
      probes: [],
      account: '123456789012',
      region: 'eu-west-1',
    });
    expect(validatePrecheck({})).toBeNull();
  });

  it('reads e2e reports and drops malformed cases', () => {
    const e = validateE2e({
      browser: 'chromium 159',
      cases: [
        { id: 'E2E-01', map: 'desert-compound', pass: true, errors: [], warnCodes: ['a/b'] },
        { id: 1 },
      ],
    });
    expect(e?.cases).toHaveLength(1);
    expect(validateE2e({ cases: [] })?.browser).toBe('unknown');
    expect(validateE2e(null)).toBeNull();
  });
});

describe('validateOutputs (SD-VE-05)', () => {
  const ok = {
    StrikeZone: {
      DistributionUrl: 'https://d1abc2def3.cloudfront.net',
      DistributionId: 'E1ABCDEF2GHIJ',
      BucketName: 'strikezone-webbucket-1a2b3c',
    },
  };

  it('accepts the cdk --outputs-file shape and derives host and origin', () => {
    expect(validateOutputs(ok)).toEqual({
      ok: true,
      value: {
        origin: 'https://d1abc2def3.cloudfront.net',
        host: 'd1abc2def3.cloudfront.net',
        distributionId: 'E1ABCDEF2GHIJ',
        bucket: 'strikezone-webbucket-1a2b3c',
      },
    });
  });

  it.each([
    ['DistributionUrl', 'https://evil.example.com'],
    ['DistributionUrl', 'http://d1abc.cloudfront.net'],
    ['DistributionUrl', 'https://d1abc.cloudfront.net/x'],
    ['DistributionUrl', 'https://user@d1abc.cloudfront.net'],
    ['BucketName', '10.0.0.1'],
    ['BucketName', 'Bad_Bucket'],
    ['DistributionId', 'lower'],
  ])('rejects %s = %s as bad-outputs', (field, value) => {
    const bad = { StrikeZone: { ...ok.StrikeZone, [field]: value } };
    expect(validateOutputs(bad)).toEqual({ ok: false, reason: 'bad-outputs', field });
  });

  it('rejects a missing stack or root', () => {
    expect(validateOutputs({})).toMatchObject({ ok: false, field: 'StrikeZone' });
    expect(validateOutputs('x')).toMatchObject({ ok: false, field: 'root' });
  });
});

describe('freshness inputs', () => {
  it('finds the newest file mtime under the source trees, skipping build output', () => {
    const fs = {
      list: (dir: string) => {
        if (dir.endsWith('/src')) {
          return [
            { name: 'a.ts', isDir: false, mtimeMs: 10 },
            { name: 'sub', isDir: true, mtimeMs: 0 },
            { name: 'node_modules', isDir: true, mtimeMs: 0 },
          ];
        }
        if (dir.endsWith('/src/sub')) return [{ name: 'b.ts', isDir: false, mtimeMs: 30 }];
        if (dir.endsWith('/node_modules')) return [{ name: 'c.ts', isDir: false, mtimeMs: 99 }];
        return [];
      },
    };
    expect(newestMtime('/r', ['src', 'tests'], fs)).toBe(30);
    expect(newestMtime(tmpRoot(), ['src'])).toBe(0);
  });

  it('hashes the lockfile and returns null for a missing file', () => {
    expect(sha256OfFile('package-lock.json')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256OfFile('no-such-file')).toBeNull();
  });
});
