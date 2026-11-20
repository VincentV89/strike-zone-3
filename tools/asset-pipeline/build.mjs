/**
 * StrikeZone offline asset pipeline (tech-stack-decisions-graphics-uplift TS-G-06).
 *
 * Not part of `npm run verify` or CI. It downloads the CC0 sources listed in
 * sources.mjs into a cache outside the repository, converts them and writes
 * the committed outputs:
 *   assets/models/*.glb      meshopt + quantised, no images/textures/samplers (BR-G-06)
 *   assets/textures/*.ktx2   Basis (ETC1S colour/ORM, UASTC normals), full mip chain (BR-G-18)
 *   assets/sky/*.ktx2        one equirect sky per map, ETC1S sRGB, full mips
 *   assets/.pipeline.json    tool versions and per-file source records
 *   src/maps/prop-catalog.ts, src/render/assets/manifest.ts, texture-sets.ts (generated)
 *   assets-provenance.json   v2 entries for every file (BR-G-80)
 *
 * Usage (see docs/ASSETS.md):
 *   SZ_TOKTX=/path/to/toktx SZ_ASSET_CACHE=$HOME/scratch/asset-cache node build.mjs [--only id,...]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import {
  ALL_EXTENSIONS,
  EXTMeshoptCompression,
  KHRMeshQuantization,
} from '@gltf-transform/extensions';
import {
  clearNodeTransform,
  cloneDocument,
  dedup,
  flatten,
  getBounds,
  join as joinPrims,
  mergeDocuments,
  meshopt,
  prune,
  quantize,
  simplify,
  transformMesh,
  weld,
} from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { BOT, PACKS, PROPS, SKIES, TEXTURE_SETS, WEAPONS } from './sources.mjs';
import { buildBot } from './bot.mjs';
import { readObj } from './obj.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CACHE = process.env.SZ_ASSET_CACHE ?? join(homedir(), 'scratch', 'asset-cache');
const TOKTX = process.env.SZ_TOKTX ?? 'toktx';
const OUT = join(ROOT, 'assets');
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i < 0 ? null : new Set((process.argv[i + 1] ?? '').split(','));
})();
const UA = { 'User-Agent': 'strikezone-asset-pipeline' };

export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder,
  'meshopt.decoder': (await import('meshoptimizer')).MeshoptDecoder,
});

// ------------------------------------------------------------------ download

async function fetchTo(url, path) {
  if (existsSync(path) && statSync(path).size > 0) return path;
  mkdirSync(dirname(path), { recursive: true });
  const res = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

const phFiles = new Map();
async function polyHavenFiles(id) {
  if (!phFiles.has(id)) {
    const cached = join(CACHE, 'polyhaven', `${id}.files.json`);
    await fetchTo(`https://api.polyhaven.com/files/${id}`, cached);
    phFiles.set(id, JSON.parse(readFileSync(cached, 'utf8')));
  }
  return phFiles.get(id);
}

/** Downloads a Poly Haven model's glTF at `res`, plus PNG diffuse maps (alpha). Returns the .gltf path. */
export async function polyHavenModel(id, res = '1k') {
  const files = await polyHavenFiles(id);
  const g = files.gltf[res].gltf;
  const dir = join(CACHE, 'polyhaven', 'models', `${id}-${res}`);
  await fetchTo(g.url, join(dir, `${id}.gltf`));
  for (const [p, v] of Object.entries(g.include)) await fetchTo(v.url, join(dir, p));
  // PNG diffuse maps keep the alpha channel the JPG copies drop.
  for (const [k, v] of Object.entries(files)) {
    if (!/diff/i.test(k) && k !== 'Diffuse') continue;
    const png = v?.[res]?.png?.url;
    if (typeof png === 'string') await fetchTo(png, join(dir, 'png', png.split('/').pop()));
  }
  return join(dir, `${id}.gltf`);
}

async function polyHavenTexture(id) {
  const files = await polyHavenFiles(id);
  const dir = join(CACHE, 'polyhaven', 'textures', id);
  const out = {};
  for (const [k, n] of [
    ['Diffuse', 'diff'],
    ['nor_gl', 'nor_gl'],
    ['arm', 'arm'],
  ]) {
    out[n] = await fetchTo(files[k]['1k'].jpg.url, join(dir, `${n}.jpg`));
  }
  return out;
}

async function polyHavenSky(id) {
  const files = await polyHavenFiles(id);
  return fetchTo(files.tonemapped.url, join(CACHE, 'polyhaven', 'hdri', `${id}.jpg`));
}

export async function driveFile(fileId, name) {
  return fetchTo(
    `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`,
    join(CACHE, 'quaternius', name),
  );
}

