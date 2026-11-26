import type { ScaleConfig } from '../../config/scales';
import { groundAt, type WorldGrid } from './grid';

/** Roof height above sea level, world m, of whatever building stands over (x, y), or NaN where there is none. */
export type ObstacleFn = (x: number, y: number) => number;

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

/**
 * The grid's buildings as things to hit (E5.6). Separate from `heightAt`, so ground handling, height above ground
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
  return (x, y) => {
    let top = NaN;
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
