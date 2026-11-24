import { wrapHeading } from '../sim/angles';

/** Three digits in degrees, north as 360 (359.7 rounds to 360). */
export function formatHeading(h: number): string {
  let deg = Math.round((wrapHeading(h) * 180) / Math.PI);
  if (deg === 0) deg = 360;
  return String(deg).padStart(3, '0');
}
