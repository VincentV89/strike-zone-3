/**
 * Evidence classifier (BR-VE-20..28, SD-VE-08). Pure: the status of a check
 * depends only on the register entry and the validated inputs. No env, no
 * argv, no clock.
 */
import type {
  Check,
  CheckEvidence,
  EvidenceInputs,
  EvidenceRef,
  EvidenceStatus,
  MetricRef,
  RefEvaluation,
} from './types.ts';

const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

export interface ClassifyContext {
  readonly inputs: EvidenceInputs;
  /** True when the browser spike worked, so an absent e2e.json means "not run". */
  readonly e2eAvailable: boolean;
}

function evalTest(
  ref: Extract<EvidenceRef, { kind: 'test' }>,
  ctx: ClassifyContext,
): RefEvaluation {
  const { vitest, stale, vitestReason } = ctx.inputs;
  if (vitest === null) return { ref, outcome: 'missing', reason: vitestReason };
  if (stale) return { ref, outcome: 'stale', reason: 'results older than the newest source file' };
  const file = vitest.files.find((f) => f.file === ref.file);
  if (file === undefined) {
    return { ref, outcome: 'missing', reason: 'file not in results (partial run?)' };
  }
  const matched = file.assertions.filter((a) => a.fullName.startsWith(ref.name));
  if (matched.length === 0) return { ref, outcome: 'missing', reason: 'no test matches the name' };
  const bad = matched.filter((a) => a.status !== 'passed');
  if (bad.length > 0) {
    const first = bad[0];
    return {
      ref,
      outcome: 'fail',
      reason: `${String(bad.length)} of ${String(matched.length)} not passed (${first?.status ?? '?'}: ${first?.fullName ?? ''})`,
      observed: `${String(matched.length - bad.length)}/${String(matched.length)} passed`,
    };
  }
  return {
    ref,
    outcome: 'pass',
    reason: `${String(matched.length)} passed`,
    observed: `${String(matched.length)}/${String(matched.length)} passed`,
  };
}

function evalE2e(ref: Extract<EvidenceRef, { kind: 'e2e' }>, ctx: ClassifyContext): RefEvaluation {
  const { e2e, e2eReason } = ctx.inputs;
  if (e2e === null) {
    return ctx.e2eAvailable
      ? { ref, outcome: 'missing', reason: e2eReason }
      : { ref, outcome: 'pending', reason: 'headless Chromium unavailable on the runtime' };
  }
  const cases = e2e.cases.filter((c) => c.id === ref.id);
  if (cases.length === 0) return { ref, outcome: 'missing', reason: `${ref.id} not in e2e.json` };
  const failed = cases.filter((c) => !c.pass);
  if (failed.length > 0) {
    return {
      ref,
      outcome: 'fail',
      reason: `failed on ${failed.map((c) => c.map).join(', ')}`,
      observed: `${String(cases.length - failed.length)}/${String(cases.length)} maps`,
    };
  }
  return {
    ref,
    outcome: 'pass',
    reason: `passed on ${cases.map((c) => c.map).join(', ')}`,
    observed: `${String(cases.length)}/${String(cases.length)} maps`,
  };
}

function evalSmoke(
  ref: Extract<EvidenceRef, { kind: 'smoke' }>,
  ctx: ClassifyContext,
): RefEvaluation {
  const { smoke, smokeReason } = ctx.inputs;
  if (smoke === null) return { ref, outcome: 'missing', reason: smokeReason };
  if (smoke.mode === 'blocked') {
    return { ref, outcome: 'blocked', reason: `blocked: ${smoke.reason ?? 'deploy not run'}` };
  }
  const check = smoke.checks.find((c) => c.id === ref.id);
  if (check === undefined)
    return { ref, outcome: 'missing', reason: `${ref.id} not in smoke.json` };
  if (check.notVerified === true) return { ref, outcome: 'missing', reason: check.observed };
  return {
    ref,
    outcome: check.pass ? 'pass' : 'fail',
    reason: check.pass ? 'passed' : `expected ${check.expected}`,
    observed: check.observed,
  };
}

