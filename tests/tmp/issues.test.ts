import { it } from 'vitest';
import { checkMapData, getMap } from '../../src/maps';
it('issues', () => {
  for (const id of ['desert-compound', 'industrial-warehouse'] as const) {
    const def = getMap(id);
    console.log(id, JSON.stringify(checkMapData(def)));
    console.log(def.solids.map((s, i) => (s.prop !== undefined ? `${i}:${s.kind}@${s.box.min.x.toFixed(1)},${s.box.min.z.toFixed(1)}` : '')).filter(Boolean).join(' '));
  }
});
