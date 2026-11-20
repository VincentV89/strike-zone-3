/**
 * Security assertions for the StrikeZone stack (security-design-hosting-infra,
 * "Assertion Suite Map"). Each test name starts with the requirement id.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Token } from 'aws-cdk-lib';
import { Match } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../infra/lib/config.ts';
import { CSP, PERMISSIONS_POLICY } from '../../infra/lib/headers.ts';
import { PREVIEW_HEADERS } from '../../infra/lib/policy.ts';
import {
  actionsOf,
  dependsOn,
  identityStatements,
  onlyResource,
  resourcesOf,
  resourcesOfType,
  synthPrebuilt,
  type Statement,
} from './synth.ts';

const { stack, template, json } = synthPrebuilt();

const [bucketId, bucket] = onlyResource(json, 'AWS::S3::Bucket');
const [distributionId, distribution] = onlyResource(json, 'AWS::CloudFront::Distribution');
const distConfig = distribution.Properties?.['DistributionConfig'] as Record<string, unknown>;
const defaultBehavior = distConfig['DefaultCacheBehavior'] as Record<string, unknown>;

const BASIC_EXECUTION = 'AWSLambdaBasicExecutionRole';

const ALLOWED_TYPES = [
  'AWS::S3::Bucket',
  'AWS::S3::BucketPolicy',
  'AWS::CloudFront::Distribution',
  'AWS::CloudFront::OriginAccessControl',
  'AWS::CloudFront::ResponseHeadersPolicy',
  'AWS::IAM::Role',
  'AWS::IAM::Policy',
  'AWS::Lambda::Function',
  'AWS::Lambda::LayerVersion',
  'AWS::Logs::LogGroup',
  'Custom::CDKBucketDeployment',
  'Custom::S3AutoDeleteObjects',
].sort();

const distributionArn = {
  'Fn::Join': [
    '',
    [
      'arn:',
      { Ref: 'AWS::Partition' },
      ':cloudfront::',
      { Ref: 'AWS::AccountId' },
      ':distribution/',
      { Ref: distributionId },
    ],
  ],
};

describe('origin bucket (T-H-1)', () => {
  it('SEC-H-01 blocks all public access, enforces bucket-owner ownership and has no website', () => {
    expect(bucket.Properties?.['PublicAccessBlockConfiguration']).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    expect(bucket.Properties?.['OwnershipControls']).toEqual({
      Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }],
    });
    expect(bucket.Properties).not.toHaveProperty('WebsiteConfiguration');
  });

  it('SEC-H-04 uses SSE-S3, no versioning and a generated name', () => {
    expect(bucket.Properties?.['BucketEncryption']).toEqual({
      ServerSideEncryptionConfiguration: [
        { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
      ],
    });
    expect(bucket.Properties).not.toHaveProperty('VersioningConfiguration');
    expect(bucket.Properties).not.toHaveProperty('BucketName');
  });

  it('SEC-H-02 SEC-H-03 bucket policy has exactly the SSL deny, the OAC read and the auto-delete grant', () => {
    const [, policy] = onlyResource(json, 'AWS::S3::BucketPolicy');
    const statements = (policy.Properties?.['PolicyDocument'] as { Statement: Statement[] })
      .Statement;
    expect(statements).toHaveLength(3);

    const sslDeny = statements.filter((s) => s.Effect === 'Deny');
    expect(sslDeny).toEqual([
      expect.objectContaining({
        Action: 's3:*',
        Principal: { AWS: '*' },
        Condition: { Bool: { 'aws:SecureTransport': 'false' } },
      }),
    ]);

    const cloudFront = statements.filter(
      (s) =>
        JSON.stringify(s.Principal) === JSON.stringify({ Service: 'cloudfront.amazonaws.com' }),
    );
    expect(cloudFront).toHaveLength(1);
    expect(cloudFront[0]).toMatchObject({
      Effect: 'Allow',
      Action: 's3:GetObject',
      Condition: { StringEquals: { 'AWS:SourceArn': distributionArn } },
    });

    const others = statements.filter((s) => s.Effect === 'Allow' && !cloudFront.includes(s));
    expect(others).toHaveLength(1);
    expect(JSON.stringify(others[0]?.Principal)).toContain(
      'CustomS3AutoDeleteObjectsCustomResourceProviderRole',
    );
    for (const s of statements.filter((x) => x.Effect === 'Allow')) {
      expect(actionsOf(s)).not.toContain('s3:ListBucket');
      expect(s.Principal).not.toEqual({ AWS: '*' });
      expect(s.Principal).not.toBe('*');
    }
  });

  it('SEC-H-03 uses Origin Access Control with sigv4 always-signing and no OAI', () => {
    template.resourceCountIs('AWS::CloudFront::CloudFrontOriginAccessIdentity', 0);
    template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: Match.objectLike({
        OriginAccessControlOriginType: 's3',
        SigningBehavior: 'always',
        SigningProtocol: 'sigv4',
      }),
    });
    const origins = distConfig['Origins'] as Record<string, unknown>[];
    expect(origins).toHaveLength(1);
    expect(origins[0]?.['OriginAccessControlId']).toBeDefined();
    expect(origins[0]?.['S3OriginConfig']).toEqual({ OriginAccessIdentity: '' });
  });
});

describe('transport (T-H-2)', () => {
  it('SEC-H-05 redirects HTTP to HTTPS on the only behaviour', () => {
    expect(defaultBehavior['ViewerProtocolPolicy']).toBe('redirect-to-https');
    expect(distConfig).not.toHaveProperty('CacheBehaviors');
  });

  it('SEC-H-06 sets no MinimumProtocolVersion and uses the default certificate', () => {
    expect(distConfig).not.toHaveProperty('ViewerCertificate');
    expect(JSON.stringify(distConfig)).not.toContain('MinimumProtocolVersion');
    expect(distConfig).not.toHaveProperty('Aliases');
  });
});

describe('browser-facing headers (T-H-3, T-H-4)', () => {
  const [headersId, headers] = onlyResource(json, 'AWS::CloudFront::ResponseHeadersPolicy');
  const config = headers.Properties?.['ResponseHeadersPolicyConfig'] as Record<string, unknown>;

  it('SEC-H-07 attaches the one SecurityHeaders policy to the default behaviour', () => {
    expect(defaultBehavior['ResponseHeadersPolicyId']).toEqual({ Ref: headersId });
  });

  it('SEC-H-06 SEC-H-07 sets the exact security header values with override', () => {
    expect(config['SecurityHeadersConfig']).toEqual({
      ContentSecurityPolicy: { ContentSecurityPolicy: CSP, Override: true },
      StrictTransportSecurity: {
        AccessControlMaxAgeSec: 31_536_000,
        IncludeSubdomains: false,
        Preload: false,
        Override: true,
      },
      ContentTypeOptions: { Override: true },
      FrameOptions: { FrameOption: 'DENY', Override: true },
      ReferrerPolicy: { ReferrerPolicy: 'no-referrer', Override: true },
    });
    expect(config['CustomHeadersConfig']).toEqual({
      Items: [{ Header: 'Permissions-Policy', Value: PERMISSIONS_POLICY, Override: true }],
    });
  });

  it('SEC-H-07 CSP is the baseline plus exactly the two graphics-uplift additions (SR-G-01)', () => {
    expect(CSP).toBe(
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    );
    // The only unsafe- token is wasm-unsafe-eval, which does not allow JS eval.
    expect(CSP.replace("'wasm-unsafe-eval'", '')).not.toContain('unsafe-');
    expect(CSP).not.toMatch(/img-src[^;]*blob:/);
    expect(CSP).toMatch(/connect-src 'self';/);
    expect(PERMISSIONS_POLICY).toBe('camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  });

  it('SR-G-01 policy.ts is the single CDK-free source of the policy strings', () => {
    const src = readFileSync(path.join(REPO_ROOT, 'infra/lib/policy.ts'), 'utf8');
    expect(src).not.toMatch(/from 'aws-cdk-lib/);
    expect(PREVIEW_HEADERS['Content-Security-Policy']).toBe(CSP);
    expect(PREVIEW_HEADERS['Permissions-Policy']).toBe(PERMISSIONS_POLICY);
    expect(PREVIEW_HEADERS['X-Content-Type-Options']).toBe('nosniff');
  });

  it('SEC-H-08 has no edge functions, Lambda@Edge or extra behaviours', () => {
    expect(defaultBehavior).not.toHaveProperty('FunctionAssociations');
    expect(defaultBehavior).not.toHaveProperty('LambdaFunctionAssociations');
    expect(distConfig).not.toHaveProperty('CacheBehaviors');
    template.resourceCountIs('AWS::CloudFront::Function', 0);
  });
});

describe('identity, credentials and privilege (T-H-5)', () => {
  it('SEC-H-09 is environment-agnostic: account and region are unresolved tokens', () => {
    expect(Token.isUnresolved(stack.account)).toBe(true);
    expect(Token.isUnresolved(stack.region)).toBe(true);
    expect(JSON.stringify(json)).not.toMatch(/\b\d{12}\b/);
  });

  it('SEC-H-10 creates no IAM user or access key', () => {
    template.resourceCountIs('AWS::IAM::User', 0);
    template.resourceCountIs('AWS::IAM::AccessKey', 0);
  });

  it('SEC-H-11 SD-H-01 has no wildcard Allow resource in any identity policy', () => {
    const wildcardAllows = identityStatements(json).filter(
      (s) => s.Effect === 'Allow' && resourcesOf(s).includes('*'),
    );
    expect(wildcardAllows).toEqual([]);
  });

  it('SEC-H-11 SD-H-01 scopes invalidation to this distribution only', () => {
    const invalidation = identityStatements(json).filter((s) =>
      actionsOf(s).some((a) => a.startsWith('cloudfront:')),
    );
    expect(invalidation).toHaveLength(1);
    expect(invalidation[0]?.Effect).toBe('Allow');
    expect([...actionsOf(invalidation[0] as Statement)].sort()).toEqual([
      'cloudfront:CreateInvalidation',
      'cloudfront:GetInvalidation',
    ]);
    expect(invalidation[0]?.Resource).toEqual(distributionArn);
  });

  it('SEC-H-11 SD-H-03 the only "*" resources are the two CreateLogGroup denies', () => {
    const wildcards = identityStatements(json).filter((s) => resourcesOf(s).includes('*'));
    expect(wildcards).toHaveLength(2);
    for (const s of wildcards) {
      expect(s.Effect).toBe('Deny');
      expect(actionsOf(s)).toEqual(['logs:CreateLogGroup']);
    }
  });

  it('SEC-H-11 S3 writes target only this bucket and the bootstrap bucket is read-only', () => {
    for (const s of identityStatements(json).filter((x) => x.Effect === 'Allow')) {
      const actions = actionsOf(s);
      if (!actions.some((a) => a.startsWith('s3:'))) continue;
      const resources = JSON.stringify(resourcesOf(s));
      const writes = actions.some((a) => /^s3:(Put|Delete|Abort)/.test(a));
      if (writes) {
        expect(resources).toContain(bucketId);
        expect(resources).not.toContain('cdk-hnb659fds-assets');
      } else {
        expect(resources).toContain('cdk-hnb659fds-assets');
      }
    }
  });

  it('SEC-H-12 attaches only AWSLambdaBasicExecutionRole as a managed policy', () => {
    const roles = resourcesOfType(json, 'AWS::IAM::Role');
    expect(roles).toHaveLength(2);
    for (const [, role] of roles) {
      const arns = (role.Properties?.['ManagedPolicyArns'] ?? []) as unknown[];
      expect(arns).toHaveLength(1);
      expect(JSON.stringify(arns[0])).toContain(`policy/service-role/${BASIC_EXECUTION}`);
    }
    expect(JSON.stringify(json)).not.toMatch(/FullAccess|AdministratorAccess/);
  });
});

describe('teardown and resource inventory (T-H-6)', () => {
  it('SEC-H-13 SD-H-04 resource types equal the allowlist exactly, with no CDK metadata', () => {
    const types = [...new Set(Object.values(json.Resources).map((r) => r.Type))].sort();
    expect(types).toEqual(ALLOWED_TYPES);
    template.resourceCountIs('AWS::CDK::Metadata', 0);
  });

  it('SEC-H-14 the bucket and every log group are deleted with the stack', () => {
    expect(bucket.DeletionPolicy).toBe('Delete');
    expect(bucket.UpdateReplacePolicy).toBe('Delete');
    const logGroups = resourcesOfType(json, 'AWS::Logs::LogGroup');
    expect(logGroups).toHaveLength(2);
    for (const [, lg] of logGroups) {
      expect(lg.DeletionPolicy).toBe('Delete');
      expect(lg.UpdateReplacePolicy).toBe('Delete');
      expect(lg.Properties?.['RetentionInDays']).toBe(7);
    }
    template.resourceCountIs('Custom::S3AutoDeleteObjects', 1);
  });

  it('SEC-H-14 SD-H-02 every Lambda logs to a stack-managed log group', () => {
    const logGroups = resourcesOfType(json, 'AWS::Logs::LogGroup');
    const logGroupIds = new Set(logGroups.map(([id]) => id));
    const functions = resourcesOfType(json, 'AWS::Lambda::Function');
    expect(functions).toHaveLength(2);
    for (const [fnId, fn] of functions) {
      const configured = (
        fn.Properties?.['LoggingConfig'] as { LogGroup?: { Ref?: string } } | undefined
      )?.LogGroup?.Ref;
      const named = logGroups.some(
        ([, lg]) =>
          JSON.stringify(lg.Properties?.['LogGroupName']) ===
          JSON.stringify({ 'Fn::Join': ['', ['/aws/lambda/', { Ref: fnId }]] }),
      );
      expect(
        (configured !== undefined && logGroupIds.has(configured)) || named,
        `${fnId} has no stack-managed log group`,
      ).toBe(true);
    }
  });

  it('SEC-H-14 SD-H-02 the auto-delete custom resource depends on its log group', () => {
    const [, autoDelete] = onlyResource(json, 'Custom::S3AutoDeleteObjects');
    const [autoDeleteLogsId] = resourcesOfType(json, 'AWS::Logs::LogGroup').find(([, lg]) =>
      JSON.stringify(lg.Properties?.['LogGroupName'] ?? null).includes('/aws/lambda/'),
    ) ?? [''];
    expect(autoDeleteLogsId).not.toBe('');
    expect(dependsOn(autoDelete)).toContain(autoDeleteLogsId);
  });

  it('SEC-H-17 synthesis writes no cdk.context.json (no lookups)', () => {
    expect(existsSync(path.join(REPO_ROOT, 'cdk.context.json'))).toBe(false);
  });
});

describe('cost exposure (T-H-9)', () => {
  it('SEC-H-19 caps edge spend with PriceClass_100 and has no fixed-cost services', () => {
    expect(distConfig['PriceClass']).toBe('PriceClass_100');
    for (const type of [
      'AWS::WAFv2::WebACL',
      'AWS::Route53::HostedZone',
      'AWS::CertificateManager::Certificate',
      'AWS::KMS::Key',
    ]) {
      template.resourceCountIs(type, 0);
    }
    expect(distConfig).not.toHaveProperty('Logging');
  });
});
