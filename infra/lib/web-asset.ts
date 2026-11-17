/**
 * The single web asset that both BucketDeployments read (ADR-013, TS-H-10).
 *
 * - Build mode (default): the asset source is the repository root, hashed by
 *   source with runtime and build outputs excluded. Local bundling runs
 *   `npm run build:web -- --outDir <out>` through execFileSync with an
 *   argument array and no shell (SEC-H-16). Docker is never used: the image
 *   below is a placeholder that is never pulled, because tryBundle either
 *   returns true or throws.
 * - Prebuilt mode (SZ_SKIP_WEB_BUILD=1): the asset is the existing web
 *   directory (dist/ or SZ_WEB_DIR), staged as-is.
 */
import { execFileSync } from 'node:child_process';
import { AssetHashType, DockerImage } from 'aws-cdk-lib';
import type { ILocalBundling } from 'aws-cdk-lib';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import type { Construct } from 'constructs';
import { REPO_ROOT, type WebSource } from './config.ts';

/** Never pulled: local bundling always succeeds or throws first. */
export const PLACEHOLDER_IMAGE = 'public.ecr.aws/docker/library/node:24-slim';

/** Paths left out of the source hash in build mode (TS-H-10). */
export const SOURCE_EXCLUDES: readonly string[] = [
  'node_modules',
  'cdk.out',
  'dist',
  'dist-test', // app-shell test bundle, never part of the asset hash (ID-AS-03)
  'coverage',
  'reports',
  '.kiro-data',
  '.kiro',
  '.aidlc',
  '.git',
];

/** The subset of execFileSync this module uses, so tests can stub it. */
export type RunFile = (
  file: string,
  args: readonly string[],
  options: { cwd: string; stdio: 'inherit'; shell: false },
) => unknown;

/** Exact argument array for the web build (asserted by tests/infra/bundling.test.ts). */
export function webBuildArgs(outDir: string): string[] {
  return ['run', 'build:web', '--', '--outDir', outDir];
}

/**
 * Local bundler for build mode. A non-zero exit makes execFileSync throw,
 * and the error propagates so synth or deploy fails (no Docker fallback).
 */
export function createWebBundler(
  run: RunFile = execFileSync,
  cwd: string = REPO_ROOT,
): ILocalBundling {
  return {
    tryBundle(outputDir: string): boolean {
      run('npm', webBuildArgs(outputDir), { cwd, stdio: 'inherit', shell: false });
      return true;
    },
  };
}

export function createWebAsset(scope: Construct, id: string, source: WebSource): Asset {
  if (source.mode === 'prebuilt') {
    return new Asset(scope, id, { path: source.webDir });
  }
  return new Asset(scope, id, {
    path: REPO_ROOT,
    assetHashType: AssetHashType.SOURCE,
    exclude: [...SOURCE_EXCLUDES],
    bundling: {
      image: DockerImage.fromRegistry(PLACEHOLDER_IMAGE),
      local: createWebBundler(),
    },
  });
}
