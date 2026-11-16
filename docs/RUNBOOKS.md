# StrikeZone runbooks

These runbooks cover the production site: one `StrikeZone` CloudFormation stack that serves a static bundle from a private S3 bucket through CloudFront. There is no server, no database and no player data on AWS. Settings and match history live in each player's browser (localStorage, keyed by the CloudFront origin). There is no on-call: the repository owner handles every incident.

Rollback is always a revert commit through the normal pipeline. The details of the pipeline and its one-time setup are in [infra/README.md](../infra/README.md).

## Severity

| Severity | Meaning                                                                                              | Respond                | Typical signal                                  |
| -------- | ---------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------- |
| P1       | The site is down or serves a broken game to every player                                             | Same day; revert first | Deploy job red after `cdk deploy`, smoke fails  |
| P2       | Unexpected cost, or a partial defect with a workaround (one map, one browser, one smoke check)       | Within 2 business days | AWS Budgets or Cost Anomaly email, player issue |
| P3       | A trend or hygiene problem with no player impact today (rising 4xx, flaky CI test, SLI under target) | With the next change   | Monthly review                                  |

Targets: RTO under 30 minutes once a revert starts. RPO does not apply, because nothing on AWS holds data that is not in git.

## How to run an incident

1. **Open an issue** with the label `incident` and the title `[P1] <short description>`. Write the first update: status (investigating, identified, mitigating, resolved), impact, next step and when the next update will be.
2. **Mitigate before you diagnose.** For a P1 that a recent deploy caused, start RB-02 straight away.
3. **Update the issue** at each status change. Do not guess at the root cause in the issue until it is confirmed.
4. **Close the issue** when the fix is deployed and both smoke checks pass. Link the revert or fix PR.
5. **Review** a P1 within 2 days, using the template at the end of this file. Add the review as the issue's final comment.

## RB-01 Deploy job failed at `cdk deploy`

Signal: the `deploy` job in `.github/workflows/ci.yml` is red at the deploy step. Production keeps serving the previous version, because CloudFormation rolls back by itself and old assets are never pruned.

1. Read the CloudFormation error in the job log.
2. In the CloudFormation console (stack region), confirm that `StrikeZone` is `UPDATE_ROLLBACK_COMPLETE`. On a first deploy, `ROLLBACK_COMPLETE` means the owner must delete the empty stack before retrying.
3. Common causes:
   - `could not assume role` or `Not authorized to perform sts:AssumeRoleWithWebIdentity`: a repository variable is missing or wrong, or the role trust no longer matches `repo:VincentV89/strike-zone-3:ref:refs/heads/main` (for example after someone added an `environment:`). See RB-06.
   - `SSM parameter /cdk-bootstrap/hnb659fds/version not found`: the region is not bootstrapped. Run the bootstrap step in infra/README.md.
   - `UPDATE_ROLLBACK_FAILED`: open an issue as P2 and use "Continue update rollback" in the console. Do not delete the stack, because that changes the CloudFront domain.
4. Fix through a PR. There is nothing to revert in production.

## RB-02 A bad release is live (revert)

Signal: `npm run smoke` or `npm run smoke:browser` fails in the deploy job, or a player reports a broken game after a green deploy.

1. Look at `smoke.json` and `browser-smoke.json` in the `deploy-reports-<sha>` artifact. If only `smoke:browser` failed and its one retry also failed, treat it as real, not as CDN propagation.
2. Find the bad commit from the `Commit:` line in the deploy job summary.
3. `git revert <sha>` on a branch (`git revert -m 1 <sha>` for a merge commit) and open a PR to `main`.
4. Merge when `verify` and `e2e` pass. The push runs verify, e2e, deploy and both smoke checks (about 15 to 25 minutes).
5. Done when the new deploy job is green. Record the timings in the incident issue against the 30-minute RTO.

Never re-run an old workflow run to roll back: its `web-dist-<sha>` artifact expires after 7 days, and `main` would still hold the bad code. Never use `cdk destroy` as a rollback.

## RB-03 Players see an old or mixed version

Signal: a player still gets the previous game after a green deploy, or the page loads with missing assets.

1. Check the `deploy` job: the `WebIndex` deployment invalidates `/*` after the assets upload. A green job means the invalidation completed.
2. Ask the player to reload. `index.html` is sent with `no-cache`, so one reload fetches the new entry point.
3. If several players still get the old `index.html` 15 minutes after a green deploy, the owner can run one invalidation by hand with their own credentials:

   ```
   aws cloudfront create-invalidation --distribution-id <DistributionId> --paths "/index.html"
   ```

4. Open a P3 issue if it happened at all. A green deploy should never leave stale content.

## RB-04 Cost alert or anomaly

Signal: the AWS Budgets email (over $5 a month, actual or forecast) or a Cost Anomaly Detection email.

