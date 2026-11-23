/**
 * Minimal OBJ + MTL reader for the Quaternius weapon sources (offline pipeline only).
 * Produces a gltf-transform Document with one primitive per `usemtl` group and flat
 * normals; the MTL diffuse colour becomes the material's base colour factor (linear).
 */
import { Document } from '@gltf-transform/core';

export function readObj(objText, mtlText) {
  const colours = new Map();
  let current = null;
  for (const line of mtlText.split(/\r?\n/)) {
    const [k, ...v] = line.trim().split(/\s+/);
    if (k === 'newmtl') current = v.join(' ');
    else if (k === 'Kd' && current !== null) colours.set(current, v.slice(0, 3).map(Number));
  }
  const pos = [];
  const groups = new Map();
  let mat = 'default';
  for (const line of objText.split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] === 'v') pos.push([Number(t[1]), Number(t[2]), Number(t[3])]);
    else if (t[0] === 'usemtl') mat = t.slice(1).join(' ');
    else if (t[0] === 'f') {
      const idx = t.slice(1).map((s) => {
        const i = Number(s.split('/')[0]);
        return i < 0 ? pos.length + i : i - 1;
      });
      if (!groups.has(mat)) groups.set(mat, []);
      const g = groups.get(mat);
      for (let k = 1; k + 1 < idx.length; k++) g.push([idx[0], idx[k], idx[k + 1]]);
    }
  }
  const doc = new Document();
  doc.createBuffer('main');
  const scene = doc.createScene('obj');
  doc.getRoot().setDefaultScene(scene);
  const mesh = doc.createMesh('obj');
  for (const [name, tris] of groups) {
    const p = new Float32Array(tris.length * 9);
    const n = new Float32Array(tris.length * 9);
    tris.forEach((tri, i) => {
      const [a, b, c] = tri.map((j) => pos[j]);
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let nx = e1[1] * e2[2] - e1[2] * e2[1];
      let ny = e1[2] * e2[0] - e1[0] * e2[2];
      let nz = e1[0] * e2[1] - e1[1] * e2[0];
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      [a, b, c].forEach((v, k) => {
        p.set(v, i * 9 + k * 3);
        n.set([nx, ny, nz], i * 9 + k * 3);
      });
    });
    const [r, g, b] = colours.get(name) ?? [0.2, 0.2, 0.2];
    const m = doc.createMaterial(name).setBaseColorFactor([r, g, b, 1]);
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(p))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(n))
      .setMaterial(m);
    mesh.addPrimitive(prim);
  }
  scene.addChild(doc.createNode('obj').setMesh(mesh));
  return doc;
}
