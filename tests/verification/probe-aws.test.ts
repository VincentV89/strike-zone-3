/** Credential precheck C1..C4 and the read-only AWS runner (SD-VE-02, SD-VE-03). */
import { describe, expect, it } from 'vitest';
import {
  describeStackCall,
  parseAccount,
  parseRegion,
  parseStackStatus,
  REGION_CALL,
  runAws,
  STS_CALL,
  type AwsCall,
  type AwsRun,
  type ExecFileLike,
} from '../../scripts/verification/aws.ts';
import {
  precheckReady,
  probeCli,
  probeCredentialSource,
  runPrecheck,
  type ProbeDeps,
} from '../../scripts/verification/probe.ts';

const FAKE_KEY = 'AKIA' + 'FAKEFAKEFAKEFAKE';
const SECRET_NAME = 'AWS_SECRET' + '_ACCESS_KEY';
const STS_OUT = JSON.stringify({
  ['User' + 'Id']: 'AROAEXAMPLE:me',
  Account: '123456789012',
  Arn: 'arn:aws:' + 'sts::123456789012:assumed-role/x/me',
});

function deps(over: {
  env?: Record<string, string | undefined>;
  files?: Record<string, number>;
  aws?: (call: AwsCall) => Promise<AwsRun>;
}): ProbeDeps & { calls: AwsCall[] } {
  const calls: AwsCall[] = [];
  const files: Record<string, number> = { '/usr/bin/aws': 1000, ...over.files };
  return {
    env: { PATH: '/usr/bin', HOME: '/home/u', ...over.env },
    statSize: (p) => (Object.hasOwn(files, p) ? (files[p] ?? null) : null),
    aws: (call) => {
      calls.push(call);
      return over.aws?.(call) ?? Promise.resolve({ ok: true, stdout: STS_OUT });
    },
    calls,
  };
}

