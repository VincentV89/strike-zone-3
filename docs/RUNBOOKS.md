# StrikeZone runbooks

These runbooks cover the production site: one `StrikeZone` CloudFormation stack that serves a static bundle from a private S3 bucket through CloudFront. There is no server, no database and no player data on AWS. Since the graphics uplift the bundle also holds about 17 MB of binary assets (`.glb` models, `.ktx2` textures and the Basis transcoder `.wasm`), published by their own BucketDeployments with explicit content types. Settings and match history live in each player's browser (localStorage, keyed by the CloudFront origin). There is no on-call: the repository owner handles every incident.

Rollback is always a revert commit through the normal pipeline. The details of the pipeline and its one-time setup are in [infra/README.md](../infra/README.md).

## Severity

| Severity | Meaning                                                                                              | Respond                | Typical signal                                  |
| -------- | ---------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------- |
| P1       | The site is down or serves a broken game to every player                                             | Same day; revert first | Deploy job red after `cdk deploy`, smoke fails  |
| P2       | Unexpected cost, or a partial defect with a workaround (one map, one browser, one smoke check)       | Within 2 business days | AWS Budgets or Cost Anomaly email, player issue |
| P3       | A trend or hygiene problem with no player impact today (rising 4xx, flaky CI test, SLI under target) | With the next change   | Monthly review                                  |

Targets: RTO under 30 minutes once a revert starts. RPO does not apply, because nothing on AWS holds data that is not in git.

The alert ids used in the observability design map onto this scale as follows. A design "SEV2" is a P1 here, because it means every player is affected.

| Alert                                                          | Severity | Runbook           |
| -------------------------------------------------------------- | -------- | ----------------- |
| SM-4c binary asset check fails (AL-G-01a)                      | P1       | RB-10, then RB-02 |
| SM-3 CSP or Permissions-Policy differs (AL-G-01b)              | P1       | RB-11, then RB-02 |
| `smoke:browser` does not reach the live HUD (AL-G-01c)         | P1       | RB-02             |
| `smoke:browser` reaches the HUD with asset warnings (AL-G-01c) | P2       | RB-12             |
| `cdk deploy` fails or the deploy Lambda fails (AL-G-01d)       | P2       | RB-01, RB-13      |
| AWS Budgets or Cost Anomaly Detection (AL-G-03, AL-G-04)       | P2       | RB-04             |
| A recorded manual-fail on MT-G1, MT-G2, MT-G3 or load time     | P2       | RB-14             |
| e2e fails on a PR (AL-G-02)                                    | none     | Fix before merge  |

## How to run an incident

1. **Open an issue** with the label `incident` and the title `[P1] <short description>`. Write the first update: status (investigating, identified, mitigating, resolved), impact, next step and when the next update will be.
2. **Mitigate before you diagnose.** For a P1 that a recent deploy caused, start RB-02 straight away.
3. **Update the issue** at each status change. Do not guess at the root cause in the issue until it is confirmed.
4. **Close the issue** when the fix is deployed and both smoke checks pass. Link the revert or fix PR.
5. **Review** a P1 within 2 days, using the template at the end of this file. Add the review as the issue's final comment.

## RB-01 Deploy job failed at `cdk deploy`

Signal: the `deploy` job in `.github/workflows/ci.yml` is red at the deploy step. Production keeps serving the previous version, because CloudFormation rolls back by itself and old assets are never pruned.

1. Read the CloudFormation error in the job log.
2. In the CloudFormation console (stack region), confirm that `StrikeZone` is `UPDATE_ROLLBACK_COMPLETE`. The stack has existed since the 2026-11-17 deploy, so a failed deploy is an update and rolls back by itself. `ROLLBACK_COMPLETE` only happens on a create; then the owner deletes the empty stack before retrying.
3. Common causes:
   - `could not assume role` or `Not authorized to perform sts:AssumeRoleWithWebIdentity`: a repository variable is missing or wrong, or the role trust no longer matches `repo:VincentV89/strike-zone-3:ref:refs/heads/main` (for example after someone added an `environment:`). See RB-06.
   - `SSM parameter /cdk-bootstrap/hnb659fds/version not found`: the region is not bootstrapped. Run the bootstrap step in infra/README.md.
   - `UPDATE_ROLLBACK_FAILED`: open an issue as P2 and use "Continue update rollback" in the console. Do not delete the stack, because that changes the CloudFront domain.
   - A `Custom::CDKBucketDeployment` resource failed (for example `WebTextures` or `WebModels`): see RB-13.
4. Fix through a PR. There is nothing to revert in production.

## RB-02 A bad release is live (revert)

Signal: `npm run smoke` or `npm run smoke:browser` fails in the deploy job, or a player reports a broken game after a green deploy.

1. Look at `smoke.json` and `browser-smoke.json` in the `deploy-reports-<sha>` artifact. If only `smoke:browser` failed and its one retry also failed, treat it as real, not as CDN propagation.
2. Find the bad commit from the `Commit:` line in the deploy job summary.
3. `git revert <sha>` on a branch (`git revert -m 1 <sha>` for a merge commit) and open a PR to `main`.
4. Merge when `verify` and `e2e` pass. The push runs verify, e2e, deploy and both smoke checks (about 15 to 25 minutes).
5. Done when the new deploy job is green. Record the timings in the incident issue against the 30-minute RTO.

