/**
 * collision-world public surface (src/physics). Other components import this
 * file only; geometry, shapes, ray and move modules are private (SD-CN-03).
 */
export { buildCollisionWorld } from './world';
export {
  CELL_SIZE,
  DEFAULT_STEP_HEIGHT,
  DEPEN_MAX,
  EPS,
  GROUND_PROBE,
  MAX_RAY_DIST,
  MAX_SPEED,
  MAX_SUBSTEP,
  MAX_SUBSTEPS,
  SWEEP_SAMPLE,
} from './constants';
export { PHYSICS_DIAGNOSTIC_CODES, type PhysicsDiagnosticCode } from './diagnostics';
export type { Capsule, CollisionWorld, MoveResult, RayHit } from './types';