describe('probes', () => {
  it('C1 finds the aws CLI on PATH only', () => {
    expect(probeCli(deps({})).pass).toBe(true);
    expect(probeCli(deps({ env: { PATH: '/opt/bin' } }))).toEqual({
      id: 'C1',
      pass: false,
      reason: 'aws CLI not on PATH',
    });
  });

  it('C2 does not count env vars that point at /dev/null or a 0-byte file (BR-VE-41)', () => {
    const d = deps({
      env: { AWS_CONFIG_FILE: '/dev/null', AWS_SHARED_CREDENTIALS_FILE: '/tmp/empty' },
      files: { '/dev/null': 0, '/tmp/empty': 0 },
    });
    expect(probeCredentialSource(d).pass).toBe(false);
    const half = deps({ env: { AWS_ACCESS_KEY_ID: FAKE_KEY } });
    expect(probeCredentialSource(half).pass).toBe(false);
  });

  it('C2 accepts env keys, profile files, web identity and container credentials by kind only', () => {
    const env = deps({ env: { AWS_ACCESS_KEY_ID: FAKE_KEY, [SECRET_NAME]: 'x'.repeat(40) } });
    const r = probeCredentialSource(env);
    expect(r).toEqual({ id: 'C2', pass: true, sourceKind: 'env' });
    expect(JSON.stringify(r)).not.toContain(FAKE_KEY);
    expect(
      probeCredentialSource(deps({ files: { '/home/u/.aws/credentials': 120 } })).sourceKind,
    ).toBe('profile-file');
    expect(
      probeCredentialSource(
        deps({ env: { AWS_WEB_IDENTITY_TOKEN_FILE: '/t/tok' }, files: { '/t/tok': 900 } }),
      ).sourceKind,
    ).toBe('web-identity');
    expect(
      probeCredentialSource(deps({ env: { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/x' } }))
        .sourceKind,
    ).toBe('container');
  });

  it('runPrecheck reduces STS to the account id and resolves the region', async () => {
    const d = deps({
      env: { AWS_ACCESS_KEY_ID: FAKE_KEY, [SECRET_NAME]: 's', AWS_REGION: 'eu-west-1' },
    });
    const pre = await runPrecheck(d);
    expect(pre).toEqual({
      probes: [
        { id: 'C1', pass: true },
        { id: 'C2', pass: true, sourceKind: 'env' },
        { id: 'C3', pass: true },
        { id: 'C4', pass: true },
      ],
      account: '123456789012',
      region: 'eu-west-1',
    });
    expect(JSON.stringify(pre)).not.toContain('assumed-role');
    expect(JSON.stringify(pre)).not.toContain('AROA');
    expect(precheckReady(pre)).toBe(true);
    expect(d.calls).toEqual([STS_CALL]);
  });

  it('runPrecheck skips STS when C1 or C2 fails and is blocked today (no credentials)', async () => {
    const none = deps({
      env: { PATH: '/opt', AWS_CONFIG_FILE: '/dev/null', AWS_SHARED_CREDENTIALS_FILE: '/dev/null' },
    });
    const pre = await runPrecheck(none);
    expect(pre.probes.map((p) => [p.id, p.pass])).toEqual([
      ['C1', false],
      ['C2', false],
      ['C3', false],
      ['C4', false],
    ]);
    expect(pre.probes[2]?.reason).toBe('skipped: C1 failed');
    expect(none.calls).toEqual([]);
    expect(precheckReady(pre)).toBe(false);
  });

  it('runPrecheck asks the CLI for the region and rejects a bad identity', async () => {
    const d = deps({
      files: { '/home/u/.aws/config': 50 },
      aws: (call) =>
        Promise.resolve(
          call[0] === 'configure'
            ? { ok: true, stdout: 'us-east-2\n' }
            : { ok: false, stdout: '', error: 'failed' },
        ),
    });
    const pre = await runPrecheck(d);
    expect(pre.probes[2]).toEqual({
      id: 'C3',
      pass: false,
      reason: 'sts get-caller-identity failed',
    });
    expect(pre.region).toBe('us-east-2');
    expect(pre.account).toBeUndefined();
    expect(d.calls).toEqual([STS_CALL, REGION_CALL]);
  });
});

describe('runAws (read-only, no shell)', () => {
  function fakeExec(
    err: (Error & { code?: unknown; killed?: boolean }) | null,
    out = '',
  ): {
    exec: ExecFileLike;
    seen: { file: string; args: readonly string[]; opts: unknown }[];
  } {
    const seen: { file: string; args: readonly string[]; opts: unknown }[] = [];
    return {
      exec: (file, args, opts, cb) => {
        seen.push({ file, args, opts });
        cb(err, out);
      },
      seen,
    };
  }

  it('passes the closed argument tuple to execFile with shell false and a 15 s timeout', async () => {
    const f = fakeExec(null, STS_OUT);
    expect(await runAws(STS_CALL, f.exec, {})).toEqual({ ok: true, stdout: STS_OUT });
    expect(f.seen[0]?.file).toBe('aws');
    expect(f.seen[0]?.args).toEqual(['sts', 'get-caller-identity', '--output', 'json']);
    expect(f.seen[0]?.opts).toMatchObject({
      shell: false,
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
  });

  it('maps a missing binary, a timeout and a failure to codes, never stderr text', async () => {
    const enoent = Object.assign(new Error('spawn aws ENOENT'), { code: 'ENOENT' });
    expect(await runAws(REGION_CALL, fakeExec(enoent).exec, {})).toEqual({
      ok: false,
      stdout: '',
      error: 'not-found',
    });
    const killed = Object.assign(new Error('t'), { killed: true });
    expect((await runAws(REGION_CALL, fakeExec(killed).exec, {})).error).toBe('timeout');
    expect(
      (await runAws(describeStackCall('StrikeZone'), fakeExec(new Error('x')).exec, {})).error,
    ).toBe('failed');
  });

  it('parses account, region and stack status defensively', () => {
    expect(parseAccount(STS_OUT)).toBe('123456789012');
    expect(parseAccount('{"Account":"12"}')).toBeNull();
    expect(parseAccount('nope')).toBeNull();
    expect(parseAccount('[]')).toBeNull();
    expect(parseRegion(' ap-southeast-2 \n')).toBe('ap-southeast-2');
    expect(parseRegion('none')).toBeNull();
    expect(parseStackStatus('{"Stacks":[{"StackStatus":"UPDATE_COMPLETE"}]}')).toBe(
      'UPDATE_COMPLETE',
    );
    expect(parseStackStatus('{"Stacks":[]}')).toBeNull();
    expect(parseStackStatus('{"Stacks":[{"StackStatus":"x;rm"}]}')).toBeNull();
    expect(parseStackStatus('{}')).toBeNull();
    expect(parseStackStatus('[')).toBeNull();
    expect(describeStackCall('CDKToolkit')).toEqual([
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      'CDKToolkit',
      '--output',
      'json',
    ]);
  });
});
