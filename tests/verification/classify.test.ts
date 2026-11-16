/**
 * Classifier rules BR-VE-20..28 (classify.ts). One test per rule; only
 * automated-pass and manual-pass count as passed.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyAll,
  combine,
  compose,
  evaluateRef,
  isPassed,
  readPath,
} from '../../scripts/verification/classify.ts';
import type {
  CheckEvidence,
  EvidenceRef,
  EvidenceStatus,
} from '../../scripts/verification/types.ts';
import { BLOCKED_SMOKE, check, inputs, manual, vitest } from './helpers.ts';

const T: EvidenceRef = { kind: 'test', file: 'tests/a.test.ts', name: 'suite' };
const passing = vitest([
  {
    file: 'tests/a.test.ts',
    assertions: [
      { fullName: 'suite > one', status: 'passed' },
      { fullName: 'suite > two', status: 'passed' },
      { fullName: 'other > x', status: 'failed' },
    ],
  },
]);
const ctx = (over = {}) => ({ inputs: inputs({ vitest: passing, ...over }), e2eAvailable: true });

function run(
  refs: readonly EvidenceRef[],
  over = {},
  extra = {},
): { status: EvidenceStatus; reason: string } {
  const c = check({ refs, ...extra });
  return combine(
    c,
    refs.map((r) => evaluateRef(r, ctx(over))),
  );
}

describe('classify', () => {
  it('BR-VE-21: every automated ref passing gives automated-pass', () => {
    expect(run([T]).status).toBe('automated-pass');
  });

  it('BR-VE-21: one failed or skipped assertion under the prefix gives automated-fail', () => {
    const v = vitest([
      {
        file: 'tests/a.test.ts',
        assertions: [
          { fullName: 'suite > one', status: 'passed' },
          { fullName: 'suite > two', status: 'skipped' },
        ],
      },
    ]);
    const r = run([T], { vitest: v });
    expect(r.status).toBe('automated-fail');
    expect(r.reason).toContain('1 of 2 not passed');
  });

  it('BR-VE-14: a prefix matching nothing is missing, never pass', () => {
    const r = run([{ kind: 'test', file: 'tests/a.test.ts', name: 'nothing here' }]);
    expect(r.status).toBe('not-verified');
    expect(r.reason).toContain('no test matches');
  });

  it('a file absent from the results is missing (partial run?)', () => {
    const r = run([{ kind: 'test', file: 'tests/b.test.ts', name: 'x' }]);
    expect(r.status).toBe('not-verified');
    expect(r.reason).toContain('partial run?');
  });

  it('BR-VE-26: stale results make every test ref stale', () => {
    const r = run([T], { stale: true });
    expect(r.status).toBe('not-verified');
    expect(r.reason).toContain('older than the newest source file');
  });

  it('missing vitest results give not-verified with the reader reason', () => {
    const r = run([T], { vitest: null, vitestReason: 'reports/vitest-results.json absent' });
    expect(r).toEqual({
      status: 'not-verified',
      reason: 'tests/a.test.ts › suite: reports/vitest-results.json absent',
    });
  });

  it('BR-VE-22: a missed metric target is automated-fail even when the tests pass', () => {
    const metrics = new Map([['b.json', { ok: true as const, value: { span: 720 } }]]);
    const m: EvidenceRef = {
      kind: 'metric',
      report: 'b.json',
      path: ['span'],
      op: '<=',
      target: 300,
      label: 'span',
    };
    const r = run([T, m], { metrics });
    expect(r.status).toBe('automated-fail');
    expect(r.reason).toContain('target <= 300 missed');
    expect(evaluateRef(m, ctx({ metrics })).observed).toBe(720);
  });

  it('metric refs: met targets pass, === compares scalars, absent files are missing', () => {
    const metrics = new Map<string, { ok: true; value: unknown } | { ok: false; reason: string }>([
      ['b.json', { ok: true, value: { n: 2, ok: true, s: 'x', nested: { o: {} } } }],
      ['bad.json', { ok: false, reason: 'unreadable' }],
    ]);
    const c = ctx({ metrics });
    const ev = (r: Partial<EvidenceRef & { kind: 'metric' }>) =>
      evaluateRef(
        { kind: 'metric', report: 'b.json', path: ['n'], op: '>=', target: 1, label: 'l', ...r },
        c,
      ).outcome;
    expect(ev({})).toBe('pass');
    expect(ev({ op: '===', path: ['ok'], target: true })).toBe('pass');
    expect(ev({ op: '===', path: ['s'], target: 'y' })).toBe('fail');
    expect(ev({ op: '===', path: ['nested'], target: 1 })).toBe('missing');
    expect(ev({ path: ['s'] })).toBe('missing');
    expect(ev({ path: ['nope'] })).toBe('missing');
    expect(ev({ report: 'bad.json' })).toBe('missing');
    expect(ev({ report: 'none.json' })).toBe('missing');
  });

  it('SD-VE-07: prototype path segments are refused as unsafe-path', () => {
    expect(readPath({ a: 1 }, ['__proto__'])).toEqual({ ok: false, reason: 'unsafe-path' });
    expect(readPath({ a: 1 }, ['constructor'])).toEqual({ ok: false, reason: 'unsafe-path' });
    expect(readPath({ a: { b: 2 } }, ['a', 'b'])).toEqual({ ok: true, value: 2 });
    expect(readPath(Object.create({ inherited: 1 }) as object, ['inherited']).ok).toBe(false);
  });

  it('BR-VE-25: blocked smoke gives not-verified with the blocked reason', () => {
    const r = run([{ kind: 'smoke', id: 'SM-2' }], { smoke: BLOCKED_SMOKE });
    expect(r.status).toBe('not-verified');
    expect(r.reason).toContain('blocked: C1, C2, C3 failed');
  });

  it('live smoke: a failure is automated-fail and a not-run check is missing', () => {
    const smoke = {
      ...BLOCKED_SMOKE,
      mode: 'live' as const,
      checks: [
        { id: 'SM-2' as const, request: 'r', expected: '200', observed: '500', pass: false },
        {
          id: 'SM-9' as const,
          request: 'r',
          expected: 'x',
          observed: 'not verified: aws CLI unavailable',
          pass: false,
          notVerified: true as const,
        },
        { id: 'SM-1' as const, request: 'r', expected: '301', observed: '301', pass: true },
      ],
    };
    expect(run([{ kind: 'smoke', id: 'SM-2' }], { smoke }).status).toBe('automated-fail');
    expect(run([{ kind: 'smoke', id: 'SM-9' }], { smoke }).status).toBe('not-verified');
    expect(run([{ kind: 'smoke', id: 'SM-1' }], { smoke }).status).toBe('automated-pass');
    expect(run([{ kind: 'smoke', id: 'SM-5' }], { smoke }).status).toBe('not-verified');
  });

  it('BR-VE-23: passing automated refs plus a missing manual result give manual-pending', () => {
    const r = run([T, { kind: 'manual', id: 'MT-03' }]);
    expect(r.status).toBe('manual-pending');
    expect(r.reason).toContain('MT-03 not yet run');
    expect(r.reason).toContain('supporting evidence');
  });

  it('BR-VE-24: a recorded manual pass gives manual-pass; the newest result wins', () => {
    const refs: EvidenceRef[] = [T, { kind: 'manual', id: 'MT-03' }];
    const ok = run(refs, { manual: [manual({ id: 'MT-03' })] });
    expect(ok.status).toBe('manual-pass');
    const flip = run(refs, {
      manual: [
        manual({ id: 'MT-03', date: '2026-11-21', outcome: 'fail' }),
        manual({ id: 'MT-03', date: '2026-11-20' }),
      ],
    });
    expect(flip.status).toBe('manual-fail');
  });

  it('an automated failure outranks a manual pass', () => {
    const v = vitest([
      { file: 'tests/a.test.ts', assertions: [{ fullName: 'suite', status: 'failed' }] },
    ]);
    const r = run([T, { kind: 'manual', id: 'MT-01' }], { vitest: v, manual: [manual()] });
    expect(r.status).toBe('automated-fail');
  });

  it('BR-VE-28: indirect evidence never upgrades a manual-pending entry', () => {
    const r = run([T, { kind: 'manual', id: 'MT-05' }], {}, { indirect: true });
    expect(r.status).toBe('manual-pending');
    expect(run([T], {}, { indirect: true }).reason).toContain('(indirect)');
  });

  it('e2e refs: pending when the browser is unavailable, missing when not run, per-map results', () => {
    const e: EvidenceRef = { kind: 'e2e', id: 'E2E-04' };
    expect(evaluateRef(e, { inputs: inputs(), e2eAvailable: false }).outcome).toBe('pending');
    expect(
      combine(check({ refs: [e] }), [evaluateRef(e, { inputs: inputs(), e2eAvailable: false })])
        .status,
    ).toBe('not-verified');
    expect(evaluateRef(e, ctx()).outcome).toBe('missing');
    const e2e = {
      browser: 'chromium',
      cases: [
        { id: 'E2E-04', map: 'desert-compound', pass: true, errors: [], warnCodes: [] },
        { id: 'E2E-04', map: 'industrial-warehouse', pass: false, errors: ['x'], warnCodes: [] },
      ],
    };
    expect(evaluateRef(e, ctx({ e2e })).outcome).toBe('fail');
    expect(evaluateRef({ kind: 'e2e', id: 'E2E-05' }, ctx({ e2e })).outcome).toBe('missing');
    const good = { ...e2e, cases: e2e.cases.slice(0, 1) };
    expect(evaluateRef(e, ctx({ e2e: good })).outcome).toBe('pass');
  });

  it('BR-VE-20: only automated-pass and manual-pass count as passed', () => {
    const passed = (
      [
        'automated-pass',
        'automated-fail',
        'manual-pass',
        'manual-fail',
        'manual-pending',
        'not-verified',
      ] as const
    ).filter(isPassed);
    expect(passed).toEqual(['automated-pass', 'manual-pass']);
  });
});

describe('DOD composition', () => {
  const ev = (id: string, status: EvidenceStatus): CheckEvidence => ({
    id,
    title: id,
    status,
    reason: '',
    indirect: false,
    refs: [],
  });

  it('takes the weakest part', () => {
    expect(compose([ev('a', 'automated-pass'), ev('b', 'not-verified')]).status).toBe(
      'not-verified',
    );
    expect(compose([ev('a', 'manual-pending'), ev('b', 'automated-pass')]).status).toBe(
      'manual-pending',
    );
    expect(compose([ev('a', 'automated-fail'), ev('b', 'not-verified')]).status).toBe(
      'automated-fail',
    );
    expect(compose([ev('a', 'manual-fail'), ev('b', 'automated-pass')]).status).toBe('manual-fail');
    expect(compose([ev('a', 'manual-pass'), ev('b', 'automated-pass')]).status).toBe('manual-pass');
    expect(compose([ev('a', 'automated-pass')]).status).toBe('automated-pass');
    expect(compose([]).status).toBe('not-verified');
  });

  it('classifyAll keeps register order and composes DOD rows from classified parts', () => {
    const checks = [
      check({ id: 'GV-A', refs: [T] }),
      check({ id: 'GV-B', refs: [{ kind: 'smoke', id: 'SM-1' }] }),
      check({ id: 'DOD-X', refs: [], composedOf: ['GV-A', 'GV-B'] }),
      check({ id: 'DOD-Y', refs: [], composedOf: ['GV-A'] }),
    ];
    const out = classifyAll(checks, ctx());
    expect(out.map((c) => [c.id, c.status])).toEqual([
      ['GV-A', 'automated-pass'],
      ['GV-B', 'not-verified'],
      ['DOD-X', 'not-verified'],
      ['DOD-Y', 'automated-pass'],
    ]);
    expect(out[2]?.reason).toContain('GV-B not-verified');
  });
});
