import type { ScaleConfig } from '../../config/scales';
import type { LandmarkSolid, MapLandmark } from './mapFile';
import { groundAt, heightAt, type WorldGrid } from './grid';

/**
 * Roof height above sea level, world m, of whatever building stands over (x, y), or NaN where there is none. With `z`,
 * what starts above that height, such as a bridge deck, is left out, so it can be passed under.
 */
export type ObstacleFn = (x: number, y: number, z?: number) => number;

/** Side of the squares buildings are filed under, world m. */
const BUCKET_M = 100;

interface Solid {
  readonly x: number;
  readonly y: number;
  /** Unit vector of the width axis. */
  readonly ux: number;
  readonly uy: number;
  readonly halfWidth: number;
  readonly halfDepth: number;
  readonly roof: number;
}

type Corner = readonly [number, number];

/** Corners southwest, southeast, northeast, northwest (before turning) of a solid's rectangle at one of its sizes. */
export function solidCorners(s: Pick<LandmarkSolid, 'x' | 'y' | 'turn'>, width: number, depth: number): [Corner, Corner, Corner, Corner] {
  const a = ((s.turn ?? 0) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const at = (u: number, v: number): Corner => [s.x + u * cos + v * sin, s.y - u * sin + v * cos];
  return [at(-width / 2, -depth / 2), at(width / 2, -depth / 2), at(width / 2, depth / 2), at(-width / 2, depth / 2)];
}

/** A north-aligned box on the ground, world m. */
export interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Slack for the map file's rounding to centimeters. */
const BOX_SLACK_M = 0.05;

/** The box round points given as x, y pairs (or x, y, z with `stride` 3). */
export function boxOf(points: readonly number[], stride = 2): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < points.length; i += stride) {
    const x = points[i] as number;
    const y = points[i + 1] as number;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/** The ground a solid stands over: nothing of it is outside this. */
export function solidBox(s: LandmarkSolid): Box {
  const box =
    s.shape === 'prism'
      ? boxOf(s.points ?? [])
      : s.shape
        ? boxOf([s.x - s.width / 2, s.y - s.width / 2, s.x + s.width / 2, s.y + s.width / 2])
        : boxOf(solidCorners(s, s.width, s.depth).flat());
  return { minX: box.minX - BOX_SLACK_M, minY: box.minY - BOX_SLACK_M, maxX: box.maxX + BOX_SLACK_M, maxY: box.maxY + BOX_SLACK_M };
}

/** A circle on the ground holding everything a landmark draws or can be hit by, so far ones are skipped at once. */
export function landmarkCircle(l: MapLandmark): { readonly x: number; readonly y: number; readonly radius: number } {
  const points: number[] = [l.x, l.y];
  const add = (b: Box, grow = 0): void => {
    points.push(b.minX - grow, b.minY - grow, b.maxX + grow, b.maxY + grow);
  };
  for (const s of l.solids) add(solidBox(s));
  for (const w of l.wires ?? []) add(boxOf(w.points, 3));
  for (const d of l.decor) {
    if (d.kind === 'line') add(boxOf(d.points), d.width);
    else if (d.kind === 'polygon') add(boxOf(d.points));
    else if (d.kind === 'rect') add(boxOf(solidCorners(d, d.width, d.depth).flat()));
    else add(boxOf([d.x, d.y]), d.radius + (d.kind === 'ring' ? d.width : 0));
  }
  if (l.posts) add(boxOf([l.posts.x, l.posts.y]), l.posts.radius);
  const b = boxOf(points);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, radius: Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2 };
}

const inBox = (b: Box, x: number, y: number): boolean => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;

/**
 * Height of a landmark solid's surface over (x, y), world m above the ground at the landmark, or NaN outside its plan.
 * Where the solid narrows, the surface slopes from the bottom edge to the top edge.
 */
