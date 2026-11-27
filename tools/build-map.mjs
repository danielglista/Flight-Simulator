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

const { validateScales, validatePlaces, validateWater, validateDistricts, validateRoads, validateLandmarks } = await load('tools/map/validate.ts');
const { placeAll, groundLocalKm } = await load('tools/map/place.ts');
const { buildWithPatches } = await load('tools/map/patches.ts');
const { runGuardrails } = await load('tools/map/guard.ts');
const { readDbfField, readPolylines } = await load('tools/map/shapefile.ts');
const { buildRoads, roadClass, roadLength } = await load('tools/map/roads.ts');
const { cellAt } = await load('tools/map/skeleton.ts');
const { growConvex } = await load('src/sim/world/polygon.ts');
const { generateBuildings, createRoadDistance, packBuildings, inRing } = await load('tools/map/buildings.ts');
const { project } = await load('tools/map/project.ts');
const { buildLandmarks, landmarkClear } = await load('tools/map/landmarks.ts');
const { districtCode } = await load('tools/map/districts.ts');
const { groundAt } = await load('src/sim/world/grid.ts');
const { ROAD_WIDTH_M } = await load('src/config/map.ts');
const { renderTerrain, renderCrop, renderLayered } = await load('tools/map/shade.ts');
const { decodeFloatPredictorTile, sampleElevation } = await load('tools/map/tiff.ts');

const geo = Number(process.argv[2] ?? 25);

const sf = validateScales(readJson('data/map/scales.json'));
const places = validatePlaces(readJson('data/map/places.json'));
const checks = readJson('data/map/checks.json').checks;
const water = validateWater(readJson('data/map/water.json'));
const { districts, types: districtTypes } = validateDistricts(readJson('data/map/districts.json'), places.cities.map((c) => c.id));
const landmarksFile = validateLandmarks(readJson('data/map/landmarks.json'), places.cities.map((c) => c.id));
const scales = { ...sf.scales, geoDistance: geo };
const grid = { ...sf.grid, baseCellM: Number(process.argv[3] ?? sf.grid.baseCellM), patchCellM: Number(process.argv[4] ?? sf.grid.patchCellM) };
const tag = `1-${geo}`;

const roadsConfig = validateRoads(readJson('data/map/roads.json'));

// ---- inputs ----
for (const ext of ['shp', 'dbf']) {
  if (!existsSync(join(raw, `${roadsConfig.source}.${ext}`))) {
    console.error(`Missing tools/raw/${roadsConfig.source}.${ext}. See data/map/SOURCES.md.`);
    process.exit(1);
  }
}
const roadNames = readDbfField(new Uint8Array(readFileSync(join(raw, `${roadsConfig.source}.dbf`))), 'FULLNAME');
const roadLines = readPolylines(new Uint8Array(readFileSync(join(raw, `${roadsConfig.source}.shp`))), roadNames, (n) => roadClass(n, roadsConfig) !== null);
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
const built = buildWithPatches({ placement, box: sf.box, land, lakes, rivers, elevationAt, water, districts }, grid);
const sk = built.base;
const results = runGuardrails(sk, placement, scales.altitude, checks);
// Airports are checked again on their fine patch, where the ground is exact.
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

// Highways, with bridges where the finest grid covering a point says water.
const layersFine = [...built.patches.map((p) => p.skeleton), sk];
const wet = (x, y) => {
  for (const k of layersFine) {
    const i = cellAt(k, sk.originKm.x + x / 1000, sk.originKm.y + y / 1000);
    if (i >= 0) return !k.land[i] || k.grid.water[i] > 0;
  }
  return false;
};
const roads = buildRoads({ lines: roadLines, config: roadsConfig, toWorld: (x, y) => placement.field.toWorld(x, y), originKm: sk.originKm, width: sk.grid.cols * sk.grid.cellSize, height: sk.grid.rows * sk.grid.cellSize, wet, avoid: placement.airports.map((a) =>
  growConvex(a.outline.map((v) => ({ x: (v.x - sk.originKm.x) * 1000, y: (v.y - sk.originKm.y) * 1000 })), 20), // clear of the outline, world m
) });
const bridges = roads.filter((r) => r.bridge);
console.log(`roads: ${roads.length} pieces, ${roads.reduce((n, r) => n + r.points.length / 2, 0)} points, ${bridges.length} over water`);
for (const r of bridges.filter((b) => roadLength(b) > 300).sort((a, b) => roadLength(b) - roadLength(a))) {
  console.log(`  long crossing: ${Math.round(roadLength(r))} m world, ${r.kind}, from ${r.points.slice(0, 2).join(',')} to ${r.points.slice(-2).join(',')}`);
}

