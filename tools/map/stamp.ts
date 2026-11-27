import type { PointKm } from './project';
import type { Warp } from './warp';
import { contains, nearestOnOutline, type Polygon } from '../../src/sim/world/polygon';

/**
 * An airport drawn at its own scale (a stamp), with the land around it bent to meet it.
 *
 * Inside the real outline, world = stamp center + (real - real center) / scale, exactly.
 * Outside, a point gets the stamp's offset at the nearest outline point, fading to zero over
 * `fadeKm` of world distance. So a river beside the runway stays beside it, instead of the
 * pushed and enlarged stamp landing on top of the warped river.
 */
export interface Stamp {
  readonly id: string;
  /** Real km center. */
  readonly real: PointKm;
  /** The shape that is stamped: CONVEX and counterclockwise, real km from the center. */
  readonly outline: Polygon;
  /** World km center. */
  readonly world: PointKm;
  /** Real km per world km inside the stamp. */
  readonly scale: number;
  /**
   * World km over which the largest offset fades back to the plain warp. Smaller offsets fade over
   * proportionally less (never under MIN_FADE_KM), so a side that barely moved disturbs little around it.
   */
  readonly fadeKm: number;
}

export const MIN_FADE_KM = 0.25;
/** How much a sideways offset counts toward the fade length, against one pointing away from the stamp. */
export const SIDEWAYS_FADE = 0.5;

/** Real km to world km and back, for the whole map: the city warp plus airport stamps. */
export interface MapField {
  readonly toWorld: (x: number, y: number) => PointKm;
  readonly toReal: (x: number, y: number) => PointKm;
  /** The stamps as used, with any fade that had to be lengthened. */
  readonly stamps: readonly Stamp[];
}

export class FieldError extends Error {}

export interface Prepared extends Stamp {
  /** Largest offset along the outline, world km. */
  readonly maxD: number;
  /** The outline in real km and in world km. */
  readonly ring: Polygon;
  readonly worldRing: Polygon;
  /** Fade length at each corner of the outline, world km. Interpolated along the sides. */
  readonly fades: readonly number[];
  /** World box the stamp can move points into or out of. */
  readonly reach: { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number };
}

/** The world offset a stamp adds at a real point, given that point's plain warp `q`. */
function offset(s: Prepared, warp: Warp, x: number, y: number, q: PointKm): PointKm {
  const inside = contains(s.ring, x, y);
  const near = inside ? null : nearestOnOutline(s.ring, x, y);
  const cx = near ? near.x : x;
  const cy = near ? near.y : y;
  const wc = near ? warp.toWorld(cx, cy) : q;
  const dx = s.world.x + (cx - s.real.x) / s.scale - wc.x;
  const dy = s.world.y + (cy - s.real.y) / s.scale - wc.y;
  if (!near) return { x: dx, y: dy };
  const d = Math.hypot(q.x - wc.x, q.y - wc.y);
  // Fade length from the corners, by where the nearest outline point sits: continuous all round.
  const a = s.fades[near.edge] as number;
  const b = s.fades[(near.edge + 1) % s.fades.length] as number;
  const fade = a * (1 - near.t) + b * near.t;
  if (d >= fade) return { x: 0, y: 0 };
  const t = d / fade;
  const w = 1 - t * t * (3 - 2 * t);
  return { x: w * dx, y: w * dy };
}

/** Largest offset along the outline, each corner's fade, and the box the stamp can reach. */
function prepare(s: Stamp, warp: Warp): Prepared {
  const ring = s.outline.map((v) => ({ x: s.real.x + v.x, y: s.real.y + v.y }));
  const worldRing = s.outline.map((v) => ({ x: s.world.x + v.x / s.scale, y: s.world.y + v.y / s.scale }));
  const at = (i: number): PointKm => ring[i % ring.length] as PointKm;
  /** The offset that puts a real point where the stamp has it. */
  const shift = (r: PointKm, q: PointKm): PointKm => ({ x: s.world.x + (r.x - s.real.x) / s.scale - q.x, y: s.world.y + (r.y - s.real.y) / s.scale - q.y });

  let maxD = 0;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const n = 64;
  for (let e = 0; e < ring.length; e++) {
    const a = at(e);
    const b = at(e + 1);
    for (let k = 0; k < n; k++) {
      const r = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n };
      const q = warp.toWorld(r.x, r.y);
      const o = shift(r, q);
      maxD = Math.max(maxD, Math.hypot(o.x, o.y));
      x0 = Math.min(x0, q.x);
      x1 = Math.max(x1, q.x);
      y0 = Math.min(y0, q.y);
      y1 = Math.max(y1, q.y);
    }
  }
  // Each corner's fade, from the stricter of its two sides. Only an offset pointing away from the
  // stamp can fold the land; one pointing back toward it, or sideways, may fade quickly, which keeps
  // the stamp from bending the land far beyond it.
  const fades = ring.map((v, i) => {
    const o = shift(v, warp.toWorld(v.x, v.y));
    const along = [i + ring.length - 1, i].map((e) => {
      const a = at(e);
      const b = at(e + 1);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      // Outward normal of a counterclockwise side.
      const nx = (b.y - a.y) / len;
      const ny = (a.x - b.x) / len;
      return Math.max(0, o.x * nx + o.y * ny) + SIDEWAYS_FADE * Math.abs(o.y * nx - o.x * ny);
    });
    return Math.max(MIN_FADE_KM, maxD > 0 ? (s.fadeKm * Math.max(...along)) / maxD : 0);
  });
  const m = Math.max(...fades) + maxD;
  const xs = worldRing.map((v) => v.x);
  const ys = worldRing.map((v) => v.y);
  return {
    ...s,
    maxD,
    ring,
    worldRing,
    fades,
    reach: {
      x0: Math.min(x0 - m, ...xs),
      x1: Math.max(x1 + m, ...xs),
      y0: Math.min(y0 - m, ...ys),
      y1: Math.max(y1 + m, ...ys),
    },
  };
}

