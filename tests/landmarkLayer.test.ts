import { describe, expect, it } from 'vitest';
import type { LandmarkSolid } from '../src/sim/world/mapFile';
import { landmarkColor, postPoints, solidFaces, solidShadow, overheadSolids, boxesMeet, worldBox } from '../src/views/landmarkLayer';

const s: LandmarkSolid = { x: 0, y: 0, width: 10, depth: 10, topWidth: 6, topDepth: 6, bottom: 0, top: 40, material: 'marble-upper' };

describe('landmarks from above', () => {
  it('shows four faces, lit from the northwest, around the top', () => {
    const { faces, top } = solidFaces(s);
    expect(top).toEqual([[-3, -3], [3, -3], [3, 3], [-3, 3]]);
    const [south, east, north, west] = faces.map((f) => f.light);
    expect(north!).toBeGreaterThan(south!);
    expect(west!).toBeGreaterThan(east!);
    expect(faces[0]!.points).toEqual([[-5, -5], [5, -5], [3, -3], [-3, -3]]);
  });
  it('casts a shadow to the southeast, longer for a taller solid', () => {
    const reach = (top: number) => Math.max(...solidShadow({ ...s, top }).map(([x]) => x));
    expect(reach(40)).toBeGreaterThan(15);
    expect(reach(80)).toBeGreaterThan(reach(40));
    expect(Math.min(...solidShadow(s).map(([x]) => x))).toBeCloseTo(-5, 6);
    expect(Math.min(...solidShadow(s).map(([, y]) => y))).toBeLessThan(-15);
  });
  it('spaces the flag poles around their circle, and marks an unknown material', () => {
    const poles = postPoints({ x: 10, y: 20, radius: 15, count: 4, height: 3 });
    expect(poles).toHaveLength(4);
    for (const [x, y] of poles) expect(Math.hypot(x - 10, y - 20)).toBeCloseTo(15, 6);
    expect(landmarkColor('nothing')).toEqual([255, 0, 255]);
  });
});

describe('what hangs over the plane', () => {
  const deck = { x: 0, y: 0, width: 20, depth: 4, topWidth: 20, topDepth: 4, bottom: 14, top: 17, material: 'bridge-blue' };
  const leg = { ...deck, y: 10, width: 2, bottom: 0, top: 39 };
  const bridge = { id: 'b', x: 0, y: 0, solids: [deck, leg], decor: [] };
  it('is what lies above a plane under a raised solid, and nothing beside or over it', () => {
    expect(overheadSolids(bridge, 0, 0, 7)).toEqual([deck]);
    expect(overheadSolids(bridge, 0, 6, 7)).toEqual([]);
    expect(overheadSolids(bridge, 0, 0, 20)).toEqual([]);
  });
});

describe('which landmarks are in view', () => {
  it('turns the screen area into world meters, y north', () => {
    const f = { ox: 100, oy: 50, mpp: 2, mapHeight: 1000 };
    expect(worldBox(f, { left: 100, top: 50, right: 200, bottom: 100 })).toEqual({ minX: 0, maxX: 200, minY: 900, maxY: 1000 });
  });
  it('meets boxes that overlap and not ones apart', () => {
    const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(boxesMeet(a, { minX: 9, minY: 9, maxX: 20, maxY: 20 })).toBe(true);
    expect(boxesMeet(a, { minX: 11, minY: 0, maxX: 20, maxY: 10 })).toBe(false);
  });
});