// Where each airport ended up, in the game's frame (the base grid's southwest corner is 0, 0), and the ground leveled for it.
const airports = placement.airports.map((a) => {
  const flat = sk.flattened.find((f) => f.id === a.airport.id);
  return {
    id: a.airport.id,
    x: (a.world.x - sk.originKm.x) * 1000,
    y: (a.world.y - sk.originKm.y) * 1000,
    elevationM: flat.elevationM,
    scale: a.scale,
    ground: groundLocalKm(a.airport).map((ring) => ring.map((q) => ({ x: q.x * 1000, y: q.y * 1000 }))),
  };
});
// Buildings (E5.3), placed on the same ground the game will use.
const codeAt = (x, y) => {
  for (const k of layersFine) {
    const i = cellAt(k, sk.originKm.x + x / 1000, sk.originKm.y + y / 1000);
    if (i >= 0) return k.grid.terrain[i];
  }
  return -1;
};
const ground = {
  ...sk.grid,
  patches: built.patches.map((p) => ({ id: p.id, x: Math.round((p.skeleton.originKm.x - sk.originKm.x) * 1000), y: Math.round((p.skeleton.originKm.y - sk.originKm.y) * 1000), grid: p.skeleton.grid })),
};
const groundWorld = (x, y) => groundAt(ground, { altitude: scales.altitude, geoDistance: geo }, x, y);
// A district outline through the same warp as its painted ground, long edges subdivided so they bend with it.
const ringWorld = (d) => {
  const real = [...d.ring, d.ring[0]].map(([lon, lat]) => project(lat, lon));
  const out = [];
  for (let i = 0; i + 1 < real.length; i++) {
    const n = Math.max(1, Math.ceil(Math.hypot(real[i + 1].x - real[i].x, real[i + 1].y - real[i].y) / 0.2));
    for (let s = 0; s < n; s++) {
      const w = placement.field.toWorld(real[i].x + ((real[i + 1].x - real[i].x) * s) / n, real[i].y + ((real[i + 1].y - real[i].y) * s) / n);
      out.push([(w.x - sk.originKm.x) * 1000, (w.y - sk.originKm.y) * 1000]);
    }
  }
  return out;
};
const halfRoad = { major: ROAD_WIDTH_M.major / 2, minor: ROAD_WIDTH_M.minor / 2 };
// Landmarks (E6): only the center goes through the warp.
const landmarks = buildLandmarks(landmarksFile, (lat, lon) => {
  const r = project(lat, lon);
  const w = placement.field.toWorld(r.x, r.y);
  return { x: (w.x - sk.originKm.x) * 1000, y: (w.y - sk.originKm.y) * 1000 };
}, scales.buildingHeight);
const city = generateBuildings({ blocked: landmarkClear(landmarksFile, landmarks), districts, styles: districtTypes, ringWorld, code: codeAt, ground: groundWorld, roadDistance: createRoadDistance(roads, halfRoad), heightScale: scales.buildingHeight, seed: 20260101 });
const buildings = city.buildings;
console.log(`buildings: ${buildings.length}`);
// Count and roof cover per housing density. A district's ground is what still has its color and no later district claims, sampled.
{
  const rings = districts.map(ringWorld);
  const owner = (x, y) => rings.findLastIndex((r) => inRing(x, y, r));
  const owners = buildings.map((b) => owner(b.x, b.y));
  const SAMPLE = 20;
  const level = new Map();
  districts.forEach((d, n) => {
    if (d.type !== 'housing') return;
    const sum = level.get(d.density) ?? { count: 0, roofs: 0, ground: 0 };
    level.set(d.density, sum);
    buildings.forEach((b, i) => {
      if (owners[i] !== n) return;
      sum.count++;
      sum.roofs += b.width * b.depth;
    });
    const xs = rings[n].map((p) => p[0]);
    const ys = rings[n].map((p) => p[1]);
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += SAMPLE) {
      for (let y = Math.min(...ys); y <= Math.max(...ys); y += SAMPLE) if (codeAt(x, y) === districtCode(d) && owner(x, y) === n) sum.ground += SAMPLE * SAMPLE;
    }
  });
  for (const [density, s] of [...level].sort((a, b) => a[0] - b[0])) console.log(`  housing density ${density}: ${s.count} buildings, roofs cover ${((100 * s.roofs) / s.ground).toFixed(1)}% of its ground`);
}
for (const c of placement.cities) {
  const x = (c.world.x - sk.originKm.x) * 1000;
  const y = (c.world.y - sk.originKm.y) * 1000;
  const w = c.core.w * 1000;
  const h = c.core.h * 1000;
  const inCore = buildings.filter((b) => Math.abs(b.x - x) <= w / 2 && Math.abs(b.y - y) <= h / 2);
  console.log(`  ${c.city.id} core: ${inCore.length} buildings, roofs cover ${((100 * inCore.reduce((n, b) => n + b.width * b.depth, 0)) / (w * h)).toFixed(1)}% of the core box, tallest ${Math.max(0, ...inCore.map((b) => b.height))} m world`);
}

