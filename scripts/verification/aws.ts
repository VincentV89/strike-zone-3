/**
 * The only process boundary of the verification unit (SD-VE-03). runAws runs
 * one of a closed set of read-only AWS CLI calls through execFile without a
 * shell. STS output is reduced to the account id before it leaves this file.
 */
import { execFile } from 'node:child_process';
import { ACCOUNT_RE, isRecord, own, REGION_RE } from './validate.ts';

export type AwsCall =
  | readonly ['sts', 'get-caller-identity', '--output', 'json']
  | readonly [
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      'CDKToolkit' | 'StrikeZone',
      '--output',
      'json',
    ]
  | readonly ['configure', 'get', 'region'];

export const STS_CALL: AwsCall = ['sts', 'get-caller-identity', '--output', 'json'];
export const REGION_CALL: AwsCall = ['configure', 'get', 'region'];
export function describeStackCall(stack: 'CDKToolkit' | 'StrikeZone'): AwsCall {
  return ['cloudformation', 'describe-stacks', '--stack-name', stack, '--output', 'json'];
}

export interface AwsRun {
  readonly ok: boolean;
  readonly stdout: string;
  /** 'not-found' when the binary is missing; never stderr content. */
  readonly error?: 'not-found' | 'failed' | 'timeout';
}

export type ExecFileLike = (
  file: string,
  args: readonly string[],
  opts: { shell: false; timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv },
  cb: (err: (Error & { code?: unknown; killed?: boolean }) | null, stdout: string) => void,
) => void;

const defaultExec: ExecFileLike = (file, args, opts, cb) => {
  execFile(file, [...args], { ...opts, encoding: 'utf8' }, (err, stdout) => {
    cb(err, typeof stdout === 'string' ? stdout : '');
  });
};

export function runAws(
  call: AwsCall,
  runFile: ExecFileLike = defaultExec,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AwsRun> {
  return new Promise((done) => {
    runFile(
      'aws',
      call,
      { shell: false, timeout: 15_000, maxBuffer: 1024 * 1024, env },
      (err, stdout) => {
        if (err === null) {
          done({ ok: true, stdout });
          return;
        }
        if (err.code === 'ENOENT') done({ ok: false, stdout: '', error: 'not-found' });
        else if (err.killed === true) done({ ok: false, stdout: '', error: 'timeout' });
        else done({ ok: false, stdout: '', error: 'failed' });
      },
    );
  });
}

/** Reduces `sts get-caller-identity` output to the account id only. */
export function parseAccount(stdout: string): string | null {
  try {
    const v: unknown = JSON.parse(stdout);
    if (!isRecord(v)) return null;
    const account = own(v, 'Account');
    return typeof account === 'string' && ACCOUNT_RE.test(account) ? account : null;
  } catch {
    return null;
  }
}

export function parseRegion(stdout: string): string | null {
  const r = stdout.trim();
  return REGION_RE.test(r) ? r : null;
}

/** StackStatus of the first stack in `describe-stacks` output. */
export function parseStackStatus(stdout: string): string | null {
  try {
    const v: unknown = JSON.parse(stdout);
    if (!isRecord(v)) return null;
    const stacks = own(v, 'Stacks');
    if (!Array.isArray(stacks)) return null;
    const first: unknown = stacks[0];
    if (!isRecord(first)) return null;
    const status = own(first, 'StackStatus');
    return typeof status === 'string' && /^[A-Z_]{1,64}$/.test(status) ? status : null;
  } catch {
    return null;
  }
}
