import { describe, expect, it } from 'vitest';
import { fillRings, strokePolyline } from '../tools/map/fill';
import { runGuardrails } from '../tools/map/guard';
import { applyReliefRules, boxBlur } from '../tools/map/mountains';
import { boundsOf, placeAll } from '../tools/map/place';
import { project, unproject } from '../tools/map/project';
import { buildSkeleton, DEFAULT_TERRAIN, valueNoise, type PolygonGeo } from '../tools/map/skeleton';
import { decodeFloatPredictorTile, sampleElevation, type ElevationGrid } from '../tools/map/tiff';
import type { MapScales, PlacesFile } from '../tools/map/types';
import { DEFAULT_SHAPE } from '../tools/map/warp';
import { Terrain } from '../src/sim/world/terrain';

describe('fillRings', () => {
  const collect = (rings: [number, number][][], cols = 10, rows = 10) => {
    const hit: number[] = [];
    fillRings(rings, cols, rows, (i) => hit.push(i));
    return hit;
  };
  it('fills cells whose centers are inside', () => {
    const hit = collect([[[2, 2], [5, 2], [5, 4], [2, 4]]]);
    expect(hit).toHaveLength(6);
    expect(hit).toContain(2 * 10 + 2);
    expect(hit).toContain(3 * 10 + 4);
  });
  it('leaves holes empty', () => {
    const hit = collect([[[0, 0], [10, 0], [10, 10], [0, 10]], [[3, 3], [7, 3], [7, 7], [3, 7]]]);
    expect(hit).toHaveLength(100 - 16);
  });
  it('clips shapes that extend past the grid', () => {
    expect(collect([[[-50, -50], [50, -50], [50, 50], [-50, 50]]])).toHaveLength(100);
  });
});

describe('strokePolyline', () => {
  it('draws a line of the requested width', () => {
    const hit = new Set<number>();
    strokePolyline([[1, 5], [9, 5]], 3, 10, 10, (i) => hit.add(i));
    expect(hit.size).toBeGreaterThanOrEqual(8 * 3 - 4);
    expect(hit.has(5 * 10 + 5)).toBe(true);
    expect(hit.has(0)).toBe(false);
  });
});

describe('float predictor decoding', () => {
  it('decodes what the encoder wrote', () => {
    const w = 4;
    const values = [1.5, -20.25, 300, 0];
    const bytes = new Uint8Array(w * 4);
    const dv = new DataView(new ArrayBuffer(4));
    values.forEach((v, x) => {
      dv.setFloat32(0, v, false);
      for (let b = 0; b < 4; b++) bytes[b * w + x] = dv.getUint8(b);
    });
    const enc = new Uint8Array(bytes.length);
    enc[0] = bytes[0] as number;
    for (let i = 1; i < bytes.length; i++) enc[i] = ((bytes[i] as number) - (bytes[i - 1] as number)) & 0xff;
    expect(Array.from(decodeFloatPredictorTile(enc, w, 1))).toEqual(values);
  });
  it('rejects short data', () => {
    expect(() => decodeFloatPredictorTile(new Uint8Array(3), 4, 1)).toThrow();
  });
});

describe('sampleElevation', () => {
  const g: ElevationGrid = { cols: 2, rows: 2, data: new Float32Array([0, 10, 20, 30]), west: 0, north: 2, step: 1 };
  it('is exact at sample centers and linear between', () => {
    expect(sampleElevation(g, 1.5, 0.5)).toBeCloseTo(0, 9);
    expect(sampleElevation(g, 0.5, 1.5)).toBeCloseTo(30, 9);
    expect(sampleElevation(g, 1, 1)).toBeCloseTo(15, 9);
  });
});

