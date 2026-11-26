import { describe, expect, it } from 'vitest';
import placesJson from '../data/map/places.json';
import scalesJson from '../data/map/scales.json';
import waterJson from '../data/map/water.json';
import { placeAll } from '../tools/map/place';
import { project } from '../tools/map/project';
import { pointInRing, strokeAuthored } from '../tools/map/skeleton';
import { makeField, type Stamp } from '../tools/map/stamp';
import type { AuthoredRiver } from '../tools/map/types';
import { MapDataError, validatePlaces, validateScales, validateWater } from '../tools/map/validate';
import { makeWarp } from '../tools/map/warp';

const sf = validateScales(scalesJson);
const places = validatePlaces(placesJson);
const pl = placeAll(sf.scales, sf.box, sf.warp, places);
const dca = pl.airports.find((a) => a.airport.id === 'DCA')!;
const stamp = pl.field.stamps.find((s) => s.id === 'DCA')!;

describe('airport stamp field', () => {
  it('is exactly the stamp inside the boundary', () => {
    for (const [fx, fy] of [[0, 0], [0.9, -0.9], [-0.99, 0.99], [0.5, 0.2]] as const) {
      const x = dca.real.x + fx * stamp.halfW;
      const y = dca.real.y + fy * stamp.halfH;
      const w = pl.field.toWorld(x, y);
      expect(w.x).toBeCloseTo(dca.world.x + (x - dca.real.x) / stamp.scale, 9);
      expect(w.y).toBeCloseTo(dca.world.y + (y - dca.real.y) / stamp.scale, 9);
    }
  });
  it('maps the boundary onto the placed boundary box', () => {
    const ne = pl.field.toWorld(dca.real.x + stamp.halfW, dca.real.y + stamp.halfH);
    expect(ne.x).toBeCloseTo(dca.boundary.cx + dca.boundary.w / 2, 9);
    expect(ne.y).toBeCloseTo(dca.boundary.cy + dca.boundary.h / 2, 9);
  });
  it('is continuous across the boundary', () => {
    const y = dca.real.y + 0.3;
    const e = dca.real.x + stamp.halfW;
    const a = pl.field.toWorld(e - 1e-7, y);
    const b = pl.field.toWorld(e + 1e-7, y);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-6);
  });
  it('leaves the plain warp alone far away', () => {
    const p = project(39.5, -77.5);
    expect(pl.field.toWorld(p.x, p.y)).toEqual(pl.warp.toWorld(p.x, p.y));
  });
  it('moves the Philadelphia city center by under 0.2 km world (PHL stamp fade reaches it)', () => {
    const phl = pl.cities.find((c) => c.city.id === 'phl-city')!;
    const a = pl.field.toWorld(phl.real.x, phl.real.y);
    const b = pl.warp.toWorld(phl.real.x, phl.real.y);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.2);
  });
  it('round trips through toReal near the stamp', () => {
    for (const [dx, dy] of [[0, 0], [1.5, 0.4], [-2, -3], [0.4, 2.5], [3, -1], [-0.7, 1.6]] as const) {
      const p = { x: dca.real.x + dx, y: dca.real.y + dy };
      const w = pl.field.toWorld(p.x, p.y);
      const back = pl.field.toReal(w.x, w.y);
      expect(Math.hypot(back.x - p.x, back.y - p.y) * 1000).toBeLessThan(1); // under 1 real m
    }
  });
  it('never folds the land: every real point within 8 km round trips', () => {
    let worst = 0;
    for (let i = -20; i <= 20; i++) {
      for (let j = -20; j <= 20; j++) {
        const p = { x: dca.real.x + i * 0.4, y: dca.real.y + j * 0.4 };
        const w = pl.field.toWorld(p.x, p.y);
        const back = pl.field.toReal(w.x, w.y);
        worst = Math.max(worst, Math.hypot(back.x - p.x, back.y - p.y));
      }
    }
    expect(worst * 1000).toBeLessThan(1);
  });
  it('lengthens a fade that would fold, and says so', () => {
    const warp = makeWarp(25, 4, [{ id: 'c', x: 0, y: 0 }]);
    const s: Stamp = { id: 'X', real: { x: 0, y: -5 }, halfW: 0.6, halfH: 1.5, world: { x: 0, y: -2 }, scale: 2, fadeKm: 0.3 };
    const f = makeField(warp, [s]);
    expect(f.stamps[0]!.fadeKm).toBeGreaterThan(0.3);
  });
  it('is the plain warp without stamps', () => {
    const warp = makeWarp(25, 4, [{ id: 'c', x: 0, y: 0 }]);
    const f = makeField(warp, []);
    expect(f.toWorld(3, 4)).toEqual(warp.toWorld(3, 4));
    expect(f.toReal(0.5, 0.2)).toEqual(warp.toReal(0.5, 0.2));
  });
});

describe('authored water', () => {
  it('validates the data file', () => {
    const w = validateWater(waterJson);
    expect(w.regions.map((r) => r.id)).toEqual(['dc', 'philadelphia', 'lower-delaware']);
    expect(w.rivers.map((r) => r.id)).toContain('anacostia');
  });
  it('gives named errors', () => {
    expect(() => validateWater({ ...waterJson, minWidthM: 0 })).toThrow(MapDataError);
    const bad = { ...waterJson, rivers: [{ id: 'x', tidal: true, points: [[-77, 38.9, 100], [-77, 38.8]] }] };
    expect(() => validateWater(bad)).toThrow(/river x/);
    const noTide = { ...waterJson, rivers: [{ id: 'y', points: [[-77, 38.9, 100], [-77, 38.8, 100]] }] };
    expect(() => validateWater(noTide)).toThrow(/tidal/);
    const dup = { ...waterJson, rivers: [...waterJson.rivers, waterJson.rivers[0]] };
    expect(() => validateWater(dup)).toThrow(/duplicate/);
  });
  it('tests points against a ring', () => {
    const sq = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
    expect(pointInRing(1, 1, sq)).toBe(true);
    expect(pointInRing(3, 1, sq)).toBe(false);
  });
  it('draws a river at its real width scaled to the place, with a minimum', () => {
    // Plain 1:10 field, no cities: a 500 m river is 50 m world, 5 cells of 10 m.
    const warp = makeWarp(10, 4, []);
    const field = makeField(warp, []);
    const o = project(39, -77);
    const river = (widthM: number): AuthoredRiver => ({ id: 'r', tidal: true, points: [[-77, 38.99, widthM], [-77, 39.01, widthM]] });
    const across = (widthM: number, minHalfCells: number): number => {
      const cols = 40;
      const rows = 40;
      const cellKm = 0.01;
      const hit = new Uint8Array(cols * rows);
      strokeAuthored(river(widthM), field, 0.5, minHalfCells, { left: o.x / 10 - 0.2, bottom: o.y / 10 - 0.2, cellKm, cols, rows }, (i) => (hit[i] = 1));
      let n = 0;
      for (let c = 0; c < cols; c++) n += hit[20 * cols + c] as number;
      return n;
    };
    expect(across(500, 0)).toBeGreaterThanOrEqual(4);
    expect(across(500, 0)).toBeLessThanOrEqual(6);
    expect(across(50, 2)).toBeGreaterThanOrEqual(4); // 5 m world, widened to 2 cells each side
  });
});
