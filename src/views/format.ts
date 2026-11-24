import { wrapHeading } from '../sim/angles';

/** Three digits in degrees, north as 360 (359.7 rounds to 360). */
export function formatHeading(h: number): string {
  let deg = Math.round((wrapHeading(h) * 180) / Math.PI);
  if (deg === 0) deg = 360;
  return String(deg).padStart(3, '0');
}

/** Rounds to a multiple of `step`; never returns -0. */
function roundTo(v: number, step: number): number {
  const r = Math.round(v / step) * step;
  return r === 0 ? 0 : r;
}

const withCommas = (n: number): string => Math.abs(n).toLocaleString('en-US');

/** Whole knots. */
export function formatSpeed(knots: number): string {
  return String(roundTo(knots, 1));
}

/** Displayed feet to the nearest 10, with a thousands comma: `3,280`. */
export function formatAltitude(feet: number): string {
  const r = roundTo(feet, 10);
  return (r < 0 ? '-' : '') + withCommas(r);
}

/** Ft/min to the nearest 50, always signed except zero: `+3,050`, `-500`, `0`. */
export function formatVerticalSpeed(fpm: number): string {
  const r = roundTo(fpm, 50);
  if (r === 0) return '0';
  return (r < 0 ? '-' : '+') + withCommas(r);
}