// ------------------------------------------------------------------ textures

const records = [];
const provenance = [];

function rel(p) {
  return relative(ROOT, p).split('\\').join('/');
}

function record(path, source) {
  const bytes = readFileSync(path);
  records.push({
    path: rel(path),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    ...source,
  });
  provenance.push({
    path: rel(path),
    origin: source.origin,
    licence: source.licence,
    author: source.author,
    ...(source.source ? { source: source.source } : {}),
    ...(source.note ? { note: source.note } : {}),
  });
}

/**
 * Encodes an image to KTX2 with a full mip chain. kind: bc (sRGB ETC1S), orm (linear ETC1S),
 * n (linear UASTC + zstd), sky (sRGB ETC1S). Returns { path, width, height }.
 */
export async function encodeKtx2(
  input,
  outPath,
  { px, height, kind, alpha = false, flipY = false },
) {
  const w = px;
  const h = height ?? px;
  const tmp = join(tmpdir(), `sz-${createHash('md5').update(outPath).digest('hex')}.png`);
  let img = sharp(input).resize(w, h, { fit: 'fill', kernel: 'lanczos3' });
  // KTX2 rows are top-down and three uploads compressed textures without flipY, so an
  // equirect sky is flipped here to come out upright.
  if (flipY) img = img.flip();
  img = alpha ? img.ensureAlpha() : img.removeAlpha();
  await img.png().toFile(tmp);
  mkdirSync(dirname(outPath), { recursive: true });
  const common = ['--t2', '--genmipmap'];
  const enc =
    kind === 'n'
      ? ['--encode', 'uastc', '--uastc_quality', '1', '--uastc_rdo_l', '2.0', '--zcmp', '19']
      : ['--encode', 'etc1s', '--clevel', '2', '--qlevel', kind === 'sky' ? '200' : '150'];
  const tf =
    kind === 'bc' || kind === 'sky'
      ? ['--assign_oetf', 'srgb', '--assign_primaries', 'bt709']
      : ['--assign_oetf', 'linear', '--assign_primaries', 'none'];
  execFileSync(TOKTX, [...common, ...enc, ...tf, outPath, tmp], { stdio: 'pipe' });
  rmSync(tmp, { force: true });
  return { path: outPath, width: w, height: h };
}

/** Mean sRGB colour of an image as a linear [r, g, b] glTF factor (fallback colour, BR-G-14). */
export async function meanLinear(input) {
  const s = await sharp(input).removeAlpha().stats();
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return s.channels.slice(0, 3).map((c) => Number(lin(c.mean).toFixed(4)));
}

// ------------------------------------------------------------------ models

export function triangles(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const p of mesh.listPrimitives()) {
      const idx = p.getIndices();
      n += (idx ? idx.getCount() : (p.getAttribute('POSITION')?.getCount() ?? 0)) / 3;
    }
  return Math.round(n);
}

/**
 * Bakes every node transform into its mesh, merges every mesh into one node and joins primitives
 * that share a material. Returns the single mesh node.
 */
export async function collapse(doc) {
  await doc.transform(flatten());
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const meshNodes = root.listNodes().filter((n) => n.getMesh() !== null);
  for (const n of meshNodes) clearNodeTransform(n);
  const target = doc.createMesh('collapsed');
  for (const n of meshNodes) {
    for (const p of n.getMesh().listPrimitives()) target.addPrimitive(p);
    n.setMesh(null);
  }
  for (const n of root.listNodes()) n.dispose();
  for (const s of root.listScenes()) if (s !== scene) s.dispose();
  const node = doc.createNode('collapsed').setMesh(target);
  scene.addChild(node);
  await doc.transform(joinPrims({ keepNamed: false }), weld(), dedup(), prune());
  return root.listNodes().find((n) => n.getMesh() !== null);
}

/** 4x4 column-major matrix from a Y rotation (deg), X rotation (deg), uniform scale and translation. */
export function matrix({ rotX = 0, rotY = 0, rotZ = 0, scale = 1, t = [0, 0, 0] }) {
  const rx = (rotX * Math.PI) / 180;
  const ry = (rotY * Math.PI) / 180;
  const rz = (rotZ * Math.PI) / 180;
  const X = [1, 0, 0, 0, Math.cos(rx), Math.sin(rx), 0, -Math.sin(rx), Math.cos(rx)];
  const Y = [Math.cos(ry), 0, -Math.sin(ry), 0, 1, 0, Math.sin(ry), 0, Math.cos(ry)];
  const Z = [Math.cos(rz), Math.sin(rz), 0, -Math.sin(rz), Math.cos(rz), 0, 0, 0, 1];
  const mul = (a, b) => {
    const o = new Array(9).fill(0);
    for (let c = 0; c < 3; c++)
      for (let r = 0; r < 3; r++)
        for (let k = 0; k < 3; k++) o[c * 3 + r] += a[k * 3 + r] * b[c * 3 + k];
    return o;
  };
  const R = mul(Y, mul(X, Z));
  return [
    R[0] * scale,
    R[1] * scale,
    R[2] * scale,
    0,
    R[3] * scale,
    R[4] * scale,
    R[5] * scale,
    0,
    R[6] * scale,
    R[7] * scale,
    R[8] * scale,
    0,
    t[0],
    t[1],
    t[2],
    1,
  ];
}

