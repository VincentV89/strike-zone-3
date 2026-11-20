/**
 * Asset applier (business-logic-model §5, BR-G-14, BR-G-70). Lazy kit chunk (moved out of
 * the entry by the over-budget order, performance-design §1.3): it only runs once the kit has
 * loaded. Uploads happen here (through the runtime), never in render().
 */
import { Color, type Material, type MeshStandardMaterial, type Object3D } from 'three';
import type { MapDefinition, MaterialHint } from '../../maps';
import type { AssetEntry, AssetLookup, AssetRuntime } from './types';

/**
 * Binds the authored PBR set of every hint whose three textures are ready (BR-G-70).
 * Returns the number of materials that switched.
 */
export function applyPbrSets(
  def: MapDefinition,
  materials: ReadonlyMap<string, Material>,
  runtime: AssetRuntime,
  lookup: AssetLookup,
): number {
  let n = 0;
  for (const hint of def.materials) {
    const mat = materials.get(hint.id) as MeshStandardMaterial | undefined;
    if (mat === undefined || hint.pbr === undefined) continue;
    const set = runtime.textureSets[hint.pbr];
    if (set === undefined) continue;
    if ([set.bc, set.n, set.orm].some((k) => lookup.texture(k) === null)) continue;
    runtime.bindSlot(mat, 'map', set.bc, lookup);
    runtime.bindSlot(mat, 'normalMap', set.n, lookup);
    runtime.bindSlot(mat, 'roughnessMap', set.orm, lookup);
    runtime.bindSlot(mat, 'metalnessMap', set.orm, lookup);
    runtime.bindSlot(mat, 'aoMap', set.orm, lookup);
    pbrColour(hint, mat);
    n += 1;
  }
  return n;
}

function pbrColour(hint: MaterialHint, mat: MeshStandardMaterial): void {
  if (hint.pbrTint === true) mat.color.set(new Color(hint.base)).multiplyScalar(1.6);
  else mat.color.setRGB(1, 1, 1);
  mat.roughness = 1;
  mat.metalness = hint.metalness > 0.4 ? 1 : 0.25;
  mat.aoMapIntensity = 1;
}

/**
 * Puts a loaded weapon model under the viewmodel rig (BR-G-40/41): the rig's box parts are
 * hidden, the muzzle socket moves to the model's `muzzle` node. Returns false to keep the
 * box rig (fallback).
 */
export function attachViewmodel(
  rigGroup: Object3D,
  hide: readonly Object3D[],
  muzzleSocket: Object3D,
  model: Object3D,
  entry: AssetEntry,
  runtime: AssetRuntime,
  lookup: AssetLookup,
): boolean {
  if (!runtime.bindModelTextures(model, entry, lookup)) return false;
  const muzzle = model.getObjectByName('muzzle');
  if (muzzle === undefined) return false;
  model.name = `${entry.key}-model`;
  model.updateMatrixWorld(true);
  muzzleSocket.position.setFromMatrixPosition(muzzle.matrixWorld);
  for (const o of hide) o.visible = false;
  model.traverse((o) => {
    o.frustumCulled = false;
  });
  rigGroup.add(model);
  return true;
}
