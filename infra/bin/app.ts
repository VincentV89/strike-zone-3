/**
 * CDK app entry, run by `node infra/bin/app.ts` (Node 24 type stripping,
 * TS-H-02). Environment-agnostic: the operator's CLI profile selects the
 * account and region (SD-H-05). The only environment inputs are
 * SZ_SKIP_WEB_BUILD and SZ_WEB_DIR, parsed in infra/lib/config.ts.
 */
import { App } from 'aws-cdk-lib';
import { defineStrikeZone } from '../lib/app-definition.ts';
import { parseWebSource } from '../lib/config.ts';

const app = new App();
defineStrikeZone(app, parseWebSource(process.env));
app.synth();