export function boundsOf(node) {
  return getBounds(node);
}

/** Feet at the origin, centred in xz. */
export function groundAndCentre(mesh, node) {
  const b = getBounds(node);
  transformMesh(
    mesh,
    matrix({ t: [-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2] }),
  );
}

export async function simplifiedCopy(doc, targetTris) {
  const copy = cloneDocument(doc);
  const tris = triangles(copy);
  if (tris > targetTris) {
    await copy.transform(
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: Math.max(0.002, targetTris / tris),
        error: 1,
      }),
    );
  }
  return copy;
}

/** Strips every texture reference; returns per-material texture sources found in the source glTF. */
export function stripTextures(doc, dir) {
  const out = [];
  doc
    .getRoot()
    .listMaterials()
    .forEach((m) => {
      const uri = (t) => (t ? join(dir, t.getURI()) : null);
      out.push({
        material: m,
        name: m.getName(),
        bc: uri(m.getBaseColorTexture()),
        n: uri(m.getNormalTexture()),
        orm: uri(m.getMetallicRoughnessTexture() ?? m.getOcclusionTexture()),
        alphaMode: m.getAlphaMode(),
      });
      m.setBaseColorTexture(null)
        .setNormalTexture(null)
        .setMetallicRoughnessTexture(null)
        .setOcclusionTexture(null)
        .setEmissiveTexture(null);
    });
  for (const t of doc.getRoot().listTextures()) t.dispose();
  return out;
}

/** Writes one GLB with meshopt compression and quantisation, then checks BR-G-06. */
export async function writeGlb(doc, path) {
  // GLB allows one buffer.
  const root = doc.getRoot();
  const buffers = root.listBuffers();
  const keep = buffers[0] ?? doc.createBuffer('main');
  for (const a of root.listAccessors()) a.setBuffer(keep);
  for (const b of buffers.slice(1)) b.dispose();
  await doc.transform(
    prune({ keepLeaves: true, keepAttributes: true }),
    quantize({ quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 14, quantizeWeight: 8 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true);
  doc.createExtension(KHRMeshQuantization).setRequired(true);
  mkdirSync(dirname(path), { recursive: true });
  const bin = await io.writeBinary(doc);
  writeFileSync(path, bin);
  checkGlb(bin, path);
}

export function checkGlb(bin, label) {
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bin.subarray(20, 20 + jsonLen)));
  for (const k of ['images', 'textures', 'samplers'])
    if ((json[k] ?? []).length > 0) throw new Error(`${label}: GLB carries ${k}`);
  for (const b of json.buffers ?? [])
    if (b.uri !== undefined) throw new Error(`${label}: buffer uri`);
  const req = json.extensionsRequired ?? [];
  for (const e of req)
    if (e !== 'EXT_meshopt_compression' && e !== 'KHR_mesh_quantization')
      throw new Error(`${label}: required extension ${e}`);
  if (jsonLen > 1024 * 1024) throw new Error(`${label}: JSON chunk over 1 MB`);
  return json;
}

// ------------------------------------------------------------------ props and packs

const manifest = []; // { key, file, kind, maps, colour?, maxTexturePx?, maxTriangles?, requiredNodes?, requiredClips?, textures?, use? }
const catalog = []; // PropCatalogEntry
const SOURCE_PH = (id, kind) => ({
  origin: 'cc0',
  licence: 'CC0-1.0',
  author: 'Poly Haven',
  source: `https://polyhaven.com/a/${id}`,
  note: kind,
});

function addTextureEntry(key, file, { maps, colour, maxTexturePx, use = 'always' }) {
  manifest.push({ key, file: rel(file), kind: 'texture', maps, colour, maxTexturePx, use });
}

