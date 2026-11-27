import { describe, expect, it } from 'vitest';
import placesJson from '../data/map/places.json';
import scalesJson from '../data/map/scales.json';
import waterJson from '../data/map/water.json';
import { boxPolygon, groundLocalKm, placeAll } from '../tools/map/place';
import { contains, convexHull } from '../src/sim/world/polygon';
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
const half = { w: dca.airport.boundaryKm.w / 2, h: dca.airport.boundaryKm.h / 2 };

describe('airport stamp field', () => {
  it('is exactly the stamp inside the boundary', () => {
    for (const [fx, fy] of [[0, 0], [0.9, -0.9], [-0.99, 0.99], [0.5, 0.2]] as const) {
      const x = dca.real.x + fx * half.w;
      const y = dca.real.y + fy * half.h;
      const w = pl.field.toWorld(x, y);
      expect(w.x).toBeCloseTo(dca.world.x + (x - dca.real.x) / stamp.scale, 9);
      expect(w.y).toBeCloseTo(dca.world.y + (y - dca.real.y) / stamp.scale, 9);
    }
  });
  it('maps the outline onto the placed outline', () => {
    stamp.outline.forEach((v, i) => {
      const w = pl.field.toWorld(dca.real.x + v.x, dca.real.y + v.y);
      expect(w.x).toBeCloseTo(dca.outline[i]!.x, 9);
      expect(w.y).toBeCloseTo(dca.outline[i]!.y, 9);
    });
  });
  it('is continuous across the boundary', () => {
    const y = dca.real.y + 0.3;
    const e = dca.real.x + half.w;
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
    const s: Stamp = { id: 'X', real: { x: 0, y: -5 }, outline: boxPolygon({ cx: 0, cy: 0, w: 1.2, h: 3 }), world: { x: 0, y: -2 }, scale: 2, fadeKm: 0.3 };
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

describe('polygon stamp (E7.3)', () => {
  it('gives a rectangle outline the values the box stamp gave', () => {
    const warp = makeWarp(25, 4, [{ id: 'c', x: 0, y: 0 }]);
    const s: Stamp = { id: 'X', real: { x: 1, y: -20 }, outline: boxPolygon({ cx: 0, cy: 0, w: 1.2, h: 3 }), world: { x: 0.3, y: -3 }, scale: 2, fadeKm: 2 };
    const f = makeField(warp, [s]);
    expect(f.stamps[0]!.fadeKm).toBeCloseTo(3.38, 9);
    // Real km from the stamp center, then world km, recorded from the box code: inside, beside sides, past corners.
    const before = [
      [0, 0, 0.3, -3.0],
      [0.5, -1.2, 0.55, -3.6],
      [1.4, 0.3, 0.6719280762, -2.8410616486],
      [-2.5, 0.7, -0.176639667, -2.5978578455],
      [0.2, 4, 0.4100026826, -2.1831156802],
      [-0.3, -6, 0.1421036309, -3.8528221317],
      [3, 5, 0.8107698573, -2.0439053961],
      [-4, 4, -0.3258739633, -1.7621416462],
      [-2, -3, -0.1176357536, -3.7774483532],
      [5, -8, 0.8796170662, -3.8405820073],
    ] as const;
    for (const [dx, dy, x, y] of before) {
      const w = f.toWorld(s.real.x + dx, s.real.y + dy);
      expect(w.x).toBeCloseTo(x, 9);
      expect(w.y).toBeCloseTo(y, 9);
    }
  });

  // DCA stamped by the hull of its ground: slanted sides and many corners.
  const hull = convexHull(groundLocalKm(dca.airport).flat());
  const field = makeField(pl.warp, [{ id: 'hull', real: dca.real, outline: hull, world: dca.world, scale: dca.scale, fadeKm: 2 }]);
  const real = (x: number, y: number) => ({ x: dca.real.x + x, y: dca.real.y + y });

  it('is exact inside a many-sided hull', () => {
    expect(hull.length).toBeGreaterThan(4);
    let tried = 0;
    for (let x = -0.5; x <= 0.5; x += 0.05) {
      for (let y = -1.5; y <= 1.2; y += 0.1) {
        if (!contains(hull, x, y)) continue;
        tried++;
        const p = real(x, y);
        const w = field.toWorld(p.x, p.y);
        expect(w.x).toBeCloseTo(dca.world.x + x / dca.scale, 9);
        expect(w.y).toBeCloseTo(dca.world.y + y / dca.scale, 9);
      }
    }
    expect(tried).toBeGreaterThan(50);
  });
  it('is continuous across every side and corner', () => {
    hull.forEach((a, i) => {
      const b = hull[(i + 1) % hull.length]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const out = { x: (b.y - a.y) / len, y: (a.x - b.x) / len };
      for (const t of [0, 0.37, 1]) {
        // On the outline and at several distances off it, a step of 1e-7 km moves the map no farther than that allows.
        for (const off of [0, 0.5, 2]) {
          const at = real(a.x + (b.x - a.x) * t + out.x * off, a.y + (b.y - a.y) * t + out.y * off);
          const w = field.toWorld(at.x, at.y);
          for (const [dx, dy] of [[1e-7, 0], [-1e-7, 0], [0, 1e-7], [0, -1e-7]] as const) {
            const n = field.toWorld(at.x + dx, at.y + dy);
            expect(Math.hypot(n.x - w.x, n.y - w.y)).toBeLessThan(1e-6);
          }
        }
      }
    });
  });
  it('never folds around a hull: every real point within 8 km round trips', () => {
    let worst = 0;
    for (let i = -20; i <= 20; i++) {
      for (let j = -20; j <= 20; j++) {
        const p = real(i * 0.4, j * 0.4);
        const w = field.toWorld(p.x, p.y);
        const back = field.toReal(w.x, w.y);
        worst = Math.max(worst, Math.hypot(back.x - p.x, back.y - p.y));
      }
    }
    expect(worst * 1000).toBeLessThan(1);
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
