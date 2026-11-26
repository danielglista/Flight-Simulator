import { describe, expect, it } from 'vitest';
import { ROOF_COLORS } from '../src/config/palette';
import type { MapBuilding } from '../src/sim/world/mapFile';
import { buildingLevel, buildingsByTile, hull, roofColor, roofCorners, shadowShape, visibleTiles, withinCoarse } from '../src/views/cityLayer';

const b: MapBuilding = { x: 100, y: 100, width: 20, depth: 10, angle: 0, height: 20, style: 1 };

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
  it('casts a shadow southeast, longer for a taller building', () => {
    const east = (h: number) => Math.max(...shadowShape({ ...b, height: h }).map((p) => p[0]));
    const south = Math.min(...shadowShape(b).map((p) => p[1]));
    expect(east(20)).toBeGreaterThan(105);
    expect(south).toBeLessThan(90);
    expect(east(80)).toBeGreaterThan(east(20));
    expect(hull([[0, 0], [2, 0], [2, 2], [0, 2], [1, 1]])).toHaveLength(4);
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
  it('puts a building in every tile its roof or shadow reaches, lowest first', () => {
    const tall = { ...b, x: 125, height: 80 };
    const tiles = buildingsByTile([tall, b], 128);
    expect([...tiles.keys()].sort()).toEqual(['0,0', '1,0']);
    expect(tiles.get('0,0')!.map((x) => x.height)).toEqual([20, 80]);
  });
});
