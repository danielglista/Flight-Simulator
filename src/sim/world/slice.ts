import type { ScaleConfig } from '../../config/scales';
import { groundAt, heightAt, surfaceAt, waterLevelAt, type WorldGrid } from './grid';

export interface Slice {
  /** Height of whatever is on top (water surface or ground), WORLD meters, at each sample. */
  readonly heightWorldM: Float32Array;
  /** The solid ground (bed) under it, WORLD meters. */
  readonly groundWorldM: Float32Array;
  /** Water surface, WORLD meters, or NaN where dry. */
  readonly waterWorldM: Float32Array;
  /** Terrain code at each sample. */
  readonly surface: Uint8Array;
}

/**
 * Samples terrain along a line from `origin`. `heading` is radians clockwise
 * from north, so the direction is (sin h, cos h). Sample i is at distance
 * i * length / (samples - 1); both ends are included, and one sample returns
 * the origin. It goes through the grid accessors (heightAt, groundAt, waterLevelAt, surfaceAt), never the raw arrays, so
 * overlays that change those functions show up here too.
 */
export function sliceAlong(
  grid: WorldGrid,
  scale: ScaleConfig,
  origin: { readonly x: number; readonly y: number },
  heading: number,
  length: number,
  samples: number,
): Slice {
  const n = Math.max(1, Math.floor(samples));
  const heightWorldM = new Float32Array(n);
  const groundWorldM = new Float32Array(n);
  const waterWorldM = new Float32Array(n);
  const surface = new Uint8Array(n);
  const dx = Math.sin(heading);
  const dy = Math.cos(heading);
  const step = n > 1 ? length / (n - 1) : 0;
  for (let i = 0; i < n; i++) {
    const x = origin.x + dx * step * i;
    const y = origin.y + dy * step * i;
    heightWorldM[i] = heightAt(grid, scale, x, y);
    groundWorldM[i] = groundAt(grid, scale, x, y);
    waterWorldM[i] = waterLevelAt(grid, scale, x, y);
    surface[i] = surfaceAt(grid, x, y);
  }
  return { heightWorldM, groundWorldM, waterWorldM, surface };
}
