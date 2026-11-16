/**
 * Publish, routing, determinism and output assertions (SEC-H-15, SEC-H-16
 * prebuilt half, REL-H-02/04/05, PERF-H-02/03, OBS-H-01, ID-H-01).
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSETS_CACHE_CONTROL, INDEX_CACHE_CONTROL } from '../../infra/lib/strikezone-stack.ts';
import {
  dependsOn,
  FIXTURE_DIR,
  onlyResource,
  resourcesOfType,
  synthPrebuilt,
  type ResourceJson,
} from './synth.ts';

const { app, stack, json } = synthPrebuilt();

const [, distribution] = onlyResource(json, 'AWS::CloudFront::Distribution');
const distConfig = distribution.Properties?.['DistributionConfig'] as Record<string, unknown>;
const defaultBehavior = distConfig['DefaultCacheBehavior'] as Record<string, unknown>;

function deployment(prefix: string): [string, ResourceJson] {
  const found = resourcesOfType(json, 'Custom::CDKBucketDeployment').filter(([id]) =>
    id.startsWith(prefix),
  );
  if (found.length !== 1) throw new Error(`expected one ${prefix} deployment`);
  return found[0] as [string, ResourceJson];
}

function listFiles(dir: string, base: string = dir): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? listFiles(full, base) : [path.relative(base, full)];
    })
    .sort();
}

const [assetsId, webAssets] = deployment('WebAssetsCustomResource');
const [, webIndex] = deployment('WebIndexCustomResource');

describe('ordered, non-pruning publish (T-H-7)', () => {
  it('SEC-H-15 REL-H-02 WebIndex depends on WebAssets', () => {
    expect(dependsOn(webIndex)).toContain(assetsId);
    expect(dependsOn(webAssets).some((d) => d.startsWith('WebIndex'))).toBe(false);
  });

  it('SEC-H-15 REL-H-02 neither deployment prunes', () => {
    expect(webAssets.Properties?.['Prune']).toBe(false);
    expect(webIndex.Properties?.['Prune']).toBe(false);
  });

  it('SEC-H-15 WebAssets excludes index.html and WebIndex carries only index.html', () => {
    expect(webAssets.Properties?.['Exclude']).toEqual(['index.html']);
    expect(webAssets.Properties).not.toHaveProperty('Include');
    expect(webIndex.Properties?.['Exclude']).toEqual(['*']);
    expect(webIndex.Properties?.['Include']).toEqual(['index.html']);
  });

  it('SEC-H-15 only WebIndex invalidates, and only /*', () => {
    expect(webAssets.Properties).not.toHaveProperty('DistributionId');
    expect(webAssets.Properties).not.toHaveProperty('DistributionPaths');
    expect(webIndex.Properties?.['DistributionId']).toBeDefined();
    expect(webIndex.Properties?.['DistributionPaths']).toEqual(['/*']);
  });

  it('SEC-H-15 both deployments read the same single web asset', () => {
    expect(webAssets.Properties?.['SourceObjectKeys']).toEqual(
      webIndex.Properties?.['SourceObjectKeys'],
    );
    expect(webAssets.Properties?.['SourceObjectKeys']).toHaveLength(1);
  });

  it('PERF-H-02 hashed assets are immutable for a year and index.html is no-cache', () => {
    expect(ASSETS_CACHE_CONTROL).toBe('public, max-age=31536000, immutable');
    expect(INDEX_CACHE_CONTROL).toBe('no-cache');
    expect(webAssets.Properties?.['SystemMetadata']).toEqual({
      'cache-control': ASSETS_CACHE_CONTROL,
    });
    expect(webIndex.Properties?.['SystemMetadata']).toEqual({
      'cache-control': INDEX_CACHE_CONTROL,
    });
  });

  it('SEC-H-16 the staged asset holds exactly the prebuilt web directory', () => {
    const staged = path.join(app.outdir, stack.webAsset.assetPath);
    expect(listFiles(staged)).toEqual(listFiles(FIXTURE_DIR));
    expect(listFiles(staged)).toEqual(['assets/index-abc123.js', 'index.html']);
  });
});

describe('delivery and routing', () => {
  it('PERF-H-03 compresses responses and serves HTTP/2 and HTTP/3 over IPv6', () => {
    expect(defaultBehavior['Compress']).toBe(true);
    expect(distConfig['HttpVersion']).toBe('http2and3');
    expect(distConfig['IPV6Enabled']).toBe(true);
    // Managed CachingOptimized policy, which honours the per-object Cache-Control.
    expect(defaultBehavior['CachePolicyId']).toBe('658327ea-f89d-4fab-a63d-7e88639e58f6');
  });

  it('REL-H-05 serves index.html at the root and for 403 and 404 with status 200', () => {
    expect(distConfig['DefaultRootObject']).toBe('index.html');
    expect(distConfig['CustomErrorResponses']).toEqual([
      { ErrorCode: 403, ResponseCode: 200, ResponsePagePath: '/index.html', ErrorCachingMinTTL: 0 },
      { ErrorCode: 404, ResponseCode: 200, ResponsePagePath: '/index.html', ErrorCachingMinTTL: 0 },
    ]);
  });

  it('REL-H-04 two synths of the same tree give the same template', () => {
    const again = synthPrebuilt();
    expect(JSON.stringify(again.json)).toBe(JSON.stringify(json));
  });
});

describe('outputs and tags', () => {
  it('OBS-H-01 exports DistributionUrl, DistributionId and BucketName', () => {
    expect(Object.keys(json.Outputs ?? {}).sort()).toEqual([
      'BucketName',
      'DistributionId',
      'DistributionUrl',
    ]);
    expect(JSON.stringify(json.Outputs?.['DistributionUrl'])).toContain('https://');
  });

  it('ID-H-01 tags the bucket and the distribution with project and managed-by', () => {
    for (const type of ['AWS::S3::Bucket', 'AWS::CloudFront::Distribution']) {
      const [, r] = onlyResource(json, type);
      expect(r.Properties?.['Tags']).toEqual(
        expect.arrayContaining([
          { Key: 'project', Value: 'strikezone' },
          { Key: 'managed-by', Value: 'cdk' },
        ]),
      );
    }
  });
});
