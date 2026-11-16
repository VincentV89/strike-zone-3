/**
 * npm run report [-- --root <dir>]
 *
 * Entry point only; the logic is in scripts/verification/run-report.ts.
 * Exit 0 clean, 1 automated-fail / failed run / register error / masked hit,
 * 2 programmer error.
 */
import { buildReport, writeReport, type ReportRun } from './verification/run-report.ts';

const argv = process.argv.slice(2);
const rootIdx = argv.indexOf('--root');
const root = rootIdx === -1 ? '.' : (argv[rootIdx + 1] ?? '.');

let run: ReportRun | null = null;
let error: unknown = null;
try {
  run = await buildReport(root);
} catch (e) {
  error = e;
  console.error(`verification/report-crashed: ${e instanceof Error ? e.message : 'unknown'}`);
} finally {
  process.exitCode = writeReport(root, run, error);
}
if (run !== null) {
  const t = run.evidence.totals;
  console.log(
    `  report: automated-pass ${String(t['automated-pass'])}, automated-fail ${String(t['automated-fail'])}, manual-pending ${String(t['manual-pending'])}, not-verified ${String(t['not-verified'])}`,
  );
  console.log('  wrote docs/FINAL-REPORT.md and reports/evidence.json');
}