function build(warp: Warp, prepared: readonly Prepared[]): Omit<MapField, 'stamps'> {
  const toWorld = (x: number, y: number): PointKm => {
    const q = warp.toWorld(x, y);
    let ox = 0;
    let oy = 0;
    for (const s of prepared) {
      if (q.x < s.reach.x0 || q.x > s.reach.x1 || q.y < s.reach.y0 || q.y > s.reach.y1) continue;
      const o = offset(s, warp, x, y, q);
      ox += o.x;
      oy += o.y;
    }
    return { x: q.x + ox, y: q.y + oy };
  };

  const toReal = (X: number, Y: number): PointKm => {
    let near = false;
    for (const s of prepared) {
      if (contains(s.worldRing, X, Y)) {
        return { x: s.real.x + (X - s.world.x) * s.scale, y: s.real.y + (Y - s.world.y) * s.scale };
      }
      if (X >= s.reach.x0 && X <= s.reach.x1 && Y >= s.reach.y0 && Y <= s.reach.y1) near = true;
    }
    let p = warp.toReal(X, Y);
    if (!near) return p;
    // Warm start: undo the offset and invert the plain warp, a few times.
    for (let k = 0; k < 12; k++) {
      const t0 = toWorld(p.x, p.y);
      const q0 = warp.toWorld(p.x, p.y);
      p = warp.toReal(X - (t0.x - q0.x), Y - (t0.y - q0.y));
    }
    // Damped Newton's method on toWorld, with a numeric Jacobian: a step that does not bring the
    // point closer is halved, since the outline and the fade edge make the field only piecewise smooth.
    const h = 1e-5;
    let t = toWorld(p.x, p.y);
    let err = Math.hypot(t.x - X, t.y - Y);
    for (let k = 0; k < 60 && err > 1e-9; k++) {
      const ax = toWorld(p.x + h, p.y);
      const ay = toWorld(p.x, p.y + h);
      const j11 = (ax.x - t.x) / h;
      const j21 = (ax.y - t.y) / h;
      const j12 = (ay.x - t.x) / h;
      const j22 = (ay.y - t.y) / h;
      const det = j11 * j22 - j12 * j21;
      if (!(Math.abs(det) > 1e-12)) break;
      const ex = t.x - X;
      const ey = t.y - Y;
      const sx = (j22 * ex - j12 * ey) / det;
      const sy = (-j21 * ex + j11 * ey) / det;
      let step = 1;
      let moved = false;
      for (let m = 0; m < 30; m++, step /= 2) {
        const q = { x: p.x - sx * step, y: p.y - sy * step };
        const tq = toWorld(q.x, q.y);
        const e = Math.hypot(tq.x - X, tq.y - Y);
        if (e < err) {
          p = q;
          t = tq;
          err = e;
          moved = true;
          break;
        }
      }
      if (!moved) break;
    }
    return p;
  };
  return { toWorld, toReal };
}

/**
 * Smallest local area ratio of the field against the plain warp over a stamp's reach. Below zero the
 * map folds over itself; near zero it is squeezed almost flat.
 */
export function worstAreaRatio(warp: Warp, s: Prepared, toWorld: MapField['toWorld']): number {
  const n = 200;
  const h = 1e-4;
  let worst = Infinity;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const p = warp.toReal(s.reach.x0 + ((s.reach.x1 - s.reach.x0) * i) / n, s.reach.y0 + ((s.reach.y1 - s.reach.y0) * j) / n);
      const t = toWorld(p.x, p.y);
      const ax = toWorld(p.x + h, p.y);
      const ay = toWorld(p.x, p.y + h);
      const det = (ax.x - t.x) * (ay.y - t.y) - (ay.x - t.x) * (ax.y - t.y);
      const qa = warp.toWorld(p.x, p.y);
      const qx = warp.toWorld(p.x + h, p.y);
      const qy = warp.toWorld(p.x, p.y + h);
      const det0 = (qx.x - qa.x) * (qy.y - qa.y) - (qy.x - qa.x) * (qx.y - qa.y);
      worst = Math.min(worst, det / det0);
    }
  }
  return worst;
}

/** Land around a stamp may be squeezed to this share of its plain-warp area, no further. */
export const MIN_AREA_RATIO = 0.05;
/** When a stamp's fade folds the land, it is lengthened by this factor and tried again. */
const FADE_GROWTH = 1.3;
const FADE_TRIES = 12;

/**
 * The warp plus stamps. A stamp whose fade is too short to bend the land without folding it gets a
 * longer fade (reported in `stamps`), so other scales and hand pushes still build.
 */
export function makeField(warp: Warp, stamps: readonly Stamp[]): MapField {
  const prepared = stamps.map((s) => {
    let fade = s.fadeKm;
    for (let k = 0; k < FADE_TRIES; k++) {
      const p = prepare({ ...s, fadeKm: fade }, warp);
      if (worstAreaRatio(warp, p, build(warp, [p]).toWorld) > MIN_AREA_RATIO) return p;
      fade *= FADE_GROWTH;
    }
    throw new FieldError(`airport ${s.id}: the land around the stamp folds over itself even with a ${fade.toFixed(1)} km fade`);
  });
  return { ...build(warp, prepared), stamps: prepared.map(({ maxD: _m, reach: _r, ring: _g, worldRing: _w, fades: _f, ...s }) => s) };
}
