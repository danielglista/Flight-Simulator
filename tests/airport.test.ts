import { TEST_MAP_OFFSET_M as O } from '../src/sim/world/testMap';
import { describe, expect, it } from 'vitest';
import { SCALES } from '../src/config/scales';
import {
  blendWeight,
  buildAirport,
  runwayFrame,
  runwayNumber,
  runwaySpan,
  type Runway,
} from '../src/sim/world/airport';
import { createGrid, groundAt, heightAt, runwayAt, surfaceAt, waterLevelAt } from '../src/sim/world/grid';
import { sliceAlong } from '../src/sim/world/slice';
import { withAirports } from '../src/sim/world/placeAirports';
import { buildTestAirport, TEST_AIRPORT_DEF } from '../src/sim/world/testAirport';
import { Terrain } from '../src/sim/world/terrain';
import { buildTestMap } from '../src/sim/world/testMap';

function runway(a: [number, number], b: [number, number], width: number): Runway {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const heading = Math.atan2(b[0] - a[0], b[1] - a[1]);
  return { a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, width, names: ['36', '18'], length, heading };
}
const DEG = Math.PI / 180;

describe('runwayFrame', () => {
  const north = runway([0, 0], [0, 100], 20); // heading 0
  const east = runway([0, 0], [100, 0], 20); // heading 90
  it('gives along 0 at a and length at b, across 0 on the centerline', () => {
    expect(runwayFrame(north, 0, 0)).toEqual({ along: 0, across: 0 });
    expect(runwayFrame(north, 0, 100)).toEqual({ along: 100, across: 0 });
    expect(runwayFrame(north, 0, 50).along).toBe(50);
  });
  it('is positive to the right of the heading at 0, 90 and 070', () => {
    expect(runwayFrame(north, 5, 50).across).toBeCloseTo(5);
    expect(runwayFrame(east, 50, -5).across).toBeCloseTo(5);
    const r = runway([0, 0], [Math.sin(70 * DEG) * 1000, Math.cos(70 * DEG) * 1000], 20);
    // A point to the right (south-east side) of a 070 line.
    expect(runwayFrame(r, 500 * Math.sin(70 * DEG) + 5 * Math.cos(70 * DEG), 500 * Math.cos(70 * DEG) - 5 * Math.sin(70 * DEG)).across).toBeCloseTo(5);
  });
  it('swaps along and across when the endpoints are reversed', () => {
    const rev = runway([0, 100], [0, 0], 20);
    expect(runwayFrame(rev, 3, 90).along).toBeCloseTo(10);
    expect(runwayFrame(rev, 3, 90).across).toBeCloseTo(-3);
  });
});

describe('runwaySpan', () => {
  const rw = runway([0, 0], [0, 100], 20);
  it('runs along the runway', () => {
    const s = runwaySpan(rw, { x: 0, y: -50 }, 0);
    expect(s?.enter).toBeCloseTo(50);
    expect(s?.exit).toBeCloseTo(150);
  });
  it('crosses at 90 degrees through the width', () => {
    const s = runwaySpan(rw, { x: -100, y: 50 }, Math.PI / 2);
    expect(s?.enter).toBeCloseTo(90);
    expect(s?.exit).toBeCloseTo(110);
  });
  it('clips an oblique line', () => {
    const s = runwaySpan(rw, { x: -100, y: 50 }, Math.atan2(1, 0.5)); // slope: 0.5 east per north... heading
    expect(s).not.toBeNull();
    expect((s?.exit ?? 0) - (s?.enter ?? 0)).toBeGreaterThan(0);
  });
  it('returns null when it misses, or runs parallel outside', () => {
    expect(runwaySpan(rw, { x: 50, y: -50 }, 0)).toBeNull();
    expect(runwaySpan(rw, { x: -100, y: 200 }, Math.PI / 2)).toBeNull();
  });
  it('has a negative enter when the origin is on the runway', () => {
    const s = runwaySpan(rw, { x: 0, y: 40 }, 0);
    expect(s?.enter).toBeCloseTo(-40);
    expect(s?.exit).toBeCloseTo(60);
  });
});

