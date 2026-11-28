import { describe, expect, it } from 'vitest';
import mapUrl from '../public/maps/mid-atlantic.bin?inline';
import districtsJson from '../data/map/districts.json';
import kitJson from '../data/map/kit.json';
import landmarksJson from '../data/map/landmarks.json';
import townsJson from '../data/map/towns.json';
import { ROAD_WIDTH_M, TOWN_RADIUS_M } from '../src/config/map';
import { LANDMARK_COLORS } from '../src/config/palette';
import { groundAt, surfaceAt, waterLevelAt } from '../src/sim/world/grid';
import { parseMap } from '../src/sim/world/mapFile';
import { Terrain } from '../src/sim/world/terrain';
import { createRoadDistance, footprintPoints, footprintsOverlap, generateBuildings, type BuildingInput } from '../tools/map/buildings';
import { kitClear, kitLandmarks, pieceShape, placeKit, planM, townArea, townCenter, townRing, type TownGround } from '../tools/map/towns';
import type { Town } from '../tools/map/types';
import { MapDataError, validateDistricts, validateKit, validateTowns } from '../tools/map/validate';

const towns = validateTowns(townsJson);
const kit = validateKit(kitJson);
const SCALE = landmarksJson.footprintScale;
const { types } = validateDistricts(districtsJson, ['dc', 'phl-city']);
const identity = { toWorld: (x: number, y: number) => ({ x, y }) };

describe('town data', () => {
  it('has Salisbury and Frederick', () => {
    expect(towns.map((t) => [t.id, t.type])).toEqual([['salisbury', 'farm'], ['frederick', 'hill']]);
  });
  it('names the bad entry', () => {
    const good = townsJson.towns[0]!;
    const one = (d: object) => () => validateTowns({ towns: [{ ...good, ...d }] });
    expect(one({ type: 'port' })).toThrow(/town salisbury/);
    expect(one({ density: 6 })).toThrow(/density/);
    expect(one({ size: 'metropolis' })).toThrow(/size/);
    expect(one({ offsetM: { x: 1 } })).toThrow(/offsetM\.y/);
    expect(one({ signature: { piece: 'church', enlarge: 0 } })).toThrow(/enlarge/);
    expect(() => validateTowns({ towns: [good, good] })).toThrow(MapDataError);
  });
});

describe('town outline', () => {
  const town: Town = { ...towns[0]!, offsetM: { x: 100, y: -200 }, size: 'largeTown' };
  it('offsets the center in world meters', () => {
    const base = townCenter({ ...town, offsetM: { x: 0, y: 0 } }, identity);
    const moved = townCenter(town, identity);
    expect(moved.x - base.x).toBeCloseTo(0.1);
    expect(moved.y - base.y).toBeCloseTo(-0.2);
  });
  it('is an octagon of the radius of its size', () => {
    const c = townCenter(town, identity);
    const ring = townRing(town, identity);
    expect(ring).toHaveLength(8);
    for (const p of ring) expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeCloseTo(0.22);
  });
});

describe('town houses', () => {
  const rings: Record<string, [number, number][]> = {
    'town-salisbury': [[0, 0], [300, 0], [300, 300], [0, 300]],
    'town-frederick': [[1000, 0], [1300, 0], [1300, 300], [1000, 300]],
  };
  const build = (list: readonly Town[]) => {
    const input: BuildingInput = { districts: list.map(townArea), styles: types, ringWorld: (d) => rings[d.id]!, code: () => Terrain.suburb, ground: () => 0, roadDistance: () => Infinity, heightScale: 3, seed: 1 };
    return generateBuildings(input).buildings;
  };
  it('does not reshuffle one town when another is edited', () => {
    const east = (list: readonly Town[]) => build(list).filter((b) => b.x > 800);
    const edited = [{ ...towns[0]!, density: 3 as const, streetDeg: 40 }, towns[1]!];
    expect(east(edited)).toEqual(east(towns));
    expect(east(towns).length).toBeGreaterThan(0);
  });
});

