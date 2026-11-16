/**
 * Renderer constants (business-logic-model-presentation-3d §3, BR-P-40..45).
 * World units are metres, seconds and radians.
 */

/**
 * Local copy of the agent dimensions in MAP_RULES. renderer -> map-data is a
 * type-only edge, so the values are copied; tests/render/bot-rig.test.ts
 * asserts the copy equals MAP_RULES.
 */
export const BOT_DIMENSIONS = Object.freeze({
  agentRadius: 0.4,
  agentHeight: 1.8,
  crouchHeight: 1.2,
});

/** Hard capacity of every bot instanced mesh (BOT_COUNTS max). */
export const MAX_BOTS = 20;

/** Scope zoom applied to tan(vFov / 2) (BR-P-42). */
export const SCOPE_ZOOM = 4;
/** Scope blend ease time in render seconds (§3.2). */
export const SCOPE_BLEND_SEC = 0.1;

/** Horizontal FOV setting at a 16:9 reference aspect (BR-P-40). */
export const FOV_MIN_DEG = 70;
export const FOV_MAX_DEG = 110;
export const FOV_DEFAULT_DEG = 90;
export const REFERENCE_ASPECT = 16 / 9;

/** World camera near plane; well inside the 0.1 m limit of BR-CN-39. */
export const WORLD_NEAR_M = 0.05;
/** Viewmodel camera (BR-P-43). */
export const VM_FOV_DEG = 55;
export const VM_NEAR_M = 0.01;
export const VM_FAR_M = 5;

/** Interpolation is skipped for any entity that moved further in one tick (BR-P-44). */
export const TELEPORT_M = 2;

/** Muzzle flash longer side cap at 1080 px viewport height (BR-P-45). */
export const FLASH_CAP_PX_1080 = 160;
/** Muzzle flash and flash light duration in ticks (SEC-P-12). */
export const FLASH_TICKS = 2;
/** Unclamped bot muzzle flash quad side (m). */
export const BOT_FLASH_SIZE_M = 0.35;
/** Unclamped player muzzle flash sprite side (m, viewmodel space). */
export const VM_FLASH_SIZE_M = 0.12;

/** Hit flash on a bot instance (§2.8). */
export const HIT_FLASH_TICKS = 3;
export const HIT_FLASH_STRENGTH = 0.6;

/** Death reaction (story-bot-death). */
export const DEATH_TOPPLE_SEC = 0.5;
/**
 * The body rotates about the feet, so after the topple its centre line lies at
 * floor height; it is lifted by half its depth (front/back) or width (sideways) so the torso rests on the
 * floor instead of sinking into it (deviation from the BLM's 0.4 m drop).
 */
export const DEATH_REST_LIFT_M = 0.13;
/** Half width across the shoulders, used when the body falls sideways. */
export const DEATH_SIDE_LIFT_M = 0.25;
export const DEATH_BRIGHTNESS = 0.35;

/** Effect lifetimes. */
export const TRACER_TICKS = 4;
export const TRACER_OPACITY = 0.7;
export const TRACER_WIDTH_M = 0.02;
export const PLAYER_TRACER_OFFSET_M = 2;
/** Bot tracers start this far along the shot ray, about the muzzle. */
export const BOT_TRACER_OFFSET_M = 0.5;
export const DECAL_LIFE_SEC = 10;
export const DECAL_FADE_SEC = 1;
export const DECAL_SIZE_M = 0.12;
export const DECAL_OPACITY = 0.85;
export const PARTICLE_LIFE_SEC = 0.35;
export const PARTICLE_SIZE_M = 0.05;
export const GRAVITY = 9.8;

/** Every player rifle shot that is a multiple of this draws a tracer (BR-P-41). */
export const RIFLE_TRACER_EVERY = 3;

/** Map texture side in pixels on every preset (performance-design PD loading path). */
export const MAP_TEXTURE_SIZE = 256;
/** Session sprite textures. */
export const SPRITE_TEXTURE_SIZE = 64;