export function solidTopAt(s: LandmarkSolid, x: number, y: number): number {
  if (s.shape === 'prism') {
    const p = s.points ?? [];
    for (let i = 0; i < p.length; i += 2) {
      const ax = p[i] as number;
      const ay = p[i + 1] as number;
      // Counterclockwise corners: inside is to the left of every wall.
      if (((p[(i + 2) % p.length] as number) - ax) * (y - ay) - ((p[(i + 3) % p.length] as number) - ay) * (x - ax) < 0) return NaN;
    }
    return s.top;
  }
  if (s.shape) {
    const r = Math.hypot(x - s.x, y - s.y);
    const base = s.width / 2;
    if (r > base) return NaN;
    if (s.shape === 'dome') return s.bottom + (s.top - s.bottom) * Math.sqrt(1 - (r / base) ** 2);
    const top = s.topWidth / 2;
    return r <= top ? s.top : s.bottom + (s.top - s.bottom) * ((base - r) / (base - top));
  }
  const a = ((s.turn ?? 0) * Math.PI) / 180;
  const u = Math.abs((x - s.x) * Math.cos(a) - (y - s.y) * Math.sin(a));
  const v = Math.abs((x - s.x) * Math.sin(a) + (y - s.y) * Math.cos(a));
  if (u > s.width / 2 || v > s.depth / 2) return NaN;
  const rise = (d: number, base: number, top: number): number => (d <= top / 2 ? 1 : (base / 2 - d) / (base / 2 - top / 2));
  return s.bottom + (s.top - s.bottom) * Math.min(rise(u, s.width, s.topWidth), rise(v, s.depth, s.topDepth));
}

/** The map's landmarks and what stands on its airports (E7.9), which is drawn and hit the same way. */
export function landmarksAndStructures(grid: WorldGrid): readonly MapLandmark[] {
  return [...(grid.landmarks ?? []), ...(grid.airports ?? []).flatMap((a) => (a.structures ? [a.structures] : []))];
}

/**
 * The grid's buildings and landmarks as things to hit (E5.6, E6). Separate from `heightAt`, so ground handling, height above ground
 * and landing are unchanged. A roof is the ground under the building's middle plus its height, as it is drawn.
 */
export function createObstacles(grid: WorldGrid, scale: ScaleConfig): ObstacleFn {
  const buckets = new Map<string, Solid[]>();
  for (const b of grid.buildings ?? []) {
    const a = (b.angle * Math.PI) / 180;
    const solid: Solid = {
      x: b.x,
      y: b.y,
      ux: Math.sin(a),
      uy: Math.cos(a),
      halfWidth: b.width / 2,
      halfDepth: b.depth / 2,
      roof: groundAt(grid, scale, b.x, b.y) + b.height,
    };
    const reach = Math.hypot(solid.halfWidth, solid.halfDepth);
    for (let i = Math.floor((b.x - reach) / BUCKET_M); i <= Math.floor((b.x + reach) / BUCKET_M); i++) {
      for (let j = Math.floor((b.y - reach) / BUCKET_M); j <= Math.floor((b.y + reach) / BUCKET_M); j++) {
        const key = `${i},${j}`;
        const list = buckets.get(key);
        if (list) list.push(solid);
        else buckets.set(key, [solid]);
      }
    }
  }
  // A landmark is looked into only inside its box, and each of its solids only inside its own: this is asked hundreds
  // of times a frame.
  const landmarks = landmarksAndStructures(grid).map((l) => {
    const solids = l.solids.map((s) => ({ s, box: solidBox(s) }));
    const box = boxOf(solids.flatMap(({ box: b }) => [b.minX, b.minY, b.maxX, b.maxY]));
    return { ground: heightAt(grid, scale, l.x, l.y), box, solids };
  });
  return (x, y, z) => {
    let top = NaN;
    for (const l of landmarks) {
      if (!inBox(l.box, x, y)) continue;
      for (const { s, box } of l.solids) {
        if (!inBox(box, x, y)) continue;
        if (z !== undefined && s.bottom > 0 && l.ground + s.bottom > z) continue;
        const roof = l.ground + solidTopAt(s, x, y);
        if (roof === roof && !(top >= roof)) top = roof;
      }
    }
    for (const s of buckets.get(`${Math.floor(x / BUCKET_M)},${Math.floor(y / BUCKET_M)}`) ?? []) {
      const dx = x - s.x;
      const dy = y - s.y;
      if (Math.abs(dx * s.ux + dy * s.uy) > s.halfWidth || Math.abs(dx * s.uy - dy * s.ux) > s.halfDepth) continue;
      if (!(top >= s.roof)) top = s.roof;
    }
    return top;
  };
}

/** The ground or the roof over it, whichever is higher. */
export function topOf(heightAt: (x: number, y: number) => number, obstacleAt: ObstacleFn | undefined, x: number, y: number): number {
  const ground = heightAt(x, y);
  const roof = obstacleAt ? obstacleAt(x, y) : NaN;
  return roof > ground ? roof : ground;
}
