import { describe, expect, it } from 'vitest';
import { FIXED_SUN, type Sun } from '../src/config/sun';
import type { LandmarkSolid } from '../src/sim/world/mapFile';
import { faceLight } from '../src/views/sunLight';
import { paintOrder, roundLight, sideFaces, silhouette, farthestFirst, inSlice } from '../src/views/sideLandmarks';

const s: LandmarkSolid = { x: 0, y: 100, width: 10, depth: 4, topWidth: 6, topDepth: 2, bottom: 0, top: 40, material: 'marble-upper' };
const from = (deg: number): Sun => ({ ...FIXED_SUN, azimuth: (deg * Math.PI) / 180 });

describe('landmark outline from the side', () => {
  it('takes the extent across the line of flight, at bottom and top', () => {
    const north = silhouette(s, 0, 0, 0);
    expect(north.base).toEqual([98, 102]);
    expect(north.top).toEqual([99, 101]);
    const east = silhouette(s, -50, 100, Math.PI / 2);
    expect(east.base[0]).toBeCloseTo(45, 6);
    expect(east.base[1]).toBeCloseTo(55, 6);
  });
  it('says how far to the left of the line it is', () => {
    expect(silhouette(s, 30, 0, 0).left).toBeCloseTo(30, 6);
    expect(silhouette(s, -30, 0, 0).left).toBeCloseTo(-30, 6);
  });
});

describe('landmark faces from the side', () => {
  const square: LandmarkSolid = { ...s, x: 0, y: 0, width: 10, depth: 10, topWidth: 6, topDepth: 6 };
  const deg = (d: number) => (d * Math.PI) / 180;
  it('shows one face square on, and a different one from each side', () => {
    // Heading east looks north, at the south face; and so on round.
    // A sun off the diagonals, so no two faces are lit alike.
    const lights = [90, 0, 270, 180].map((h) => sideFaces(square, 0, 0, deg(h), from(200)));
    for (const faces of lights) expect(faces).toHaveLength(1);
    expect(new Set(lights.map((f) => f[0]!.light)).size).toBe(4);
    expect(lights[0]![0]!.base).toEqual([-5, 5].map((v) => expect.closeTo(v, 6)));
    expect(lights[0]![0]!.top).toEqual([-3, 3].map((v) => expect.closeTo(v, 6)));
  });
  it('shows two faces at an angle, meeting at the corner, which moves with the heading', () => {
    const at = (h: number) => sideFaces(square, 0, 0, deg(h), FIXED_SUN).sort((a, b) => a.base[0] - b.base[0]);
    for (const h of [20, 45, 70]) {
      const [left, right] = at(h);
      expect(at(h)).toHaveLength(2);
      expect(left!.base[1]).toBeCloseTo(right!.base[0], 6);
    }
    const corner = (h: number) => at(h)[0]!.base[1];
    expect(corner(45)).toBeCloseTo(0, 6);
    expect(Math.abs(corner(20) - corner(70))).toBeGreaterThan(5);
  });
});

describe('round walls and painting order', () => {
  it('lights a round wall from the southwest, whichever way you look', () => {
    // Heading east looks north: west is on screen left. Heading west looks south: west is on screen right.
    expect(roundLight(-0.8, Math.PI / 2, FIXED_SUN)).toBeGreaterThan(roundLight(0.8, Math.PI / 2, FIXED_SUN));
    expect(roundLight(0.8, (3 * Math.PI) / 2, FIXED_SUN)).toBeGreaterThan(roundLight(-0.8, (3 * Math.PI) / 2, FIXED_SUN));
    // And from the other side with the sun in the east.
    expect(roundLight(0.8, Math.PI / 2, from(90))).toBeGreaterThan(roundLight(-0.8, Math.PI / 2, from(90)));
  });
  it('is as wide from every side', () => {
    const drum: LandmarkSolid = { ...s, width: 10, depth: 10, shape: 'drum' };
    const at = silhouette(drum, 0, 0, Math.PI / 4);
    expect(at.base[1] - at.base[0]).toBeCloseTo(10, 6);
  });
  it('paints standing solids farthest first, then what is on top from the bottom up', () => {
    const item = (bottom: number, left: number) => ({ s: { ...s, bottom }, left });
    const order = paintOrder([item(30, 0), item(0, -5), item(20, 9), item(0, 5)]).map((i) => [i.s.bottom, i.left]);
    expect(order).toEqual([[0, 5], [0, -5], [20, 9], [30, 0]]);
  });
});

describe('angled walls from the side', () => {
  it('lights an angled wall by the way it faces', () => {
    // A triangle whose one wall seen heading east (looking north) faces southeast.
    const wedge: LandmarkSolid = { ...s, shape: 'prism', points: [0, 0, 10, 10, 0, 10] };
    const walls = sideFaces(wedge, 0, 0, Math.PI / 2, from(180));
    expect(walls).toHaveLength(1);
    const lit = walls[0]!.light;
    expect(lit).toBeCloseTo(faceLight(from(180), Math.SQRT1_2, -Math.SQRT1_2), 6);
    expect(lit).toBeGreaterThan(faceLight(from(180), 1, 0));
    expect(lit).toBeLessThan(faceLight(from(180), 0, -1));
  });
  it('shows only the walls of a prism turned toward the viewer', () => {
    const square: LandmarkSolid = { ...s, x: 5, y: 5, width: 10, depth: 10, shape: 'prism', points: [0, 0, 10, 0, 10, 10, 0, 10] };
    expect(sideFaces(square, 0, 0, Math.PI / 2, FIXED_SUN)).toHaveLength(1);
    expect(sideFaces(square, 0, 0, Math.PI / 4, FIXED_SUN)).toHaveLength(2);
    expect(silhouette(square, 0, 0, Math.PI / 2).base[0]).toBeCloseTo(0, 6);
    expect(silhouette(square, 0, 0, Math.PI / 2).base[1]).toBeCloseTo(10, 6);
  });
});

describe('order between landmarks', () => {
  it('paints the one farthest to the left of the line first', () => {
    // Heading east, left is north.
    const w = { origin: { x: 0, y: 0 }, heading: Math.PI / 2 };
    const near = { x: 50, y: 10 };
    const far = { x: 0, y: 90 };
    expect(farthestFirst([near, far], w)).toEqual([far, near]);
    expect(farthestFirst([near, far], { ...w, heading: -Math.PI / 2 })).toEqual([near, far]);
  });
});

describe('which landmarks can show from the side', () => {
  it('takes one reaching into the slice and leaves one ahead, behind or far off the line', () => {
    // Heading east: along is east, left is north.
    const w = { origin: { x: 0, y: 0 }, heading: Math.PI / 2 };
    const at = (x: number, y: number) => inSlice({ x, y, radius: 10 }, w, 500, -60, 200);
    expect(at(250, 0)).toBe(true);
    expect(at(505, 205)).toBe(true);
    expect(at(520, 0)).toBe(false);
    expect(at(-20, 0)).toBe(false);
    expect(at(250, 220)).toBe(false);
    expect(at(250, -80)).toBe(false);
  });
});
