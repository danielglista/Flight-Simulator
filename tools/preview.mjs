// node tools/preview.mjs  -> tools/out/preview-1-<scale>.png and .json for 1:20, 1:25 and 1:30
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';
import { encodePng } from './png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const load = async (p) => (await runnerImport(join(root, p))).module;

const { validateScales, validatePlaces } = await load('tools/map/validate.ts');
const { placeAll, distanceKm, boundsOf } = await load('tools/map/place.ts');
const { renderPreview, COLOR_KEY } = await load('tools/map/render.ts');

const SCALES = [20, 25, 30];
const SPEED_MS = 250 * 0.514444;
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

const scalesFile = validateScales(readJson('data/map/scales.json'));
const places = validatePlaces(readJson('data/map/places.json'));
const outDir = join(root, 'tools', 'out');
mkdirSync(outDir, { recursive: true });

console.log('Colors:');
for (const [color, meaning] of COLOR_KEY) console.log(`  ${color.padEnd(18)} ${meaning}`);

let failed = false;
for (const geo of SCALES) {
  const name = `preview-1-${geo}`;
  try {
    const scales = { ...scalesFile.scales, geoDistance: geo };
    const pl = placeAll(scales, scalesFile.box, scalesFile.warp, places);
    const img = renderPreview(pl);
    writeFileSync(join(outDir, `${name}.png`), encodePng(img.width, img.height, img.data));

    const cityDist = pl.cities.length >= 2 ? distanceKm(pl.cities[0].world, pl.cities[1].world) : null;
    const apts = pl.airports;
    const tripKm = apts.length >= 2 ? distanceKm(apts[0].world, apts[1].world) : null;
    const summary = {
      geoDistance: geo,
      plateau: `1:${round(1 / pl.warp.profile.plateau, 1)}`,
      boxWorldKm: { w: round(pl.box.w, 2), h: round(pl.box.h, 2) },
      cells10m: Math.round(pl.box.w * 100) * Math.round(pl.box.h * 100),
      cityToCityKm: cityDist === null ? null : round(cityDist, 2),
      airportToAirportKm: tripKm === null ? null : round(tripKm, 2),
      secondsAt250kt: tripKm === null ? null : Math.round((tripKm * 1000) / SPEED_MS),
      airports: apts.map((a) => ({
        id: a.airport.id,
        distanceFromCityBeforeKm: round(a.distanceBeforeKm, 2),
        distanceFromCityAfterKm: round(a.distanceAfterKm, 2),
        pushedKm: round(a.pushedKm, 2),
        outlineWorldKm: { w: round(boundsOf(a.outline).w, 2), h: round(boundsOf(a.outline).h, 2) },
        corridorInBox: a.corridorInBox,
      })),
    };
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify(summary, null, 2) + '\n');
    console.log(`\n1:${geo}  plateau ${summary.plateau}  box ${summary.boxWorldKm.w} x ${summary.boxWorldKm.h} km  ${summary.cells10m} cells`);
    console.log(`  city to city ${summary.cityToCityKm} km, airport to airport ${summary.airportToAirportKm} km, about ${summary.secondsAt250kt} s at 250 kt`);
    for (const a of summary.airports) {
      console.log(`  ${a.id}: ${a.distanceFromCityBeforeKm} km from city, pushed ${a.pushedKm} km to ${a.distanceFromCityAfterKm} km; outline ${a.outlineWorldKm.w} x ${a.outlineWorldKm.h} km; corridor ${a.corridorInBox ? 'inside box' : 'LEAVES THE BOX'}`);
    }
  } catch (e) {
    failed = true;
    console.error(`\n1:${geo} failed: ${e.message}`);
  }
}
process.exitCode = failed ? 1 : 0;
