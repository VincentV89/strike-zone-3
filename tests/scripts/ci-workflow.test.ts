/**
 * Shape test for the hosted pipeline (ci-pipeline QG-09). It pins the rules
 * every earlier unit set for hosted CI: the gate runs exactly `npm ci` and
 * `npm run verify` without cloud credentials, only the deploy job may request
 * an OIDC token, deploy runs only on a push to main after verify and e2e, it
 * deploys the bundle verify built, and every action is pinned to a commit SHA.
 * The deploy role template trusts main of this repository only.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const WORKFLOW = readFileSync('.github/workflows/ci.yml', 'utf8');
const ROLE = readFileSync('infra/github-deploy-role.yaml', 'utf8');

/** Splits the top-level `jobs:` map into job name -> block text (2-space indent). */
function jobs(src: string): Map<string, string> {
  const start = src.indexOf('\njobs:\n');
  expect(start).toBeGreaterThan(0);
  const out = new Map<string, string>();
  let name: string | null = null;
  let lines: string[] = [];
  for (const line of src.slice(start + 7).split('\n')) {
    const m = /^ {2}([a-z0-9-]+):$/.exec(line);
    if (m?.[1] !== undefined) {
      if (name !== null) out.set(name, lines.join('\n'));
      name = m[1];
      lines = [];
    } else if (/^\S/.test(line)) {
      break;
    } else {
      lines.push(line);
    }
  }
  if (name !== null) out.set(name, lines.join('\n'));
  return out;
}

const JOBS = jobs(WORKFLOW);
const job = (n: string): string => {
  const j = JOBS.get(n);
  if (j === undefined) throw new Error(`missing job ${n}`);
  return j;
};
const runs = (block: string): string[] =>
  [...block.matchAll(/^ {8}run: (.+)$/gm)].map((m) => (m[1] ?? '').trim());

describe('GitHub Actions workflow (.github/workflows/ci.yml)', () => {
  it('has exactly the verify, e2e and deploy jobs', () => {
    expect([...JOBS.keys()]).toEqual(['verify', 'e2e', 'deploy']);
  });

  it('defaults the token to contents: read and triggers on main only', () => {
    expect(WORKFLOW).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(WORKFLOW).toMatch(/pull_request:\n {4}branches: \[main\]/);
    expect(WORKFLOW).toMatch(/push:\n {4}branches: \[main\]/);
  });

  it('verify runs exactly npm ci && npm run verify (plus advisory audit), with no credentials', () => {
    const v = job('verify');
    expect(runs(v)).toEqual(['npm ci', 'npm run verify', 'npm run audit']);
    expect(v).toMatch(/permissions:\n {6}contents: read\n/);
    expect(v).not.toContain('id-token');
    expect(v).not.toMatch(/aws|secrets\./i);
    expect(v).toContain('node-version: ${{ env.NODE_VERSION }}');
    expect(WORKFLOW).toContain('NODE_VERSION: 24.19.0');
  });

  it('e2e has no credentials and runs npm run e2e', () => {
    const e = job('e2e');
    expect(e).not.toContain('id-token');
    expect(e).not.toMatch(/aws-actions|secrets\./);
    expect(runs(e)).toContain('npm run e2e');
  });

  it('only deploy requests an OIDC token, only on a push to main, after verify and e2e', () => {
    const d = job('deploy');
    expect(WORKFLOW.match(/id-token: write/g)?.length).toBe(1);
    expect(d).toContain('id-token: write');
    expect(d).toContain('needs: [verify, e2e]');
    expect(d).toContain("if: github.event_name == 'push' && github.ref == 'refs/heads/main'");
    expect(d).toMatch(/concurrency:\n {6}group: deploy-strikezone\n {6}cancel-in-progress: false/);
    expect(d).not.toMatch(/secrets\./);
    expect(d).not.toMatch(/aws-access-key-id|aws-secret-access-key/);
  });

  it('deploys the verified dist/ in prebuilt mode, never dist-test/ and never destroy', () => {
    const d = job('deploy');
    expect(d).toContain('name: web-dist-${{ github.sha }}');
    expect(d).toContain("SZ_SKIP_WEB_BUILD: '1'");
    expect(d).toContain('SZ_WEB_DIR: dist\n');
    expect(d).toContain(
      'npx cdk deploy StrikeZone --require-approval never --no-notices --outputs-file reports/cdk-outputs.json',
    );
    expect(WORKFLOW).not.toMatch(/dist-test\/?\s*$|cdk destroy|cdk bootstrap/m);
  });

  it('runs both smokes after the deploy and publishes the DistributionUrl', () => {
    const d = job('deploy');
    const order = [
      'cdk deploy StrikeZone',
      'DistributionUrl',
      'npm run smoke',
      'npm run smoke:browser',
    ];
    const at = order.map((s) => d.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(d).toContain('GITHUB_STEP_SUMMARY');
  });

  it('pins every action to a full commit SHA', () => {
    const uses = [...WORKFLOW.matchAll(/uses: (\S+)/g)].map((m) => m[1] ?? '');
    expect(uses.length).toBeGreaterThanOrEqual(8);
    for (const u of uses) expect(u, u).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+@[0-9a-f]{40}$/);
  });

  it('does not let checkout persist the token', () => {
    const checkouts = WORKFLOW.match(/actions\/checkout@/g)?.length ?? 0;
    expect(WORKFLOW.match(/persist-credentials: false/g)?.length).toBe(checkouts);
  });
});

describe('deploy role template (infra/github-deploy-role.yaml)', () => {
  it('trusts GitHub OIDC for refs/heads/<Branch> of one repository, default main', () => {
    expect(ROLE).toContain('Action: sts:AssumeRoleWithWebIdentity');
    expect(ROLE).toContain('token.actions.githubusercontent.com:aud: sts.amazonaws.com');
    expect(ROLE).toContain(
      'token.actions.githubusercontent.com:sub: !Sub repo:${GitHubRepository}:ref:refs/heads/${Branch}',
    );
    expect(ROLE).toMatch(/Branch:\n {4}Type: String\n {4}Default: main\n/);
    expect(ROLE).not.toContain('StringLike');
    expect(ROLE).toContain('MaxSessionDuration: 3600');
  });

  it('grants only the CDK bootstrap roles and DescribeStacks, with no wildcard action', () => {
    const actions = [...ROLE.matchAll(/^ {18}- (\S+:\S+)$|Action: (\S+:\S+)$/gm)].map(
      (m) => m[1] ?? m[2] ?? '',
    );
    expect(new Set(actions)).toEqual(
      new Set([
        'sts:AssumeRoleWithWebIdentity',
        'sts:AssumeRole',
        'sts:TagSession',
        'cloudformation:DescribeStacks',
      ]),
    );
    expect(ROLE).not.toMatch(/Action: '?\*|Resource: '?\*/);
  });
});
