/**
 * npm run smoke [-- --precheck] [--root <dir>]
 *
 * Entry point only; the logic is in scripts/verification/run-smoke.ts.
 * The expected headers are the hosting-infra constants themselves, never
 * copies (BR-VE-47), so aws-cdk-lib loads only in this real run.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { CSP, PERMISSIONS_POLICY } from '../infra/lib/policy.ts';
import { runAws } from './verification/aws.ts';
import {
  runPrecheckCommand,
  runSmokeCommand,
  type SmokeRunDeps,
} from './verification/run-smoke.ts';

const argv = process.argv.slice(2);
const rootIdx = argv.indexOf('--root');
const root = rootIdx === -1 ? '.' : (argv[rootIdx + 1] ?? '.');

const deps: SmokeRunDeps = {
  root,
  env: process.env,
  aws: (call) => runAws(call),
  fetch,
  sleep: async (ms) => {
    await sleep(ms);
  },
  expected: { csp: CSP, permissionsPolicy: PERMISSIONS_POLICY },
};

try {
  if (argv.includes('--precheck')) {
    const pre = await runPrecheckCommand(deps);
    for (const p of pre.probes)
      console.log(`  ${p.id} ${p.pass ? 'pass' : `FAIL ${p.reason ?? ''}`}`);
  } else {
    const report = await runSmokeCommand(deps);
    console.log(
      `  smoke mode: ${report.mode}${report.reason === undefined ? '' : ` (${report.reason})`}`,
    );
    for (const c of report.checks)
      console.log(`  ${c.id} ${c.pass ? 'pass' : 'FAIL'} ${c.observed}`);
    if (report.mode === 'live' && report.checks.some((c) => !c.pass && c.notVerified !== true)) {
      process.exitCode = 1;
    }
  }
} catch (e) {
  console.error(`verification/smoke-crashed: ${e instanceof Error ? e.message : 'unknown'}`);
  process.exitCode = 2;
}
