/** Shared builders for tests/verification. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  Check,
  EvidenceInputs,
  ManualResult,
  SmokeReport,
  TestFileResult,
  VitestResults,
} from '../../scripts/verification/types.ts';

export function tmpRoot(prefix = 'sz-verif-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function put(root: string, rel: string, text: string): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}

export function vitest(
  files: readonly TestFileResult[],
  over: Partial<VitestResults> = {},
): VitestResults {
  const all = files.flatMap((f) => f.assertions);
  return {
    success: true,
    startTime: Date.UTC(2026, 10, 16, 12, 0, 0),
    numTotalTests: all.length,
    numPassedTests: all.filter((a) => a.status === 'passed').length,
    numFailedTests: all.filter((a) => a.status === 'failed').length,
    files,
    ...over,
  };
}

export function inputs(over: Partial<EvidenceInputs> = {}): EvidenceInputs {
  return {
    vitest: vitest([]),
    vitestReason: '',
    stale: false,
    e2e: null,
    e2eReason: 'e2e not run (reports/e2e.json absent)',
    smoke: null,
    smokeReason: 'smoke not run (reports/smoke.json absent)',
    manual: [],
    metrics: new Map(),
    ...over,
  };
}

export function manual(over: Partial<ManualResult> = {}): ManualResult {
  return {
    id: 'MT-01',
    tester: 'Riley',
    date: '2026-11-20',
    browser: 'Chrome',
    browserVersion: '142',
    hardware: 'desktop 1080p',
    outcome: 'pass',
    notes: '',
    ...over,
  };
}

export function check(over: Partial<Check> = {}): Check {
  return {
    id: 'GV-99',
    title: 'Fixture check',
    source: '§13-gameplay',
    stories: [],
    requirements: [],
    refs: [{ kind: 'test', file: 'tests/a.test.ts', name: 'suite' }],
    ...over,
  };
}

export const BLOCKED_SMOKE: SmokeReport = {
  mode: 'blocked',
  reason: 'C1, C2, C3 failed',
  checks: [],
  missing: ['credentials (C2)'],
  commands: ['npm run smoke'],
};

/** A real-shaped Vitest JSON reporter document. */
export function vitestJson(root: string, start: number, success = true): unknown {
  return {
    success,
    startTime: start,
    numTotalTests: 2,
    numPassedTests: success ? 2 : 1,
    numFailedTests: success ? 0 : 1,
    testResults: [
      {
        name: join(root, 'tests/app/dom/app.test.ts'),
        assertionResults: [
          {
            ancestorTitles: ['boot (story-boot-check)'],
            title: 'boots to the main menu',
            status: 'passed',
          },
          {
            ancestorTitles: ['boot (story-boot-check)'],
            title: 'shows the unsupported notice',
            status: success ? 'passed' : 'failed',
          },
        ],
      },
    ],
  };
}
