/**
 * Plane geometry on polygons, in any one length unit (the game uses meters, the map tools km).
 * A polygon is its corners in order, either winding, the last joined back to the first.
 */
import type { Vec2 } from './airport';

export type Polygon = readonly Vec2[];

/** A point this close to a line is on it. */
const EPS = 1e-9;

/** Twice the signed area of the triangle o, a, b: positive when o -> a -> b turns left. */
const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

const corner = (p: Polygon, i: number): Vec2 => p[i % p.length] as Vec2;

export interface OutlinePoint {
  readonly x: number;
  readonly y: number;
  /** The edge it lies on: from corner `edge` to the next. */
  readonly edge: number;
  /** Where along that edge, 0 to 1. */
  readonly t: number;
  readonly distance: number;
}

/** The point of the outline closest to (x, y), whether that is inside or outside. */
export function nearestOnOutline(p: Polygon, x: number, y: number): OutlinePoint {
  let best: OutlinePoint = { x: Infinity, y: Infinity, edge: 0, t: 0, distance: Infinity };
  for (let i = 0; i < p.length; i++) {
    const a = corner(p, i);
    const b = corner(p, i + 1);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
    const nx = a.x + t * dx;
    const ny = a.y + t * dy;
    const distance = Math.hypot(x - nx, y - ny);
    if (distance < best.distance) best = { x: nx, y: ny, edge: i, t, distance };
  }
  return best;
}

/** Is (x, y) inside the polygon or on its outline? */
export function contains(p: Polygon, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0; i < p.length; i++) {
    const a = corner(p, i);
    const b = corner(p, i + 1);
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside || nearestOnOutline(p, x, y).distance <= EPS;
}

/** The tightest convex polygon around the points, counterclockwise, without points along its sides. */
export function convexHull(points: readonly Vec2[]): Polygon {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (from: readonly Vec2[]): Vec2[] => {
    const out: Vec2[] = [];
    for (const q of from) {
      while (out.length >= 2 && cross(out[out.length - 2] as Vec2, out[out.length - 1] as Vec2, q) <= EPS) out.pop();
      out.push(q);
    }
    out.pop(); // the other half starts with it
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/** Is q, already known to be in line with a and b, between them? */
const between = (a: Vec2, b: Vec2, q: Vec2): boolean =>
  q.x >= Math.min(a.x, b.x) - EPS && q.x <= Math.max(a.x, b.x) + EPS && q.y >= Math.min(a.y, b.y) - EPS && q.y <= Math.max(a.y, b.y) + EPS;

const side = (a: Vec2, b: Vec2, q: Vec2): number => {
  const c = cross(a, b, q);
  return Math.abs(c) <= EPS ? 0 : Math.sign(c);
};

/** Do the segments ab and cd cross or touch? */
function segmentsMeet(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const sc = side(a, b, c);
  const sd = side(a, b, d);
  const sa = side(c, d, a);
  const sb = side(c, d, b);
  if (sc * sd < 0 && sa * sb < 0) return true;
  return (sc === 0 && between(a, b, c)) || (sd === 0 && between(a, b, d)) || (sa === 0 && between(c, d, a)) || (sb === 0 && between(c, d, b));
}

/**
 * Is the polygon not simple: do its edges cross or touch anywhere but at the corner neighbors share?
 * A repeated corner or an edge doubling back counts too.
 */
export function selfCrossing(p: Polygon): boolean {
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const a = corner(p, i);
    const b = corner(p, i + 1);
    const c = corner(p, i + 2);
    if (Math.hypot(b.x - a.x, b.y - a.y) <= EPS) return true;
    // The next edge runs back over this one.
    if (side(a, b, c) === 0 && (a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y) > 0) return true;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // neighbors round the end
      if (segmentsMeet(a, b, corner(p, j), corner(p, j + 1))) return true;
    }
  }
  return false;
}

/**
 * Do two CONVEX polygons overlap, or come closer than `gap`? Distance is measured across each side
 * of either polygon, so for two upright boxes the gap applies to x and to y separately.
 * Touching with no gap is not overlapping.
 */
export function convexOverlap(a: Polygon, b: Polygon, gap = 0): boolean {
  for (const p of [a, b]) {
    for (let i = 0; i < p.length; i++) {
      const u = corner(p, i);
      const v = corner(p, i + 1);
      const len = Math.hypot(v.x - u.x, v.y - u.y);
      if (len <= EPS) continue;
      const nx = (v.y - u.y) / len;
      const ny = (u.x - v.x) / len;
      const as = a.map((q) => q.x * nx + q.y * ny);
      const bs = b.map((q) => q.x * nx + q.y * ny);
      if (Math.max(Math.min(...bs) - Math.max(...as), Math.min(...as) - Math.max(...bs)) >= gap) return false;
    }
  }
  return true;
}

/** A CONVEX counterclockwise polygon with every side moved out by `by`, the sides extended to meet again. */
export function growConvex(p: Polygon, by: number): Polygon {
  /** Outward unit normal of edge i. */
  const normal = (i: number): Vec2 => {
    const a = corner(p, i);
    const b = corner(p, i + 1);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: (b.y - a.y) / len, y: (a.x - b.x) / len };
  };
  return p.map((v, i) => {
    const m = normal(i + p.length - 1);
    const n = normal(i);
    const k = by / (1 + m.x * n.x + m.y * n.y);
    return { x: v.x + (m.x + n.x) * k, y: v.y + (m.y + n.y) * k };
  });
}
