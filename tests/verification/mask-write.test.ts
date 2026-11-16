/** Masker and single writer (SD-VE-01, SD-VE-02). Secret-shaped fixtures are concatenated. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MASK_RULES, mask, maskPreview } from '../../scripts/verification/mask.ts';
import { isAllowedOutput, writeMasked } from '../../scripts/verification/write.ts';
import { tmpRoot } from './helpers.ts';

const KEY = 'AKIA' + 'ABCDEFGHIJKLMNOP';
const KEY2 = 'ASIA' + 'QRSTUVWXYZ234567';
const ARN = 'arn:aws:' + 'sts::123456789012:assumed-role/Admin/session';

describe('mask', () => {
  it('masks every match on a line, not only the first (g flag)', () => {
    const { text, hits } = mask(`a ${KEY} b ${KEY2} c ${KEY}`);
    expect(text).toBe(`a ${maskPreview(KEY)} b ${maskPreview(KEY2)} c ${maskPreview(KEY)}`);
    expect(text).not.toContain(KEY);
    expect(hits).toEqual([{ ruleId: 'aws-access-key-id', count: 3 }]);
  });

  it('masks identity ARNs and the STS UserId field', () => {
    const { text, hits } = mask(`{"Arn":"${ARN}","User` + `Id":"AROAXYZ:session"}`);
    expect(text).not.toContain('123456789012:assumed-role');
    expect(text).not.toContain('AROAXYZ');
    expect(hits.map((h) => h.ruleId).sort()).toEqual(['aws-identity-arn', 'aws-user-id']);
  });

  it('masks private-key headers and key names but leaves ordinary text alone', () => {
    const header = '-----BEGIN RSA ' + 'PRIVATE KEY-----';
    expect(mask(header).hits).toHaveLength(1);
    expect(mask('aws_secret' + '_access_key = x').hits).toHaveLength(1);
    expect(mask('account 123456789012 in eu-west-1')).toEqual({
      text: 'account 123456789012 in eu-west-1',
      hits: [],
    });
  });

  it('uses only non-dist rules from check:licences plus the identity rules', () => {
    const ids = MASK_RULES.map((r) => r.id);
    expect(ids).not.toContain('vite-env-var');
    expect(ids).toContain('aws-access-key-id');
    for (const r of MASK_RULES) expect(r.pattern.flags).toContain('g');
  });
});

describe('writeMasked (the only writer)', () => {
  it('allows only reports/*.json and docs/FINAL-REPORT.md under the root', () => {
    const root = '/repo';
    expect(isAllowedOutput(root, 'reports/smoke.json')).toBe(true);
    expect(isAllowedOutput(root, 'docs/FINAL-REPORT.md')).toBe(true);
    expect(isAllowedOutput(root, '/repo/reports/e2e.json')).toBe(true);
    for (const bad of [
      'docs/MANUAL-TESTS.md',
      'reports/../src/x.json',
      '../reports/x.json',
      'reports/sub/x.json',
      'reports/x.md',
      '/etc/passwd',
      'verification/manual-results.json',
    ]) {
      expect(isAllowedOutput(root, bad), bad).toBe(false);
    }
  });

  it('writes the masked text and returns the hits', () => {
    const root = tmpRoot();
    const out = writeMasked(root, 'reports/x.json', `{"k":"${KEY}"}`);
    expect(out.hits).toEqual([{ ruleId: 'aws-access-key-id', count: 1 }]);
    const written = readFileSync(join(root, 'reports/x.json'), 'utf8');
    expect(written).not.toContain(KEY);
    expect(written).toContain('AKIA****');
  });

  it('throws a verification/ programmer error for a disallowed path and writes nothing', () => {
    const root = tmpRoot();
    expect(() => writeMasked(root, 'src/evil.ts', 'x')).toThrow(
      /verification\/output-path-not-allowed/,
    );
    expect(existsSync(join(root, 'src/evil.ts'))).toBe(false);
  });
});
