import { SLOPE_SATURATE_PX, SLOPE_SHADE, type SideLayer } from '../config/display';
import type { Slice } from '../sim/world/slice';

/** Sideways offsets (world m, left of the heading) of the sample lines of a layer: evenly spaced from near to far, inclusive. */
export function laneOffsets(layer: Pick<SideLayer, 'nearM' | 'farM' | 'lanes'>): number[] {
  const n = Math.max(1, Math.floor(layer.lanes));
  if (n === 1) return [layer.nearM];
  return Array.from({ length: n }, (_, i) => layer.nearM + ((layer.farM - layer.nearM) * i) / (n - 1));
}

/**
 * Merges lane slices into their upper envelope: per column, the lane with the highest surface wins and
 * lends its ground, water and surface type. The first of equal lanes wins. Slices of different lengths
 * are cut to the shortest.
 */
export function envelope(slices: readonly Slice[]): Slice {
  const first = slices[0];
  if (!first) throw new Error('envelope needs at least one slice');
  const n = Math.min(...slices.map((s) => s.heightWorldM.length));
  const heightWorldM = new Float32Array(n);
  const groundWorldM = new Float32Array(n);
  const waterWorldM = new Float32Array(n);
  const surface = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let win = first;
    for (const s of slices) if ((s.heightWorldM[i] as number) > (win.heightWorldM[i] as number)) win = s;
    heightWorldM[i] = win.heightWorldM[i] as number;
    groundWorldM[i] = win.groundWorldM[i] as number;
    waterWorldM[i] = win.waterWorldM[i] as number;
    surface[i] = win.surface[i] as number;
  }
  return { heightWorldM, groundWorldM, waterWorldM, surface };
}

/**
 * Brightness factor for a column from the screen rows of its neighbors (y grows downward). Ground rising
 * toward the right faces the light at the left and is lighter; flat ground is 1. `strength` scales the effect.
 */
export function slopeShade(prevY: number, nextY: number, strength = 1): number {
  const slopePx = (prevY - nextY) / 2;
  const t = Math.min(1, Math.max(-1, slopePx / SLOPE_SATURATE_PX));
  return 1 + SLOPE_SHADE * strength * t;
}
