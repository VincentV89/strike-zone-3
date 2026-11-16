# StrikeZone hosting infrastructure

One AWS CDK v2 TypeScript app (`cdk.json` at the repository root, code in `infra/`) with one stack, `StrikeZone`: a private S3 bucket behind a CloudFront distribution with Origin Access Control. The game is a static bundle, so the stack has no servers, database or runtime Lambda. The two Lambda functions in the template run only at deploy and destroy time.

## Layout

| Path                            | Content                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `infra/bin/app.ts`              | CDK app entry, run by `node infra/bin/app.ts` (Node 24 type stripping)                         |
| `infra/lib/app-definition.ts`   | Creates the `StrikeZone` stack and applies the `project` and `managed-by` tags                 |
| `infra/lib/config.ts`           | Parses `SZ_SKIP_WEB_BUILD` and `SZ_WEB_DIR`; `REPO_ROOT`                                       |
| `infra/lib/web-asset.ts`        | The single web asset: build mode (local `npm run build:web`) or prebuilt mode                  |
| `infra/lib/headers.ts`          | The CSP and the security headers policy                                                        |
| `infra/lib/aspects.ts`          | `ScopeInvalidationAspect`                                                                      |
| `infra/lib/strikezone-stack.ts` | Bucket, distribution, the two BucketDeployments, log groups, outputs                           |
| `tests/infra/`                  | CDK assertion tests; each test name starts with its requirement id (SEC-H, REL-H, PERF-H, ...) |
| `tests/fixtures/web-dist/`      | Text-only prebuilt bundle the tests synthesise against                                         |

## Inputs

The app reads exactly two environment variables. Nothing else, including `CDK_DEFAULT_ACCOUNT` and `CDK_DEFAULT_REGION`, is read.

| Variable            | Values                                                        | Effect                                                                      |
| ------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `SZ_SKIP_WEB_BUILD` | unset (or empty), or exactly `1`; anything else is an error   | Unset: build mode, the web bundle is built during synth. `1`: prebuilt mode |
| `SZ_WEB_DIR`        | optional path; must be a directory that contains `index.html` | Prebuilt mode only. Defaults to `<repo>/dist`                               |

## Gate step (offline)

`npm run synth` typechecks `infra/` with Node module semantics (`tsconfig.infra.json`) and runs `cdk synth --quiet --strict --no-notices` in prebuilt mode on the `dist/` that `npm run build` produced. It needs no credentials and makes no AWS calls. `--strict` turns any CDK warning into a failure. It runs inside `npm run verify` between `build` and `check:licences`.

Telemetry and version reporting are off in three places on purpose: `analyticsReporting: false` on the stack, `"versionReporting": false` and `"cli-telemetry": false` in `cdk.json`, and `CDK_DISABLE_CLI_TELEMETRY=true` in the `synth` script.

## Deploy (manual, credentialed)

Deploy is never part of `npm run verify`. It needs AWS credentials (D-01) and a one-time CDK bootstrap that the requester approves (D-02). Run everything from the repository root.

1. `aws sts get-caller-identity`. The CLI profile chooses the account and region; the stack pins neither.
2. `npx cdk bootstrap`, once per account and region, only after approval. It is never scripted.
3. `npm ci && npm run verify` on the commit you will deploy.
4. `npx cdk diff` and review IAM and resource changes.
5. `npx cdk deploy --all`. Build mode runs `npm run build:web` into a CDK staging directory, so one command builds and publishes. Answer the IAM approval prompt yourself; `--require-approval never` is used only by an agent run the requester approved and by the GitHub Actions deploy job, whose IAM changes were reviewed in the pull request that the `verify` gate checked.
6. Run the smoke checks (SM-1..8, owned by verification) against the `DistributionUrl` output.

Stack outputs: `DistributionUrl`, `DistributionId`, `BucketName`.

**Publish order.** `WebAssets` uploads every file except `index.html` with `Cache-Control: public, max-age=31536000, immutable`. `WebIndex` then uploads `index.html` with `no-cache` and invalidates `/*`. Neither prunes, so a browser holding the previous `index.html` still finds its assets.

**Rollback.** Check out the last good commit and repeat steps 3 to 6 (RTO under 30 minutes). There is no server-side state.

## GitHub Actions CI/CD

`.github/workflows/ci.yml` runs on pull requests to `main`, pushes to `main` and manual dispatch. `tests/scripts/ci-workflow.test.ts` (inside `npm run verify`) pins its shape.

