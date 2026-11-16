/**
 * Seam marker strings (SD-AS-02). They are string literals, so minification
 * cannot rename them, and scripts/check-seams.ts fails the build if any of
 * them reaches dist/. They exist only in the `--mode test` bundle.
 */
export const SEAM_GLOBAL = '__strikezone';
export const BYPASS_MARKER = 'strikezone:pointer-lock-bypass';
export const OVERLAY_MARKER = 'strikezone:dev-overlay';
