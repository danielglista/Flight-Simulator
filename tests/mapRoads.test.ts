import { describe, expect, it } from 'vitest';
import roadsJson from '../data/map/roads.json';
import { buildRoads, joinLines, roadClass, roadLength, simplify, skirt, splitAtWater } from '../tools/map/roads';
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
    const box = { left: 0, bottom: 0, right: 100, top: 40 };
    const [line] = skirt([[80, 60], [80, 30], [80, 10], [80, -20]], box);
    expect(line).toContainEqual([100, 40]);
    expect(line).toContainEqual([100, 0]);
    for (const [x, y] of line!) expect(x > 0.01 && x < 99.99 && y > 0.01 && y < 39.99).toBe(false);
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
