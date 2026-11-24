import type { Bounds } from './camera';

/** Temporary stand-in for the plane (replaced in B2). World meters; heading in radians clockwise from north. */
export interface Probe {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
}

const TWO_PI = Math.PI * 2;

export const START_PROBE: Probe = { x: 2560, y: 2560, heading: Math.PI / 4 };

/** Degrees turned per internal pixel of horizontal drag. */
export const DEGREES_PER_PIXEL = 0.5;

export function wrapHeading(h: number): number {
  const w = h % TWO_PI;
  return w < 0 ? w + TWO_PI : w;
}

export function turnBy(p: Probe, radians: number): Probe {
  return { ...p, heading: wrapHeading(p.heading + radians) };
}

export function moveProbe(p: Probe, x: number, y: number, bounds: Bounds): Probe {
  return {
    ...p,
    x: Math.min(bounds.width, Math.max(0, x)),
    y: Math.min(bounds.height, Math.max(0, y)),
  };
}

/** Three digits in degrees, north as 360 (359.7 rounds to 360). */
export function formatHeading(h: number): string {
  let deg = Math.round((wrapHeading(h) * 180) / Math.PI);
  if (deg === 0) deg = 360;
  return String(deg).padStart(3, '0');
}
