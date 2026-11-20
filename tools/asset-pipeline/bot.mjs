/**
 * Bot character build (RA-G1, BR-G-50..56, performance-design §3.2):
 * Quaternius Soldier_Male (CC0) -> one skinned primitive per LOD with one palette material,
 * a rifle rigidly skinned to the right hand, a `muzzle` node on the hand bone, the clips
 * idle/walk/run/shoot/death renamed from the source, and crouch-idle/crouch-walk derived
 * offline from the source's SitDown end pose (the pack has no crouch clips).
 */
import { readFileSync } from 'node:fs';
import {
  getBounds,
  joinPrimitives,
  simplifyPrimitive,
  weldPrimitive,
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { orientWeapon } from './build.mjs';

function invert(m) {
  const inv = new Array(16);
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10,
    b01 = a00 * a12 - a02 * a10,
    b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11,
    b04 = a01 * a13 - a03 * a11,
    b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30,
    b07 = a20 * a32 - a22 * a30,
    b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31,
    b10 = a21 * a33 - a23 * a31,
    b11 = a22 * a33 - a23 * a32;
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  inv[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  inv[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  inv[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  inv[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  inv[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  inv[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  inv[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  inv[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  inv[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  inv[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  inv[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  inv[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  inv[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  inv[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  inv[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  inv[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return inv;
}

const apply = (m, v, w = 1) => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * w,
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * w,
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * w,
];

function qmul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Holds the last keyframe of every channel of `src` as a new looping clip. */
function poseClip(doc, src, name, period, legSwing) {
  const anim = doc.createAnimation(name);
  for (const ch of src.listChannels()) {
    const s = ch.getSampler();
    const out = s.getOutput();
    const n = out.getCount();
    const size = out.getElementSize();
    const last = out.getElement(n - 1, new Array(size).fill(0));
    const target = ch.getTargetNode();
    const swing =
      legSwing !== 0 &&
      ch.getTargetPath() === 'rotation' &&
      /^UpperLeg\.[LR]$/.test(target.getName());
    const keys = swing ? 5 : 2;
    const times = new Float32Array(keys);
    const values = new Float32Array(keys * size);
    for (let k = 0; k < keys; k++) {
      times[k] = (period * k) / (keys - 1);
      let v = last;
      if (swing) {
        const phase = target.getName().endsWith('.L') ? 0 : Math.PI;
        const a = (legSwing * Math.sin((2 * Math.PI * k) / (keys - 1) + phase)) / 2;
        v = qmul(last, [Math.sin(a), 0, 0, Math.cos(a)]);
      }
      values.set(v, k * size);
    }
    const sampler = doc
      .createAnimationSampler()
      .setInput(doc.createAccessor().setType('SCALAR').setArray(times))
      .setOutput(doc.createAccessor().setType(out.getType()).setArray(values))
      .setInterpolation('LINEAR');
    anim
      .addSampler(sampler)
      .addChannel(
        doc
          .createAnimationChannel()
          .setTargetNode(target)
          .setTargetPath(ch.getTargetPath())
          .setSampler(sampler),
      );
  }
  return anim;
}

function smoothNormals(doc, prim) {
  const pos = prim.getAttribute('POSITION');
  const idx = prim.getIndices().getArray();
  const n = new Float32Array(pos.getCount() * 3);
  const a = [0, 0, 0],
    b = [0, 0, 0],
    c = [0, 0, 0];
  for (let i = 0; i < idx.length; i += 3) {
    pos.getElement(idx[i], a);
    pos.getElement(idx[i + 1], b);
    pos.getElement(idx[i + 2], c);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const f = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    for (const v of [idx[i], idx[i + 1], idx[i + 2]])
      for (let k = 0; k < 3; k++) n[v * 3 + k] += f[k];
  }
  for (let v = 0; v < n.length; v += 3) {
    const l = Math.hypot(n[v], n[v + 1], n[v + 2]) || 1;
    n[v] /= l;
    n[v + 1] /= l;
    n[v + 2] /= l;
  }
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(n));
}

export async function buildBot(B, ctx) {
  const path = await ctx.driveFile(B.gltf.id, B.gltf.name);
  const doc = await ctx.io.read(path);
  const root = doc.getRoot();
  const prov = {
    origin: 'cc0',
    licence: 'CC0-1.0',
    author: 'Quaternius',
    source: 'https://quaternius.com/packs/ultimatedanimatedcharacter.html',
    note: 'Soldier_Male + AssaultRifle_1; palette texture; crouch clips derived from SitDown',
  };

  // Clips.
  const sit = root.listAnimations().find((a) => a.getName() === 'SitDown');
  poseClip(doc, sit, 'crouch-idle', 1.0, 0);
  poseClip(doc, sit, 'crouch-walk', 1.0, 0.35);
  for (const a of root.listAnimations()) {
    const n = B.clips[a.getName()];
    if (n !== undefined) a.setName(n);
    else if (!a.getName().startsWith('crouch-')) a.dispose();
  }

  const meshNode = root.listNodes().find((n) => n.getSkin() !== null);
  const skin = meshNode.getSkin();
  const mesh = meshNode.getMesh();
  const b = getBounds(meshNode);
  const rawHeight = b.max[1] - b.min[1];
  const metre = rawHeight / B.heightM; // mesh units per metre

  // Rifle rigidly skinned to Fist.R: v_mesh = inverse(IBM_hand) * g (g in hand-local units).
  const joints = skin.listJoints();
  const hand = joints.findIndex((j) => j.getName() === 'Fist.R');
  const ibm = skin.getInverseBindMatrices().getElement(hand, new Array(16).fill(0));
  const bindWorld = invert(ibm);
  const jointScale = Math.hypot(bindWorld[0], bindWorld[1], bindWorld[2]);
  const gunDoc = ctx.readObj(
    readFileSync(await ctx.driveFile(B.rifle.objId, `${B.rifle.name}.obj`), 'utf8'),
    readFileSync(await ctx.driveFile(B.rifle.mtlId, `${B.rifle.name}.mtl`), 'utf8'),
  );
  const gunNode = await ctx.collapse(gunDoc);
  orientWeapon(gunNode.getMesh(), gunNode);
  const gb = getBounds(gunNode);
  const gunLen = gb.max[2] - gb.min[2];
  const k = (0.78 / gunLen) * (metre / jointScale); // gun units -> hand-local units
  // Gun frame (barrel -z, up +y) -> hand-local frame: barrel along the bone's +y (out of the fist),
  // gun up along the bone's +z. Grip sits 0.32 of the length behind the gun's centre.
  const gripZ = gb.min[2] + 0.68 * gunLen;
  const gripY = (gb.min[1] + gb.max[1]) / 2;
  const toHand = (p) => {
    const x = (p[0] - (gb.min[0] + gb.max[0]) / 2) * k;
    const y = (p[1] - gripY) * k;
    const z = (p[2] - gripZ) * k;
    return [-x, -z, y]; // hand-local: x' = -x, y' (along fist) = -z, z' (up) = y
  };
  for (const gp of gunNode.getMesh().listPrimitives()) {
    const pos = gp.getAttribute('POSITION');
    const nor = gp.getAttribute('NORMAL');
    const count = pos.getCount();
    const P = new Float32Array(count * 3);
    const N = new Float32Array(count * 3);
    const J = new Uint8Array(count * 4);
    const Wt = new Float32Array(count * 4);
    const v = [0, 0, 0];
    for (let i = 0; i < count; i++) {
      P.set(apply(bindWorld, toHand(pos.getElement(i, v))), i * 3);
      const nv = nor.getElement(i, v);
      const nl = [-nv[0], -nv[2], nv[1]];
      const nw = apply(bindWorld, nl, 0);
      const l = Math.hypot(...nw) || 1;
      N.set(
        nw.map((c) => c / l),
        i * 3,
      );
      J[i * 4] = hand;
      Wt[i * 4] = 1;
    }
    const src = gp.getMaterial();
    const mat = doc
      .createMaterial(`rifle-${src.getName()}`)
      .setBaseColorFactor(src.getBaseColorFactor());
    const idx = gp.getIndices();
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(P))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(N))
      .setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(J))
      .setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(Wt))
      .setMaterial(mat);
    if (idx)
      prim.setIndices(
        doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx.getArray())),
      );
    mesh.addPrimitive(prim);
  }

  // One palette material (single material per LOD, BR-G-50).
  const bindings = await ctx.bakePalette(doc, B.key, 'all', prov);
  const parts = mesh.listPrimitives();
  if (parts.length > 1) {
    const merged = joinPrimitives(parts);
    for (const p of parts) p.dispose();
    mesh.addPrimitive(merged);
  }
  const joined = mesh.listPrimitives();
  if (joined.length !== 1) throw new Error(`bot: ${joined.length} primitives after palette join`);
  // Muzzle node on the hand bone, in hand-local units.
  const muzzle = doc
    .createNode('muzzle')
    .setTranslation(
      toHand([(gb.min[0] + gb.max[0]) / 2, gb.max[1] - 0.1 * (gb.max[1] - gb.min[1]), gb.min[2]]),
    );
  joints[hand].addChild(muzzle);
  meshNode.setName(`${B.key}_LOD0`);
  mesh.setName(`${B.key}_LOD0`);
  const tris0 = ctx.triangles(doc);
  if (tris0 > B.lod0) throw new Error(`bot LOD0 has ${tris0} triangles`);
  const lod1Prim = joined[0].clone();
  // The source is flat-shaded (split vertices with face normals); drop normals and weld so the
  // simplifier can collapse edges, then rebuild smooth normals for the far LOD.
  lod1Prim.setAttribute('NORMAL', null);
  weldPrimitive(lod1Prim, { overwrite: true });
  simplifyPrimitive(lod1Prim, { simplifier: MeshoptSimplifier, ratio: B.lod1 / tris0, error: 1 });
  smoothNormals(doc, lod1Prim);
  const tris1 = Math.round(lod1Prim.getIndices().getCount() / 3);
  if (tris1 > B.lod1) throw new Error(`bot LOD1 has ${tris1} triangles`);
  const lod1Mesh = doc.createMesh(`${B.key}_LOD1`).addPrimitive(lod1Prim);
  const lod1Node = doc.createNode(`${B.key}_LOD1`).setMesh(lod1Mesh).setSkin(skin);
  const armature = root.listNodes().find((n) => n.listChildren().includes(meshNode));
  armature.addChild(lod1Node);

  // Top node: metres, facing -z (the source faces +z).
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const top = doc
    .createNode(B.key)
    .setScale(Array(3).fill(1 / metre))
    .setRotation([0, 1, 0, 0]);
  for (const c of scene.listChildren()) {
    scene.removeChild(c);
    top.addChild(c);
  }
  scene.addChild(top);

  const file = `${ctx.OUT}/models/${B.key}.glb`;
  await ctx.writeGlb(doc, file);
  ctx.record(file, prov);
  return {
    key: B.key,
    file: `assets/models/${B.key}.glb`,
    kind: 'model',
    maps: 'all',
    maxTriangles: B.lod0,
    lod1MaxTriangles: B.lod1,
    requiredNodes: ['muzzle', `${B.key}_LOD0`, `${B.key}_LOD1`],
    requiredClips: ['idle', 'walk', 'run', 'crouch-idle', 'crouch-walk', 'shoot', 'death'],
    textures: bindings,
  };
}
