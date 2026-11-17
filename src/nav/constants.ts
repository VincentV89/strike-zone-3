/**
 * navigation constants (business-rules-collision-nav, "Constants"). Caps are
 * module constants, not inputs (SD-CN-14).
 */

/** Lattice spacing on walkable tops (m), ADR-002. */
export const NAV_SPACING = 1.5;
export const NAV_MIN_SPACING = 0.5;
export const NAV_MAX_SPACING = 4;
/** Candidate dedup (m), BR-CN-63. */
export const NAV_MERGE_XZ = 0.5;
export const NAV_MERGE_DY = 0.3;
/** Link radius as a multiple of spacing: 1.5 x 1.5 m = 2.25 m (BR-CN-64). */
export const NAV_LINK_FACTOR = 1.5;
/** Anchors search twice the link radius (BR-CN-65). */
export const NAV_ANCHOR_LINK_FACTOR = 2;
export const NAV_MAX_NEIGHBOURS = 12;
export const NAV_MAX_NODES = 8000;
/** The baker reads the clock after every this many work items (SD-CN-04). */
export const BAKE_CLOCK_EVERY = 16;
/** Union operations per components work item. */
export const UNION_BATCH = 256;
/** nearestNode search limits (BR-CN-70). */
export const NEAREST_RADIUS = 6;
export const NEAREST_DY = 2.5;
/** Path endpoint attach (BR-CN-71). */
export const ATTACH_RADIUS = 3;
export const ATTACH_CANDIDATES = 4;
/** String pulling window (BR-CN-75). */
export const PULL_LOOKAHEAD = 8;
/** PathService budgets (BR-CN-81..83, SD-CN-14). */
export const MAX_PATHS_PER_TICK = 2;
export const MAX_PATHS_PER_TICK_LIMIT = 8;
export const MAX_CACHE_HITS_PER_TICK = 16;
export const CACHE_SIZE = 64;
export const MAX_QUEUE = 64;
/** Node paths longer than this are served but not cached. */
export const MAX_CACHED_PATH = 256;