async function emitMaterialTextures(prefix, src, px, maps, prov, opts = {}) {
  const bindings = {};
  const n = src.length;
  for (let k = 0; k < n; k++) {
    const s = src[k];
    const tag = n === 1 ? '' : `-${k}`;
    const name = `${prefix}__${k}`;
    s.material.setName(name);
    const keys = {};
    // Use the PNG diffuse when the material is alpha-tested (vegetation, leaves).
    let bcIn = s.bc;
    const alpha = s.alphaMode !== 'OPAQUE';
    if (alpha && bcIn !== null) {
      const pngDir = join(dirname(dirname(bcIn)), 'png');
      const base = bcIn
        .split('/')
        .pop()
        .replace(/\.jpg$/, '.png');
      const want = opts.dryDiffuse === true ? base.replace('_diff_', '_dry_diff_') : base;
      if (existsSync(join(pngDir, want))) bcIn = join(pngDir, want);
      s.material.setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true);
    }
    for (const [slot, input] of [
      ['bc', bcIn],
      ['n', s.n],
      ['orm', s.orm],
    ]) {
      if (input === null || input === undefined) continue;
      const key = `tex-${prefix}${tag}-${slot}`;
      const file = join(OUT, 'textures', `${key}.ktx2`);
      const size = slot === 'bc' ? px : Math.max(256, px / 2);
      await encodeKtx2(input, file, { px: size, kind: slot, alpha: slot === 'bc' && alpha });
      record(file, prov);
      addTextureEntry(key, file, {
        maps,
        colour: slot === 'bc' ? 'srgb' : 'linear',
        maxTexturePx: size,
      });
      keys[slot] = key;
    }
    if (bcIn !== null) {
      const [r, g, b] = await meanLinear(bcIn);
      s.material.setBaseColorFactor([r, g, b, 1]);
    }
    bindings[name] = keys;
  }
  return bindings;
}

/** Inset per face for colliders: the visual exceeds the collider by at most this (BR-G-22). */
function colliderInset(kind, extent) {
  const max = kind === 'rock' ? 0.2 : 0.05;
  return Math.min(max, extent * 0.1);
}

