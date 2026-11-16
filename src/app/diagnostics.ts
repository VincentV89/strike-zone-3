/**
 * Browser Diagnostics sink (FD-AS-Q3, TS-AS-08). One `console.warn` per code
 * in all builds, never a detail object and never console.error. Counts stay
 * in memory and are exposed through the test seam. This is the only file in
 * src/app that writes the console (SD-AS-06).
 */
import { createDiagnostics, type Diagnostics } from '../core';

/** app-shell's own codes (business-logic-model-app-shell §12, additive). */
export const APP_CODES = [
  'app/frame-fault',
  'app/frame-fault-tripped',
  'app/load-failed',
  'app/lock-timeout',
  'app/ignored-event',
  'app/outcome-from-snapshot',
  'app/weak-seed',
  'app/storage-unavailable',
  'app/audio-unlock-failed',
  'app/history-write-failed',
] as const;

export type AppCode = (typeof APP_CODES)[number];

export type WarnFn = (message: string) => void;

const consoleWarn: WarnFn = (message) => {
  console.warn(message);
};

export function createAppDiagnostics(warn: WarnFn = consoleWarn): Diagnostics {
  // The detail argument is dropped on purpose: only the code reaches the console.
  return createDiagnostics((code) => {
    warn(`[strikezone] ${code}`);
  });
}
