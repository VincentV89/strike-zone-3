/**
 * Load and check cost (BR-M-89, PR-M targets). Timings are reported; the
 * assertions use ceilings well above the targets to tolerate CI noise.
 */
import { describe, expect, it, vi } from 'vitest';

describe('map-data cost', () => {
  it('evaluates the maps and looks both up quickly', async () => {
    await import('../../src/maps/index'); // warm the transform cache
    vi.resetModules();
    const t0 = performance.now();
    const maps = await import('../../src/maps/index');
    for (const id of maps.mapIds()) maps.getMap(id);
    const loadMs = performance.now() - t0;

    const t1 = performance.now();
    for (const id of maps.mapIds()) expect(maps.checkMapData(maps.getMap(id))).toEqual([]);
    const checkMs = (performance.now() - t1) / maps.mapIds().length;

    console.log(
      `map-data: module evaluation + getMap x2 ${loadMs.toFixed(2)} ms (target 5); checkMapData ${checkMs.toFixed(2)} ms per map (target 20)`,
    );
    expect(loadMs).toBeLessThan(50);
    expect(checkMs).toBeLessThan(200);
  });
});