describe('town kit', () => {
  it('has a color for every material and a signature in each town', () => {
    for (const piece of kit.pieces) for (const m of [...piece.solids.flatMap((s) => [s.material, s.cap ?? s.material]), ...piece.decor.map((d) => d.material), ...(piece.wires ?? []).map((w) => w.material)]) expect(LANDMARK_COLORS[m], m).toBeDefined();
    for (const t of towns) expect(kit.layouts[t.type]?.[t.size]?.map((s) => s.piece)).toContain(t.signature.piece);
  });
  it('names the bad entry', () => {
    const layout = (type: string, size: string, ...pieces: string[]) => () => validateKit({ ...kitJson, layouts: { [type]: { [size]: pieces.map((piece) => ({ piece, x: 0, y: 0, turn: 0 })) } } });
    expect(layout('farm', 'town', 'pier')).toThrow(/pier/);
    expect(layout('farm', 'village', 'church')).toThrow(/size/);
    expect(() => validateKit({ ...kitJson, enlarge: 0 })).toThrow(/enlarge/);
    expect(() => validateKit({ ...kitJson, pieces: [{ ...kitJson.pieces[0], solids: [{}] }] })).toThrow(MapDataError);
  });

  it('fails a layout that breaks a piece rule', () => {
    const layout = (type: string, size: string, ...pieces: string[]) => () => validateKit({ ...kitJson, layouts: { [type]: { [size]: pieces.map((piece) => ({ piece, x: 0, y: 0, turn: 0 })) } } });
    expect(layout('farm', 'town', 'mill')).toThrow(/farm town may not have "mill"/);
    expect(layout('hill', 'town', 'courthouse')).toThrow(/size town may not have "courthouse"/);
    expect(layout('farm', 'smallCity', 'greenhouses')).toThrow(/greenhouses/);
    expect(layout('farm', 'town', 'church', 'church', 'church', 'church')).toThrow(/at most 3/);
    expect(layout('farm', 'town', 'greenhouses', 'church', 'church', 'church')).not.toThrow();
    expect(() => placeKit({ ...towns[0]!, size: 'smallCity' }, kit, SCALE, square)).toThrow(/no layout/);
  });

  const square: TownGround = { center: { x: 0, y: 0 }, ring: [[-160, -160], [160, -160], [160, 160], [-160, 160]], open: () => true, dry: () => true, roadDistance: () => Infinity };
  const salisbury = towns[0]!;

  it('plans a piece round its ground decoration as well as its solids', () => {
    expect(planM(kit.pieces.find((p) => p.id === 'manor-house')!)).toEqual({ width: 70, depth: 60 });
    expect(planM(kit.pieces.find((p) => p.id === 'school')!)).toEqual({ width: 110, depth: 109 });
    // The mast's guy wires reach past its pad.
    expect(planM(kit.pieces.find((p) => p.id === 'radio-mast')!)).toEqual({ width: 36, depth: 36 });
  });
  it('enlarges only the first of the signature piece', () => {
    const placed = placeKit(towns[1]!, kit, SCALE, { ...square, ring: [[-400, -400], [400, -400], [400, 400], [-400, 400]] });
    const churches = placed.filter((p) => p.piece === 'church');
    expect(churches.map((p) => p.enlarge)).toEqual([2.5, 1.5, 1.5]);
    const [big, small] = kitLandmarks(churches, kit, SCALE, 3);
    const height = (l: typeof big) => Math.max(...l!.solids.map((s) => s.top));
    expect(height(big)).toBeCloseTo((45 / 3) * 2.5);
    expect(height(small)).toBeCloseTo((45 / 3) * 1.5);
  });
  it('moves a piece off a highway and keeps pieces apart', () => {
    // A highway north to south through the water tower's spot.
    const road = (x: number) => Math.abs(x + 45) - 8;
    const placed = placeKit({ ...salisbury, streetDeg: 0 }, kit, SCALE, { ...square, roadDistance: road });
    for (const [i, p] of placed.entries()) {
      for (const [x] of footprintPoints(pieceShape(p))) expect(road(x)).toBeGreaterThanOrEqual(0);
      for (const other of placed.slice(i + 1)) expect(footprintsOverlap(pieceShape(p), pieceShape(other))).toBe(false);
      expect(kitClear(placed, kit, SCALE)(p.x, p.y)).toBe(true);
    }
  });
  it('fails when there is no room', () => {
    expect(() => placeKit(salisbury, kit, SCALE, { ...square, open: () => false, dry: () => false })).toThrow(/no room/);
  });
  it('stands a piece that cannot go inside just outside, on dry land', () => {
    const placed = placeKit(salisbury, kit, SCALE, { ...square, open: () => false, dry: (x) => x < 0 });
    for (const p of placed) {
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(TOWN_RADIUS_M[salisbury.size] * 1.5);
      for (const [x] of footprintPoints(pieceShape(p))) expect(x).toBeLessThan(0);
    }
  });
});

describe('towns on the built map', () => {
  const map = parseMap(Uint8Array.from(atob(mapUrl.slice(mapUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer);
  const grid = map.grid;
  const scale = { altitude: map.altitudeScale, geoDistance: map.geoDistance };
  const roadDistance = createRoadDistance(grid.roads ?? [], { major: ROAD_WIDTH_M.major / 2, minor: ROAD_WIDTH_M.minor / 2 });
  /** Where the map build put them, world m. */
  const sites = [{ id: 'salisbury', x: 9686, y: 4733 }, { id: 'frederick', x: 3403, y: 9282 }];

  it.each(sites)('stands its kit pieces at $id, dry, off the highways and clear of the houses', (site) => {
    const town = towns.find((t) => t.id === site.id)!;
    const pieces = (grid.landmarks ?? []).filter((l) => l.id.startsWith(`${site.id}-`));
    expect(pieces).toHaveLength(kit.layouts[town.type]![town.size]!.length);
    const houses = (grid.buildings ?? []).filter((b) => Math.hypot(b.x - site.x, b.y - site.y) <= TOWN_RADIUS_M[town.size]);
    for (const piece of pieces) {
      for (const s of piece.solids) {
        // Town ground, or open land where a big piece hangs past the town's edge. Never water, which is seabed.
        expect(surfaceAt(grid, s.x, s.y)).not.toBe(Terrain.seabed);
        expect(roadDistance(s.x, s.y)).toBeGreaterThan(0);
        for (const h of houses) expect(footprintsOverlap(h, { x: s.x, y: s.y, width: s.width, depth: s.depth, angle: 90 + (s.turn ?? 0) })).toBe(false);
      }
    }
  });

  it.each(sites)('has a patch of houses at $id, dry and off the highways', (site) => {
    const radius = TOWN_RADIUS_M[towns.find((t) => t.id === site.id)!.size];
    const houses = (grid.buildings ?? []).filter((b) => Math.hypot(b.x - site.x, b.y - site.y) <= radius);
    expect(houses.length).toBeGreaterThan(20);
    for (const [i, h] of houses.entries()) {
      expect(surfaceAt(grid, h.x, h.y)).toBe(Terrain.suburb);
      for (const [x, y] of footprintPoints(h)) {
        expect(waterLevelAt(grid, scale, x, y) > groundAt(grid, scale, x, y)).toBe(false);
        expect(roadDistance(x, y)).toBeGreaterThanOrEqual(0);
      }
      for (const other of houses.slice(i + 1)) expect(footprintsOverlap(h, other)).toBe(false);
    }
  });
});
