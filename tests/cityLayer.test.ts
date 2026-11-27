import { describe, expect, it } from 'vitest';
import { ROOF_COLORS } from '../src/config/palette';
import { FIXED_SUN, type Sun } from '../src/config/sun';
import type { MapBuilding } from '../src/sim/world/mapFile';
import { buildingLevel, buildingsByTile, hull, nextToPaint, reachBox, runWithin, roofColor, roofCorners, shadedHalf, shadowShape, visibleTiles, withinCoarse } from '../src/views/cityLayer';
import { sunForStep } from '../src/views/sunLight';

const b: MapBuilding = { x: 100, y: 100, width: 20, depth: 10, angle: 0, height: 20, style: 1 };
const from = (deg: number): Sun => ({ ...FIXED_SUN, azimuth: (deg * Math.PI) / 180 });
const mean = (v: number[]) => v.reduce((a, n) => a + n, 0) / v.length;

describe('building layer', () => {
  it('uses the nearest zoom level, and nothing past 10 m per pixel', () => {
    expect(buildingLevel(0.5)).toBe(0.5);
    expect(buildingLevel(3.2)).toBe(2.5);
    expect(buildingLevel(11)).toBe(10);
    expect(buildingLevel(20)).toBeNull();
    expect(buildingLevel(40)).toBeNull();
  });
  it('lays a roof with its width along the street heading', () => {
    const xs = roofCorners(b).map((p) => p[0]);
    const ys = roofCorners(b).map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(20, 6); // heading north
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10, 6);
  });
  it('casts a shadow northeast, longer for a taller building', () => {
    const east = (h: number) => Math.max(...shadowShape({ ...b, height: h }, FIXED_SUN).map((p) => p[0]));
    const north = Math.max(...shadowShape(b, FIXED_SUN).map((p) => p[1]));
    expect(east(20)).toBeGreaterThan(105);
    expect(north).toBeGreaterThan(110);
    expect(Math.min(...shadowShape(b, FIXED_SUN).map((p) => p[0]))).toBeCloseTo(95, 6);
    expect(east(80)).toBeGreaterThan(east(20));
    expect(hull([[0, 0], [2, 0], [2, 2], [0, 2], [1, 1]])).toHaveLength(4);
  });
  it('turns the shadow with the sun', () => {
    const xs = (deg: number) => shadowShape(b, from(deg)).map((p) => p[0]);
    expect(Math.max(...xs(270))).toBeCloseTo(115, 6);
    expect(Math.min(...xs(90))).toBeCloseTo(85, 6);
  });
  it('darkens the half of a pitched roof that faces away from the sun, whichever way the building is turned', () => {
    // Ridge north-south at angle 0 or 180: the halves face east and west.
    const x = (angle: number, deg: number) => mean(shadedHalf({ ...b, angle }, from(deg)).map((p) => p[0]));
    for (const angle of [0, 180]) {
      expect(x(angle, 270)).toBeGreaterThan(100);
      expect(x(angle, 90)).toBeLessThan(100);
    }
    // Ridge east-west: the halves face north and south.
    expect(mean(shadedHalf({ ...b, angle: 90 }, FIXED_SUN).map((p) => p[1]))).toBeGreaterThan(100);
  });
  it('gives one building one color from its style', () => {
    expect(roofColor(b)).toEqual(roofColor({ ...b }));
    expect(ROOF_COLORS[1]).toContainEqual(roofColor(b));
  });
  it('places a close tile inside the zoomed-out one that stands in for it', () => {
    expect(withinCoarse(7, 128, 640)).toEqual({ index: 1, offset: 256 });
    expect(withinCoarse(-1, 128, 640)).toEqual({ index: -1, offset: 512 });
  });
  it('finds the tiles on screen', () => {
    // A 100 x 100 px view whose top left is world (200, 900), at 2 m per pixel, on a 1000 m tall map.
    const f = { ox: -100, oy: -50, mpp: 2, mapHeight: 1000 };
    expect(visibleTiles(f, { left: 0, top: 0, right: 100, bottom: 100 }, 128)).toEqual({ i0: 1, i1: 3, j0: 5, j1: 7 });
  });
  it('covers the roof and the longest shadow the moving sun can cast: west, north and east, never south', () => {
    const box = reachBox(b);
    expect([box.minX, box.maxX, box.minY, box.maxY]).toEqual([65, 135, 90, 140].map((v) => expect.closeTo(v, 6)));
    for (let step = 0; step < 60; step++) {
      for (const [x, y] of shadowShape(b, sunForStep(step))) {
        expect(x).toBeGreaterThanOrEqual(box.minX - 1e-6);
        expect(x).toBeLessThanOrEqual(box.maxX + 1e-6);
        expect(y).toBeGreaterThanOrEqual(box.minY - 1e-6);
        expect(y).toBeLessThanOrEqual(box.maxY + 1e-6);
      }
    }
  });
  it('puts a building in every tile its roof or shadow can reach, lowest first', () => {
    const tall = { ...b, x: 125, height: 80 };
    const tiles = buildingsByTile([tall, b], 128);
    expect([...tiles.keys()].sort()).toEqual(['0,0', '0,1', '1,0', '1,1']);
    expect(tiles.get('0,0')!.map((x) => x.height)).toEqual([20, 80]);
  });
});

describe('repainting building tiles', () => {
  const now = from(180);
  const before = from(170);
  it('paints a missing tile before a stale one, and nothing when all are up to date', () => {
    const tiles = [{ id: 1, painted: now }, { id: 2, painted: before }, { id: 3, painted: null }];
    expect(nextToPaint(tiles, now)?.id).toBe(3);
    expect(nextToPaint(tiles.slice(0, 2), now)?.id).toBe(2);
    expect(nextToPaint(tiles.slice(0, 1), now)).toBeNull();
  });
  it('stops a job when its time is up, always doing at least one step', () => {
    let clock = 0;
    let done = 0;
    function* work() {
      for (let i = 0; i < 5; i++) {
        done++;
        clock += 4;
        yield;
      }
    }
    const job = work();
    expect(runWithin(job, 6, () => clock)).toBe(false);
    expect(done).toBe(2);
    expect(runWithin(job, -1, () => clock)).toBe(false);
    expect(done).toBe(3);
    expect(runWithin(job, 100, () => clock)).toBe(true);
    expect(done).toBe(5);
  });
});
