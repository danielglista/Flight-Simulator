import { describe, expect, it } from 'vitest';
import roadsJson from '../data/map/roads.json';
import { buildRoads, joinLines, roadClass, roadLength, simplify, skirt, splitAtWater } from '../tools/map/roads';
import { contains, nearestOnOutline } from '../src/sim/world/polygon';
import { readDbfField, readPolylines } from '../tools/map/shapefile';
import { MapDataError, validateRoads } from '../tools/map/validate';

const config = validateRoads(roadsJson);

describe('road data', () => {
  it('sorts names into classes and leaves the rest out', () => {
    expect(roadClass('I- 95', config)).toBe('major');
    expect(roadClass('Capital Beltway', config)).toBe('major');
    expect(roadClass('US Hwy 50', config)).toBe('minor');
    expect(roadClass('I- 395 Hov', config)).toBeNull();
    expect(roadClass('Main St', config)).toBeNull();
  });
  it('rejects bad config', () => {
    expect(() => validateRoads({ ...roadsJson, densifyKm: 0 })).toThrow(MapDataError);
    expect(() => validateRoads({ ...roadsJson, exclude: 'x' })).toThrow(/exclude/);
  });
});

describe('shapefile reading', () => {
  // One record: a polyline with one part and two points; a dbf with one 5-character NAME field.
  const shp = (() => {
    const b = new DataView(new ArrayBuffer(100 + 8 + 80));
    b.setInt32(0, 9994, false);
    b.setInt32(32, 3, true);
    b.setInt32(104, 40, false);
    b.setInt32(108, 3, true);
    b.setInt32(108 + 36, 1, true);
    b.setInt32(108 + 40, 2, true);
    [-77, 38.9, -76, 39.9].forEach((v, i) => b.setFloat64(108 + 48 + i * 8, v, true));
    return new Uint8Array(b.buffer);
  })();
  const dbf = (() => {
    const b = new Uint8Array(32 + 32 + 1 + 6);
    const v = new DataView(b.buffer);
    v.setUint32(4, 1, true);
    v.setUint16(8, 65, true);
    v.setUint16(10, 6, true);
    b.set(new TextEncoder().encode('NAME'), 32);
    b[32 + 16] = 5;
    b[64] = 0x0d;
    b.set(new TextEncoder().encode(' I- 95'), 65);
    return b;
  })();
  it('reads names and lines', () => {
    const names = readDbfField(dbf, 'NAME');
    expect(names).toEqual(['I- 95']);
    expect(readPolylines(shp, names, () => true)).toEqual([{ name: 'I- 95', line: [[-77, 38.9], [-76, 39.9]] }]);
    expect(readPolylines(shp, names, () => false)).toEqual([]);
    expect(() => readDbfField(dbf, 'NOPE')).toThrow(/NOPE/);
  });
});

describe('road geometry', () => {
  it('thins points that lie on the line', () => {
    expect(simplify([[0, 0], [5, 0.1], [10, 0], [10, 10]], 1)).toEqual([[0, 0], [10, 0], [10, 10]]);
  });
  it('splits at water, with the pieces still touching', () => {
    const parts = splitAtWater([[0, 0], [100, 0]], (x) => x > 40 && x < 60, 5);
    expect(parts.map((p) => p.bridge)).toEqual([false, true, false]);
    expect(parts[0]!.points.at(-1)).toEqual(parts[1]!.points[0]);
  });
  it('joins pieces of one name end to end, whatever their direction', () => {
    const joined = joinLines([
      { name: 'a', line: [[1, 0], [2, 0]] },
      { name: 'a', line: [[1, 0], [0, 0]] },
      { name: 'b', line: [[2, 0], [3, 0]] },
    ]);
    expect(joined).toHaveLength(2);
    expect(joined[0]!.line).toHaveLength(3);
  });
  it('goes around a box the shorter way, never through it', () => {
    const box = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 0, y: 40 }];
    const [line] = skirt([[80, 60], [80, 30], [80, 10], [80, -20]], box);
    expect(line).toContainEqual([100, 40]);
    expect(line).toContainEqual([100, 0]);
    for (const [x, y] of line!) expect(x > 0.01 && x < 99.99 && y > 0.01 && y < 39.99).toBe(false);
  });
  it('follows the slanted sides of a many-sided shape (E7.3)', () => {
    const hexagon = [{ x: 20, y: 0 }, { x: 60, y: 0 }, { x: 80, y: 30 }, { x: 60, y: 60 }, { x: 20, y: 60 }, { x: 0, y: 30 }];
    const [line] = skirt([[-10, 40], [10, 40], [50, 40], [90, 40]], hexagon);
    // North over the top, the shorter way, by both upper corners.
    expect(line).toContainEqual([60, 60]);
    expect(line).toContainEqual([20, 60]);
    expect(line).toHaveLength(6); // the two ends, where it enters and leaves, and the two corners
    for (const [x, y] of line!) {
      const q = nearestOnOutline(hexagon, x, y);
      expect(contains(hexagon, x, y) && q.distance > 0.01).toBe(false);
    }
  });
  it('cuts the hairpin where a road leaves a shape and runs back the way it was rerouted (E7.4)', () => {
    const box = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 200 }, { x: 0, y: 200 }];
    // In from the north at x 700, out of the south side, then east below the box: the way round is by the east end.
    const line: [number, number][] = [[700, 300], [700, 100], [700, -50], [850, -50], [920, -50], [990, -50], [1300, -50]];
    const [out] = skirt(line, box);
    // Round the northeast corner as before, down the east side, and straight to the road below: not west again.
    expect(out).toContainEqual([1000, 200]);
    expect(out).toContainEqual([1000, 0]);
    expect(out!.some(([x, y]) => x < 900 && y < 150)).toBe(false);
    expect(out!.at(-1)).toEqual([1300, -50]);
    // And the same road driven the other way.
    const [back] = skirt([...line].reverse(), box);
    expect(back!.some(([x, y]) => x < 900 && y < 150)).toBe(false);
    expect(back!.at(-1)).toEqual([700, 300]);
  });
  it('makes one road of two carriageways, and keeps roads that are far apart', () => {
    const build = (gapDeg: number) =>
      buildRoads({
        lines: [0, gapDeg].map((dy) => ({ name: 'I- 95', line: [[-77, 38.9 + dy], [-76.9, 38.9 + dy]] as const })),
        config,
        toWorld: (x, y) => ({ x: x / 25, y: y / 25 }),
        originKm: { x: -100, y: -100 },
        width: 1e6,
        height: 1e6,
        wet: () => false,
      });
    expect(build(0.002)).toHaveLength(1); // about 9 world m apart
    expect(build(0.02)).toHaveLength(2);
  });
  it('writes a repeated stretch once', () => {
    const line = [[-77, 38.9], [-76.99, 38.9]] as const;
    const roads = buildRoads({
      lines: [{ name: 'I- 95', line }, { name: 'Capital Beltway', line: [...line].reverse() }],
      config,
      toWorld: (x, y) => ({ x: x / 25, y: y / 25 }),
      originKm: { x: -100, y: -100 },
      width: 1e6,
      height: 1e6,
      wet: () => false,
    });
    expect(roads).toHaveLength(1);
    expect(roadLength(roads[0]!)).toBeGreaterThan(30);
  });
});
