/**
 * Defines the StrikeZone stack on an App. Shared by infra/bin/app.ts and the
 * assertion tests so both synthesise exactly the same construct tree.
 */
import { Tags, type App } from 'aws-cdk-lib';
import type { WebSource } from './config.ts';
import { StrikeZoneStack } from './strikezone-stack.ts';

export const STACK_ID = 'StrikeZone';

export function defineStrikeZone(app: App, webSource: WebSource): StrikeZoneStack {
  const stack = new StrikeZoneStack(app, STACK_ID, {
    description: 'StrikeZone static site: private S3 origin behind CloudFront (OAC)',
    // SD-H-04: no AWS::CDK::Metadata, also when tests synthesise without the CLI.
    analyticsReporting: false,
    webSource,
  });
  // ID-H-01: cost attribution and the post-destroy inventory filter.
  Tags.of(app).add('project', 'strikezone');
  Tags.of(app).add('managed-by', 'cdk');
  return stack;
}
