/**
 * navReport (LC-CN-09, H-M-03): the single reachability check that tests and
 * game-simulation's validateMap share (FD-CN-07). Path existence equals
 * "same component", because every link is walkable both ways (BR-CN-64).
 */
import type { MapDefinition } from '../maps';
import type { AnchorList, NavGraph, NavReport } from './types';

export function navReport(def: MapDefinition, graph: NavGraph): NavReport {
  const unattached: { list: AnchorList; index: number }[] = [];
  const spawnNodes = def.spawns.map((_, i) => graph.anchorNode('spawns', i));
  const coverNodes = def.cover.map((_, i) => graph.anchorNode('cover', i));
  spawnNodes.forEach((node, index) => {
    if (node === null) unattached.push({ list: 'spawns', index });
  });
  coverNodes.forEach((node, index) => {
    if (node === null) unattached.push({ list: 'cover', index });
  });
  def.navHints.forEach((hint, index) => {
    if (hint.kind === 'patrol' && graph.anchorNode('navHints', index) === null) {
      unattached.push({ list: 'navHints', index });
    }
  });

  const unreachable: { fromSpawn: number; list: 'spawns' | 'cover'; index: number }[] = [];
  spawnNodes.forEach((from, fromSpawn) => {
    if (from === null) return;
    const check = (list: 'spawns' | 'cover', nodes: readonly (number | null)[]): void => {
      nodes.forEach((to, index) => {
        if (to !== null && !graph.reachable(from, to)) unreachable.push({ fromSpawn, list, index });
      });
    };
    check('spawns', spawnNodes);
    check('cover', coverNodes);
  });

  return Object.freeze({
    components: graph.componentCount,
    unattached: Object.freeze(unattached),
    unreachable: Object.freeze(unreachable),
    ok: unattached.length === 0 && unreachable.length === 0,
  });
}
