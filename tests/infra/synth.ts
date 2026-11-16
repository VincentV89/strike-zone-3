/**
 * Shared synthesis for the infra assertion suites: prebuilt mode against the
 * committed fixture, with the feature flags from cdk.json so tests see the
 * same template as `cdk synth`. The App writes to a temporary outdir, never
 * to the repository.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { defineStrikeZone } from '../../infra/lib/app-definition.ts';
import { REPO_ROOT } from '../../infra/lib/config.ts';
import type { StrikeZoneStack } from '../../infra/lib/strikezone-stack.ts';

export const FIXTURE_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'web-dist');

interface CdkJson {
  readonly context: Record<string, unknown>;
}

export function cdkContext(): Record<string, unknown> {
  const cdk = JSON.parse(readFileSync(path.join(REPO_ROOT, 'cdk.json'), 'utf8')) as CdkJson;
  return cdk.context;
}

export interface Synthesised {
  readonly app: App;
  readonly stack: StrikeZoneStack;
  readonly template: Template;
  readonly json: TemplateJson;
}

export interface ResourceJson {
  readonly Type: string;
  readonly Properties?: Record<string, unknown>;
  readonly DependsOn?: string | readonly string[];
  readonly DeletionPolicy?: string;
  readonly UpdateReplacePolicy?: string;
}

export interface TemplateJson {
  readonly Resources: Record<string, ResourceJson>;
  readonly Outputs?: Record<string, unknown>;
}

export function synthPrebuilt(webDir: string = FIXTURE_DIR): Synthesised {
  const app = new App({ context: cdkContext() });
  const stack = defineStrikeZone(app, { mode: 'prebuilt', webDir });
  const template = Template.fromStack(stack);
  return { app, stack, template, json: template.toJSON() as TemplateJson };
}

export function resourcesOfType(json: TemplateJson, type: string): [string, ResourceJson][] {
  return Object.entries(json.Resources).filter(([, r]) => r.Type === type);
}

export function onlyResource(json: TemplateJson, type: string): [string, ResourceJson] {
  const found = resourcesOfType(json, type);
  if (found.length !== 1) throw new Error(`expected one ${type}, found ${String(found.length)}`);
  return found[0] as [string, ResourceJson];
}

export function dependsOn(r: ResourceJson): readonly string[] {
  if (r.DependsOn === undefined) return [];
  return typeof r.DependsOn === 'string' ? [r.DependsOn] : r.DependsOn;
}

export interface Statement {
  readonly Effect: string;
  readonly Action: string | readonly string[];
  readonly Resource?: unknown;
  readonly Principal?: unknown;
  readonly Condition?: unknown;
}

export function actionsOf(s: Statement): readonly string[] {
  return typeof s.Action === 'string' ? [s.Action] : s.Action;
}

export function resourcesOf(s: Statement): readonly unknown[] {
  if (s.Resource === undefined) return [];
  return Array.isArray(s.Resource) ? (s.Resource as unknown[]) : [s.Resource];
}

/** Every identity-policy statement: AWS::IAM::Policy documents and inline role policies. */
export function identityStatements(json: TemplateJson): Statement[] {
  const out: Statement[] = [];
  for (const [, r] of resourcesOfType(json, 'AWS::IAM::Policy')) {
    const doc = r.Properties?.['PolicyDocument'] as { Statement: Statement[] };
    out.push(...doc.Statement);
  }
  for (const [, r] of resourcesOfType(json, 'AWS::IAM::Role')) {
    const inline = (r.Properties?.['Policies'] ?? []) as {
      PolicyDocument: { Statement: Statement[] };
    }[];
    for (const p of inline) out.push(...p.PolicyDocument.Statement);
  }
  return out;
}
