import { buildAirport, type Airport, type AirportDef } from './airport';
import { Terrain } from './terrain';
import { TEST_MAP_OFFSET_M } from './testMap';

/**
 * Invented airport on the test map's level area. Authored in LOCAL REAL meters
 * (x east, y north of the anchor), so tuning the airport scale never rewrites it.
 * Paving sits only north and west of the runway centre, so a flipped grid shows.
 */
export const TEST_AIRPORT_DEF: AirportDef = {
  ident: 'TST',
  name: 'Test Field',
  anchor: { x: 2560 + TEST_MAP_OFFSET_M, y: 955 + TEST_MAP_OFFSET_M },
  scale: 2,
  boundary: { minX: -1400, minY: -490, maxX: 1400, maxY: 490 },
  blend: 80,
  fieldElevationM: 30,
  cellSize: 2,
  runways: [{ a: { x: -987, y: -359 }, b: { x: 987, y: 359 }, width: 45, names: ['07', '25'] }],
  paving: [
    { kind: 'rect', code: Terrain.airport, minX: -200, minY: 250, maxX: 200, maxY: 410 },
    { kind: 'strip', code: Terrain.taxiway, a: { x: -990, y: -264 }, b: { x: 0, y: 96 }, width: 24 },
    { kind: 'strip', code: Terrain.taxiway, a: { x: -959, y: -349 }, b: { x: -990, y: -264 }, width: 24 },
    { kind: 'strip', code: Terrain.taxiway, a: { x: 0, y: 96 }, b: { x: 0, y: 250 }, width: 24 },
  ],
};

export function buildTestAirport(): Airport {
  return buildAirport(TEST_AIRPORT_DEF);
}
