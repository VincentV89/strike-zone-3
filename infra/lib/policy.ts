/**
 * Browser policy strings, the single source of truth (security-design-graphics-uplift §1,
 * BR-G-84). No aws-cdk-lib import, so the CloudFront headers (headers.ts), the
 * infra tests, smoke SM-3 and the e2e preview server (vite.preview.config.ts)
 * all read the same values.
 *
 * Graphics uplift (RA-G3, NFR-G-Q2 = A): `'wasm-unsafe-eval'` in script-src for
 * the meshopt and Basis WASM decoders, and `worker-src 'self' blob:` for the
 * KTX2 transcoder worker.
 *
 * [RULE CHANGE] CG-G-Q1 = A (requester, 2026-11-20): `'unsafe-eval'` in script-src.
 * three 0.187's basis_transcoder.js is an Emscripten embind build that creates its
 * invokers with `new Function` inside the transcoder worker, which 'wasm-unsafe-eval'
 * does not cover. Without it every KTX2 texture fails. Disclosed in docs/FINAL-REPORT.md. `img-src blob:` was approved but is unused (no image
 * is ever loaded from a URL), so it is left out. `connect-src` stays 'self'.
 */
export const CSP =
  "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self'; " +
  "img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; " +
  "base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';

/** Headers the e2e preview server sends on every response, matching CloudFront. */
export const PREVIEW_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Security-Policy': CSP,
  'Permissions-Policy': PERMISSIONS_POLICY,
  'X-Content-Type-Options': 'nosniff',
});
