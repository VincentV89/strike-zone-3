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

/**
 * CSP baseline from security-design-foundation. A later Web Worker unit may
 * add `worker-src 'self' blob:` here, with the test updated in the same change.
 */
export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
  "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; " +
  "form-action 'none'";

export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';

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