describe('runwayNumber', () => {
  it('rounds to ten degrees, with north as 36', () => {
    expect(runwayNumber(70 * DEG)).toBe('07');
    expect(runwayNumber(250 * DEG)).toBe('25');
    expect(runwayNumber(0)).toBe('36');
    expect(runwayNumber(359 * DEG)).toBe('36');
    expect(runwayNumber(180 * DEG)).toBe('18');
  });
});

describe('buildAirport', () => {
  const a = buildTestAirport();
  it('converts real meters to world meters about the anchor', () => {
    expect(a.minX).toBe(1860 + O);
    expect(a.maxX).toBe(3260 + O);
    expect(a.minY).toBe(710 + O);
    expect(a.maxY).toBe(1200 + O);
    expect(a.blend).toBe(40);
    expect(a.cols).toBe(700);
    expect(a.rows).toBe(245);
    const rw = a.runways[0] as Runway;
    expect(rw.length).toBeCloseTo(1050, -1);
    expect(rw.width).toBe(22.5);
    expect(rw.heading / DEG).toBeCloseTo(70, 0);
    expect(rw.names).toEqual(['07', '25']);
  });
  it('keeps the field elevation in real meters (not divided by the airport scale)', () => {
    expect(a.fieldElevationM).toBe(30);
  });
  it('paints the fine grid with row 0 south', () => {
    const at = (x: number, y: number) => a.surface[Math.floor((y - a.minY) / 2) * a.cols + Math.floor((x - a.minX) / 2)];
    expect(at((2560 + O), (955 + O) + 165)).toBe(Terrain.airport); // apron, north of centre
    expect(at((2560 + O), (955 + O) - 165)).toBe(Terrain.grass); // same place mirrored south
    expect(at((2560 + O) - 300, (955 + O))).toBe(Terrain.grass);
    expect(at((2560 + O), (955 + O) + 80)).toBe(Terrain.taxiway); // apron link, (0, 160 real)
    expect(at((2560 + O) - 100, (955 + O) + 11.5)).toBe(Terrain.taxiway); // on the taxiway line at real (-200, 23)
    expect(at((2560 + O) + 100, (955 + O) + 70)).toBe(Terrain.grass);
  });
});

describe('lookup', () => {
  const map = buildTestMap();
  const air = buildTestAirport();
  const g = withAirports(map, [air]);
  const rw = air.runways[0] as Runway;
  const mid = { x: (rw.a.x + rw.b.x) / 2, y: (rw.a.y + rw.b.y) / 2 };

  it('puts the runway above the fine grid above the base', () => {
    expect(surfaceAt(g, mid.x, mid.y)).toBe(Terrain.runway);
    expect(surfaceAt(g, (2560 + O), (955 + O) + 165)).toBe(Terrain.airport);
    expect(surfaceAt(g, (2560 + O) - 300, (955 + O))).toBe(Terrain.grass);
    expect(runwayAt(g, mid.x, mid.y)?.runway).toBe(rw);
    expect(runwayAt(g, (2560 + O), (955 + O) + 165)).toBeNull();
  });
  it('changes nothing outside the boundary, and with no airports', () => {
    for (const [x, y] of [[100, 100], [(2560 + O), 1500 + O], [1000 + O, 2000 + O], [1859 + O, (955 + O)], [3261 + O, (955 + O)]] as const) {
      expect(surfaceAt(g, x, y)).toBe(surfaceAt(map, x, y));
      expect(heightAt(g, SCALES, x, y)).toBe(heightAt(map, SCALES, x, y));
    }
    expect(g.airports).toHaveLength(1);
    expect(map.airports).toHaveLength(0);
  });
  it('is flat and dry on the runway', () => {
    expect(groundAt(g, SCALES, mid.x, mid.y)).toBe(30 / SCALES.altitude);
    expect(Number.isNaN(waterLevelAt(g, SCALES, mid.x, mid.y))).toBe(true);
    expect(heightAt(g, SCALES, mid.x, mid.y)).toBe(30 / SCALES.altitude);
  });
  it('slices the runway: about 1,050 m of constant 3 world m', () => {
    const len = 1200;
    const n = 1201;
    const s = sliceAlong(g, SCALES, { x: rw.a.x - Math.sin(rw.heading) * 50, y: rw.a.y - Math.cos(rw.heading) * 50 }, rw.heading, len, n);
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (s.surface[i] === Terrain.runway) {
        count++;
        expect(s.heightWorldM[i]).toBeCloseTo(30 / SCALES.altitude, 5);
      }
    }
    expect(count).toBeGreaterThan(1048);
    expect(count).toBeLessThan(1053);
    expect(s.surface[0]).not.toBe(Terrain.runway);
    expect(s.surface[n - 1]).not.toBe(Terrain.runway);
  });
  it('span agrees with the slice samples to one column', () => {
    const heading = 160 * DEG;
    const origin = { x: mid.x - Math.sin(heading) * 150, y: mid.y - Math.cos(heading) * 150 };
    const span = runwaySpan(rw, origin, heading);
    expect(span).not.toBeNull();
    const n = 301;
    const s = sliceAlong(g, SCALES, origin, heading, 300, n);
    const cols = [...s.surface].map((c, i) => (c === Terrain.runway ? i : -1)).filter((i) => i >= 0);
    expect(cols.length).toBeGreaterThan(0);
    expect(Math.abs((cols[0] as number) - (span as { enter: number }).enter)).toBeLessThanOrEqual(1);
    expect(Math.abs((cols[cols.length - 1] as number) - (span as { exit: number }).exit)).toBeLessThanOrEqual(1);
  });
});