/** Reads a value at `path` with own-property steps only. */
export function readPath(
  root: unknown,
  path: readonly string[],
): { ok: true; value: unknown } | { ok: false; reason: string } {
  let cur: unknown = root;
  for (const seg of path) {
    if (UNSAFE_SEGMENTS.has(seg)) return { ok: false, reason: 'unsafe-path' };
    if (typeof cur !== 'object' || cur === null || !Object.hasOwn(cur, seg)) {
      return { ok: false, reason: `no value at ${path.join('.')}` };
    }
    cur = (cur as Record<string, unknown>)[seg];
  }
  return { ok: true, value: cur };
}

function evalMetric(ref: MetricRef, ctx: ClassifyContext): RefEvaluation {
  const file = ctx.inputs.metrics.get(ref.report);
  if (file === undefined) return { ref, outcome: 'missing', reason: `${ref.report} not loaded` };
  if (!file.ok) return { ref, outcome: 'missing', reason: `${file.reason} ${ref.report}` };
  const at = readPath(file.value, ref.path);
  if (!at.ok) return { ref, outcome: 'missing', reason: at.reason };
  const v = at.value;
  if (ref.op === '===') {
    if (typeof v !== 'number' && typeof v !== 'string' && typeof v !== 'boolean') {
      return { ref, outcome: 'missing', reason: 'not a scalar' };
    }
    const ok = v === ref.target;
    return {
      ref,
      outcome: ok ? 'pass' : 'fail',
      reason: ok ? 'met' : `expected ${String(ref.target)}`,
      observed: v,
    };
  }
  if (typeof v !== 'number' || !Number.isFinite(v) || typeof ref.target !== 'number') {
    return { ref, outcome: 'missing', reason: 'not a number' };
  }
  const ok = ref.op === '<=' ? v <= ref.target : v >= ref.target;
  return {
    ref,
    outcome: ok ? 'pass' : 'fail',
    reason: ok ? 'met' : `target ${ref.op} ${String(ref.target)} missed`,
    observed: v,
  };
}

function evalManual(
  ref: Extract<EvidenceRef, { kind: 'manual' }>,
  ctx: ClassifyContext,
): RefEvaluation {
  const results = ctx.inputs.manual.filter((r) => r.id === ref.id);
  // The newest dated result wins; on equal dates the later entry in the file.
  let latest = results[0];
  for (const r of results) if (latest === undefined || r.date >= latest.date) latest = r;
  if (latest === undefined) return { ref, outcome: 'pending', reason: `${ref.id} not yet run` };
  return {
    ref,
    outcome: latest.outcome === 'pass' ? 'pass' : 'fail',
    reason: `${latest.tester}, ${latest.date}, ${latest.browser} ${latest.browserVersion}`,
    observed: latest.outcome,
  };
}

export function evaluateRef(ref: EvidenceRef, ctx: ClassifyContext): RefEvaluation {
  switch (ref.kind) {
    case 'test':
      return evalTest(ref, ctx);
    case 'e2e':
      return evalE2e(ref, ctx);
    case 'smoke':
      return evalSmoke(ref, ctx);
    case 'metric':
      return evalMetric(ref, ctx);
    case 'manual':
      return evalManual(ref, ctx);
  }
}

function describeRef(ref: EvidenceRef): string {
  switch (ref.kind) {
    case 'test':
      return `${ref.file} › ${ref.name}`;
    case 'metric':
      return `${ref.report} ${ref.path.join('.')}`;
    default:
      return ref.id;
  }
}

