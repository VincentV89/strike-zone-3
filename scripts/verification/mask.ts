/**
 * Output masker (SD-VE-01). Reuses the check:licences secret rules (non-dist
 * only) recompiled with the `g` flag, plus verification-only identity rules.
 * Matches are replaced with the check:licences preview format.
 */
import { SECRET_RULES } from '../check-licences.ts';

export interface MaskRule {
  readonly id: string;
  readonly pattern: RegExp;
}

export interface MaskHit {
  readonly ruleId: string;
  readonly count: number;
}

// Built from fragments so this file holds no literal the scanners would flag.
const IDENTITY_RULES: readonly MaskRule[] = [
  {
    id: 'aws-identity-arn',
    pattern: new RegExp('arn:aws[a-z-]*:(?:iam|sts)::\\d{12}:[^\\s"\']+', 'g'),
  },
  { id: 'aws-user-id', pattern: new RegExp('"User' + 'Id"\\s*:\\s*"[^"]+"', 'g') },
];

export const MASK_RULES: readonly MaskRule[] = [
  ...SECRET_RULES.filter((r) => !r.distOnly).map((r) => ({
    id: r.id,
    pattern: new RegExp(
      r.pattern.source,
      r.pattern.flags.includes('g') ? r.pattern.flags : `${r.pattern.flags}g`,
    ),
  })),
  ...IDENTITY_RULES,
];

export function maskPreview(match: string): string {
  return `${match.slice(0, 4)}****`;
}

export function mask(
  text: string,
  rules: readonly MaskRule[] = MASK_RULES,
): { text: string; hits: MaskHit[] } {
  let out = text;
  const hits: MaskHit[] = [];
  for (const rule of rules) {
    let count = 0;
    out = out.replace(rule.pattern, (m) => {
      count += 1;
      return maskPreview(m);
    });
    if (count > 0) hits.push({ ruleId: rule.id, count });
  }
  return { text: out, hits };
}