describe('mountain rules', () => {
  const cols = 41;
  const rows = 41;
  const ridge = () => {
    const e = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) e[r * cols + 20] = 300;
    return e;
  };
  it('box blur keeps the total height', () => {
    const e = ridge();
    const b = boxBlur(e, cols, rows, 3);
    expect(b.reduce((s, v) => s + v, 0)).toBeCloseTo(e.reduce((s, v) => s + v, 0), 0);
    expect(Math.max(...b)).toBeLessThan(300);
  });
  it('widening spreads a ridge and compression shrinks it', () => {
    const e = ridge();
    applyReliefRules(e, cols, rows, { compress: 1, baseRadiusCells: 5, widenRadiusCells: 3 });
    expect((e[20 * cols + 24] as number) > 0).toBe(true);
    const f = ridge();
    applyReliefRules(f, cols, rows, { compress: 0.5, baseRadiusCells: 10, widenRadiusCells: 0 });
    expect(f[20 * cols + 20]).toBeLessThan(300);
    expect(f[20 * cols + 20]).toBeGreaterThan(100);
  });
  it('leaves things alone at the default settings', () => {
    const e = ridge();
    applyReliefRules(e, cols, rows, { compress: 1, baseRadiusCells: 5, widenRadiusCells: 0 });
    expect(e[20 * cols + 20]).toBe(300);
  });
});

describe('valueNoise', () => {
  it('is deterministic, bounded and varies', () => {
    expect(valueNoise(10, 20, 50, 1)).toBe(valueNoise(10, 20, 50, 1));
    const vals = Array.from({ length: 200 }, (_, i) => valueNoise(i * 13, i * 7, 50, 1));
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...vals)).toBeLessThanOrEqual(1);
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(0.2);
  });
});

