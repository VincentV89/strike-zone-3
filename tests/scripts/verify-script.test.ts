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

  // hosting-infra (cicd-pipeline-hosting-infra): synth reuses the bundle that
  // build produced and must finish before check:licences scans dist/.
  it('runs synth after build and before check:licences', () => {
    const steps = verifySteps(verify);
    const synth = steps.indexOf('synth');
    expect(synth).toBeGreaterThan(steps.indexOf('build'));
    expect(synth).toBeLessThan(steps.indexOf('check:licences'));
  });

  it('runs synth strict, offline and in prebuilt mode with telemetry off', () => {
    const synth = pkg.scripts['synth'] ?? '';
    expect(synth).toContain('tsc -p tsconfig.infra.json');
    for (const part of [
      'SZ_SKIP_WEB_BUILD=1',
      'CDK_DISABLE_CLI_TELEMETRY=true',
      '--strict',
      '--no-notices',
    ]) {
      expect(synth).toContain(part);
    }
    expect(pkg.scripts['build:web']).toBe('vite build');
  });

  // app-shell (cicd-pipeline-app-shell): check:seams scans the final dist/ last.
  it('runs check:seams as the last step and keeps build:test out of the gate', () => {
    const steps = verifySteps(verify);
    expect(steps.at(-1)).toBe('check:seams');
    expect(pkg.scripts['check:seams']).toBe('node scripts/check-seams.ts');
    expect(pkg.scripts['build:test']).toBe('vite build --mode test --outDir dist-test');
    expect(steps).not.toContain('build:test');
  });
});