describe('blend', () => {
  // 40 x 40 cells at 10 m. Base ground 100 m real on the west half and 700 on the east, so the airport must blend.
  function uneven() {
    const g = createGrid(40, 40, 10);
    for (let r = 0; r < 40; r++) for (let c = 0; c < 40; c++) g.elevation[r * 40 + c] = c < 20 ? 100 : 700;
    for (let i = 0; i < g.terrain.length; i++) g.terrain[i] = Terrain.grass;
    const def = {
      ...TEST_AIRPORT_DEF,
      anchor: { x: 200, y: 200 },
      boundary: { minX: -300, minY: -300, maxX: 300, maxY: 300 },
      blend: 100,
      runways: [{ a: { x: -100, y: 0 }, b: { x: 100, y: 0 }, width: 30, names: ['09', '27'] as [string, string] }],
      paving: [],
    };
    return withAirports(g, [buildAirport(def)]);
  }
  const g = uneven();
  const a = g.airports[0]!;
  const base = (x: number, y: number) => groundAt({ ...g, airports: [] }, SCALES, x, y);
  it('equals the base at the boundary and the field inside', () => {
    expect(groundAt(g, SCALES, a.minX, 200)).toBeCloseTo(base(a.minX, 200), 9);
    expect(groundAt(g, SCALES, 200, 200)).toBeCloseTo(30 / SCALES.altitude, 9);
    expect(blendWeight(a, 200, 200)).toBe(1);
  });
  it('is monotonic into the interior with no jumps and no NaN', () => {
    let prev = groundAt(g, SCALES, a.minX - 0.5, 200);
    let worst = 0;
    for (let x = a.minX - 0.5; x <= 200; x += 0.25) {
      const h = groundAt(g, SCALES, x, 200);
      expect(Number.isNaN(h)).toBe(false);
      worst = Math.max(worst, Math.abs(h - prev));
      prev = h;
    }
    expect(worst).toBeLessThan(0.3);
    const h0 = groundAt(g, SCALES, a.minX, 200);
    const h1 = groundAt(g, SCALES, a.minX + a.blend / 2, 200);
    const h2 = groundAt(g, SCALES, a.minX + a.blend, 200);
    expect(h0).toBeGreaterThan(h1);
    expect(h1).toBeGreaterThan(h2);
  });
  it('has no jump across any edge', () => {
    for (const [x, y] of [[a.minX, 150], [a.maxX, 150], [150, a.minY], [150, a.maxY]] as const) {
      const inside = groundAt(g, SCALES, x + (x === a.minX ? 0.001 : x === a.maxX ? -0.001 : 0), y + (y === a.minY ? 0.001 : y === a.maxY ? -0.001 : 0));
      const outside = groundAt(g, SCALES, x + (x === a.minX ? -0.001 : x === a.maxX ? 0.001 : 0), y + (y === a.minY ? -0.001 : y === a.maxY ? 0.001 : 0));
      expect(Math.abs(inside - outside)).toBeLessThan(0.01);
    }
  });
});
