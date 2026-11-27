import { describe, expect, it } from 'vitest';
import {
  BUILDING_LAYOUT,
  createRoadDistance,
  footprintPoints,
  footprintsOverlap,
  generateBuildings,
  type BuildingInput,
} from '../tools/map/buildings';
import { DENSITIES, type Density, type District } from '../tools/map/types';
import { validateDistricts } from '../tools/map/validate';
import districtsJson from '../data/map/districts.json';
import { Terrain } from '../src/sim/world/terrain';

const district: District = { id: 'd', cityId: 'dc', type: 'downtown', ring: [] };
const square: [number, number][] = [[0, 0], [1000, 0], [1000, 1000], [0, 1000]];
const base: BuildingInput = {
  districts: [district],
  styles: { downtown: { coverage: 0.3, footprintM: [20, 30], nudge: 1, heightM: [30, 60], heightSkew: 1, streetDeg: 0 } },
  ringWorld: () => square,
  code: () => Terrain.downtown,
  ground: () => 0,
  roadDistance: () => Infinity,
  heightScale: 3,
  seed: 1,
};
const cover = (input: BuildingInput) => generateBuildings(input).buildings.reduce((n, b) => n + b.width * b.depth, 0) / 1e6;

describe('building generator', () => {
  it('is the same every time and fills to about the district coverage', () => {
    expect(generateBuildings(base)).toEqual(generateBuildings(base));
    expect(cover(base)).toBeGreaterThan(0.24);
    expect(cover(base)).toBeLessThan(0.36);
    const { buildings } = generateBuildings(base);
    for (const b of buildings) {
      expect(b.height).toBeGreaterThanOrEqual(10);
      expect(b.height).toBeLessThanOrEqual(20);
    }
  });
  it('never overlaps two buildings, even at a street angle', () => {
    const { buildings } = generateBuildings({ ...base, styles: { downtown: { coverage: 0.6, footprintM: [20, 30], nudge: 1, heightM: [30, 60], heightSkew: 1, streetDeg: 9 } } });
    for (let i = 0; i < buildings.length; i++) {
      for (let j = i + 1; j < buildings.length; j++) expect(footprintsOverlap(buildings[i]!, buildings[j]!)).toBe(false);
    }
  });
  it('keeps the whole footprint on its own ground and off the highways', () => {
    const roadDistance = createRoadDistance([{ kind: 'major', bridge: false, points: [0, 500, 1000, 500] }], { major: 8, minor: 5 });
    const input = { ...base, code: (x: number) => (x < 400 ? Terrain.downtown : Terrain.park), roadDistance };
    const { buildings } = generateBuildings(input);
    expect(buildings.length).toBeGreaterThan(0);
    for (const b of buildings) {
      for (const [x, y] of footprintPoints(b)) {
        expect(x).toBeLessThan(400);
        expect(Math.abs(y - 500)).toBeGreaterThanOrEqual(8 + BUILDING_LAYOUT.roadGapM);
      }
    }
  });
  it('lets a district override its type', () => {
    const tall = { ...district, style: { heightM: [300, 300] as [number, number] } };
    expect(generateBuildings({ ...base, districts: [tall] }).buildings.every((b) => b.height === 100)).toBe(true);
  });
  it('builds nothing for a type without settings', () => {
    expect(generateBuildings({ ...base, districts: [{ ...district, type: 'park' }] }).buildings).toEqual([]);
  });
});

describe('housing density', () => {
  const { types } = validateDistricts(districtsJson, ['dc', 'phl-city']);
  const level = (id: string, density: Density, ring: [number, number][] = []): District => ({ id, cityId: 'dc', type: 'housing', density, ring });
  const housing = (density: Density): BuildingInput => ({ ...base, districts: [level('h', density)], styles: types, code: () => (density >= 4 ? Terrain.residential : Terrain.suburb) });

  it('covers more ground at each step up, about as planned', () => {
    const planned = [0.04, 0.12, 0.21, 0.33, 0.44];
    DENSITIES.forEach((d, i) => expect(Math.abs(cover(housing(d)) / (planned[i] as number) - 1)).toBeLessThan(0.15));
  });
  it('stores the residential style for 4 and 5 and the suburb one below', () => {
    expect(DENSITIES.map((d) => generateBuildings(housing(d)).buildings[0]?.style)).toEqual([2, 2, 2, 1, 1]);
  });
  it('puts buildings in straight rows when the nudge is 0', () => {
    const { buildings } = generateBuildings(housing(5));
    // Heading north: four side by side across a block, each at one exact x, 11 m apart, then a street.
    const rows = [...new Set(buildings.map((b) => b.x))].sort((a, b) => a - b);
    expect(rows.slice(0, 5).map((x) => x - (rows[0] as number))).toEqual([0, 11, 22, 33, 54]);
    for (const b of buildings) {
      expect(b.width).toBeGreaterThanOrEqual(14);
      expect(b.depth).toBeLessThanOrEqual(10);
    }
  });
  it('leaves a later district its own ground, even one of the same color', () => {
    const wide = level('wide', 2, square);
    const inner = level('inner', 3, [[300, 300], [700, 300], [700, 700], [300, 700]]);
    const input: BuildingInput = { ...housing(2), districts: [wide, inner], ringWorld: (d) => d.ring as [number, number][] };
    const alone = generateBuildings({ ...input, districts: [inner] }).buildings;
    const inside = generateBuildings(input).buildings.filter((b) => footprintPoints(b).some(([x, y]) => x > 300 && x < 700 && y > 300 && y < 700));
    expect(inside.length).toBe(alone.length);
    expect(inside).toEqual(alone);
  });
});
