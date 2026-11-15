/**
 * Build-mode bundling (SEC-H-16) and the invalidation-scoping aspect's
 * statement logic (SD-H-01). execFileSync is stubbed: nothing is built here.
 */
import { App, Aspects, Stack } from 'aws-cdk-lib';
import { CfnPolicy } from 'aws-cdk-lib/aws-iam';
import { describe, expect, it } from 'vitest';
import {
  isWildcardInvalidation,
  ScopeInvalidationAspect,
  scopeStatements,
} from '../../infra/lib/aspects.ts';
import { REPO_ROOT } from '../../infra/lib/config.ts';
import {
  createWebBundler,
  PLACEHOLDER_IMAGE,
  SOURCE_EXCLUDES,
  webBuildArgs,
  type RunFile,
} from '../../infra/lib/web-asset.ts';

interface Call {
  readonly file: string;
  readonly args: readonly string[];
  readonly options: Parameters<RunFile>[2];
}

function recordingRun(calls: Call[]): RunFile {
  return (file, args, options) => {
    calls.push({ file, args, options });
    return Buffer.alloc(0);
  };
}

describe('build-mode bundling', () => {
  it('SEC-H-16 runs npm run build:web with an exact argument array and no shell', () => {
    const calls: Call[] = [];
    const bundled = createWebBundler(recordingRun(calls)).tryBundle('/tmp/cdk-out/asset', {
      image: undefined as never,
    });
    expect(bundled).toBe(true);
    expect(calls).toEqual([
      {
        file: 'npm',
        args: ['run', 'build:web', '--', '--outDir', '/tmp/cdk-out/asset'],
        options: { cwd: REPO_ROOT, stdio: 'inherit', shell: false },
      },
    ]);
  });

  it('SEC-H-16 keeps a hostile outDir as a single argument', () => {
    expect(webBuildArgs('/tmp/x; rm -rf ~')).toEqual([
      'run',
      'build:web',
      '--',
      '--outDir',
      '/tmp/x; rm -rf ~',
    ]);
  });

  it('SEC-H-16 propagates a failed build instead of falling back to Docker', () => {
    const failing: RunFile = () => {
      throw new Error('Command failed: npm run build:web');
    };
    expect(() =>
      createWebBundler(failing).tryBundle('/tmp/out', { image: undefined as never }),
    ).toThrow('Command failed');
  });

  it('SEC-H-16 uses a placeholder image and excludes runtime and build outputs from the hash', () => {
    expect(PLACEHOLDER_IMAGE).toBe('public.ecr.aws/docker/library/node:24-slim');
    expect([...SOURCE_EXCLUDES].sort()).toEqual(
      [
        '.aidlc',
        '.git',
        '.kiro',
        '.kiro-data',
        'cdk.out',
        'coverage',
        'dist',
        'node_modules',
        'reports',
      ].sort(),
    );
  });
});

describe('ScopeInvalidationAspect statement logic', () => {
  const wildcard = {
    Effect: 'Allow',
    Action: ['cloudfront:GetInvalidation', 'cloudfront:CreateInvalidation'],
    Resource: '*',
  };
  const scoped = { Ref: 'Distribution' };
  const s3 = { Effect: 'Allow', Action: 's3:GetObject*', Resource: 'arn:bucket/*' };
  const deny = { Effect: 'Deny', Action: 'logs:CreateLogGroup', Resource: '*' };

  it('SD-H-01 drops a bare wildcard invalidation statement', () => {
    expect(scopeStatements([s3, wildcard, deny])).toEqual({ kept: [s3, deny], removed: 1 });
  });

  it('SD-H-01 strips "*" from a minimised statement that also holds the scoped ARN', () => {
    const merged = { ...wildcard, Resource: ['*', scoped] };
    expect(scopeStatements([merged])).toEqual({
      kept: [{ ...wildcard, Resource: scoped }],
      removed: 1,
    });
  });

  it('SD-H-01 leaves Deny statements and non-invalidation Allows alone', () => {
    expect(isWildcardInvalidation(deny)).toBe(false);
    expect(isWildcardInvalidation({ ...wildcard, Action: ['cloudfront:*'] })).toBe(false);
    expect(isWildcardInvalidation({ ...wildcard, Resource: scoped })).toBe(false);
    expect(scopeStatements([s3, deny]).removed).toBe(0);
  });

  it('SD-H-01 reports more than one match so the aspect can fail synth', () => {
    expect(scopeStatements([wildcard, wildcard]).removed).toBe(2);
  });

  it('SD-H-01 the aspect fails synth when the CDK statement shape changes', () => {
    const app = new App();
    const stack = new Stack(app, 'Probe');
    new CfnPolicy(stack, 'Policy', {
      policyName: 'probe',
      policyDocument: { Version: '2012-10-17', Statement: [wildcard, { ...wildcard }] },
    });
    Aspects.of(stack).add(new ScopeInvalidationAspect());
    expect(() => app.synth()).toThrow('infra/invalidation-wildcard-shape');
  });
});
