/**
 * Browser-facing response headers (SEC-H-06, SEC-H-07). One policy on the
 * default behaviour; every header uses override: true.
 */
import { Duration } from 'aws-cdk-lib';
import {
  HeadersFrameOption,
  HeadersReferrerPolicy,
  type ResponseHeadersPolicyProps,
} from 'aws-cdk-lib/aws-cloudfront';

import { CSP, PERMISSIONS_POLICY } from './policy.ts';

/** Re-exported so existing imports keep working; the strings live in policy.ts. */
export { CSP, PERMISSIONS_POLICY };

/** One year; no includeSubdomains or preload, because *.cloudfront.net is not ours. */
export const HSTS_MAX_AGE_SECONDS = 31_536_000;

export const SECURITY_HEADERS_PROPS: ResponseHeadersPolicyProps = {
  comment: 'StrikeZone security headers (SEC-H-07)',
  securityHeadersBehavior: {
    contentSecurityPolicy: { contentSecurityPolicy: CSP, override: true },
    strictTransportSecurity: {
      accessControlMaxAge: Duration.seconds(HSTS_MAX_AGE_SECONDS),
      includeSubdomains: false,
      preload: false,
      override: true,
    },
    contentTypeOptions: { override: true },
    frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
    referrerPolicy: { referrerPolicy: HeadersReferrerPolicy.NO_REFERRER, override: true },
  },
  customHeadersBehavior: {
    customHeaders: [{ header: 'Permissions-Policy', value: PERMISSIONS_POLICY, override: true }],
  },
};
