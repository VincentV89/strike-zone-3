import { it } from 'vitest';
import { getMap } from '../../src/maps';
import { PROP_CATALOG } from '../../src/maps/props';

it('plan', () => {
  for (const id of ['desert-compound', 'industrial-warehouse'] as const) {
    const def = getMap(id);
    const b = def.bounds;
    const obstacles = def.solids.filter((s) => s.kind !== 'ground' || s.box.max.y > 0.05);
    const pts: { x: number; z: number }[] = [
      ...def.spawns.map((s) => s.pos),
      ...def.cover.map((c) => c.pos),
      ...def.navHints.flatMap((h) => (h.kind === 'exclude' ? [] : [h.pos])),
    ];
    const near = (x: number, z: number, m: number): boolean =>
      obstacles.some((s) => x > s.box.min.x - m && x < s.box.max.x + m && z > s.box.min.z - m && z < s.box.max.z + m) ||
      def.ramps.some((r) => x > r.minX - 3 && x < r.maxX + 3 && z > r.minZ - 3 && z < r.maxZ + 3);
    const cands: { x: number; z: number }[] = [];
    for (let x = b.min.x + 4; x < b.max.x - 4; x += 1)
      for (let z = b.min.z + 4; z < b.max.z - 4; z += 1) {
        if (near(x, z, 3.2)) continue;
        if (pts.some((p) => Math.hypot(p.x - x, p.z - z) < 4)) continue;
        cands.push({ x, z });
      }
    const chosen: { x: number; z: number }[] = [];
    while (chosen.length < 16 && cands.length > 0) {
      let best = cands[0]!;
      let bd = -1;
      for (const c of cands) {
        const d = chosen.length === 0 ? Math.hypot(c.x, c.z) * -1 + 1000 : Math.min(...chosen.map((q) => Math.hypot(q.x - c.x, q.z - c.z)));
        if (d > bd) { bd = d; best = c; }
      }
      chosen.push(best);
    }
    // wall-adjacent spots for visual debris: just outside obstacles by 0.8 m, away from spawns
    const wall: { x: number; z: number }[] = [];
    for (const s of obstacles) {
      if (s.kind === 'boundary' || s.box.max.y - s.box.min.y < 2) continue;
      const cx = (s.box.min.x + s.box.max.x) / 2;
      for (const [x, z] of [[cx, s.box.min.z - 0.8], [cx, s.box.max.z + 0.8]] as const) {
        if (!near(x, z, 0.3) && !pts.some((p) => Math.hypot(p.x - x, p.z - z) < 2.5) && x > b.min.x + 2 && x < b.max.x - 2 && z > b.min.z + 2 && z < b.max.z - 2) wall.push({ x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 });
      }
    }
    console.log(id, 'cands', cands.length, 'chosen', JSON.stringify(chosen), 'wall', JSON.stringify(wall.slice(0, 40)));
  }
  console.log([...PROP_CATALOG.values()].map((c) => `${c.id} ${c.kind} ${JSON.stringify(c.visualBounds)}`).join('\n'));
});
