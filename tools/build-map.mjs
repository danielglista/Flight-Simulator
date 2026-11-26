// node tools/build-map.mjs [geoDistance] [baseCellM] [patchCellM]  -> tools/out/mid-atlantic-1-<geo>.bin, a shaded preview PNG, and a guardrail report
// Needs tools/raw/ne_10m_*.geojson and tools/raw/etopo_<col>_<row>.tile (see data/map/SOURCES.md).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { runnerImport } from 'vite';
import { encodePng } from './png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = join(root, 'tools', 'raw');
const outDir = join(root, 'tools', 'out');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const load = async (p) => (await runnerImport(join(root, p))).module;

const { validateScales, validatePlaces, validateWater } = await load('tools/map/validate.ts');
const { placeAll } = await load('tools/map/place.ts');
const { buildWithPatches } = await load('tools/map/patches.ts');
const { runGuardrails } = await load('tools/map/guard.ts');
const { renderTerrain, renderCrop, renderLayered } = await load('tools/map/shade.ts');
const { decodeFloatPredictorTile, sampleElevation } = await load('tools/map/tiff.ts');

const geo = Number(process.argv[2] ?? 25);

const sf = validateScales(readJson('data/map/scales.json'));
const places = validatePlaces(readJson('data/map/places.json'));
const checks = readJson('data/map/checks.json').checks;
const water = validateWater(readJson('data/map/water.json'));
const scales = { ...sf.scales, geoDistance: geo };
const grid = { ...sf.grid, baseCellM: Number(process.argv[3] ?? sf.grid.baseCellM), patchCellM: Number(process.argv[4] ?? sf.grid.patchCellM) };
const tag = `1-${geo}`;

// ---- inputs ----
for (const f of ['ne_10m_land.geojson', 'ne_10m_lakes.geojson', 'ne_10m_rivers_north_america.geojson']) {
  if (!existsSync(join(raw, f))) {
    console.error(`Missing tools/raw/${f}. See data/map/SOURCES.md for where to get it.`);
    process.exit(1);
  }
}
const geojson = (f) => JSON.parse(readFileSync(join(raw, f), 'utf8'));
const polys = (fc) =>
  fc.features.flatMap((ft) => {
    const g = ft.geometry;
    if (!g) return [];
    if (g.type === 'Polygon') return [{ rings: g.coordinates }];
    if (g.type === 'MultiPolygon') return g.coordinates.map((rings) => ({ rings }));
    return [];
  });
const rivers = geojson('ne_10m_rivers_north_america.geojson').features.flatMap((ft) => {
  const g = ft.geometry;
  if (!g) return [];
  const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  const name = ft.properties?.name ?? null;
  return lines.map((line) => ({ name, major: Boolean(name), line }));
});
const land = polys(geojson('ne_10m_land.geojson'));
const lakes = polys(geojson('ne_10m_lakes.geojson'));

// ETOPO 2022 60 arc-second tiles: 256 x 256 samples each, columns 23 to 25, rows 11 to 12 of the global 21600 x 10800 grid.
const TILE = 256;
const TX = [23, 24, 25];
const TY = [11, 12];
const cols = TX.length * TILE;
const rowsN = TY.length * TILE;
const data = new Float32Array(cols * rowsN);
for (const ty of TY) {
  for (const tx of TX) {
    const f = join(raw, `etopo_${tx}_${ty}.tile`);
    if (!existsSync(f)) {
      console.error(`Missing ${f}. See data/map/SOURCES.md.`);
      process.exit(1);
    }
    const tile = decodeFloatPredictorTile(new Uint8Array(inflateSync(readFileSync(f))), TILE, TILE);
    for (let y = 0; y < TILE; y++) data.set(tile.subarray(y * TILE, (y + 1) * TILE), ((ty - TY[0]) * TILE + y) * cols + (tx - TX[0]) * TILE);
  }
}
const step = 1 / 60;
const elev = { cols, rows: rowsN, data, west: -180 + (TX[0] * TILE) * step, north: 90 - (TY[0] * TILE) * step, step };
const elevationAt = (lat, lon) => sampleElevation(elev, lat, lon);

