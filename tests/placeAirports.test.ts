import { TEST_MAP_OFFSET_M as O } from '../src/sim/world/testMap';
import { describe, expect, it } from 'vitest';
import { buildAirport, type AirportDef } from '../src/sim/world/airport';
import { createGrid } from '../src/sim/world/grid';
import { withAirports } from '../src/sim/world/placeAirports';
import { buildTestAirport, TEST_AIRPORT_DEF } from '../src/sim/world/testAirport';
import { buildTestMap } from '../src/sim/world/testMap';

const map = buildTestMap();
const tryDef = (patch: Partial<AirportDef>, grid = map) =>
  withAirports(grid, [buildAirport({ ...TEST_AIRPORT_DEF, ...patch })]);

describe('withAirports', () => {
  it('accepts the test airport and shares the base arrays', () => {
    const g = withAirports(map, [buildTestAirport()]);
    expect(g.elevation).toBe(map.elevation);
    expect(g.airports).toHaveLength(1);
  });
  it('rejects a boundary outside the map, naming the airport', () => {
    expect(() => tryDef({ anchor: { x: 100, y: 955 } })).toThrow(/TST.*outside the map/);
  });
  it('rejects overlapping airports', () => {
    const a = buildTestAirport();
    const b = buildAirport({ ...TEST_AIRPORT_DEF, ident: 'TS2', anchor: { x: 2700 + O, y: 955 + O } });
    expect(() => withAirports(map, [a, b])).toThrow(/TS2.*overlaps airport TST/);
  });
  it('rejects a runway that reaches the blend band', () => {
    expect(() =>
      tryDef({ runways: [{ a: { x: -1380, y: 0 }, b: { x: 987, y: 0 }, width: 45, names: ['09', '27'] }] }),
    ).toThrow(/blend band/);
  });
  it('rejects paving in the blend band', () => {
    expect(() =>
      tryDef({ paving: [{ kind: 'rect', code: 9, minX: -1395, minY: 0, maxX: -1300, maxY: 50 }] }),
    ).toThrow(/blend band/);
  });
  it('rejects wet base ground', () => {
    const g = createGrid(40, 40, 10);
    g.elevation.fill(5);
    g.elevation[20 * 40 + 20] = -3;
    const def = {
      ...TEST_AIRPORT_DEF,
      anchor: { x: 200, y: 200 },
      boundary: { minX: -300, minY: -300, maxX: 300, maxY: 300 },
      blend: 50,
      runways: [{ a: { x: -100, y: 0 }, b: { x: 100, y: 0 }, width: 30, names: ['09', '27'] as [string, string] }],
      paving: [],
    };
    expect(() => withAirports(g, [buildAirport(def)])).toThrow(/wet/);
  });
  it('rejects names that do not match the heading, or are not reciprocal', () => {
    const r = TEST_AIRPORT_DEF.runways[0]!;
    expect(() => tryDef({ runways: [{ ...r, names: ['08', '26'] }] })).toThrow(/does not match heading/);
    expect(() => tryDef({ runways: [{ ...r, names: ['07', '24'] }] })).toThrow(/reciprocal/);
  });
  it('rejects a non-positive blend', () => {
    expect(() => tryDef({ blend: 0 })).toThrow(/blend/);
  });
});
