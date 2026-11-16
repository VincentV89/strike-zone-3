/**
 * ScopeInvalidationAspect (SEC-H-11, SD-H-01).
 *
 * BucketDeployment adds `cloudfront:GetInvalidation, cloudfront:CreateInvalidation`
 * on Resource "*" to its handler role whenever `distribution` is set. This
 * aspect removes that "*" grant; the stack adds an explicit statement scoped
 * to this distribution's ARN. If a CDK upgrade changes the statement shape so
 * that more than one match is found, synth fails loudly instead of silently
 * widening or narrowing the grant. Tests assert the scoped statement exists
 * and no wildcard Allow remains, which catches the zero-match case.
 */
import { Stack } from 'aws-cdk-lib';
import type { IAspect } from 'aws-cdk-lib';
import { CfnPolicy } from 'aws-cdk-lib/aws-iam';
import type { IConstruct } from 'constructs';

interface StatementJson {
  readonly Effect: string;
  readonly Action: string | readonly string[];
  readonly Resource?: unknown;
}

export const INVALIDATION_ACTIONS: readonly string[] = [
  'cloudfront:GetInvalidation',
  'cloudfront:CreateInvalidation',
];

function isInvalidationAllow(s: StatementJson): boolean {
  const actions = typeof s.Action === 'string' ? [s.Action] : s.Action;
  return (
    s.Effect === 'Allow' &&
    actions.length > 0 &&
    actions.every((a) => INVALIDATION_ACTIONS.includes(a))
  );
}

function hasWildcard(resource: unknown): boolean {
  return resource === '*' || (Array.isArray(resource) && resource.includes('*'));
}

/** True for an invalidation-only Allow statement whose resources include "*". */
export function isWildcardInvalidation(s: StatementJson): boolean {
  return isInvalidationAllow(s) && hasWildcard(s.Resource);
}

/**
 * Drops the "*" resource from the one wildcard invalidation statement. With
 * `@aws-cdk/aws-iam:minimizePolicies` on, CDK merges the scoped statement the
 * stack adds into the same statement (Resource: ["*", <distribution ARN>]),
 * so the wildcard is removed from the list; a bare "*" statement is dropped.
 */
export function scopeStatements(statements: readonly StatementJson[]): {
  readonly kept: StatementJson[];
  readonly removed: number;
} {
  let removed = 0;
  const kept: StatementJson[] = [];
  for (const s of statements) {
    if (!isWildcardInvalidation(s)) {
      kept.push(s);
      continue;
    }
    removed += 1;
    const rest = Array.isArray(s.Resource) ? s.Resource.filter((r) => r !== '*') : [];
    if (rest.length > 0) kept.push({ ...s, Resource: rest.length === 1 ? rest[0] : rest });
  }
  return { kept, removed };
}

export class ScopeInvalidationAspect implements IAspect {
  visit(node: IConstruct): void {
    if (!(node instanceof CfnPolicy)) return;
    const doc = Stack.of(node).resolve(node.policyDocument) as { Statement?: StatementJson[] };
    const { kept, removed } = scopeStatements(doc.Statement ?? []);
    if (removed === 0) return;
    if (removed !== 1) {
      throw new Error(`infra/invalidation-wildcard-shape: matched ${String(removed)} statements`);
    }
    node.addPropertyOverride('PolicyDocument.Statement', kept);
  }
}
