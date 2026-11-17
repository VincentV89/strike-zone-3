/**
 * The one StrikeZone stack (ADR-013, TS-H-05..09): a private S3 origin behind
 * CloudFront with Origin Access Control, two ordered BucketDeployments and
 * stack-managed log groups. Every resource is removed by `cdk destroy`.
 *
 * Three escape hatches on CDK-managed constructs are deliberate and listed in
 * infra/README.md: ScopeInvalidationAspect (SD-H-01, SEC-H-11), the
 * AutoDeleteObjects provider log group (SD-H-02, SEC-H-14) and the
 * logs:CreateLogGroup denies on both Lambda roles (SD-H-03, SEC-H-14).
 */
import {
  Aspects,
  CfnOutput,
  type CfnResource,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  HttpVersion,
  PriceClass,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, CacheControl, Source } from 'aws-cdk-lib/aws-s3-deployment';
import type { Asset } from 'aws-cdk-lib/aws-s3-assets';
import type { Construct } from 'constructs';
import { ScopeInvalidationAspect } from './aspects.ts';
import type { WebSource } from './config.ts';
import { SECURITY_HEADERS_PROPS } from './headers.ts';
import { createWebAsset } from './web-asset.ts';

/** Construct path of the CDK singleton that empties the bucket on delete. */
export const AUTO_DELETE_PROVIDER_ID = 'Custom::S3AutoDeleteObjectsCustomResourceProvider';

export const ASSETS_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const INDEX_CACHE_CONTROL = 'no-cache';

export interface StrikeZoneStackProps extends StackProps {
  readonly webSource: WebSource;
}

const DENY_CREATE_LOG_GROUP = {
  Effect: 'Deny',
  Action: 'logs:CreateLogGroup',
  Resource: '*',
} as const;

export class StrikeZoneStack extends Stack {
  readonly bucket: Bucket;
  readonly distribution: Distribution;
  readonly webAsset: Asset;
  readonly webAssets: BucketDeployment;
  readonly webIndex: BucketDeployment;

  constructor(scope: Construct, id: string, props: StrikeZoneStackProps) {
    super(scope, id, props);

    // SEC-H-01..04: private, SSL-only, SSE-S3, no ACLs, no website, no versioning.
    this.bucket = new Bucket(this, 'Web', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: BucketEncryption.S3_MANAGED,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: false,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const securityHeaders = new ResponseHeadersPolicy(
      this,
      'SecurityHeaders',
      SECURITY_HEADERS_PROPS,
    );

    // SEC-H-05..08, PERF-H-03, REL-H-05, SEC-H-19. minimumProtocolVersion is
    // deliberately unset: with the default certificate it has no effect and
    // CDK's warning would fail `synth --strict`.
    this.distribution = new Distribution(this, 'Distribution', {
      comment: 'StrikeZone static site',
      defaultRootObject: 'index.html',
      httpVersion: HttpVersion.HTTP2_AND_3,
      enableIpv6: true,
      priceClass: PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        compress: true,
      },
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
        ttl: Duration.seconds(0),
      })),
    });

    this.webAsset = createWebAsset(this, 'WebBundle', props.webSource);
    const source = Source.bucket(this.webAsset.bucket, this.webAsset.s3ObjectKey);

    const deployLogs = new LogGroup(this, 'DeployLogs', {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // SEC-H-15, REL-H-02, PERF-H-02: hashed assets first, never pruned.
    this.webAssets = new BucketDeployment(this, 'WebAssets', {
      sources: [source],
      destinationBucket: this.bucket,
      exclude: ['index.html'],
      prune: false,
      cacheControl: [CacheControl.fromString(ASSETS_CACHE_CONTROL)],
      logGroup: deployLogs,
    });

    // Then index.html, the only deployment that invalidates.
    this.webIndex = new BucketDeployment(this, 'WebIndex', {
      sources: [source],
      destinationBucket: this.bucket,
      exclude: ['*'],
      include: ['index.html'],
      prune: false,
      cacheControl: [CacheControl.fromString(INDEX_CACHE_CONTROL)],
      distribution: this.distribution,
      distributionPaths: ['/*'],
      logGroup: deployLogs,
    });
    this.webIndex.node.addDependency(this.webAssets);

    // SD-H-01: replace CDK's invalidation grant on "*" with one on this distribution.
    Aspects.of(this).add(new ScopeInvalidationAspect());
    const handlerRole = this.webIndex.handlerRole;
    handlerRole.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cloudfront:CreateInvalidation', 'cloudfront:GetInvalidation'],
        resources: [
          this.formatArn({
            service: 'cloudfront',
            region: '',
            resource: 'distribution',
            resourceName: this.distribution.distributionId,
          }),
        ],
      }),
    );
    // SD-H-03: late log delivery must not re-create a deleted log group.
    handlerRole.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.DENY,
        actions: [DENY_CREATE_LOG_GROUP.Action],
        resources: ['*'],
      }),
    );

    this.addAutoDeleteLogGroup();

    // OBS-H-01: what verification reads for smoke and destroy checks.
    new CfnOutput(this, 'DistributionUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
    });
    new CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId });
    new CfnOutput(this, 'BucketName', { value: this.bucket.bucketName });
  }

  /**
   * SD-H-02 and SD-H-03 for the AutoDeleteObjects provider: a stack-managed
   * log group named after the handler, created before the custom resource
   * runs, plus an inline Deny on the provider role.
   */
  private addAutoDeleteLogGroup(): void {
    const provider = this.node.findChild(AUTO_DELETE_PROVIDER_ID);
    const handler = provider.node.findChild('Handler') as CfnResource;
    const role = provider.node.findChild('Role') as CfnResource;

    const autoDeleteLogs = new LogGroup(this, 'AutoDeleteLogs', {
      logGroupName: Fn.join('', ['/aws/lambda/', handler.ref]),
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    role.addPropertyOverride('Policies', [
      {
        PolicyName: 'DenyCreateLogGroup',
        PolicyDocument: { Version: '2012-10-17', Statement: [DENY_CREATE_LOG_GROUP] },
      },
    ]);

    // The CDK CustomResource that empties the bucket must run after its log group exists.
    this.bucket.node
      .findChild('AutoDeleteObjectsCustomResource')
      .node.addDependency(autoDeleteLogs);
  }
}