| Job      | When                                      | Credentials              | What it does                                                                                                                                                                                                                                                                           |
| -------- | ----------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify` | every run                                 | none (`contents: read`)  | `npm ci && npm run verify`, advisory `npm run audit`; uploads `reports/` and `coverage/` (14 days) and the verified `dist/` (7 days)                                                                                                                                                   |
| `e2e`    | every run, in parallel with verify        | none (`contents: read`)  | installs headless Chromium, `npm run e2e` (seeded rounds and Play Again on both maps against `dist-test/`)                                                                                                                                                                             |
| `deploy` | push to `main` only, after verify and e2e | GitHub OIDC, 1 h session | `cdk deploy StrikeZone` in prebuilt mode with the exact `dist/` verify built and checked, writes the `DistributionUrl` to the run summary, then `npm run smoke` (SM-1..SM-9) and `npm run smoke:browser` (opens the URL, clicks Start Game and the Ready gate, waits for the live HUD) |

Deploys never overlap (`deploy-strikezone` concurrency group, never cancelled mid-run). Every action is pinned to a commit SHA.

### One-time setup (account owner, with an administrator profile)

1. **Pick the account and region.** Any commercial region works; CloudFront is global. The stack, the bootstrap and the deploy role must all be in the same region.
2. **Bootstrap CDK once:** `npx cdk bootstrap aws://<ACCOUNT_ID>/<REGION>`. This creates the `CDKToolkit` stack and the `cdk-hnb659fds-*` roles the workflow assumes. Without it, the deploy job fails at `cdk deploy` with a bootstrap error. The default bootstrap gives the CloudFormation execution role `AdministratorAccess`; to narrow it, re-bootstrap with `--cloudformation-execution-policies <policy-arn>` covering S3, CloudFront, IAM roles for the two deploy-time Lambdas, Lambda and CloudWatch Logs.
3. **Create the deploy role** from `infra/github-deploy-role.yaml`:

   ```
   aws cloudformation deploy --stack-name StrikeZoneGitHubDeployRole \
     --template-file infra/github-deploy-role.yaml --capabilities CAPABILITY_NAMED_IAM \
     --parameter-overrides CreateOidcProvider=true
   ```

   Use `CreateOidcProvider=false` if the account already has the `token.actions.githubusercontent.com` provider. The role trusts only tokens whose `sub` is `repo:VincentV89/strike-zone-3:ref:refs/heads/main` with audience `sts.amazonaws.com`. Pull requests, other branches, forks and tags cannot assume it. It may only assume the CDK bootstrap deploy, file-publishing and lookup roles and call `cloudformation:DescribeStacks` on `StrikeZone` and `CDKToolkit` (smoke precheck). Sessions last at most 1 hour and no long-lived key exists anywhere.

4. **Set three repository variables** (Settings → Secrets and variables → Actions → Variables; none of them is a secret): `AWS_DEPLOY_ROLE_ARN` (the `DeployRoleArn` output), `AWS_REGION`, `AWS_ACCOUNT_ID` (the credentials action refuses any other account). The deploy job fails with a named error while any of them is missing.
5. **Protect `main`:** require pull requests and the `verify` and `e2e` status checks before merging. This is a repository setting; the workflow cannot set it.

If you add a GitHub `environment:` to the deploy job (for a manual approval), the OIDC `sub` becomes `repo:VincentV89/strike-zone-3:environment:<name>`; change the role's trust condition to match, or the job cannot assume it.

### Rollback from CI

A failed stack update rolls back by itself in CloudFormation. If the smoke checks fail after a successful deploy, revert the bad commit on `main` (`git revert`, pull request, merge); the push re-runs verify, e2e and deploy with the previous code, well inside the 30-minute RTO. The manual rollback above still works when GitHub Actions is unavailable. Incident runbooks (failed deploy, bad release, cost alert, credentials, disaster recovery) are in [docs/RUNBOOKS.md](../docs/RUNBOOKS.md).

## Destroy

`npx cdk destroy --all`. The bucket is emptied by the AutoDeleteObjects custom resource and deleted together with the distribution, roles, functions and both log groups (all `RemovalPolicy.DESTROY`).

**What survives destroy (accepted).** The CDK bootstrap stack `CDKToolkit`, its staging bucket objects (the zipped bundles and the deploy handler code) and its ECR repository. They belong to the bootstrap, not to this stack. Nothing named `StrikeZone*` or `/aws/lambda/StrikeZone-*` should remain. Check with:

- `aws cloudformation describe-stacks --stack-name StrikeZone` (should fail: stack does not exist)
- `aws logs describe-log-groups --log-group-name-prefix /aws/lambda/StrikeZone`
- `aws resourcegroupstaggingapi get-resources --tag-filters Key=project,Values=strikezone` (should be empty)

## Escape hatches on CDK-managed constructs

These three overrides are deliberate. Each is pinned by a test in `tests/infra/stack.security.test.ts`.

| Id      | Requirement | What and why                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SD-H-01 | SEC-H-11    | `ScopeInvalidationAspect` removes the `"*"` resource from the `cloudfront:CreateInvalidation`/`GetInvalidation` grant that BucketDeployment adds, and the stack grants both actions on this distribution's ARN only. With `minimizePolicies` on, CDK merges the two into one statement, so the aspect strips `"*"` from its resource list. More than one match fails synth with `infra/invalidation-wildcard-shape`. |
| SD-H-02 | SEC-H-14    | The AutoDeleteObjects provider Lambda has no log group of its own, so its destroy-time run would create `/aws/lambda/...` outside CloudFormation. The stack adds `AutoDeleteLogs` named `/aws/lambda/<handler Ref>` (7 days, DESTROY), and the auto-delete custom resource depends on it.                                                                                                                            |
| SD-H-03 | SEC-H-14    | Both Lambda roles deny `logs:CreateLogGroup`, so late log delivery cannot re-create a log group after it was deleted. The provider role gets it through `addPropertyOverride('Policies', ...)`, the deploy handler role through `addToPrincipalPolicy`.                                                                                                                                                              |

## Cost

No fixed monthly charge: no WAF, Route 53, ACM, KMS or access-log bucket (the template's resource types are pinned to an allowlist). `PriceClass_100` limits edge locations to North America and Europe. Expected cost is about $0 inside the free tier and a few cents a month outside it.

A traffic flood is billed per request and is an accepted risk. The account owner should create an AWS Budgets alert (for example $5 a month) outside this stack, so it survives destroy. To see the stack in Cost Explorer, activate the `project` tag as a cost allocation tag in the Billing console.

## Residual risks

- The TLS floor is CloudFront's default policy, because there is no custom domain or certificate. `minimumProtocolVersion` has no effect with the default certificate, and setting it would fail `--strict` synth.
- No WAF, so floods become cost (see above).
- The staged bundles in the bootstrap bucket survive destroy.
- `ScopeInvalidationAspect` depends on the shape of CDK's generated statement. A shape change fails synth or the tests; review it on every aws-cdk-lib bump.
