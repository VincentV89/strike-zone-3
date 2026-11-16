/**
 * buildCollisionWorld and the tick-path guards (SD-CN-08). Every public query
 * starts with a cheap guard; a failed guard returns the BR-CN-11 conservative
 * result and calls warnOnce(code) with no detail, so the path stays
 * allocation-free. There is no try/catch on the tick path.
 */
import { vec3, type Diagnostics, type Vec3 } from '../core';
import type { MapDefinition } from '../maps';
import { CELL_SIZE, DEFAULT_STEP_HEIGHT, EPS, MAX_RAY_DIST } from './constants';
import { NOOP_DIAGNOSTICS } from './diagnostics';
import { buildGeometry } from './geometry';
import { createMoveScratch, moveCore, separateCore, type MoveIn, type MoveOut } from './move';
import { createRayScratch, rayCore, segmentClear } from './ray';
import { fits } from './shapes';
import { sweepCore } from './sweep';
import type { Capsule, CollisionWorld, MoveResult, RayHit } from './types';

const isNum = Number.isFinite;
const finiteVec = (v: Vec3): boolean => isNum(v.x) && isNum(v.y) && isNum(v.z);
const validCapsule = (c: Capsule): boolean =>
  isNum(c.radius) && isNum(c.height) && c.radius > 0 && c.height > 2 * EPS;

function newMoveResult(): MoveResult {
  return { position: vec3(), velocity: vec3(), grounded: false, hitCeiling: false, landed: false };
}

/**
 * Builds the single collision world for a map (req-collision-world). Throws
 * StrikeZoneError on bad cell size or geometry (BR-CN-10). The world keeps no
 * reference to `def`.
 */
export function buildCollisionWorld(
  def: MapDefinition,
  cellSize: number = CELL_SIZE,
  diagnostics: Diagnostics = NOOP_DIAGNOSTICS,
): CollisionWorld {
  const g = buildGeometry(def, cellSize);
  const moveScratch = createMoveScratch();
  const rayScratch = createRayScratch();
  const sightScratch = createRayScratch();
  const moveIn: MoveIn = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 0, h: 0, dt: 0, step: 0 };
  const moveOut: MoveOut = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: false,
    hitCeiling: false,
    landed: false,
    stuck: false,
  };
  const bounds = Object.freeze({
    min: Object.freeze(vec3(g.bounds.minX, g.bounds.minY, g.bounds.minZ)),
    max: Object.freeze(vec3(g.bounds.maxX, g.bounds.maxY, g.bounds.maxZ)),
  });
  const bad = (): void => {
    diagnostics.warnOnce('physics/non-finite-input');
  };

  const world: CollisionWorld = {
    moveCapsule(pos, vel, capsule, dt, stepHeight, out = newMoveResult()) {
      if (
        !finiteVec(pos) ||
        !finiteVec(vel) ||
        !validCapsule(capsule) ||
        !isNum(dt) ||
        dt <= 0 ||
        !isNum(stepHeight)
      ) {
        bad();
        const keep = finiteVec(pos);
        out.position.x = keep ? pos.x : 0;
        out.position.y = keep ? pos.y : 0;
        out.position.z = keep ? pos.z : 0;
        out.velocity.x = 0;
        out.velocity.y = 0;
        out.velocity.z = 0;
        out.grounded = false;
        out.hitCeiling = false;
        out.landed = false;
        return out;
      }
      moveIn.x = pos.x;
      moveIn.y = pos.y;
      moveIn.z = pos.z;
      moveIn.vx = vel.x;
      moveIn.vy = vel.y;
      moveIn.vz = vel.z;
      moveIn.r = capsule.radius;
      moveIn.h = capsule.height;
      moveIn.dt = dt;
      moveIn.step = stepHeight;
      moveCore(g, moveScratch, moveIn, moveOut);
      if (moveOut.stuck) diagnostics.warnOnce('physics/stuck-in-geometry');
      out.position.x = moveOut.x;
      out.position.y = moveOut.y;
      out.position.z = moveOut.z;
      out.velocity.x = moveOut.vx;
      out.velocity.y = moveOut.vy;
      out.velocity.z = moveOut.vz;
      out.grounded = moveOut.grounded;
      out.hitCeiling = moveOut.hitCeiling;
      out.landed = moveOut.landed;
      return out;
    },

    raycast(origin, dir, maxDist, out) {
      if (!finiteVec(origin) || !finiteVec(dir) || !isNum(maxDist)) {
        bad();
        return null;
      }
      const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
      if (len < 1e-12 || !Number.isFinite(len)) {
        bad();
        return null;
      }
      if (maxDist < 0) return null;
      const dx = dir.x / len;
      const dy = dir.y / len;
      const dz = dir.z / len;
      const limit = Math.min(maxDist, MAX_RAY_DIST);
      if (!rayCore(g, origin.x, origin.y, origin.z, dx, dy, dz, limit, rayScratch)) return null;
      const hit: RayHit = out ?? {
        distance: 0,
        point: vec3(),
        normal: vec3(),
        solidIndex: -1,
        rampIndex: -1,
      };
      const { t, shape } = rayScratch;
      hit.distance = t;
      hit.point.x = origin.x + dx * t;
      hit.point.y = origin.y + dy * t;
      hit.point.z = origin.z + dz * t;
      hit.normal.x = rayScratch.nx;
      hit.normal.y = rayScratch.ny;
      hit.normal.z = rayScratch.nz;
      hit.solidIndex = shape < g.boxCount ? shape : -1;
      hit.rampIndex = shape < g.boxCount ? -1 : shape - g.boxCount;
      return hit;
    },

    lineOfSight(a, b) {
      if (!finiteVec(a) || !finiteVec(b)) {
        bad();
        return false; // fail closed (SD-CN-08)
      }
      return segmentClear(g, a.x, a.y, a.z, b.x, b.y, b.z, sightScratch);
    },

    capsuleFits(pos, capsule) {
      if (!finiteVec(pos) || !validCapsule(capsule)) {
        bad();
        return false;
      }
      return fits(g, pos.x, pos.y, pos.z, capsule.radius, capsule.height);
    },

    sweepClear(from, to, capsule, stepHeight = DEFAULT_STEP_HEIGHT) {
      if (
        !finiteVec(from) ||
        !finiteVec(to) ||
        !validCapsule(capsule) ||
        !isNum(stepHeight) ||
        stepHeight < 0
      ) {
        bad();
        return false;
      }
      return sweepCore(
        g,
        from.x,
        from.y,
        from.z,
        to.x,
        to.y,
        to.z,
        capsule.radius,
        capsule.height,
        stepHeight,
      );
    },

    separate(pa, capA, pb, capB) {
      if (!finiteVec(pa) || !finiteVec(pb) || !validCapsule(capA) || !validCapsule(capB)) {
        bad();
        return false;
      }
      return separateCore(g, pa, capA.radius, capA.height, pb, capB.radius, capB.height);
    },

    bounds,
    shapeCount: g.shapeCount,
  };
  return Object.freeze(world);
}
