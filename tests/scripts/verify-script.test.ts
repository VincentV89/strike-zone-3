/**
 * Verify-script shape test (SEC-F-16, BR-F-41): the gate is an `&&`-only,
 * fail-fast chain whose foundation steps keep their order. Later units may
 * append steps (hosting-infra's synth after build, app-shell's check:seams).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
const REQUIRED_ORDER = ['lint', 'typecheck', 'test:coverage', 'build', 'check:licences'];

function verifySteps(verify: string): string[] {
  return verify.split('&&').map((part) => part.trim().replace(/^npm run /, ''));
}

function isOrderedSubsequence(needle: readonly string[], hay: readonly string[]): boolean {
  let i = 0;
  for (const step of hay) if (step === needle[i]) i += 1;
  return i === needle.length;
}

describe('npm run verify', () => {
  const verify = pkg.scripts['verify'] ?? '';

  it('is joined only by && with no ||, ; or single |', () => {
    expect(verify).not.toMatch(/\|\||;|(^|[^|])\|([^|]|$)/);
    expect(verifySteps(verify).every((s) => s.length > 0)).toBe(true);
  });

  it('contains the foundation steps in order', () => {
    expect(isOrderedSubsequence(REQUIRED_ORDER, verifySteps(verify))).toBe(true);
  });

  it('runs lint with zero warnings and the Prettier check', () => {
    expect(pkg.scripts['lint']).toContain('--max-warnings 0');
    expect(pkg.scripts['lint']).toContain('prettier --check');
  });

  it('runs check:licences with --require-dist', () => {
    expect(pkg.scripts['check:licences']).toContain('--require-dist');
  });

  it('detects a reordered chain', () => {
    const reordered = verifySteps(
      'npm run typecheck && npm run lint && npm run test:coverage && npm run build && npm run check:licences',
    );
    expect(isOrderedSubsequence(REQUIRED_ORDER, reordered)).toBe(false);
  });
});
