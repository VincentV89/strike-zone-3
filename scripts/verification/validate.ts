/**
 * Validators: narrow `unknown` JSON into the verification types by rebuilding
 * every record field by field from an allowlist (SD-VE-07). Extra keys,
 * `__proto__` and `constructor` have no effect. Nothing here throws.
 */
import { relative, sep } from 'node:path';
import type {
  Assertion,
  AssertionStatus,
  E2eCase,
  E2eReport,
  ManualId,
  ManualResult,
  Precheck,
  ProbeResult,
  SmokeCheckResult,
  SmokeId,
  SmokeReport,
  TestFileResult,
  VitestResults,
} from './types.ts';

const MAX_TEXT = 500;

type Rec = Readonly<Record<string, unknown>>;

export function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Own-property read; prototype keys never resolve. */
export function own(rec: Rec, key: string): unknown {
  return Object.hasOwn(rec, key) ? rec[key] : undefined;
}

function str(rec: Rec, key: string, max = MAX_TEXT): string | null {
  const v = own(rec, key);
  return typeof v === 'string' && v.length <= max ? v : null;
}

function num(rec: Rec, key: string): number | null {
  const v = own(rec, key);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function bool(rec: Rec, key: string): boolean | null {
  const v = own(rec, key);
  return typeof v === 'boolean' ? v : null;
}

function strList(rec: Rec, key: string): string[] {
  const v = own(rec, key);
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length <= MAX_TEXT);
}

const ASSERTION_STATUSES = new Set(['passed', 'failed', 'skipped', 'pending', 'todo']);

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

/** Vitest `json` reporter output (subset), file paths made repo-relative. */
export function validateVitest(value: unknown, root: string): VitestResults | null {
  if (!isRecord(value)) return null;
  const success = bool(value, 'success');
  const startTime = num(value, 'startTime');
  const rawFiles = own(value, 'testResults');
  if (success === null || startTime === null || !Array.isArray(rawFiles)) return null;
  const files: TestFileResult[] = [];
  for (const f of rawFiles) {
    if (!isRecord(f)) continue;
    const name = str(f, 'name', 4096);
    const raw = own(f, 'assertionResults');
    if (name === null || !Array.isArray(raw)) continue;
    const assertions: Assertion[] = [];
    for (const a of raw) {
      if (!isRecord(a)) continue;
      const title = str(a, 'title', 4096);
      const statusRaw = str(a, 'status', 32);
      if (title === null || statusRaw === null) continue;
      const ancestors = strList(a, 'ancestorTitles');
      const status: AssertionStatus = ASSERTION_STATUSES.has(statusRaw)
        ? (statusRaw as AssertionStatus)
        : 'other';
      assertions.push({ fullName: [...ancestors, title].join(' > '), status });
    }
    const rel = name.startsWith('/') ? toPosix(relative(root, name)) : toPosix(name);
    files.push({ file: rel, assertions });
  }
  return {
    success,
    startTime,
    numTotalTests: num(value, 'numTotalTests') ?? 0,
    numPassedTests: num(value, 'numPassedTests') ?? 0,
    numFailedTests: num(value, 'numFailedTests') ?? 0,
    files,
  };
}

export function validateE2e(value: unknown): E2eReport | null {
  if (!isRecord(value)) return null;
  const raw = own(value, 'cases');
  if (!Array.isArray(raw)) return null;
  const cases: E2eCase[] = [];
  for (const c of raw) {
    if (!isRecord(c)) continue;
    const id = str(c, 'id', 16);
    const map = str(c, 'map', 64);
    const pass = bool(c, 'pass');
    if (id === null || map === null || pass === null) continue;
    cases.push({ id, map, pass, errors: strList(c, 'errors'), warnCodes: strList(c, 'warnCodes') });
  }
  return { browser: str(value, 'browser', 128) ?? 'unknown', cases };
}

const SMOKE_IDS = new Set<string>([
  'SM-1',
  'SM-2',
  'SM-3',
  'SM-4',
  'SM-4b',
  'SM-4c',
  'SM-5',
  'SM-6',
  'SM-7',
  'SM-8',
  'SM-9',
]);

