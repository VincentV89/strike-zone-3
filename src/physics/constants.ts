/**
 * collision-world constants (business-rules-collision-nav, "Constants").
 * Caps are module constants, not inputs (SD-CN-14).
 */

/** Contact tolerance (m). Equals map-data EPS; a test pins the two together (BR-CN-04). */
export const EPS = 0.01;
/** Default broadphase cell size (m), ADR-002. */
export const CELL_SIZE = 4;
/** Longest horizontal move per substep (m): half the agent radius (BR-CN-31). */
export const MAX_SUBSTEP = 0.2;
export const MAX_SUBSTEPS = 8;
/** Velocity is clamped to this length before moving (m/s). */
export const MAX_SPEED = 50;
/** Support search distance below the feet (m), BR-CN-34. */
export const GROUND_PROBE = 0.05;
/** Largest push-out in one call (m), BR-CN-38 and BR-CN-52. */
export const DEPEN_MAX = 0.5;
/** Sample spacing of sweepClear (m), BR-CN-51. */
export const SWEEP_SAMPLE = 0.2;
/** Longest xz segment sweepClear accepts (m); longer sweeps return false (SD-CN-14). */
export const MAX_SWEEP_LENGTH = 200;
/** Contact resolutions per substep (SD-CN-14). */
export const MAX_CONTACTS = 4;
/** Public raycast distance clamp (m), SD-CN-14. */
export const MAX_RAY_DIST = 500;
/** Default step height (m): MAP_RULES.stepHeight (FD-CN-04). */
export const DEFAULT_STEP_HEIGHT = 0.35;
/**
 * Height a ramp surface may rise above the feet before the ramp blocks like a
 * wall during movement. It is above 0.4 x tan 30 deg (0.231 m), the rise under
 * the rim of an actor standing on the steepest authored ramp, and below the
 * 0.4 m fit allowance of BR-CN-24, so every moved position still fits.
 */
export const RAMP_CLIMB = 0.3;
/** Setup caps (BR-CN-10). */
export const MIN_CELL_SIZE = 0.5;
export const MAX_GRID_CELLS = 16_384;
export const MAX_GRID_ENTRIES = 65_536;
