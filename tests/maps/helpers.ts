/**
 * Shared test helpers for map-data: mutable deep copies of the shipped maps
 * and issue-code extraction.
 */
import type { MapId } from '../../src/contracts';
import { getMap, type MapDataIssueCode, type MapDefinition } from '../../src/maps';

/** Removes readonly at every level so tests can mutate a copy. */
export type DeepMutable<T> = T extends (infer U)[]
  ? DeepMutable<U>[]
  : T extends readonly (infer U)[]
    ? DeepMutable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
      : T;

export type MutableMap = DeepMutable<MapDefinition>;

/** A mutable deep copy of a shipped map. */
export function copyOf(id: MapId): MutableMap {
  return JSON.parse(JSON.stringify(getMap(id))) as MutableMap;
}

export function codes(issues: readonly { code: MapDataIssueCode }[]): MapDataIssueCode[] {
  return issues.map((i) => i.code);
}

/** Every issue code, so a table test can prove each one is exercised (BR-M-93). */
export const ALL_ISSUE_CODES = [
  'maps/non-finite',
  'maps/out-of-bounds',
  'maps/ground-gap',
  'maps/boundary-gap',
  'maps/boundary-too-low',
  'maps/budget-exceeded',
  'maps/unknown-material',
  'maps/duplicate-material',
  'maps/ramp-degenerate',
  'maps/ramp-too-steep',
  'maps/ramp-unsupported',
  'maps/spawn-count',
  'maps/spawn-zones',
  'maps/spawn-zone-too-large',
  'maps/spawn-zones-too-close',
  'maps/spawn-player-count',
  'maps/spawn-too-close',
  'maps/spawn-not-on-floor',
  'maps/spawn-in-solid',
  'maps/cover-count',
  'maps/cover-not-on-floor',
  'maps/cover-in-solid',
  'maps/cover-bad-facing',
  'maps/cover-not-adjacent',
  'maps/cover-height-mismatch',
  'maps/hint-not-on-floor',
  'maps/patrol-count',
  'maps/feature-missing',
  'maps/feature-unbacked',
  'maps/lighting-invalid',
] as const satisfies readonly MapDataIssueCode[];

/** Compile-time proof that ALL_ISSUE_CODES lists the whole union. */
type Missing = Exclude<MapDataIssueCode, (typeof ALL_ISSUE_CODES)[number]>;
export const NO_MISSING_CODES: Missing extends never ? true : false = true;

export function at<T>(list: readonly T[], i: number): T {
  const v = list[i];
  if (v === undefined) throw new Error(`fixture index ${i} missing`);
  return v;
}
