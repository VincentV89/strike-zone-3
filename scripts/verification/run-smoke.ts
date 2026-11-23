/**
 * `npm run smoke` (Flow V6) and `npm run smoke -- --precheck` (Flow V3 precheck).
 * Blocked mode is a reported outcome, not a tool failure, so it exits 0.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AwsCall, AwsRun } from './aws.ts';
import { validateOutputs } from './outputs.ts';
import { precheckReady, runPrecheck, type ProbeDeps } from './probe.ts';
import { CAP_DEFAULT, readJsonBounded } from './read.ts';
import { stableJson } from './render.ts';
import {
  binaryAssetsOf,
  OPERATOR_COMMANDS,
  runSmokeChecks,
  type LocalBinaryAsset,
  type ExpectedHeaders,
  type FetchLike,
} from './smoke-checks.ts';
import type { Precheck, SmokeReport } from './types.ts';
import { validatePrecheck } from './validate.ts';
import { writeMasked } from './write.ts';

export const PRECHECK_PATH = 'reports/precheck.json';
export const SMOKE_PATH = 'reports/smoke.json';

export interface SmokeRunDeps {
  readonly root: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly aws: (call: AwsCall) => Promise<AwsRun>;
  readonly fetch: FetchLike;
  readonly sleep: (ms: number) => Promise<void>;
  readonly expected: ExpectedHeaders;
  readonly statSize?: (path: string) => number | null;
  /** Lists `<root>/dist/assets` (SM-4c); null when it does not exist. */
  readonly listDistAssets?: (root: string) => readonly LocalBinaryAsset[] | null;
}

/** The binary assets of the local verified bundle, or null without dist/assets. */
export function nodeListDistAssets(root: string): readonly LocalBinaryAsset[] | null {
  const dir = join(root, 'dist/assets');
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const entries = names.flatMap((name) => {
    const size = nodeStatSize(join(dir, name));
    return size === null ? [] : [{ name, size }];
  });
  return binaryAssetsOf(entries);
}

export function nodeStatSize(path: string): number | null {
  const s = statSync(path, { throwIfNoEntry: false });
  return s?.isFile() === true ? s.size : null;
}

function probeDeps(d: SmokeRunDeps): ProbeDeps {
  return { env: d.env, statSize: d.statSize ?? nodeStatSize, aws: d.aws };
}

export function missingItems(pre: Precheck): string[] {
  const names: Record<string, string> = {
    C1: 'aws CLI (C1)',
    C2: 'credentials (C2)',
    C3: 'working identity (C3)',
    C4: 'region (C4)',
  };
  return pre.probes
    .filter((x) => !x.pass)
    .map((x) => `${names[x.id] ?? x.id}: ${x.reason ?? 'failed'}`);
}

export function blockedReport(reason: string, missing: readonly string[]): SmokeReport {
  return { mode: 'blocked', reason, checks: [], missing, commands: OPERATOR_COMMANDS };
}

export async function runPrecheckCommand(d: SmokeRunDeps): Promise<Precheck> {
  const pre = await runPrecheck(probeDeps(d));
  writeMasked(d.root, PRECHECK_PATH, stableJson(pre));
  return pre;
}

/** Live mode needs reports/cdk-outputs.json; otherwise smoke reports why it is blocked. */
export async function runSmokeCommand(d: SmokeRunDeps): Promise<SmokeReport> {
  let report: SmokeReport = blockedReport('not started', []);
  try {
    const outputsRaw = readJsonBounded(join(d.root, 'reports/cdk-outputs.json'), CAP_DEFAULT);
    const preRaw = readJsonBounded(join(d.root, PRECHECK_PATH), CAP_DEFAULT);
    const pre = preRaw.ok ? validatePrecheck(preRaw.value) : null;
    const precheck = pre ?? (await runPrecheck(probeDeps(d)));
    if (!outputsRaw.ok) {
      const missing = missingItems(precheck);
      const failed = precheck.probes.filter((x) => !x.pass).map((x) => x.id);
      report = blockedReport(
        failed.length > 0
          ? `${failed.join(', ')} failed`
          : 'approval-not-given or deploy not run (reports/cdk-outputs.json absent)',
        missing.length > 0 ? missing : ['deploy approval and a deploy run'],
      );
      return report;
    }
    const outputs = validateOutputs(outputsRaw.value);
    if (!outputs.ok) {
      report = blockedReport(`bad-outputs (${outputs.field})`, [
        `valid ${outputs.field} in reports/cdk-outputs.json`,
      ]);
      return report;
    }
    if (precheck.region === undefined) {
      report = blockedReport('C4 failed', ['region (C4)']);
      return report;
    }
    let redeployLog: string | null = null;
    try {
      redeployLog = readFileSync(join(d.root, 'reports/redeploy.log'), 'utf8');
    } catch {
      redeployLog = null;
    }
    const checks = await runSmokeChecks(
      {
        outputs: outputs.value,
        region: precheck.region,
        expected: d.expected,
        redeployLog,
        binaryAssets: (d.listDistAssets ?? nodeListDistAssets)(d.root),
      },
      { fetch: d.fetch, sleep: d.sleep, aws: precheckReady(precheck) ? d.aws : null },
    );
    report = { mode: 'live', url: outputs.value.origin, checks, missing: [], commands: [] };
    return report;
  } finally {
    writeMasked(d.root, SMOKE_PATH, stableJson(report));
  }
}