for (const [i, l] of landmarks.entries()) {
  if (landmarksFile.landmarks[i].overWater) continue;
  results.push({ name: `landmark ${l.id} on land`, level: wet(l.x, l.y) ? 'fail' : 'ok', message: `at ${Math.round(l.x)},${Math.round(l.y)}, ${wet(l.x, l.y) ? 'in water' : 'dry'}` });
}

mkdirSync(outDir, { recursive: true });
const img = renderTerrain(sk, placement, scales.altitude, roads, buildings);
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
  const layered = renderLayered([...built.patches.map((p) => p.skeleton), sk], placement, scales.altitude, center, 2.2, 300, roads, sk.originKm, buildings);
  const wide = renderLayered([...built.patches.map((p) => p.skeleton), sk], placement, scales.altitude, center, 5, 100, roads, sk.originKm, buildings);
  writeFileSync(join(outDir, `crop-dc-wide-${tag}.png`), encodePng(wide.width, wide.height, wide.data));
  const phl = placement.airports.find((a) => a.airport.id === 'PHL').world;
  const pc = placement.cities.find((c) => c.city.id === 'phl-city').world;
  const pcenter = { x: (pc.x + phl.x) / 2, y: (pc.y + phl.y) / 2 };
  const phlCrop = renderLayered([...built.patches.map((p) => p.skeleton), sk], placement, scales.altitude, pcenter, 3, 150, roads, sk.originKm, buildings);
  writeFileSync(join(outDir, `crop-phl-${tag}.png`), encodePng(phlCrop.width, phlCrop.height, phlCrop.data));
  const phlWide = renderLayered([...built.patches.map((p) => p.skeleton), sk], placement, scales.altitude, { x: pcenter.x - 1.5, y: pcenter.y - 2 }, 4.5, 100, roads, sk.originKm, buildings);
  writeFileSync(join(outDir, `crop-phl-wide-${tag}.png`), encodePng(phlWide.width, phlWide.height, phlWide.data));
  writeFileSync(join(outDir, `crop-dc-${tag}.png`), encodePng(layered.width, layered.height, layered.data));
}

// Binary 'FSMAP2': JSON length, JSON meta, then for the base and each patch in meta order:
// elevation (int16 LE), terrain (u8), water (u8).
const layers = (k) => [Buffer.from(k.grid.elevation.buffer, k.grid.elevation.byteOffset, k.grid.elevation.byteLength), Buffer.from(k.grid.terrain), Buffer.from(k.grid.water)];
const describe = (k) => ({ cols: k.grid.cols, rows: k.grid.rows, cellM: k.grid.cellSize, originKm: k.originKm });
const meta = Buffer.from(JSON.stringify({ geoDistance: geo, scales, box: sf.box, grid, airports, roads, buildings: packBuildings(buildings), landmarks, base: describe(sk), patches: built.patches.map((p) => ({ id: p.id, kind: p.kind, ...describe(p.skeleton) })) }));
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