// A small synthetic world: one city and one airport on land, sea to the east, a river and a hill.
describe('skeleton and guardrails', () => {
  const scales: MapScales = { geoDistance: 25, airportMajor: 1.5, airportSmall: 2, cityCore: 4, altitude: 5, buildingHeight: 3 };
  const box = { south: 38.5, north: 39.3, west: -77.4, east: -76.4 };
  /** A box of real km about the airport at 38.85, -77, as a ground polygon. */
  const ground = (w: number, h: number): [number, number][] => {
    const c = project(38.85, -77.0);
    return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([i, j]) => {
      const ll = unproject(c.x + (i * w) / 2, c.y + (j * h) / 2);
      return [ll.lon, ll.lat];
    });
  };
  const places: PlacesFile = {
    cities: [{ id: 'c', name: 'Town', lat: 38.9, lon: -77.0, coreKm: { w: 8, h: 6 } }],
    airports: [{ id: 'AAA', name: 'Field', cityId: 'c', lat: 38.85, lon: -77.0, size: 'major', boundaryKm: { w: 2, h: 2.5 }, runwayHeadingDeg: 90, ground: [ground(2, 2.5)] }],
  };
  const placement = placeAll(scales, box, DEFAULT_SHAPE, places);
  const land: PolygonGeo[] = [{ rings: [[[-78, 38], [-76.7, 38], [-76.7, 40], [-78, 40]]] }];
  const river = { name: 'Test', major: true, line: [[-77.2, 38.4], [-77.2, 39.4]] as [number, number][] };
  const hill = (lat: number, lon: number) => (Math.hypot(lat - 39.1, lon + 77.3) < 0.05 ? 400 : 20);
  const build = (airportWet = false) => {
    // A lake over the airport tests that the boundary is carved dry.
    const lake: PolygonGeo[] = airportWet ? [{ rings: [[[-77.1, 38.7], [-76.9, 38.7], [-76.9, 39], [-77.1, 39]]] }] : [];
    return buildSkeleton({ placement, box, land, lakes: lake, rivers: [river], elevationAt: hill });
  };

  it('is deterministic', () => {
    const a = build();
    const b = build();
    expect(a.grid.elevation).toEqual(b.grid.elevation);
    expect(a.grid.terrain).toEqual(b.grid.terrain);
  });
  it('makes sea where there is no land, and land at least landMin high', () => {
    const sk = build();
    const { cols, rows, elevation } = sk.grid;
    const east = (rows >> 1) * cols + cols - 2;
    expect(sk.land[east]).toBe(0);
    expect(elevation[east] as number).toBeLessThanOrEqual(DEFAULT_TERRAIN.seaFloorMaxM);
    expect(elevation[(rows >> 1) * cols + 5] as number).toBeGreaterThanOrEqual(DEFAULT_TERRAIN.landMinM);
  });
  it('puts a river on the map, with water over carved ground', () => {
    const sk = build();
    let wet = 0;
    for (let i = 0; i < sk.grid.water.length; i++) if ((sk.grid.water[i] as number) > 0) wet++;
    expect(wet).toBeGreaterThan(200);
  });
  it('keeps the airport dry and flat even under a lake', () => {
    const sk = build(true);
    const results = runGuardrails(sk, placement, 5, []);
    const dry = results.find((r) => r.name === 'AAA dry');
    const flat = results.find((r) => r.name === 'AAA flat');
    expect(dry?.level).toBe('ok');
    expect(flat?.level).toBe('ok');
  });
  it('levels only the ground, so water can run past a runway', () => {
    const fp = { ...places, airports: [{ ...places.airports[0]!, elevationM: 7, ground: [ground(0.2, 1.2)] }] };
    const pl = placeAll(scales, box, DEFAULT_SHAPE, fp);
    const lake: PolygonGeo[] = [{ rings: [[[-77.1, 38.7], [-76.9, 38.7], [-76.9, 39], [-77.1, 39]]] }];
    const sk = buildSkeleton({ placement: pl, box, land, lakes: lake, rivers: [], elevationAt: hill });
    const f = sk.flattened[0]!;
    const onGround = new Set(f.cells);
    expect(f.elevationM).toBe(7);
    let wetOutside = 0;
    const b = boundsOf(pl.airports[0]!.outline);
    const c0 = Math.floor((b.cx - b.w / 2 - sk.originKm.x) / 0.01);
    const c1 = Math.floor((b.cx + b.w / 2 - sk.originKm.x) / 0.01);
    const r0 = Math.floor((b.cy - b.h / 2 - sk.originKm.y) / 0.01);
    const r1 = Math.floor((b.cy + b.h / 2 - sk.originKm.y) / 0.01);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (!onGround.has(r * sk.grid.cols + c) && (sk.grid.water[r * sk.grid.cols + c] as number) > 0) wetOutside++;
    expect(wetOutside).toBeGreaterThan(0);
    for (const i of f.cells) {
      expect(sk.grid.water[i]).toBe(0);
      expect(sk.grid.elevation[i]).toBe(7);
    }
    expect(runGuardrails(sk, pl, 5, []).find((r) => r.name === 'AAA dry')?.level).toBe('ok');
  });
  it('reports failed expectations by name', () => {
    const sk = build();
    const results = runGuardrails(sk, placement, 5, [
      { id: 'sea-is-land', lat: 38.9, lon: -76.45, expect: 'land' },
      { id: 'hill-too-low', lat: 39.1, lon: -77.3, expect: 'land', minElevationM: 900 },
    ]);
    expect(results.find((r) => r.name === 'check sea-is-land')?.level).toBe('fail');
    expect(results.find((r) => r.name === 'check hill-too-low')?.level).toBe('fail');
  });
  it('fails a peak above the limit', () => {
    const sk = buildSkeleton({ placement, box, land, lakes: [], rivers: [], elevationAt: () => 6000 });
    const results = runGuardrails(sk, placement, 5, []);
    expect(results.find((r) => r.name === 'peak')?.level).toBe('fail');
  });
  it('colors the ground by height', () => {
    const sk = buildSkeleton({ placement, box, land, lakes: [], rivers: [], elevationAt: hill });
    const terr = new Set(sk.grid.terrain);
    expect(terr.has(Terrain.seabed)).toBe(true);
    expect(terr.has(Terrain.forest) || terr.has(Terrain.mountain)).toBe(true);
  });
});
