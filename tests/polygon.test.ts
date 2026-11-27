import { describe, expect, it } from 'vitest';
import { contains, convexHull, convexOverlap, growConvex, nearestOnOutline, selfCrossing, type Polygon } from '../src/sim/world/polygon';

const poly = (...c: readonly (readonly [number, number])[]): Polygon => c.map(([x, y]) => ({ x, y }));
const box = (cx: number, cy: number, w: number, h: number): Polygon =>
  poly([cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]);

const square = box(0, 0, 2, 2);
/** An L: the square 0..4 with its upper right quarter taken out. */
const ell = poly([0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]);
const both = (p: Polygon): Polygon[] => [p, [...p].reverse()];

describe('contains', () => {
  it('follows a notched outline, either winding', () => {
    for (const p of both(ell)) {
      expect(contains(p, 1, 3)).toBe(true);
      expect(contains(p, 3, 1)).toBe(true);
      expect(contains(p, 3, 3)).toBe(false);
      expect(contains(p, -1, 1)).toBe(false);
    }
  });

  it('counts the outline as inside', () => {
    expect(contains(square, 1, 0)).toBe(true);
    expect(contains(square, 0, 1)).toBe(true);
    expect(contains(square, -1, -1)).toBe(true);
    expect(contains(square, 1.001, 0)).toBe(false);
  });
});

describe('nearestOnOutline', () => {
  it('drops onto a side from outside or inside', () => {
    expect(nearestOnOutline(square, 3, 0.5)).toEqual({ x: 1, y: 0.5, edge: 1, t: 0.75, distance: 2 });
    expect(nearestOnOutline(square, 0, 0.9)).toMatchObject({ x: 0, y: 1, edge: 2, t: 0.5 });
  });

  it('stops at a corner', () => {
    const n = nearestOnOutline(square, 4, 5);
    expect(n).toMatchObject({ x: 1, y: 1, distance: 5 });
  });

  it('matches clamping for a point outside a rectangle', () => {
    const r = box(1, 2, 3, 5);
    for (let x = -4; x <= 6; x += 0.7) {
      for (let y = -4; y <= 8; y += 0.9) {
        if (contains(r, x, y)) continue;
        const n = nearestOnOutline(r, x, y);
        expect(n.x).toBeCloseTo(Math.max(-0.5, Math.min(2.5, x)), 12);
        expect(n.y).toBeCloseTo(Math.max(-0.5, Math.min(4.5, y)), 12);
      }
    }
  });
});

describe('convexHull', () => {
  const area2 = (p: Polygon): number => p.reduce((s, a, i) => s + a.x * p[(i + 1) % p.length]!.y - p[(i + 1) % p.length]!.x * a.y, 0);
  const isConvexCcw = (p: Polygon): boolean =>
    p.every((a, i) => {
      const b = p[(i + 1) % p.length]!;
      const c = p[(i + 2) % p.length]!;
      return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) > 0;
    });

  it('is counterclockwise and drops inner, repeated and side points', () => {
    const h = convexHull([...square, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);
    expect(h).toHaveLength(4);
    expect(area2(h)).toBeCloseTo(8, 12);
    expect(isConvexCcw(h)).toBe(true);
  });

  it('wraps notched ground in several pieces', () => {
    const pieces = [ell, box(7, 1, 1, 3), poly([2, -3], [3, -2], [1, -2])];
    const points = pieces.flat();
    const h = convexHull(points);
    expect(isConvexCcw(h)).toBe(true);
    expect(selfCrossing(h)).toBe(false);
    for (const q of points) expect(contains(h, q.x, q.y)).toBe(true);
    for (const q of h) expect(points).toContainEqual(q);
  });
});

describe('selfCrossing', () => {
  it('accepts simple polygons, notched ones too, either winding', () => {
    for (const p of [square, ell, poly([0, 0], [1, 0], [0, 1])]) {
      for (const q of both(p)) expect(selfCrossing(q)).toBe(false);
    }
  });

  it('accepts a point along a straight side', () => {
    expect(selfCrossing(poly([0, 0], [1, 0], [2, 0], [2, 2], [0, 2]))).toBe(false);
  });

  it.each([
    ['a bow tie', poly([0, 0], [2, 2], [2, 0], [0, 2])],
    ['a corner touching another side', poly([0, 0], [4, 0], [4, 4], [2, 0], [0, 4])],
    ['two corners meeting', poly([0, 0], [2, 0], [1, 1], [2, 2], [0, 2], [1, 1])],
    ['a repeated point', poly([0, 0], [2, 0], [2, 0], [0, 2])],
    ['the first point repeated at the end', poly([0, 0], [2, 0], [0, 2], [0, 0])],
    ['a side doubling back', poly([0, 0], [3, 0], [1, 0], [1, 2])],
    ['three points in a line', poly([0, 0], [1, 0], [2, 0])],
  ])('rejects %s', (_name, p) => {
    for (const q of both(p)) expect(selfCrossing(q)).toBe(true);
  });
});

describe('convexOverlap', () => {
  it('agrees with the upright box rule, gap included', () => {
    const a = box(0, 0, 2, 4);
    for (const gap of [0, 0.5]) {
      for (let x = -3; x <= 3; x += 0.25) {
        for (let y = -4; y <= 4; y += 0.25) {
          const expected = Math.abs(x) < (2 + 1) / 2 + gap && Math.abs(y) < (4 + 2) / 2 + gap;
          expect(convexOverlap(a, box(x, y, 1, 2), gap)).toBe(expected);
        }
      }
    }
  });

  it('separates turned shapes whose bounding boxes overlap', () => {
    const a = poly([0, 0], [4, 0], [0, 4]);
    const b = poly([4, 1], [4, 4], [1, 4]);
    expect(convexOverlap(a, b)).toBe(false);
    // The slanted sides are 1/sqrt(2) apart.
    expect(convexOverlap(a, b, 0.7)).toBe(false);
    expect(convexOverlap(a, b, 0.72)).toBe(true);
  });

  it('sees one inside the other, either winding', () => {
    for (const inner of both(box(0, 0, 0.5, 0.5))) {
      expect(convexOverlap(square, inner)).toBe(true);
      expect(convexOverlap(inner, square)).toBe(true);
    }
  });
});

describe('growConvex', () => {
  it('moves each side of a box out, keeping square corners', () => {
    expect(growConvex(square, 0.5)).toEqual(box(0, 0, 3, 3));
  });

  it('keeps every side the same distance out on a many-sided shape', () => {
    const h = convexHull([...ell]);
    const g = growConvex(h, 0.25);
    expect(g).toHaveLength(h.length);
    g.forEach((a, i) => {
      const b = g[(i + 1) % g.length]!;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      expect(nearestOnOutline(h, mid.x, mid.y).distance).toBeCloseTo(0.25, 12);
      expect(contains(h, mid.x, mid.y)).toBe(false);
    });
  });
});