async function buildProp(p) {
  const gltf = await polyHavenModel(p.ph, p.res ?? '1k');
  const doc = await io.read(gltf);
  const src = stripTextures(doc, dirname(gltf));
  const node = await collapse(doc);
  const mesh = node.getMesh();
  // Instanced props never morph: drop shape keys (the wheel rim ships one).
  for (const prim of mesh.listPrimitives())
    for (const t of prim.listTargets()) prim.removeTarget(t);
  if (p.rot) transformMesh(mesh, matrix(p.rot));
  if (p.scale) transformMesh(mesh, matrix({ scale: p.scale }));
  groundAndCentre(mesh, node);
  if (mesh.listPrimitives().length > (p.maxPrims ?? 2))
    throw new Error(`${p.id}: ${mesh.listPrimitives().length} primitives after join`);
  const pack = PACKS[p.pack];
  const bindings = await emitMaterialTextures(
    p.id,
    src,
    p.texPx ?? 512,
    pack.maps,
    SOURCE_PH(p.ph, 'texture'),
    p,
  );
  const lod0 = await simplifiedCopy(doc, p.lod0);
  const lod1 = p.lod1 ? await simplifiedCopy(doc, p.lod1) : null;
  const b = getBounds(node);
  const visual = { min: b.min.map(round3), max: b.max.map(round3) };
  const colliders = [];
  if (p.kind !== 'visual') {
    const ex = [0, 1, 2].map((i) => b.max[i] - b.min[i]);
    const inset = ex.map((e) => colliderInset(p.kind, e));
    colliders.push({
      min: [b.min[0] + inset[0], b.min[1], b.min[2] + inset[2]].map(round3),
      max: [b.max[0] - inset[0], b.max[1] - inset[1], b.max[2] - inset[2]].map(round3),
    });
  }
  catalog.push({
    id: p.id,
    asset: p.pack,
    node: p.id,
    lods: lod1 ? 2 : 1,
    kind: p.kind,
    colliders,
    visualBounds: visual,
    maxScale: p.maxScale ?? 1.5,
    triangles: [triangles(lod0), lod1 ? triangles(lod1) : 0],
    textures: bindings,
  });
  return { p, lod0, lod1, bindings };
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

/** Moves the single mesh of `src` into `pack` under a node named `name`; returns the node. */
function adopt(pack, src, name) {
  const map = mergeDocuments(pack, src);
  const scene = pack.getRoot().getDefaultScene() ?? pack.getRoot().listScenes()[0];
  let node = null;
  for (const n of src.getRoot().listNodes()) {
    const t = map.get(n);
    if (t && t.getMesh()) node = t;
  }
  for (const s of src.getRoot().listScenes()) {
    const t = map.get(s);
    if (t && t !== scene) t.dispose();
  }
  if (node === null) throw new Error(`${name}: no mesh node`);
  node.setName(name);
  node.getMesh().setName(name);
  return node;
}

async function buildPack(key, built) {
  const pack = new Document();
  pack.createBuffer('main');
  const scene = pack.createScene('pack');
  pack.getRoot().setDefaultScene(scene);
  let tris = 0;
  for (const { p, lod0, lod1 } of built) {
    const top = pack.createNode(p.id);
    scene.addChild(top);
    const n0 = adopt(pack, lod0, `${p.id}_LOD0`);
    top.addChild(n0);
    tris += triangles(lod0);
    if (lod1) top.addChild(adopt(pack, lod1, `${p.id}_LOD1`));
  }
  for (const n of [...scene.listChildren()])
    if (!built.some((b) => b.p.id === n.getName())) n.dispose();
  const file = join(OUT, 'models', `${key}.glb`);
  await writeGlb(pack, file);
  record(file, {
    origin: 'cc0',
    licence: 'CC0-1.0',
    author: 'Poly Haven',
    source: `https://polyhaven.com/a/${built[0].p.ph}`,
    note: `pack of ${built.map((b) => b.p.ph).join(', ')} (geometry simplified, textures split out)`,
  });
  const textures = Object.assign({}, ...built.map((b) => b.bindings));
  manifest.push({
    key,
    file: rel(file),
    kind: 'model',
    maps: PACKS[key].maps,
    maxTriangles: Math.ceil(tris * 1.05),
    requiredNodes: built.flatMap((b) => [
      b.p.id,
      `${b.p.id}_LOD0`,
      ...(b.lod1 ? [`${b.p.id}_LOD1`] : []),
    ]),
    requiredClips: [],
    textures,
  });
}

// ------------------------------------------------------------------ texture sets and skies

async function buildTextureSets() {
  const sets = {};
  for (const [key, def] of Object.entries(TEXTURE_SETS)) {
    const src = await polyHavenTexture(def.ph);
    const keys = {};
    for (const [slot, input] of [
      ['bc', src.diff],
      ['n', src.nor_gl],
      ['orm', src.arm],
    ]) {
      const k = `tex-${key}-${slot}`;
      const file = join(OUT, 'textures', `${k}.ktx2`);
      await encodeKtx2(input, file, { px: 1024, kind: slot });
      record(file, SOURCE_PH(def.ph, `PBR set ${key}`));
      addTextureEntry(k, file, {
        maps: def.maps,
        colour: slot === 'bc' ? 'srgb' : 'linear',
        maxTexturePx: 1024,
      });
      keys[slot] = k;
    }
    sets[key] = { ...keys, maps: def.maps };
  }
  return sets;
}

async function buildSkies() {
  for (const [key, def] of Object.entries(SKIES)) {
    const input = await polyHavenSky(def.ph);
    const k = `sky-${key}`;
    const file = join(OUT, 'sky', `${k}.ktx2`);
    await encodeKtx2(input, file, { px: 2048, height: 1024, kind: 'sky', flipY: true });
    record(file, SOURCE_PH(def.ph, 'tonemapped HDRI, 2048x1024'));
    manifest.push({
      key: k,
      file: rel(file),
      kind: 'sky',
      maps: def.maps,
      colour: 'srgb',
      maxTexturePx: 2048,
    });
  }
}

// ------------------------------------------------------------------ weapons

async function buildWeapon(w) {
  let doc;
  let src = [];
  let prov;
  if (w.obj) {
    const objPath = await driveFile(w.obj.objId, `${w.obj.name}.obj`);
    const mtlPath = await driveFile(w.obj.mtlId, `${w.obj.name}.mtl`);
    doc = readObj(readFileSync(objPath, 'utf8'), readFileSync(mtlPath, 'utf8'));
    prov = {
      origin: 'cc0',
      licence: 'CC0-1.0',
      author: 'Quaternius',
      source: 'https://quaternius.com/packs/ultimategun.html',
      note: `${w.obj.name} (palette texture baked from MTL colours)`,
    };
  } else {
    const gltf = await polyHavenModel(w.ph, w.res ?? '2k');
    doc = await io.read(gltf);
    src = stripTextures(doc, dirname(gltf));
    prov = SOURCE_PH(w.ph, 'weapon');
  }
  const node = await collapse(doc);
  const mesh = node.getMesh();
  orientWeapon(mesh, node);
  // Scale to the target length along z, then put the muzzle at the rig's muzzle socket.
  let b = getBounds(node);
  transformMesh(mesh, matrix({ scale: w.length / (b.max[2] - b.min[2]) }));
  b = getBounds(node);
  transformMesh(
    mesh,
    matrix({
      t: [-(b.min[0] + b.max[0]) / 2, w.muzzle[1] - b.max[1] + 0.03, w.muzzle[2] - b.min[2]],
    }),
  );
  let bindings;
  if (w.obj) {
    bindings = await bakePalette(doc, w.key, 'all', prov);
  } else {
    bindings = await emitMaterialTextures(w.key, src, w.texPx ?? 2048, 'all', prov);
  }
  const lod = await simplifiedCopy(doc, w.maxTriangles);
  const out = new Document();
  out.createBuffer('main');
  const scene = out.createScene('weapon');
  out.getRoot().setDefaultScene(scene);
  const top = out.createNode(w.key);
  scene.addChild(top);
  const body = adopt(out, lod, `${w.key}_body`);
  top.addChild(body);
  const muzzle = out.createNode('muzzle').setTranslation([0, w.muzzle[1], w.muzzle[2]]);
  top.addChild(muzzle);
  const prims = body.getMesh().listPrimitives().length;
  if (prims > 2) throw new Error(`${w.key}: ${prims} primitives (BR-G-40 allows 2)`);
  const file = join(OUT, 'models', `${w.key}.glb`);
  await writeGlb(out, file);
  record(file, prov);
  manifest.push({
    key: w.key,
    file: rel(file),
    kind: 'model',
    maps: 'all',
    maxTriangles: 15000,
    requiredNodes: ['muzzle'],
    requiredClips: [],
    textures: bindings,
  });
}

function positions(mesh) {
  const out = [];
  const v = [0, 0, 0];
  for (const p of mesh.listPrimitives()) {
    const a = p.getAttribute('POSITION');
    for (let i = 0; i < a.getCount(); i++) out.push([...a.getElement(i, v)]);
  }
  return out;
}

/**
 * Auto-orients a weapon: longest axis to z with the thinner end (the muzzle) at -z, and the
 * axis of larger remaining extent to y with the muzzle above the centre (barrels sit high).
 */
export function orientWeapon(mesh, node) {
  const b = getBounds(node);
  const ext = [0, 1, 2].map((i) => b.max[i] - b.min[i]);
  const long = ext.indexOf(Math.max(...ext));
  const rest = [0, 1, 2].filter((i) => i !== long);
  const up = ext[rest[0]] >= ext[rest[1]] ? rest[0] : rest[1];
  const side = rest.find((i) => i !== up);
  const pts = positions(mesh);
  const slab = (atMin) =>
    pts.filter((p) =>
      atMin ? p[long] < b.min[long] + 0.06 * ext[long] : p[long] > b.max[long] - 0.06 * ext[long],
    );
  const spread = (ps) => {
    if (ps.length === 0) return Infinity;
    let lo = Infinity,
      hi = -Infinity;
    for (const p of ps) {
      lo = Math.min(lo, p[up]);
      hi = Math.max(hi, p[up]);
    }
    return hi - lo;
  };
  const muzzleAtMin = spread(slab(true)) < spread(slab(false));
  const ms = slab(muzzleAtMin);
  const muzzleUp = ms.reduce((s, p) => s + p[up], 0) / Math.max(1, ms.length);
  const upSign = muzzleUp >= (b.min[up] + b.max[up]) / 2 ? 1 : -1;
  const zSign = muzzleAtMin ? 1 : -1; // muzzle (min end) must map to -z
  // new z = zSign * old[long]; new y = upSign * old[up]; new x = cross(y, z) for a proper rotation.
  const Z = [0, 0, 0];
  Z[long] = zSign;
  const Y = [0, 0, 0];
  Y[up] = upSign;
  const X = [Y[1] * Z[2] - Y[2] * Z[1], Y[2] * Z[0] - Y[0] * Z[2], Y[0] * Z[1] - Y[1] * Z[0]];
  void side;
  // Rows of the rotation are X, Y, Z (new = R * old); column-major for gltf-transform.
  transformMesh(mesh, [X[0], Y[0], Z[0], 0, X[1], Y[1], Z[1], 0, X[2], Y[2], Z[2], 0, 0, 0, 0, 1]);
}

/**
 * Replaces every material with one palette material: each vertex gets the UV of its source
 * material's cell in a 16x16-cell sRGB palette texture (BR-G-07 binding, single material).
 */
export async function bakePalette(doc, key, maps, prov, px = 256, gain = 2.5) {
  const root = doc.getRoot();
  const mats = root.listMaterials();
  const cells = 16;
  const raw = Buffer.alloc(px * px * 3);
  const cellPx = px / cells;
  mats.forEach((m, i) => {
    const [r, g, b] = m.getBaseColorFactor().map((c) => Math.min(1, c * gain));
    const s = (v) =>
      Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
    const cx = (i % cells) * cellPx;
    const cy = Math.floor(i / cells) * cellPx;
    for (let y = cy; y < cy + cellPx; y++)
      for (let x = cx; x < cx + cellPx; x++) {
        const o = (y * px + x) * 3;
        raw[o] = s(r);
        raw[o + 1] = s(g);
        raw[o + 2] = s(b);
      }
  });
  const palette = doc.createMaterial(`${key}__0`).setRoughnessFactor(0.6).setMetallicFactor(0.2);
  for (const mesh of root.listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      const i = mats.indexOf(p.getMaterial());
      const u = ((i % cells) + 0.5) / cells;
      const v = (Math.floor(i / cells) + 0.5) / cells;
      const count = p.getAttribute('POSITION').getCount();
      const uv = new Float32Array(count * 2);
      for (let k = 0; k < count; k++) {
        uv[k * 2] = u;
        uv[k * 2 + 1] = v;
      }
      p.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv));
      p.setMaterial(palette);
    }
  }
  for (const m of mats) m.dispose();
  await doc.transform(joinPrims({ keepNamed: false }), prune());
  const tmp = join(tmpdir(), `sz-palette-${key}.png`);
  await sharp(raw, { raw: { width: px, height: px, channels: 3 } })
    .png()
    .toFile(tmp);
  const k = `tex-${key}-bc`;
  const file = join(OUT, 'textures', `${k}.ktx2`);
  await encodeKtx2(tmp, file, { px, kind: 'bc' });
  rmSync(tmp, { force: true });
  record(file, { ...prov, note: `${prov.note ?? ''} palette`.trim() });
  addTextureEntry(k, file, { maps, colour: 'srgb', maxTexturePx: px });
  return { [`${key}__0`]: { bc: k } };
}

