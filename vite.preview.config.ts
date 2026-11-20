/**
 * vite preview for e2e (security-design-graphics-uplift §1): the same build settings as
 * vite.config.ts plus the production response headers from infra/lib/policy.ts, so a CSP
 * regression (wasm-unsafe-eval, the transcoder worker) fails e2e before any deploy.
 */
import { defineConfig, mergeConfig } from 'vite';
import { PREVIEW_HEADERS } from './infra/lib/policy.ts';
import base from './vite.config.ts';

export default mergeConfig(base, defineConfig({ preview: { headers: { ...PREVIEW_HEADERS } } }));
