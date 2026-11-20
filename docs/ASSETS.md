# Asset pipeline

The committed files under `assets/` are built offline by `tools/asset-pipeline/build.mjs`. The pipeline is not part of `npm run verify` or CI; verify only checks its outputs (`check:licences` phase 2, `check:assets`, the Node asset tests).

## Sources

Every source is CC0 1.0. `tools/asset-pipeline/sources.mjs` lists them:

- **Poly Haven** (polyhaven.com): 8 PBR texture sets, 2 tonemapped skies (`aarfontein_dusk` for Desert Compound, `quarry_cloudy` for Industrial Warehouse) and 23 props, vegetation and backdrop models.
- **Quaternius** (quaternius.com): the bot (`Soldier_Male`, Ultimate Animated Character Pack) and the three weapons (`AssaultRifle_1`, `Pistol_1`, `SniperRifle_1`, Ultimate Gun Pack).

`assets-provenance.json` records source, author and licence per file, and `docs/CREDITS.md` is generated from it (`node scripts/assets/credits.ts --write`).

## Outputs and rules

- GLB: one buffer, `EXT_meshopt_compression` + `KHR_mesh_quantization` required, no images, textures or samplers (BR-G-06). Prop packs hold `<id>` with `<id>_LOD0` and `<id>_LOD1` children; their colliders are written to `src/maps/prop-catalog.data.ts`, never read from the GLB at runtime.
- KTX2: Basis ETC1S for colour, ORM and skies, UASTC + Zstandard for normals, full mip chains (`toktx --genmipmap`). Skies are flipped vertically before encoding.
- The bot is one skinned primitive with one palette material per LOD (LOD0 ≤ 5,000, LOD1 ≤ 2,000 triangles), a rifle skinned to `Fist.R`, a `muzzle` node, and the clips `idle`, `walk`, `run`, `shoot`, `death`, plus `crouch-idle` and `crouch-walk` derived from the source's SitDown pose.
- Generated sources: `src/maps/prop-catalog.data.ts`, `src/render/assets/manifest.data.ts`, `src/render/assets/texture-sets.data.ts`, and `assets/.manifest.json` / `assets/.pipeline.json` (tool versions and SHA-256 per file).

## Running it

The pipeline needs its own dependencies (exact versions in `tools/asset-pipeline/package.json`) and KTX-Software `toktx` 4.4.2. In the AI-DLC runtime both live outside the workspace:

```sh
mkdir -p $HOME/scratch/pipeline && cd $HOME/scratch/pipeline
cp /path/to/repo/tools/asset-pipeline/package*.json . && npm ci
ln -sfn $HOME/scratch/pipeline/node_modules /path/to/repo/tools/asset-pipeline/node_modules
curl -sLO https://github.com/KhronosGroup/KTX-Software/releases/download/v4.4.2/KTX-Software-4.4.2-Linux-arm64.deb
dpkg -x KTX-Software-4.4.2-Linux-arm64.deb $HOME/scratch/tools/ktx
cd /path/to/repo/tools/asset-pipeline
LD_LIBRARY_PATH=$HOME/scratch/tools/ktx/usr/lib SZ_TOKTX=$HOME/scratch/tools/ktx/usr/bin/toktx \
  SZ_ASSET_CACHE=$HOME/scratch/asset-cache node build.mjs
cd ../.. && npx prettier --write src/maps/prop-catalog.data.ts src/render/assets/*.data.ts assets-provenance.json
node scripts/assets/credits.ts --write && npx prettier --write docs/CREDITS.md
```

Partial rebuilds: `--bot-only`, `--sky-only`, and `--generate-only` (rewrites the generated sources from `assets/.manifest.json`). After a full rebuild, run `npm run verify`; prop changes also need `SZ_UPDATE_GOLDEN=1 npx vitest run tests/sim/determinism.test.ts` and a reviewed golden diff.
