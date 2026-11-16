/**
 * Trust-boundary parsing for the CDK app (security-design-hosting-infra,
 * "Input Validation"). The only inputs are two environment variables and the
 * filesystem. Infra is delivery-ring code and does not import src/core, so
 * failures are plain Errors whose message starts with an `infra/<kebab>` code.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

/** Repository root, resolved from this file and never from cwd (TS-H-03). */
export const REPO_ROOT: string = path.resolve(import.meta.dirname, '../..');

export type WebSource =
  { readonly mode: 'build' } | { readonly mode: 'prebuilt'; readonly webDir: string };

export interface InfraEnv {
  readonly SZ_SKIP_WEB_BUILD?: string | undefined;
  readonly SZ_WEB_DIR?: string | undefined;
}

function hasIndexHtml(dir: string): boolean {
  return (
    existsSync(dir) &&
    statSync(dir).isDirectory() &&
    existsSync(path.join(dir, 'index.html')) &&
    statSync(path.join(dir, 'index.html')).isFile()
  );
}

/** Resolves and checks the prebuilt web directory: it must contain index.html. */
export function resolveWebDir(raw: string | undefined, repoRoot: string = REPO_ROOT): string {
  const dir = raw === undefined || raw === '' ? path.join(repoRoot, 'dist') : path.resolve(raw);
  if (!hasIndexHtml(dir)) {
    throw new Error(`infra/web-dir-missing: ${dir} must be a directory containing index.html`);
  }
  return dir;
}

/**
 * Reads SZ_SKIP_WEB_BUILD (unset or exactly "1") and SZ_WEB_DIR. Any other
 * SZ_SKIP_WEB_BUILD value throws, so a typo such as "true" never silently
 * starts a web build.
 */
export function parseWebSource(env: InfraEnv, repoRoot: string = REPO_ROOT): WebSource {
  const skip = env.SZ_SKIP_WEB_BUILD;
  if (skip === undefined || skip === '') return { mode: 'build' };
  if (skip !== '1') {
    throw new Error(
      `infra/invalid-skip-web-build: SZ_SKIP_WEB_BUILD must be unset or "1", got ${JSON.stringify(skip)}`,
    );
  }
  return { mode: 'prebuilt', webDir: resolveWebDir(env.SZ_WEB_DIR, repoRoot) };
}