// ------------------------------------------------------------------ generated sources

function writeGenerated({ manifest, catalog, sets }) {
  const header = (what) =>
    `/**\n * GENERATED by tools/asset-pipeline/build.mjs (node build.mjs --generate-only); do not edit.\n * ${what}\n */\n`;
  // Prop catalog (map-data, BR-G-20/86).
  const cat = catalog.map((c) => ({
    id: c.id,
    asset: c.asset,
    node: c.node,
    lods: c.lods,
    kind: c.kind,
    colliders: c.colliders,
    visualBounds: c.visualBounds,
    maxScale: c.maxScale,
  }));
  writeFileSync(
    join(ROOT, 'src/maps/prop-catalog.data.ts'),
    header('Prop catalog: model-space colliders and bounds, read from the pack GLBs.') +
      `import type { PropCatalogEntry } from './types';\n\n` +
      `export const PROP_CATALOG_DATA: readonly PropCatalogEntry[] = ${JSON.stringify(cat, null, 2)};\n`,
  );
  // Manifest (kit chunk): hashed ?url imports only (BR-G-05).
  const imports = manifest
    .map((e, i) => `import u${String(i)} from '../../../${e.file}?url';`)
    .join('\n');
  const entries = manifest
    .map((e, i) => {
      const bytes = statSync(join(ROOT, e.file)).size;
      const { file, ...rest } = e;
      void file;
      const body = JSON.stringify({ ...rest, bytes }).slice(1, -1);
      return `  { ${body}, url: u${String(i)} },`;
    })
    .join('\n');
  writeFileSync(
    join(ROOT, 'src/render/assets/manifest.data.ts'),
    header('Asset manifest: one entry per committed file under assets/.') +
      `import type { AssetEntry } from './types';\n${imports}\n\n` +
      `export const MANIFEST_ENTRIES: readonly AssetEntry[] = [\n${entries}\n];\n`,
  );
  writeFileSync(
    join(ROOT, 'src/render/assets/texture-sets.data.ts'),
    header('TEXTURE_SETS: TextureSetKey -> the three AssetKeys of the PBR set (BR-G-70).') +
      `import type { TextureSetTable } from './types';\n\n` +
      `export const TEXTURE_SET_DATA: TextureSetTable = ${JSON.stringify(sets, null, 2)};\n`,
  );
}

