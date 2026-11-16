/**
 * Real-map collision checks: H-M-01 (BR-CN-90), H-M-02 (BR-CN-91), the
 * wall-type sweep (BR-CN-96) and one shape list for sight and shots (SD-CN-19).
 */
import { describe, expect, it } from 'vitest';
import type { MapId } from '../../src/contracts';
import { getMap, MAP_RULES, WALKABLE_KINDS } from '../../src/maps';
import { buildCollisionWorld, EPS as PHYSICS_EPS } from '../../src/physics';
import { EPS as MAPS_EPS } from '../../src/maps/rules';

const STANDING = { radius: MAP_RULES.agentRadius, height: MAP_RULES.agentHeight };
const CROUCH = { radius: MAP_RULES.agentRadius, height: MAP_RULES.crouchHeight };
const STEP = MAP_RULES.stepHeight;
const DT = 1 / 60;
const MAPS: readonly MapId[] = ['desert-compound', 'industrial-warehouse'];

type Face = '+x' | '-x' | '+z' | '-z';
const FACES: readonly Face[] = ['+x', '-x', '+z', '-z'];

it('pins physics EPS to map-data EPS (BR-CN-04)', () => {
  expect(PHYSICS_EPS).toBe(MAPS_EPS);
});

describe.each(MAPS)('%s', (id) => {
  const def = getMap(id);
  const world = buildCollisionWorld(def);

  it('builds one shape per solid and ramp', () => {
    expect(world.shapeCount).toBe(def.solids.length + def.ramps.length);
  });

  it('fits a standing actor at every spawn (H-M-01, BR-CN-90)', () => {
    const bad = def.spawns.flatMap((s, i) => (world.capsuleFits(s.pos, STANDING) ? [] : [i]));
    expect(bad).toEqual([]);
  });

  it('fits the right capsule at every cover point (H-M-02, BR-CN-91)', () => {
    const bad = def.cover.flatMap((c, i) =>
      world.capsuleFits(c.pos, c.height === 'low' ? CROUCH : STANDING) ? [] : [i],
    );
    expect(bad).toEqual([]);
  });

  it('never lets an actor through a non-walkable solid (BR-CN-96, story-walk-with-collision AC 2)', () => {
    let tested = 0;
    const failures: string[] = [];
    def.solids.forEach((s, i) => {
      if (WALKABLE_KINDS.has(s.kind)) return;
      const b = s.box;
      for (const face of FACES) {
        const cx = (b.min.x + b.max.x) / 2;
        const cz = (b.min.z + b.max.z) / 2;
        const start = {
          x: face === '+x' ? b.max.x + 1.5 : face === '-x' ? b.min.x - 1.5 : cx,
          y: b.min.y,
          z: face === '+z' ? b.max.z + 1.5 : face === '-z' ? b.min.z - 1.5 : cz,
        };
        if (!world.capsuleFits(start, STANDING)) continue;
        for (const [speed, ticks] of [
          [6, 120],
          [50, 30],
        ] as const) {
          tested++;
          const pos = { ...start };
          const dir =
            face === '+x' ? [-1, 0] : face === '-x' ? [1, 0] : face === '+z' ? [0, -1] : [0, 1];
          const vel = { x: (dir[0] ?? 0) * speed, y: 0, z: (dir[1] ?? 0) * speed };
          for (let t = 0; t < ticks; t++) {
            const r = world.moveCapsule(pos, vel, STANDING, DT, STEP);
            pos.x = r.position.x;
            pos.y = r.position.y;
            pos.z = r.position.z;
            if (!world.capsuleFits(pos, STANDING)) {
              failures.push(`solid ${i} ${face} ${speed}: no fit at tick ${t}`);
              break;
            }
            // While vertically overlapping the solid, the axis stays outside its face.
            const overlapsY =
              pos.y < b.max.y - PHYSICS_EPS && pos.y + STANDING.height > b.min.y + PHYSICS_EPS;
            const inZ = pos.z > b.min.z && pos.z < b.max.z;
            const inX = pos.x > b.min.x && pos.x < b.max.x;
            const lim = STANDING.radius - PHYSICS_EPS;
            const crossed =
              overlapsY &&
              ((face === '+x' && inZ && pos.x < b.max.x + lim) ||
                (face === '-x' && inZ && pos.x > b.min.x - lim) ||
                (face === '+z' && inX && pos.z < b.max.z + lim) ||
                (face === '-z' && inX && pos.z > b.min.z - lim));
            if (crossed) {
              failures.push(`solid ${i} ${face} ${speed}: crossed at tick ${t}`);
              break;
            }
          }
        }
      }
    });
    expect(failures).toEqual([]);
    expect(tested).toBeGreaterThan(50);
  });

  it('blocks sight and shots through every occluding solid with the same shape list (SD-CN-19)', () => {
    let tested = 0;
    let direct = 0;
    const failures: number[] = [];
    def.solids.forEach((s, i) => {
      if (WALKABLE_KINDS.has(s.kind)) return;
      const b = s.box;
      const h = b.max.y - b.min.y;
      const thinX = b.max.x - b.min.x <= b.max.z - b.min.z;
      const y = b.min.y + Math.min(1, h / 2);
      const cx = (b.min.x + b.max.x) / 2;
      const cz = (b.min.z + b.max.z) / 2;
      const a = thinX ? { x: b.min.x - 0.05, y, z: cz } : { x: cx, y, z: b.min.z - 0.05 };
      const c = thinX ? { x: b.max.x + 0.05, y, z: cz } : { x: cx, y, z: b.max.z + 0.05 };
      tested++;
      const hit = world.raycast(a, { x: c.x - a.x, y: 0, z: c.z - a.z }, 10);
      if (world.lineOfSight(a, c) || hit === null) failures.push(i);
      else if (hit.solidIndex === i) direct++;
    });
    expect(failures).toEqual([]);
    // Most rays hit the solid itself; a few hit a touching neighbour first.
    expect(direct / tested).toBeGreaterThan(0.8);
    expect(tested).toBeGreaterThan(30);
  });

  it('casts a deterministic finite ray from every spawn eye toward the centre', () => {
    const cast = (): number[] =>
      def.spawns.map((s) => {
        const eye = { x: s.pos.x, y: s.pos.y + MAP_RULES.standEye, z: s.pos.z };
        const hit = world.raycast(eye, { x: -eye.x, y: 0, z: -eye.z }, 200);
        return hit === null ? -1 : hit.distance;
      });
    const first = cast();
    expect(first.every((d) => Number.isFinite(d))).toBe(true);
    expect(cast()).toEqual(first);
  });
});
