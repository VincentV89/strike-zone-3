/** Renderer and the report run (Flow V5, BR-VE-50..55, Q-VE-03). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'prettier';
import { describe, expect, it } from 'vitest';
import { CHECKS, CUTS, LIMITATIONS } from '../../scripts/verification/checks.ts';
import { classifyAll } from '../../scripts/verification/classify.ts';
import {
  countTotals,
  escapeMd,
  renderEvidenceJson,
  renderReport,
  renderReportMarkdown,
  stableJson,
  type ReportInputs,
} from '../../scripts/verification/render.ts';
import { buildReport, coverageRows, writeReport } from '../../scripts/verification/run-report.ts';
import { BLOCKED_SMOKE, inputs, manual, put, tmpRoot, vitest, vitestJson } from './helpers.ts';

function reportInputs(over: Partial<ReportInputs> = {}): ReportInputs {
  const v = vitest([
    {
      file: 'tests/sim/rounds.test.ts',
      assertions: [
        { fullName: 'bot-count matrix (req-bot-count-test-matrix) > x', status: 'passed' },
      ],
    },
  ]);
  const checks = classifyAll(CHECKS, {
    inputs: inputs({ vitest: v, smoke: BLOCKED_SMOKE }),
    e2eAvailable: true,
  });
  return {
    evidence: {
      generatedAt: '2026-11-16T12:00:00.000Z',
      inputs: [
        { file: 'reports/vitest-results.json', present: true, mtime: '2026-11-16T12:05:00.000Z' },
      ],
      lockfileSha256: 'ab'.repeat(32),
      runFailed: false,
      stale: false,
      problems: [],
      totals: countTotals(checks),
      checks,
    },
    vitest: v,
    coverage: [{ area: 'src/core', lines: 200, covered: 190 }],
    smoke: BLOCKED_SMOKE,
    precheck: { probes: [], account: '123456789012', region: 'eu-west-1' },
    packageVersion: '0.1.0',
    readmeControls: '| Action | Keys |\n| --- | --- |\n| Move | W A S D |',
    matrix: {
      cells: [
        { map: 'desert-compound', bots: 1, pass: true, outcome: 'victory', ticks: 900, kills: 1 },
      ],
    },
    bundle: { bytes: 823_005, brotliBytes: 190_068 },
    cuts: CUTS,
    limitations: LIMITATIONS,
    e2eAvailable: true,
    ...over,
  };
}

describe('render', () => {
  it('is deterministic: the same inputs give byte-identical output (Q-VE-03)', async () => {
    const a = await renderReport(reportInputs());
    const b = await renderReport(reportInputs());
    expect(a).toBe(b);
    expect(renderEvidenceJson(reportInputs().evidence)).toBe(
      renderEvidenceJson(reportInputs().evidence),
    );
  });

  it('is already Prettier-formatted so npm run lint accepts the committed file', async () => {
    const md = await renderReport(reportInputs());
    expect(
      await format(md, {
        parser: 'markdown',
        singleQuote: true,
        trailingComma: 'all',
        printWidth: 100,
      }),
    ).toBe(md);
  });

  it('has §16 A–H in order, then §17, Cuts and Known Limitations (BR-VE-50)', () => {
    const md = renderReportMarkdown(reportInputs());
    const heads = md
      .split('\n')
      .filter((l) => l.startsWith('## '))
      .map((l) => l.slice(3, 5));
    expect(heads).toEqual(['A.', 'B.', 'C.', 'D.', 'E.', 'F.', 'G.', 'H.', 'De', 'Cu', 'Kn']);
    expect(md).toContain('npx cdk deploy --all');
    expect(md).toContain('npx cdk destroy --all');
    expect(md).toContain('CDKToolkit');
    expect(md).toContain('No features were cut.');
  });

  it('prints "not yet available" for the URL and identity while deploy is blocked', () => {
    const md = renderReportMarkdown(reportInputs());
    expect(md).toContain(
      '**Public HTTPS URL:** not yet available: deploy blocked (C1, C2, C3 failed)',
    );
    expect(md).toContain('**AWS account ID:** not yet available');
    expect(md).not.toContain('123456789012');
    expect(md).toContain('Deployment is **blocked**');
    expect(md).toContain('npm run smoke');
  });

  it('shows the URL, account and region only after a live smoke run', () => {
    const live = {
      ...BLOCKED_SMOKE,
      mode: 'live' as const,
      url: 'https://d1abc.cloudfront.net',
      checks: [],
    };
    const md = renderReportMarkdown(reportInputs({ smoke: live }));
    expect(md).toContain('**Public HTTPS URL:** https://d1abc.cloudfront.net');
    expect(md).toContain('**AWS account ID:** 123456789012');
    expect(md).toContain('**AWS region:** eu-west-1');
    expect(md).toContain('Deployed, **not verified**');
    expect(renderReportMarkdown(reportInputs({ smoke: null }))).toContain(
      'npm run smoke has not run',
    );
  });

  it('lists every register entry with its status and every non-passed one under limitations', () => {
    const md = renderReportMarkdown(reportInputs());
    for (const c of CHECKS) expect(md, c.id).toContain(`| ${c.id} |`);
    expect(md).toContain('**GV-15m**');
    expect(md).toContain('**KL-02.**');
    expect(md).toContain('| desert-compound | 1 | pass ✓ | victory | 900 | 1 |');
    expect(md).toContain('823005 B minified');
  });

  it('marks a failed or stale run in the header and shows rejected inputs as problems', () => {
    const base = reportInputs();
    const md = renderReportMarkdown(
      reportInputs({
        evidence: {
          ...base.evidence,
          runFailed: true,
          stale: true,
          problems: ['rejected manual result 0: unknown id'],
        },
      }),
    );
    expect(md).toContain('**FAILED**');
    expect(md).toContain('**results are stale**');
    expect(md).toContain('rejected manual result 0');
  });

  it('escapes values from input files so they cannot break a table or inject markup (SD-VE-07)', async () => {
    expect(escapeMd('a|b\n<img src=x>[l](u) `c`')).toBe('a\\|b \\<img src=x\\>\\[l\\](u) \\`c\\`');
    const hostile = manual({ id: 'MT-03', tester: 'x | <script>', notes: 'n' });
    const v = vitest([
      {
        file: 'tests/app/machine.test.ts',
        assertions: [{ fullName: 'AppState machine rows > r', status: 'passed' }],
      },
      {
        file: 'tests/app/dom/app.test.ts',
        assertions: [{ fullName: 'pause and resume (F2, req-pause-menu) > p', status: 'passed' }],
      },
    ]);
    const checks = classifyAll(CHECKS, {
      inputs: inputs({ vitest: v, manual: [hostile] }),
      e2eAvailable: true,
    });
    const base = reportInputs();
    expect(checks.find((c) => c.id === 'GV-05')?.status).toBe('manual-pass');
    const md = await renderReport(reportInputs({ evidence: { ...base.evidence, checks } }));
    expect(md).not.toContain('<script>');
    expect(md).toContain('x \\| \\<script\\>');
  });

  it('renders cuts as a table and the totals in a stable key order', () => {
    const md = renderReportMarkdown(
      reportInputs({
        cuts: [
          {
            story: 'story-radar',
            requirement: 'req-radar',
            reason: 'time',
            removedControls: ['hud-radar'],
          },
        ],
      }),
    );
    expect(md).toContain('| story-radar | req-radar | time | hud-radar |');
    expect(stableJson({ b: 1, a: { d: 1, c: 2 } })).toBe(
      '{\n  "a": {\n    "c": 2,\n    "d": 1\n  },\n  "b": 1\n}\n',
    );
  });
});

describe('report run', () => {
  function fixtureRoot(
    opts: { success?: boolean; manualText?: string; readmeExtra?: string } = {},
  ): string {
    const root = tmpRoot();
    put(root, 'package.json', JSON.stringify({ version: '9.9.9' }));
    put(root, 'package-lock.json', '{}');
    put(
      root,
      'README.md',
      `# R\n\n## Controls\n\n| Action | Keys |\n| --- | --- |\n| Move | W A S D${opts.readmeExtra ?? ''} |\n\n## Next\n`,
    );
    put(
      root,
      'reports/vitest-results.json',
      JSON.stringify(vitestJson(root, Date.now() + 60_000, opts.success ?? true)),
    );
    put(
      root,
      'coverage/coverage-summary.json',
      JSON.stringify({
        total: { lines: { total: 3, covered: 2 } },
        [join(root, 'src/core/a.ts')]: { lines: { total: 10, covered: 9 } },
        [join(root, 'src/core/b.ts')]: { lines: { total: 10, covered: 7 } },
        'scripts/verification/x.ts': { lines: { total: 4, covered: 4 } },
        bad: 1,
      }),
    );
    put(
      root,
      'reports/game-simulation-stuck-industrial-warehouse.json',
      JSON.stringify({ longestNoProgressSpanTicks: 90 }),
    );
    put(
      root,
      'reports/bot-ai-stuck-industrial-warehouse.json',
      JSON.stringify({ worstStuckSpanTicks: 720 }),
    );
    put(root, 'reports/game-simulation-matrix.json', '{broken');
    if (opts.manualText !== undefined)
      put(root, 'verification/manual-results.json', opts.manualText);
    return root;
  }

  it('classifies on-disk evidence, writes both outputs and exits 1 on GV-15m (expected today)', async () => {
    const root = fixtureRoot({
      manualText: JSON.stringify({ schemaVersion: 1, results: [{ id: 'MT-99' }] }),
    });
    const run = await buildReport(root);
    const gv01 = run.evidence.checks.find((c) => c.id === 'GV-15m');
    expect(gv01?.status).toBe('automated-fail');
    expect(run.evidence.checks.find((c) => c.id === 'GV-01')?.status).toBe('not-verified');
    expect(run.evidence.checks.find((c) => c.id === 'GV-29')?.reason).toContain(
      'unreadable game-simulation-matrix.json',
    );
    expect(run.evidence.problems).toEqual(['rejected manual result 0: unknown id']);
    expect(run.evidence.stale).toBe(false);
    expect(run.exitCode).toBe(1);
    expect(writeReport(root, run, null)).toBe(1);
    const md = readFileSync(join(root, 'docs/FINAL-REPORT.md'), 'utf8');
    expect(md).toContain('Version: 9.9.9');
    expect(md).toMatch(/\|\s*`src\/core`\s*\|\s*16 \/ 20\s*\|\s*80\.0 %\s*\|/);
    const ev = JSON.parse(readFileSync(join(root, 'reports/evidence.json'), 'utf8')) as {
      checks: unknown[];
    };
    expect(ev.checks).toHaveLength(CHECKS.length);
  });

  it('a failed test run marks runFailed and exits 1; oversize manual results are a problem', async () => {
    const root = fixtureRoot({ success: false, manualText: `"${'x'.repeat(70_000)}"` });
    const run = await buildReport(root);
    expect(run.evidence.runFailed).toBe(true);
    expect(run.evidence.problems).toContain('oversize verification/manual-results.json');
    expect(run.exitCode).toBe(1);
  });

  it('missing test results give not-verified everywhere, never a pass', async () => {
    const root = tmpRoot();
    const run = await buildReport(root);
    expect(run.evidence.generatedAt).toBe('unknown (no test results)');
    expect(
      run.evidence.checks.some((c) => c.status === 'automated-pass' || c.status === 'manual-pass'),
    ).toBe(false);
  });

  it('a secret reaching the output is masked and the run exits 1 (SD-VE-01)', async () => {
    const key = 'AKIA' + 'ZZZZZZZZZZZZZZZZ';
    const root = fixtureRoot({ readmeExtra: ` ${key}` });
    const run = await buildReport(root);
    const code = writeReport(root, { ...run, exitCode: 0 }, null);
    expect(code).toBe(1);
    expect(readFileSync(join(root, 'docs/FINAL-REPORT.md'), 'utf8')).not.toContain(key);
  });

  it('a crashed run still writes a report that says so and exits 2 (BR-VE-62)', () => {
    const root = tmpRoot();
    expect(writeReport(root, null, new Error('boom'))).toBe(2);
    expect(readFileSync(join(root, 'docs/FINAL-REPORT.md'), 'utf8')).toContain(
      'failed before rendering: boom',
    );
  });

  it('aggregates coverage per area and rejects a non-object summary', () => {
    expect(
      coverageRows(
        {
          'src/a/x.ts': { lines: { total: 2, covered: 1 } },
          'x.ts': { lines: { total: 1, covered: 1 } },
        },
        '/r',
      ),
    ).toEqual([
      { area: 'src/a', lines: 2, covered: 1 },
      { area: 'x.ts', lines: 1, covered: 1 },
    ]);
    expect(coverageRows(null, '/r')).toBeNull();
  });
});