/** Re-encodes only the skies (same keys and paths), keeping every other committed output. */
async function rebuildSkiesOnly() {
  const prevRec = JSON.parse(readFileSync(join(OUT, '.pipeline.json'), 'utf8'));
  await buildSkies();
  const touched = new Set(records.map((r) => r.path));
  prevRec.files = prevRec.files
    .filter((r) => !touched.has(r.path))
    .concat(records)
    .sort((a, b) => a.path.localeCompare(b.path));
  writeFileSync(join(OUT, '.pipeline.json'), JSON.stringify(prevRec, null, 2) + '\n');
  writeGenerated(JSON.parse(readFileSync(join(OUT, '.manifest.json'), 'utf8')));
  process.stdout.write(`skies rebuilt: ${records.map((r) => `${r.path} ${r.bytes}`).join(', ')}\n`);
}

/** Rebuilds only the bot GLB and its palette texture, keeping every other committed output. */
async function rebuildBotOnly() {
  const saved = JSON.parse(readFileSync(join(OUT, '.manifest.json'), 'utf8'));
  const prevProv = JSON.parse(readFileSync(join(ROOT, 'assets-provenance.json'), 'utf8'));
  const prevRec = JSON.parse(readFileSync(join(OUT, '.pipeline.json'), 'utf8'));
  const isBot = (key) => key === BOT.key || key === `tex-${BOT.key}-bc`;
  const bot = await buildBot(BOT, {
    driveFile,
    io,
    encodeKtx2,
    record,
    addTextureEntry,
    bakePalette,
    writeGlb,
    simplifiedCopy,
    triangles,
    OUT,
    readObj,
    collapse,
    matrix,
  });
  const fresh = [...manifest, bot];
  saved.manifest = saved.manifest.filter((e) => !isBot(e.key)).concat(fresh);
  const touched = new Set(records.map((r) => r.path));
  const prov = prevProv
    .filter((p) => !touched.has(p.path))
    .concat(provenance)
    .sort((a, b) => a.path.localeCompare(b.path));
  prevRec.files = prevRec.files
    .filter((r) => !touched.has(r.path))
    .concat(records)
    .sort((a, b) => a.path.localeCompare(b.path));
  writeFileSync(join(OUT, '.manifest.json'), JSON.stringify(saved, null, 2) + '\n');
  writeFileSync(join(ROOT, 'assets-provenance.json'), JSON.stringify(prov, null, 2) + '\n');
  writeFileSync(join(OUT, '.pipeline.json'), JSON.stringify(prevRec, null, 2) + '\n');
  writeGenerated(saved);
  process.stdout.write(`bot rebuilt: ${records.map((r) => `${r.path} ${r.bytes}`).join(', ')}\n`);
}