1. In Cost Explorer, filter by tag `project=strikezone` and group by service. If the stack's own cost is near $0, the spend comes from something else in the account; close the issue as not StrikeZone.
2. In CloudWatch (region **us-east-1**, where CloudFront metrics live), look at `AWS/CloudFront Requests` and `BytesDownloaded` for the distribution over the last 7 days.
3. If traffic is a flood (for example more than 200,000 requests an hour with no reason), the owner chooses one of:
   - Accept it, if the projected cost is acceptable. Floods are an accepted risk with no WAF.
   - Disable the distribution in the CloudFront console. This stops the cost and takes the site down; the domain and player data survive and re-enabling restores the site.
   - Add AWS WAF rate limiting. This costs at least about $6 a month and is a design change (it changes the stack's resource allowlist), so it goes through a PR.
4. Record the choice in the issue.

## RB-05 CI is red with no related change

Signal: `verify` or `e2e` fails on a PR or on `main`, and the change cannot explain it.

1. Re-run the failed job once.
2. Known flaky tests: the burst ceiling in `tests/render/render-bench.test.ts` under full verify load, and the typed-lint probes in `tests/arch/ring-lint.test.ts`, which run close to the 60 s Vitest timeout. If a re-run passes, open a P3 issue with the job link. Never raise a ceiling or timeout without saying so in the PR.
3. If `e2e` fails at Chromium install, check the GitHub status page and the runner image. Production is not affected; wait or re-run later.
4. If it still fails, treat it as a real regression and fix it before anything else is merged.

## RB-06 Deploy credentials are broken or suspected compromised

The deploy uses GitHub OIDC. No long-lived AWS key exists, and the role trusts only pushes to `main` of this repository.

Broken (deploy cannot assume the role):

1. Check the three repository variables: `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION`, `AWS_ACCOUNT_ID`.
2. Check that the `StrikeZoneGitHubDeployRole` stack still exists and its trust condition is unchanged.

Suspected misuse (unexpected deploys, CloudTrail shows the role from an unknown workflow):

1. Owner, with an administrator profile: attach an inline deny-all policy to the deploy role, which stops new and existing sessions from acting. Sessions last at most 1 hour.
2. In GitHub, check recent pushes to `main`, branch protection and who has write access.
3. In CloudTrail, list events for the role over the last 7 days.
4. When the cause is closed, remove the deny policy, or delete and re-create the role stack from `infra/github-deploy-role.yaml`.
5. Open a P1 issue, but keep account ids and ARNs out of it.

## RB-07 GitHub Actions is unavailable and a rollback is needed

Needs local AWS credentials for the same account and region.

1. `aws sts get-caller-identity` and check the account and region.
2. Check out the last good commit.
3. `npm ci && npm run verify` must pass.
4. `npx cdk diff StrikeZone`, then `npx cdk deploy StrikeZone`.
5. `npm run smoke` and `npm run smoke:browser`.
6. Revert the bad commit on `main` afterwards, or the next push deploys it again.

## RB-08 The stack or its bucket is gone (disaster recovery)

The git repository is the backup: every deployed file is built from a commit, so AWS Backup is not used.

1. Confirm what is missing: `aws cloudformation describe-stacks --stack-name StrikeZone`.
2. If the stack exists but files are missing from the bucket, run the deploy again (push an empty commit to `main`, or RB-07 locally). BucketDeployment uploads every file.
3. If the stack is gone, deploy it again from `main`. The CDK bootstrap (`CDKToolkit`) and the deploy role survive a stack deletion.
4. A new stack gets a **new CloudFront domain**. Players lose their saved settings and match history, because localStorage is tied to the old origin. Publish the new URL in the incident issue and the README.
5. Run the smoke checks, then close the issue.

Expected recovery time: about 25 minutes, most of it CloudFront distribution creation.

## RB-09 A game defect in some browsers

Signal: a player report such as a black screen, a "WebGL2 not available" notice on a supported browser, the loading-error screen after "frame faults", or no sound.

1. Ask for the browser, its version, the GPU if known, and any `[strikezone] <code>` lines from the browser console. The game prints one line per diagnostic code and no personal data.
2. Reproduce locally with `npm run dev`, or with the matching manual test in `docs/MANUAL-TESTS.md`.
3. Set the severity: every supported browser broken is P1 (use RB-02 if a recent deploy caused it); one browser or one map is P2.
4. Fix forward through a PR with a test that fails before the fix.

## Post-incident review template

```
Incident: <issue link>   Severity: P1   Duration: <detected> to <resolved>
Impact: who could not play, for how long
Timeline: detected, first update, mitigation started, deployed, smoke green
Root cause:
Contributing factors:
What went well:
What to improve:
Actions: <issue links, each with an owner and a date>
```