// ---- build ----
const t0 = Date.now();
const placement = placeAll(scales, sf.box, sf.warp, places);
for (const st of placement.field.stamps) {
  const asked = places.airports.find((a) => a.id === st.id)?.stampFadeKm;
  console.log(`stamp ${st.id}: land bends to meet it over ${st.fadeKm.toFixed(2)} km world${asked !== undefined && st.fadeKm > asked + 1e-9 ? ` (lengthened from ${asked} so it does not fold)` : ''}`);
}
const built = buildWithPatches({ placement, box: sf.box, land, lakes, rivers, elevationAt, water }, grid);
const sk = built.base;
const results = runGuardrails(sk, placement, scales.altitude, checks);
// Airports are checked again on their fine patch, where the footprint is exact.
for (const p of built.patches) {
  if (p.kind !== 'airport') continue;
  const a = placement.airports.find((x) => x.airport.id === p.id);
  for (const r of runGuardrails(p.skeleton, { ...placement, airports: [a], cities: [] }, scales.altitude, [])) {
    if (r.name === `${p.id} dry` || r.name === `${p.id} flat`) results.push({ ...r, name: `${r.name} (${grid.patchCellM} m patch)` });
  }
}
console.log(`1:${geo}: base ${sk.grid.cols} x ${sk.grid.rows} cells at ${grid.baseCellM} m, plus ${built.patches.length} patches at ${grid.patchCellM} m, built in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const p of built.patches) console.log(`  patch ${p.id} (${p.kind}): ${p.skeleton.grid.cols} x ${p.skeleton.grid.rows} cells`);

for (const p of built.patches) {
  if (p.kind !== 'city') continue;
  const q = p.skeleton;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < q.grid.elevation.length; i++) if (q.land[i] && !q.grid.water[i]) { lo = Math.min(lo, q.grid.elevation[i]); hi = Math.max(hi, q.grid.elevation[i]); }
  console.log(`  ${p.id} core patch: land elevation ${lo} to ${hi} m real`);
}

mkdirSync(outDir, { recursive: true });
const img = renderTerrain(sk, placement, scales.altitude);
writeFileSync(join(outDir, `terrain-${tag}.png`), encodePng(img.width, img.height, img.data));
// Crops around DCA at the same pixels per km: the base grid, then the fine patch.
const dca = placement.airports[0].world;
const dcaPatch = built.patches.find((p) => p.id === placement.airports[0].airport.id);
for (const [name, skel] of [['base', sk], ['patch', dcaPatch.skeleton]]) {
  const crop = renderCrop(skel, placement, scales.altitude, dca, 0.9, 400);
  writeFileSync(join(outDir, `crop-dca-${name}-${tag}.png`), encodePng(crop.width, crop.height, crop.data));
}

// DC and DCA together, patches over the base, as the game will show them.
{
  const dc = placement.cities.find((c) => c.city.id === 'dc').world;
  const center = { x: (dc.x + dca.x) / 2, y: (dc.y + dca.y) / 2 };
  const layered = renderLayered([...built.patches.map((p) => p.skeleton), sk], placement, scales.altitude, center, 2.2, 300);
  const wide = renderLayered([...built.patches.map((p) => p.skeleton), sk], placement, scales.altitude, center, 5, 100);
  writeFileSync(join(outDir, `crop-dc-wide-${tag}.png`), encodePng(wide.width, wide.height, wide.data));
  const phl = placement.airports.find((a) => a.airport.id === 'PHL').world;
  const pc = placement.cities.find((c) => c.city.id === 'phl-city').world;
  const pcenter = { x: (pc.x + phl.x) / 2, y: (pc.y + phl.y) / 2 };
  const phlCrop = renderLayered([...built.patches.map((p) => p.skeleton), sk], placement, scales.altitude, pcenter, 3, 150);
  writeFileSync(join(outDir, `crop-phl-${tag}.png`), encodePng(phlCrop.width, phlCrop.height, phlCrop.data));
  const phlWide = renderLayered([...built.patches.map((p) => p.skeleton), sk], placement, scales.altitude, { x: pcenter.x - 1.5, y: pcenter.y - 2 }, 4.5, 100);
  writeFileSync(join(outDir, `crop-phl-wide-${tag}.png`), encodePng(phlWide.width, phlWide.height, phlWide.data));
  writeFileSync(join(outDir, `crop-dc-${tag}.png`), encodePng(layered.width, layered.height, layered.data));
}

// Binary 'FSMAP2': JSON length, JSON meta, then for the base and each patch in meta order:
// elevation (int16 LE), terrain (u8), water (u8).
const layers = (k) => [Buffer.from(k.grid.elevation.buffer, k.grid.elevation.byteOffset, k.grid.elevation.byteLength), Buffer.from(k.grid.terrain), Buffer.from(k.grid.water)];
const describe = (k) => ({ cols: k.grid.cols, rows: k.grid.rows, cellM: k.grid.cellSize, originKm: k.originKm });
// Where each airport ended up, in the game's frame (the base grid's southwest corner is 0, 0), and the ground leveled for it.
const airports = placement.airports.map((a) => {
  const scale = a.airport.boundaryKm.w / a.boundary.w;
  const flat = sk.flattened.find((f) => f.id === a.airport.id);
  return {
    id: a.airport.id,
    x: (a.boundary.cx - sk.originKm.x) * 1000,
    y: (a.boundary.cy - sk.originKm.y) * 1000,
    elevationM: flat.elevationM,
    scale,
    ground: (a.airport.footprint ?? []).map((f) => ({ x: f.x * 1000, y: f.y * 1000, length: f.length * 1000, width: f.width * 1000, headingDeg: f.headingDeg })),
  };
});
const meta = Buffer.from(JSON.stringify({ geoDistance: geo, scales, box: sf.box, grid, airports, base: describe(sk), patches: built.patches.map((p) => ({ id: p.id, kind: p.kind, ...describe(p.skeleton) })) }));
const head2 = Buffer.alloc(10);
head2.write('FSMAP2', 0, 'ascii');
head2.writeUInt32LE(meta.length, 6);
const file = Buffer.concat([head2, meta, ...layers(sk), ...built.patches.flatMap((p) => layers(p.skeleton))]);
writeFileSync(join(outDir, `mid-atlantic-${tag}.bin`), file);
// The game loads one map: the build at the scales and cell sizes in scales.json, kept in the project.
if (geo === sf.scales.geoDistance && grid.baseCellM === sf.grid.baseCellM && grid.patchCellM === sf.grid.patchCellM) {
  mkdirSync(join(root, 'public', 'maps'), { recursive: true });
  writeFileSync(join(root, 'public', 'maps', 'mid-atlantic.bin'), file);
  console.log('wrote public/maps/mid-atlantic.bin');
}
writeFileSync(join(outDir, `guardrails-${tag}.json`), JSON.stringify(results, null, 2) + '\n');

let bad = 0;
for (const r of results) {
  if (r.level === 'fail') bad++;
  console.log(`  ${r.level.toUpperCase().padEnd(4)} ${r.name}: ${r.message}`);
}
process.exitCode = bad > 0 ? 1 : 0;