// ------------------------------------------------------------------ main

async function main() {
  if (process.argv.includes('--generate-only')) {
    writeGenerated(JSON.parse(readFileSync(join(OUT, '.manifest.json'), 'utf8')));
    return;
  }
  if (process.argv.includes('--sky-only')) {
    await rebuildSkiesOnly();
    return;
  }
  if (process.argv.includes('--bot-only')) {
    await rebuildBotOnly();
    return;
  }
  mkdirSync(OUT, { recursive: true });
  const v = spawnSync(TOKTX, ['--version'], { encoding: 'utf8' });
  const toktxVersion = `${v.stdout}${v.stderr}`.trim() || 'unknown';
  rmSync(join(OUT, 'models'), { recursive: true, force: true });
  rmSync(join(OUT, 'textures'), { recursive: true, force: true });
  rmSync(join(OUT, 'sky'), { recursive: true, force: true });

  await buildSkies();
  const sets = await buildTextureSets();
  const byPack = new Map();
  for (const p of PROPS) {
    if (ONLY !== null && !ONLY.has(p.id)) continue;
    const built = await buildProp(p);
    process.stdout.write(`prop ${p.id}: ${built.lod0 ? triangles(built.lod0) : 0} tris\n`);
    if (!byPack.has(p.pack)) byPack.set(p.pack, []);
    byPack.get(p.pack).push(built);
  }
  for (const [key, built] of byPack) await buildPack(key, built);
  for (const w of WEAPONS) await buildWeapon(w);
  const bot = await buildBot(BOT, {
    driveFile,
    io,
    encodeKtx2,
    record,
    addTextureEntry,
    bakePalette,
    writeGlb,
    simplifiedCopy,
    triangles,
    OUT,
    readObj,
    collapse,
    matrix,
  });
  manifest.push(bot);

  const generated = { manifest, catalog, sets };
  writeFileSync(join(OUT, '.manifest.json'), JSON.stringify(generated, null, 2) + '\n');
  writeGenerated(generated);
  provenance.sort((a, b) => a.path.localeCompare(b.path));
  writeFileSync(join(ROOT, 'assets-provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  writeFileSync(
    join(OUT, '.pipeline.json'),
    JSON.stringify(
      {
        tools: {
          toktx: toktxVersion,
          '@gltf-transform/core': '4.5.1',
          meshoptimizer: '1.3.0',
          sharp: sharp.versions.sharp,
          node: process.version,
        },
        files: records.sort((a, b) => a.path.localeCompare(b.path)),
      },
      null,
      2,
    ) + '\n',
  );
  const total = records.reduce((s, r) => s + r.bytes, 0);
  process.stdout.write(`wrote ${records.length} files, ${total} bytes\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
