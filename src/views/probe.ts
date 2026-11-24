import { wrapHeading } from '../sim/angles';

/** View-facing position and heading (until B2). World meters; heading in radians clockwise from north. */
export interface Probe {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
}

/** Degrees turned per internal pixel of horizontal drag. */
export const DEGREES_PER_PIXEL = 0.5;

/** Three digits in degrees, north as 360 (359.7 rounds to 360). */
export function formatHeading(h: number): string {
  let deg = Math.round((wrapHeading(h) * 180) / Math.PI);
  if (deg === 0) deg = 360;
  return String(deg).padStart(3, '0');
}