/** Combines ref outcomes into a status (BR-VE-20..25, BR-VE-28). */
export function combine(
  check: Check,
  evals: readonly RefEvaluation[],
): { status: EvidenceStatus; reason: string } {
  const auto = evals.filter((e) => e.ref.kind !== 'manual');
  const manual = evals.filter((e) => e.ref.kind === 'manual');
  const failed = auto.filter((e) => e.outcome === 'fail');
  if (failed.length > 0) {
    return {
      status: 'automated-fail',
      reason: failed.map((e) => `${describeRef(e.ref)}: ${e.reason}`).join('; '),
    };
  }
  const manualFailed = manual.filter((e) => e.outcome === 'fail');
  if (manualFailed.length > 0) {
    return {
      status: 'manual-fail',
      reason: manualFailed.map((e) => `${describeRef(e.ref)}: ${e.reason}`).join('; '),
    };
  }
  const unknown = auto.filter(
    (e) => e.outcome === 'missing' || e.outcome === 'stale' || e.outcome === 'blocked',
  );
  if (unknown.length > 0) {
    return {
      status: 'not-verified',
      reason: unknown.map((e) => `${describeRef(e.ref)}: ${e.reason}`).join('; '),
    };
  }
  const pendingAuto = auto.filter((e) => e.outcome === 'pending');
  if (manual.length > 0) {
    const waiting = manual.filter((e) => e.outcome !== 'pass');
    if (waiting.length > 0) {
      const ids = waiting.map((e) => describeRef(e.ref)).join(', ');
      const passedAuto = auto.length - pendingAuto.length;
      return {
        status: 'manual-pending',
        reason: `${ids} not yet run${passedAuto > 0 ? `; ${String(passedAuto)} automated ref${passedAuto === 1 ? '' : 's'} pass as supporting evidence` : ''}`,
      };
    }
    return { status: 'manual-pass', reason: manual.map((e) => e.reason).join('; ') };
  }
  if (pendingAuto.length > 0) {
    return {
      status: 'not-verified',
      reason: pendingAuto.map((e) => `${describeRef(e.ref)}: ${e.reason}`).join('; '),
    };
  }
  return {
    status: 'automated-pass',
    reason: `${String(auto.length)} automated ref${auto.length === 1 ? '' : 's'} passed${check.indirect === true ? ' (indirect)' : ''}`,
  };
}

const RANK: Readonly<Record<EvidenceStatus, number>> = {
  'automated-fail': 0,
  'manual-fail': 0,
  'not-verified': 1,
  'manual-pending': 2,
  'manual-pass': 3,
  'automated-pass': 3,
};

export function isPassed(s: EvidenceStatus): boolean {
  return s === 'automated-pass' || s === 'manual-pass';
}

/** DOD composition: the weakest part wins. */
export function compose(parts: readonly CheckEvidence[]): {
  status: EvidenceStatus;
  reason: string;
} {
  if (parts.length === 0) return { status: 'not-verified', reason: 'no parts' };
  const low = Math.min(...parts.map((p) => RANK[p.status]));
  const weakest = parts.filter((p) => RANK[p.status] === low);
  let status: EvidenceStatus;
  if (low === 0) {
    status = weakest.some((p) => p.status === 'automated-fail') ? 'automated-fail' : 'manual-fail';
  } else if (low === 3) {
    status = parts.some((p) => p.status === 'manual-pass') ? 'manual-pass' : 'automated-pass';
  } else {
    status = low === 1 ? 'not-verified' : 'manual-pending';
  }
  const reason =
    low === 3
      ? `all parts passed (${parts.map((p) => p.id).join(', ')})`
      : `weakest: ${weakest.map((p) => `${p.id} ${p.status}`).join(', ')}`;
  return { status, reason };
}

/**
 * Classifies the whole register in order. DOD rows are composed from the
 * already classified parts.
 */
export function classifyAll(checks: readonly Check[], ctx: ClassifyContext): CheckEvidence[] {
  const byId = new Map<string, CheckEvidence>();
  const out: CheckEvidence[] = [];
  for (const check of checks) {
    if (check.composedOf !== undefined) continue;
    const refs = check.refs.map((r) => evaluateRef(r, ctx));
    const { status, reason } = combine(check, refs);
    const ev: CheckEvidence = {
      id: check.id,
      title: check.title,
      status,
      reason,
      indirect: check.indirect === true,
      refs,
    };
    byId.set(check.id, ev);
  }
  for (const check of checks) {
    if (check.composedOf === undefined) {
      const ev = byId.get(check.id);
      if (ev !== undefined) out.push(ev);
      continue;
    }
    const parts = check.composedOf
      .map((id) => byId.get(id))
      .filter((p): p is CheckEvidence => p !== undefined);
    const { status, reason } = compose(parts);
    out.push({
      id: check.id,
      title: check.title,
      status,
      reason,
      indirect: parts.length > 0 && parts.every((p) => p.indirect),
      refs: [],
    });
  }
  return out;
}
