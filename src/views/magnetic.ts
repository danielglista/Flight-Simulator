import type { Airport } from '../sim/world/airport';

/**
 * Magnetic variation at a world position, degrees west: magnetic heading = true heading + this. The airports' own values
 * blended by inverse square distance, so each reads exactly at its field; 0 where no airport states one. Display only:
 * the sim and the map stay in true.
 */
export function magneticVariation(airports: readonly Airport[], x: number, y: number): number {
  let sum = 0;
  let weights = 0;
  for (const a of airports) {
    if (a.variationDeg === undefined) continue;
    const d2 = ((a.minX + a.maxX) / 2 - x) ** 2 + ((a.minY + a.maxY) / 2 - y) ** 2;
    if (d2 < 1) return a.variationDeg;
    sum += a.variationDeg / d2;
    weights += 1 / d2;
  }
  return weights === 0 ? 0 : sum / weights;
}

/** A true compass direction in degrees as magnetic, 0..360. */
export const magneticDeg = (trueDeg: number, variationDeg: number): number => (((trueDeg + variationDeg) % 360) + 360) % 360;
