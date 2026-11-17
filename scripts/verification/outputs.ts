/**
 * reports/cdk-outputs.json validation (SD-VE-05). After this, smoke can only
 * reach <id>.cloudfront.net and <bucket>.s3.<region>.amazonaws.com.
 */
import type { DeployOutputs } from './types.ts';
import { isRecord, own } from './validate.ts';

const URL_RE = /^https:\/\/[a-z0-9]+\.cloudfront\.net$/;
const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const IP_LIKE = /^\d+\.\d+\.\d+\.\d+$/;
const DIST_ID_RE = /^[A-Z0-9]{8,20}$/;

export type OutputsResult =
  | { readonly ok: true; readonly value: DeployOutputs }
  | { readonly ok: false; readonly reason: 'bad-outputs'; readonly field: string };

function bad(field: string): OutputsResult {
  return { ok: false, reason: 'bad-outputs', field };
}

export function validateOutputs(value: unknown): OutputsResult {
  if (!isRecord(value)) return bad('root');
  const stack = own(value, 'StrikeZone');
  if (!isRecord(stack)) return bad('StrikeZone');
  const url = own(stack, 'DistributionUrl');
  if (typeof url !== 'string' || !URL_RE.test(url)) return bad('DistributionUrl');
  const parsed = new URL(url);
  if (
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== ''
  ) {
    return bad('DistributionUrl');
  }
  const bucket = own(stack, 'BucketName');
  if (typeof bucket !== 'string' || !BUCKET_RE.test(bucket) || IP_LIKE.test(bucket)) {
    return bad('BucketName');
  }
  const id = own(stack, 'DistributionId');
  if (typeof id !== 'string' || !DIST_ID_RE.test(id)) return bad('DistributionId');
  return { ok: true, value: { origin: url, host: parsed.host, distributionId: id, bucket } };
}
