/**
 * Types of the verification unit (domain-entities-verification). Node-only,
 * erasable syntax; never imported by src/.
 */

export type CheckSource =
  '§13-gameplay' | '§13-deployment' | '§13-bot-config' | '§17' | 'requirement';

export type ManualId = 'MT-01' | 'MT-02' | 'MT-03' | 'MT-04' | 'MT-05' | 'MT-06' | 'MT-07';
export type E2eId = 'E2E-01' | 'E2E-02' | 'E2E-03' | 'E2E-04' | 'E2E-05';
export type SmokeId =
  'SM-1' | 'SM-2' | 'SM-3' | 'SM-4' | 'SM-4b' | 'SM-5' | 'SM-6' | 'SM-7' | 'SM-8' | 'SM-9';

export interface TestRef {
  readonly kind: 'test';
  readonly file: string;
  /** Prefix of the full name: ancestor titles and title joined by ' > '. */
  readonly name: string;
}
export interface E2eRef {
  readonly kind: 'e2e';
  readonly id: E2eId;
}
export interface SmokeRef {
  readonly kind: 'smoke';
  readonly id: SmokeId;
}
export interface MetricRef {
  readonly kind: 'metric';
  /** File name under reports/. */
  readonly report: string;
  /** Property path; each step is read with Object.hasOwn (SD-VE-07). */
  readonly path: readonly string[];
  readonly op: '<=' | '>=' | '===';
  readonly target: number | string | boolean;
  readonly label: string;
}
export interface ManualRef {
  readonly kind: 'manual';
  readonly id: ManualId;
}

export type EvidenceRef = TestRef | E2eRef | SmokeRef | MetricRef | ManualRef;

export interface Check {
  readonly id: string;
  readonly title: string;
  readonly source: CheckSource;
  readonly stories: readonly string[];
  readonly requirements: readonly string[];
  readonly refs: readonly EvidenceRef[];
  /** Required manual follow-up (BR-VE-23). */
  readonly manual?: ManualId;
  /** Every automated ref is indirect evidence (BR-VE-28). */
  readonly indirect?: true;
  /** DOD rows only: status is the weakest of the parts. */
  readonly composedOf?: readonly string[];
}

export interface Cut {
  readonly story: string;
  readonly requirement: string;
  readonly reason: string;
  /** data-testid values that must be absent from the rendered screens. */
  readonly removedControls: readonly string[];
}

export interface KnownLimitation {
  readonly id: string;
  readonly text: string;
  readonly relatesTo: readonly string[];
}

export type RefOutcome = 'pass' | 'fail' | 'missing' | 'stale' | 'pending' | 'blocked';

export type EvidenceStatus =
  | 'automated-pass'
  | 'automated-fail'
  | 'manual-pass'
  | 'manual-fail'
  | 'manual-pending'
  | 'not-verified';

export const EVIDENCE_STATUSES: readonly EvidenceStatus[] = [
  'automated-pass',
  'automated-fail',
  'manual-pass',
  'manual-fail',
  'manual-pending',
  'not-verified',
];

export interface RefEvaluation {
  readonly ref: EvidenceRef;
  readonly outcome: RefOutcome;
  readonly reason: string;
  readonly observed?: string | number | boolean;
}

export interface CheckEvidence {
  readonly id: string;
  readonly title: string;
  readonly status: EvidenceStatus;
  readonly reason: string;
  readonly indirect: boolean;
  readonly refs: readonly RefEvaluation[];
}

// ---- run inputs (validated shapes) ----

export type AssertionStatus = 'passed' | 'failed' | 'skipped' | 'pending' | 'todo' | 'other';

export interface Assertion {
  readonly fullName: string;
  readonly status: AssertionStatus;
}

export interface TestFileResult {
  /** Repo-relative POSIX path. */
  readonly file: string;
  readonly assertions: readonly Assertion[];
}

export interface VitestResults {
  readonly success: boolean;
  readonly startTime: number;
  readonly numTotalTests: number;
  readonly numPassedTests: number;
  readonly numFailedTests: number;
  readonly files: readonly TestFileResult[];
}

export interface E2eCase {
  readonly id: string;
  readonly map: string;
  readonly pass: boolean;
  readonly errors: readonly string[];
  readonly warnCodes: readonly string[];
}

export interface E2eReport {
  readonly browser: string;
  readonly cases: readonly E2eCase[];
}

export interface ProbeResult {
  readonly id: 'C1' | 'C2' | 'C3' | 'C4';
  readonly pass: boolean;
  readonly sourceKind?: 'env' | 'profile-file' | 'web-identity' | 'container';
  readonly reason?: string;
}

export interface Precheck {
  readonly probes: readonly ProbeResult[];
  readonly account?: string;
  readonly region?: string;
}

export interface SmokeCheckResult {
  readonly id: SmokeId;
  readonly request: string;
  readonly expected: string;
  readonly observed: string;
  readonly pass: boolean;
  /** Not run: the outcome is unknown, never a pass (SM-9 without the CLI, SM-8 without a log). */
  readonly notVerified?: true;
}

export interface SmokeReport {
  readonly mode: 'live' | 'blocked';
  readonly reason?: string;
  readonly url?: string;
  readonly checks: readonly SmokeCheckResult[];
  readonly missing: readonly string[];
  readonly commands: readonly string[];
}

export interface ManualResult {
  readonly id: ManualId;
  readonly tester: string;
  readonly date: string;
  readonly browser: string;
  readonly browserVersion: string;
  readonly hardware: string;
  readonly outcome: 'pass' | 'fail';
  readonly notes: string;
}

export interface DeployOutputs {
  readonly origin: string;
  readonly host: string;
  readonly distributionId: string;
  readonly bucket: string;
}

/** Everything the classifier reads, already validated. Absent inputs are null. */
export interface EvidenceInputs {
  readonly vitest: VitestResults | null;
  readonly vitestReason: string;
  readonly stale: boolean;
  readonly e2e: E2eReport | null;
  readonly e2eReason: string;
  readonly smoke: SmokeReport | null;
  readonly smokeReason: string;
  readonly manual: readonly ManualResult[];
  readonly metrics: ReadonlyMap<
    string,
    { ok: true; value: unknown } | { ok: false; reason: string }
  >;
}