Reverting the graphics uplift itself has two expected side effects. The change set deletes the `WebModels`, `WebTextures` and `WebWasm` deployments (their files stay in the bucket, because nothing prunes) and replaces the deploy Lambda back to 128 MB. SM-4c then fails with an empty binary list, because the pre-uplift bundle has no `.glb`, `.ktx2` or `.wasm` files. Record that SM-4c result as expected in the incident issue; every other smoke check must be green.

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
2. In CloudWatch (region **us-east-1**, where CloudFront metrics live), look at `AWS/CloudFront Requests` and `BytesDownloaded` for the distribution over the last 7 days. Since the graphics uplift a cold visit downloads up to about 17 MB, so bytes rise once after that deploy. Bytes rising while requests stay flat points to hot-linking of the asset files; many more requests per visit points to a client refetch bug (fix through RB-12 or RB-09).
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

Graphics codes: `render/asset-*` lines mean an asset fell back to the procedural look (RB-12). A procedural sky, box-shaped bots or box weapons with no `render/asset-*` line usually means WebGL context loss; ask whether the GPU driver reset or the tab was in the background for a long time.

## RB-10 SM-4c fails: binary assets served wrong

Signal: the `SM-4c` row in `smoke.json` (deploy job) fails for at least one `.glb`, `.ktx2` or `.wasm` file. Players get procedural fallbacks, or the KTX2 decoder cannot start.

1. Read the failing reason in `smoke.json`:
   - `content-type text/html`: the file is missing and the CloudFront error response answered with `index.html`. CloudFront 4xx metrics do not show this.
   - `binary/octet-stream` or another wrong type: the file landed in the wrong BucketDeployment or the `contentType` is wrong.
   - wrong `Cache-Control`, no `nosniff`, length mismatch or bad magic bytes: a header or upload problem.
2. For a missing file, check in the job log that `WebModels`, `WebTextures` and `WebWasm` all completed. Re-run the deploy job once; a partly finished upload is the only cause a re-run can fix.
3. If it still fails, start RB-02. Then fix through a PR with a `tests/infra` case (the extension partition in `check:assets` and the `contentType` in `infra/lib/strikezone-stack.ts` must agree).

Not an incident: SM-4c failing with an empty list right after a revert to a pre-uplift bundle (see RB-02).

## RB-11 SM-3 fails: CSP or Permissions-Policy differs

Signal: SM-3 in `smoke.json` fails. If `'unsafe-eval'`, `'wasm-unsafe-eval'` or `worker-src 'self' blob:` is missing, every KTX2 texture fails and players see the procedural look. If the policy is wider than expected, treat it as a security change nobody reviewed.

1. Compare the live header in `smoke.json` with `infra/lib/policy.ts` at the deployed commit. That file is the only source of the policy.
2. If the response headers policy was edited in the console, that is drift: run `aws cloudformation detect-stack-drift --stack-name StrikeZone`, then re-run the deploy job to restore the template value.
3. Otherwise start RB-02, and fix `policy.ts` and its tests in one PR.
4. Never widen the CSP to make a smoke check pass. Any change to it is a requester decision and is disclosed in `docs/FINAL-REPORT.md`.

## RB-12 Graphics fall back to the procedural look

Signal: `browser-smoke.json` lists `render/asset-*` codes but the live HUD was reached, or a player reports flat colours, a plain sky or box-shaped bots.

1. Note which code appears:
   - `render/asset-fetch-failed`: the file did not download after one retry. Check SM-4c (RB-10).
   - `render/asset-kit-failed`: the lazy loader chunk did not load or start. Check in DevTools that its `.js` file under `/assets/` returns 200 as JavaScript, and that SM-3 passed (RB-11).
   - `render/asset-invalid` or `render/asset-decode-failed`: the bytes arrived but failed validation or decoding. Rebuild the asset with `tools/asset-pipeline` (docs/ASSETS.md) and confirm `npm run check:assets` passes.
   - `render/asset-upload`: the GPU rejected the texture. Ask for the browser and GPU.
   - `render/asset-memory`: a texture did not fit in the CPU memory budget (96 MiB per map, 160 MiB in total) and fell back. The shipped inventory fits, so on target hardware this points to an asset rebuild that grew a texture; check `reports/asset-budget.json`.
2. The game still plays, so this is P2. Open an `incident` issue and fix forward. Revert (RB-02) only if the fix cannot land within the 30-minute RTO and every player is affected.

## RB-13 The deploy Lambda fails or runs out of memory

Signal: a `Custom::CDKBucketDeployment` resource fails in `cdk deploy`, or the `DeployLogs` log group shows a timeout or out-of-memory error.

1. In CloudWatch Logs Insights, open `DeployLogs` and read the `REPORT` lines: `maxMemoryUsed` against the 512 MB limit, and the duration.
2. Re-run the deploy job once. A transient S3 error is the usual cause.
3. If memory was above about 400 MB, raise `DEPLOY_MEMORY_MB` in `infra/lib/strikezone-stack.ts`. All five deployments read that one constant; giving them different values creates a second Lambda. The change replaces the handler once.
4. Production keeps serving the previous version throughout, because `index.html` is published last.

## RB-14 A manual release check fails

Signal: a person records `manual-fail` for MT-G1 (visual sign-off), MT-G2 or MT-G3 (60 FPS on the target GPU) or the load-time check in `verification/manual-results.json`. The release stays "deployed, unverified".

1. Open a P2 `incident` issue with the preset, bot count, map, browser, GPU and the measured numbers or screenshots.
2. Fix forward through a PR. For FPS, follow the cut order in the performance requirements (Should items such as PBR textures go first) and disclose the cut in `docs/FINAL-REPORT.md`.
3. Revert (RB-02) only if the game cannot be played on the target GPU, or the Ready gate never arrives, or the requester asks for it.
4. Known item to check in MT-G1: the Warehouse containers render almost black under software WebGL. Decide on real hardware whether that is a material defect.

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
