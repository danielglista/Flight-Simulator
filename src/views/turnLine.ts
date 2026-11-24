import type { Point } from './camera';

/** A world position on the track and the heading there (radians, not wrapped). */
export interface TrackPoint extends Point {
  readonly heading: number;
}

/**
 * World positions the plane will pass through if it holds its current speed and turn rate:
 * one point per `stepS` seconds from now, up to `seconds` (the first point is the plane itself).
 * Each point also carries the heading there. Heading is clockwise from north; `turnRate` is rad/s, clockwise positive.
 */
export function turnTrack(
  craft: { readonly x: number; readonly y: number; readonly heading: number; readonly speed: number },
  turnRate: number,
  seconds: number,
  stepS: number,
): TrackPoint[] {
  const points: TrackPoint[] = [{ x: craft.x, y: craft.y, heading: craft.heading }];
  let { x, y } = craft;
  let heading = craft.heading;
  const whole = Math.floor(seconds / stepS + 1e-9);
  // Whole steps, then one shorter step if `seconds` is not a multiple, so the track is exactly `seconds` long.
  const rest = seconds - whole * stepS;
  for (let i = 0; i < whole + (rest > 1e-6 ? 1 : 0); i++) {
    const dt = i < whole ? stepS : rest;
    // Midpoint heading over the step keeps the arc accurate without small sub-steps.
    const mid = heading + (turnRate * dt) / 2;
    x += Math.sin(mid) * craft.speed * dt;
    y += Math.cos(mid) * craft.speed * dt;
    heading += turnRate * dt;
    points.push({ x, y, heading });
  }
  return points;
}
