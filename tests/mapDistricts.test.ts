import { describe, expect, it } from 'vitest';
import districtsJson from '../data/map/districts.json';
import placesJson from '../data/map/places.json';
import { districtCode, districtStyleIndex, paintDistricts } from '../tools/map/districts';
import { DISTRICT_TYPES, type District, type LonLatPoint } from '../tools/map/types';
import { MapDataError, validateDistricts, validatePlaces } from '../tools/map/validate';
import { Terrain } from '../src/sim/world/terrain';

const cityIds = validatePlaces(placesJson).cities.map((c) => c.id);

describe('district data', () => {
  it('is valid, and every city has every type of district', () => {
    const { districts } = validateDistricts(districtsJson, cityIds);
    for (const id of cityIds) {
      const types = new Set(districts.filter((d) => d.cityId === id).map((d) => d.type));
      expect([...types].sort()).toEqual([...DISTRICT_TYPES].sort());
    }
  });
  it('names the bad entry', () => {
    const ring = [[0, 0], [1, 0], [1, 1]];
    const one = (d: object) => () => validateDistricts({ districts: [{ id: 'x', cityId: 'dc', type: 'park', ring, ...d }] }, cityIds);
    expect(one({ type: 'downtown', style: { coverage: 2 } })).toThrow(/coverage/);
    expect(one({ type: 'downtown', style: { heightM: [40, 10] } })).toThrow(/heightM/);
    expect(one({ style: { hieght: 1 } })).toThrow(/unknown building setting/);
    expect(() => validateDistricts({ types: { downtown: { coverage: 0.4 } }, districts: [] }, cityIds)).toThrow(/missing/);
    expect(() => validateDistricts({ types: { housing: [] }, districts: [] }, cityIds)).toThrow(/5 density levels/);
    expect(one({ type: 'housing' })).toThrow(/density/);
    expect(one({ type: 'housing', density: 6 })).toThrow(/density/);
    expect(one({ type: 'housing', density: 2.5 })).toThrow(/density/);
    expect(one({ density: 2 })).toThrow(/only housing/);
    expect(one({ type: 'housing', density: 2, style: { coverage: 0.2 } })).toThrow(/unknown building setting/);
    expect(one({ type: 'downtown', style: { nudge: 2 } })).toThrow(/nudge/);
    expect(one({ type: 'slum' })).toThrow(/district x/);
    expect(one({ cityId: 'nyc' })).toThrow(/nyc/);
    expect(one({ ring: ring.slice(0, 2) })).toThrow(MapDataError);
  });
});

describe('paintDistricts', () => {
  const box = (id: string, type: District['type'], a: number, b: number): District => ({ id, cityId: 'dc', type, ring: [[a, a], [b, a], [b, b], [a, b]] });
  const cells = (line: readonly LonLatPoint[]) => line.map((q) => [q[0], q[1]] as [number, number]);

  it('paints in order and leaves cells that are not allowed', () => {
    const terrain = new Uint8Array(100).fill(Terrain.grass);
    paintDistricts([box('a', 'downtown', 1, 9), box('b', 'park', 4, 6)], cells, 10, 10, (i) => i !== 22, terrain);
    expect(terrain[0]).toBe(Terrain.grass);
    expect(terrain[11]).toBe(Terrain.downtown);
    expect(terrain[22]).toBe(Terrain.grass);
    expect(terrain[44]).toBe(Terrain.park);
  });
});

describe('district codes', () => {
  it('paints densities 4 and 5 as residential and lower ones as suburb', () => {
    const codes = ([1, 2, 3, 4, 5] as const).map((density) => districtCode({ type: 'housing', density }));
    expect(codes).toEqual([Terrain.suburb, Terrain.suburb, Terrain.suburb, Terrain.residential, Terrain.residential]);
    expect(districtStyleIndex({ type: 'downtown' })).toBe(0);
    expect(districtStyleIndex({ type: 'industrial' })).toBe(3);
  });
});