export function validateSmoke(value: unknown): SmokeReport | null {
  if (!isRecord(value)) return null;
  const mode = str(value, 'mode', 16);
  if (mode !== 'live' && mode !== 'blocked') return null;
  const raw = own(value, 'checks');
  const checks: SmokeCheckResult[] = [];
  if (Array.isArray(raw)) {
    for (const c of raw) {
      if (!isRecord(c)) continue;
      const id = str(c, 'id', 8);
      const pass = bool(c, 'pass');
      if (id === null || !SMOKE_IDS.has(id) || pass === null) continue;
      checks.push({
        id: id as SmokeId,
        request: str(c, 'request') ?? '',
        expected: str(c, 'expected') ?? '',
        observed: str(c, 'observed') ?? '',
        pass,
        ...(bool(c, 'notVerified') === true ? { notVerified: true as const } : {}),
      });
    }
  }
  const reason = str(value, 'reason', 200);
  const url = str(value, 'url', 200);
  return {
    mode,
    ...(reason === null ? {} : { reason }),
    ...(url === null ? {} : { url }),
    checks,
    missing: strList(value, 'missing'),
    commands: strList(value, 'commands'),
  };
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (m === null) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export interface ManualParse {
  readonly results: readonly ManualResult[];
  readonly rejected: readonly string[];
}

/** verification/manual-results.json: `{ schemaVersion: 1, results: [...] }`. */
export function validateManual(value: unknown, ids: ReadonlySet<string>): ManualParse {
  if (!isRecord(value) || own(value, 'schemaVersion') !== 1) {
    return { results: [], rejected: ['manual results: bad envelope'] };
  }
  const raw = own(value, 'results');
  if (!Array.isArray(raw))
    return { results: [], rejected: ['manual results: results is not a list'] };
  const results: ManualResult[] = [];
  const rejected: string[] = [];
  raw.forEach((r, i) => {
    const why = manualReason(r, ids);
    if (typeof why === 'string') rejected.push(`rejected manual result ${String(i)}: ${why}`);
    else results.push(why);
  });
  return { results, rejected };
}

function manualReason(r: unknown, ids: ReadonlySet<string>): ManualResult | string {
  if (!isRecord(r)) return 'not an object';
  const id = str(r, 'id', 8);
  if (id === null || !ids.has(id)) return 'unknown id';
  const tester = str(r, 'tester', 80);
  if (tester === null || tester.trim() === '') return 'tester missing or longer than 80';
  const date = str(r, 'date', 10);
  if (date === null || !isCalendarDate(date)) return 'date is not YYYY-MM-DD';
  const outcome = str(r, 'outcome', 8);
  if (outcome !== 'pass' && outcome !== 'fail') return 'outcome must be pass or fail';
  const browser = str(r, 'browser');
  const browserVersion = str(r, 'browserVersion');
  const hardware = str(r, 'hardware');
  if (browser === null || browserVersion === null || hardware === null) {
    return 'browser, browserVersion and hardware are required (at most 500 characters)';
  }
  const notesRaw = own(r, 'notes');
  if (notesRaw !== undefined && (typeof notesRaw !== 'string' || notesRaw.length > MAX_TEXT)) {
    return 'notes longer than 500';
  }
  return {
    id: id as ManualId,
    tester,
    date,
    browser,
    browserVersion,
    hardware,
    outcome,
    notes: typeof notesRaw === 'string' ? notesRaw : '',
  };
}

const PROBE_IDS = new Set(['C1', 'C2', 'C3', 'C4']);
const SOURCE_KINDS = new Set(['env', 'profile-file', 'web-identity', 'container']);
export const ACCOUNT_RE = /^\d{12}$/;
export const REGION_RE = /^[a-z]{2}(-[a-z]+)+-\d$/;

export function validatePrecheck(value: unknown): Precheck | null {
  if (!isRecord(value)) return null;
  const raw = own(value, 'probes');
  if (!Array.isArray(raw)) return null;
  const probes: ProbeResult[] = [];
  for (const p of raw) {
    if (!isRecord(p)) continue;
    const id = str(p, 'id', 4);
    const pass = bool(p, 'pass');
    if (id === null || !PROBE_IDS.has(id) || pass === null) continue;
    const kind = str(p, 'sourceKind', 16);
    const reason = str(p, 'reason', 200);
    probes.push({
      id: id as ProbeResult['id'],
      pass,
      ...(kind !== null && SOURCE_KINDS.has(kind)
        ? { sourceKind: kind as NonNullable<ProbeResult['sourceKind']> }
        : {}),
      ...(reason === null ? {} : { reason }),
    });
  }
  const account = str(value, 'account', 12);
  const region = str(value, 'region', 32);
  return {
    probes,
    ...(account !== null && ACCOUNT_RE.test(account) ? { account } : {}),
    ...(region !== null && REGION_RE.test(region) ? { region } : {}),
  };
}
