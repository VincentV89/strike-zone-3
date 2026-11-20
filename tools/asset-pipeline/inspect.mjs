// Dev helper: renders orthographic point silhouettes (front xy, side zy, top xz) of a model to PNG.
import { getBounds } from '@gltf-transform/functions';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { collapse, io, polyHavenModel, driveFile } from './build.mjs';
import { readObj } from './obj.mjs';
const [kind, id, out, a, b] = process.argv.slice(2);
let doc;
if (kind === 'ph') doc = await io.read(await polyHavenModel(id, a ?? '1k'));
else if (kind === 'obj')
  doc = readObj(
    readFileSync(await driveFile(a, id + '.obj'), 'utf8'),
    readFileSync(await driveFile(b, id + '.mtl'), 'utf8'),
  );
else doc = await io.read(id);
const node = await collapse(doc);
const bb = getBounds(node);
console.log(
  'bounds',
  bb.min.map((v) => v.toFixed(3)),
  bb.max.map((v) => v.toFixed(3)),
);
const S = 300,
  img = Buffer.alloc(S * 3 * S * 3, 20);
const views = [
  [0, 1],
  [2, 1],
  [0, 2],
];
const ext = Math.max(...[0, 1, 2].map((i) => bb.max[i] - bb.min[i]));
for (const prim of node.getMesh().listPrimitives()) {
  const p = prim.getAttribute('POSITION');
  const v = [0, 0, 0];
  for (let i = 0; i < p.getCount(); i++) {
    p.getElement(i, v);
    views.forEach(([h, vv], k) => {
      const x = Math.floor(((v[h] - bb.min[h]) / ext) * (S - 1)) + k * S;
      const y = S - 1 - Math.floor(((v[vv] - bb.min[vv]) / ext) * (S - 1));
      const o = (y * S * 3 + x) * 3;
      img[o] = 230;
      img[o + 1] = 230;
      img[o + 2] = 230;
    });
  }
}
await sharp(img, { raw: { width: S * 3, height: S, channels: 3 } })
  .png()
  .toFile(out);
