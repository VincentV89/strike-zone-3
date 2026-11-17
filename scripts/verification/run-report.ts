/**
 * `npm run report` (Flow V4 + V5): load and validate the on-disk evidence,
 * classify the register, render evidence.json and docs/FINAL-REPORT.md and
 * write both through the masker in `finally` (BR-VE-62). It never runs a
 * test or a network call (BR-VE-06).
 */
import { readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { CHECKS, CUTS, E2E_AVAILABLE, LIMITATIONS, MANUAL_IDS } from './checks.ts';
import { classifyAll } from './classify.ts';
import { CAP_DEFAULT, CAP_MANUAL, CAP_VITEST, readJsonBounded, type ReadResult } from './read.ts';
import {
  countTotals,
  renderEvidenceJson,
  renderReport,
  type CoverageRow,
  type EvidenceFile,
  type InputFileInfo,
} from './render.ts';
import { newestMtime, sha256OfFile } from './stat.ts';
import type { Check, EvidenceInputs, ManualResult } from './types.ts';
import {
  isRecord,
  own,
  validateE2e,
  validateManual,
  validatePrecheck,
  validateSmoke,
  validateVitest,
} from './validate.ts';
import { writeMasked } from './write.ts';

export const EVIDENCE_PATH = 'reports/evidence.json';
export const REPORT_PATH = 'docs/FINAL-REPORT.md';

export interface ReportRun {
  readonly exitCode: 0 | 1;
  readonly evidence: EvidenceFile;
  readonly markdown: string;
}

function why(r: ReadResult, file: string): string {
  return r.ok ? '' : r.reason === 'absent' ? `${file} absent` : `${r.reason} ${file}`;
}

function mtimeOf(path: string): string | null {
  const s = statSync(path, { throwIfNoEntry: false });
  return s === undefined ? null : new Date(s.mtimeMs).toISOString();
}

/** Register self-check at run time (the full check is tests/verification/register.test.ts). */
export function registerProblems(checks: readonly Check[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const c of checks) {
    if (ids.has(c.id)) problems.push(`verification/duplicate-check ${c.id}`);
    ids.add(c.id);
    if (c.composedOf === undefined && c.refs.length === 0)
      problems.push(`verification/no-refs ${c.id}`);
  }
  for (const c of checks) {
    for (const p of c.composedOf ?? []) {
      if (!ids.has(p)) problems.push(`verification/unknown-part ${c.id} -> ${p}`);
    }
  }
  return problems;
}

/** Aggregates coverage-summary.json per area (src/<dir>, scripts/verification). */
export function coverageRows(value: unknown, root: string): CoverageRow[] | null {
  if (!isRecord(value)) return null;
  const areas = new Map<string, { lines: number; covered: number }>();
  for (const key of Object.keys(value)) {
    if (key === 'total') continue;
    const entry = own(value, key);
    if (!isRecord(entry)) continue;
    const lines = own(entry, 'lines');
    if (!isRecord(lines)) continue;
    const total = own(lines, 'total');
    const covered = own(lines, 'covered');
    if (typeof total !== 'number' || typeof covered !== 'number') continue;
    const rel = (key.startsWith('/') ? relative(root, key) : key).split(sep).join('/');
    const parts = rel.split('/');
    const area = parts.length > 2 ? `${parts[0] ?? ''}/${parts[1] ?? ''}` : (parts[0] ?? rel);
    const row = areas.get(area) ?? { lines: 0, covered: 0 };
    row.lines += total;
    row.covered += covered;
    areas.set(area, row);
  }
  return [...areas.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([area, r]) => ({ area, lines: r.lines, covered: r.covered }));
}

/** The `## Controls` table from README.md (single source with the Controls screen). */
export function readmeControls(readme: string): string | null {
  const m = /^## Controls\s*$([\s\S]*?)^## /m.exec(readme);
  if (m === null) return null;
  const table = (m[1] ?? '')
    .split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .join('\n');
  return table === '' ? null : table;
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export async function buildReport(root: string): Promise<ReportRun> {
  const p = (f: string): string => join(root, f);
  const problems = registerProblems(CHECKS);

  const vitestRaw = readJsonBounded(p('reports/vitest-results.json'), CAP_VITEST);
  const vitest = vitestRaw.ok ? validateVitest(vitestRaw.value, root) : null;
  const vitestReason = vitestRaw.ok
    ? vitest === null
      ? 'unreadable reports/vitest-results.json'
      : ''
    : why(vitestRaw, 'reports/vitest-results.json');
  const stale = vitest !== null && newestMtime(root) > vitest.startTime;

  const e2eRaw = readJsonBounded(p('reports/e2e.json'), CAP_DEFAULT);
  const e2e = e2eRaw.ok ? validateE2e(e2eRaw.value) : null;
  const smokeRaw = readJsonBounded(p('reports/smoke.json'), CAP_DEFAULT);
  const smoke = smokeRaw.ok ? validateSmoke(smokeRaw.value) : null;
  const preRaw = readJsonBounded(p('reports/precheck.json'), CAP_DEFAULT);
  const precheck = preRaw.ok ? validatePrecheck(preRaw.value) : null;

  const manualRaw = readJsonBounded(p('verification/manual-results.json'), CAP_MANUAL);
  let manual: readonly ManualResult[] = [];
  if (manualRaw.ok) {
    const parsed = validateManual(manualRaw.value, new Set<string>(MANUAL_IDS));
    manual = parsed.results;
    problems.push(...parsed.rejected);
  } else if (manualRaw.reason !== 'absent') {
    problems.push(`${manualRaw.reason} verification/manual-results.json`);
  }

  const metricFiles = [
    ...new Set(
      CHECKS.flatMap((c) => c.refs.flatMap((r) => (r.kind === 'metric' ? [r.report] : []))),
    ),
  ].sort();
  const metrics = new Map<string, { ok: true; value: unknown } | { ok: false; reason: string }>();
  for (const f of metricFiles) {
    const r = readJsonBounded(p(`reports/${f}`), CAP_DEFAULT);
    metrics.set(f, r.ok ? { ok: true, value: r.value } : { ok: false, reason: r.reason });
  }

  const inputs: EvidenceInputs = {
    vitest,
    vitestReason,
    stale,
    e2e,
    e2eReason: e2eRaw.ok
      ? e2e === null
        ? 'unreadable reports/e2e.json'
        : ''
      : 'e2e not run (reports/e2e.json absent)',
    smoke,
    smokeReason: smokeRaw.ok
      ? smoke === null
        ? 'unreadable reports/smoke.json'
        : ''
      : 'smoke not run (reports/smoke.json absent)',
    manual,
    metrics,
  };
  const checks = classifyAll(CHECKS, { inputs, e2eAvailable: E2E_AVAILABLE });

  const covRaw = readJsonBounded(p('coverage/coverage-summary.json'), CAP_DEFAULT);
  const coverage = covRaw.ok ? coverageRows(covRaw.value, root) : null;
  const pkg = readJsonBounded(p('package.json'), CAP_DEFAULT);
  const version = pkg.ok && isRecord(pkg.value) ? own(pkg.value, 'version') : undefined;
  const bundleFile = metrics.get('app-shell-bundle.json');
  let bundle: { bytes: number; brotliBytes: number } | null = null;
  if (bundleFile?.ok === true && isRecord(bundleFile.value)) {
    const entry = own(bundleFile.value, 'entry');
    if (isRecord(entry)) {
      const bytes = own(entry, 'bytes');
      const brotliBytes = own(entry, 'brotliBytes');
      if (typeof bytes === 'number' && typeof brotliBytes === 'number')
        bundle = { bytes, brotliBytes };
    }
  }
  const matrixFile = metrics.get('game-simulation-matrix.json');

  const inputFiles = [
    'reports/vitest-results.json',
    'coverage/coverage-summary.json',
    'reports/e2e.json',
    'reports/precheck.json',
    'reports/smoke.json',
    'verification/manual-results.json',
    ...metricFiles.map((f) => `reports/${f}`),
  ];
  const inputInfo: InputFileInfo[] = inputFiles.map((file) => {
    const mtime = mtimeOf(p(file));
    return { file, present: mtime !== null, mtime };
  });

  const evidence: EvidenceFile = {
    generatedAt:
      vitest === null ? 'unknown (no test results)' : new Date(vitest.startTime).toISOString(),
    inputs: inputInfo,
    lockfileSha256: sha256OfFile(p('package-lock.json')),
    runFailed: vitest === null || !vitest.success,
    stale,
    problems,
    totals: countTotals(checks),
    checks,
  };
  const readme = readText(p('README.md'));
  const markdown = await renderReport({
    evidence,
    vitest,
    coverage,
    smoke,
    precheck,
    packageVersion: typeof version === 'string' ? version : 'unknown',
    readmeControls: readme === null ? null : readmeControls(readme),
    matrix: matrixFile?.ok === true ? matrixFile.value : null,
    bundle,
    cuts: CUTS,
    limitations: LIMITATIONS,
    e2eAvailable: E2E_AVAILABLE,
  });
  const failed =
    evidence.runFailed ||
    problems.some((x) => x.startsWith('verification/')) ||
    checks.some((c) => c.status === 'automated-fail');
  return { exitCode: failed ? 1 : 0, evidence, markdown };
}

/** Writes both outputs through the masker; a masked hit makes the run fail. */
export function writeReport(root: string, run: ReportRun | null, error: unknown): 0 | 1 | 2 {
  if (run === null) {
    const text = `# StrikeZone — Final Report\n\nThe report run failed before rendering: ${error instanceof Error ? error.message : 'unknown error'}.\n`;
    writeMasked(root, REPORT_PATH, text);
    return 2;
  }
  const a = writeMasked(root, EVIDENCE_PATH, renderEvidenceJson(run.evidence));
  const b = writeMasked(root, REPORT_PATH, run.markdown);
  const hits = [...a.hits, ...b.hits];
  for (const h of hits)
    console.error(`verification/masked-output ${h.ruleId} x ${String(h.count)}`);
  return hits.length > 0 ? 1 : run.exitCode;
}
