import { wrapHeading } from '../sim/angles';
import { N1_IDLE_PCT } from '../config/display';

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

/** Ft/min to the nearest 10, always signed except zero: `+3,050`, `-520`, `0`. */
export function formatVerticalSpeed(fpm: number): string {
  const r = roundTo(fpm, 10);
  if (r === 0) return '0';
  return (r < 0 ? '-' : '+') + withCommas(r);
}

/** Whole degrees, signed except zero: `+5`, `0`, `-12`. */
export function formatPitch(deg: number): string {
  const r = roundTo(deg, 0.1);
  return r === 0 ? '0.0' : (r < 0 ? '-' : '+') + Math.abs(r).toFixed(1);
}

/** Bank in whole degrees: `L 30`, `0`, `R 30`. */
export function formatBank(deg: number): string {
  const r = roundTo(Math.abs(deg), 1);
  if (r === 0) return '0';
  return `${deg < 0 ? 'L' : 'R'} ${r}`;
}

/** The power reading for a lever or engine fraction (0..1): N1_IDLE_PCT at idle, 100 at full (D5B). Display only. */
export function powerPct(fraction: number): number {
  return Math.round(N1_IDLE_PCT + (100 - N1_IDLE_PCT) * Math.min(1, Math.max(0, fraction)));
}

/** Height above ground by the plumb line, in displayed feet like ALT: `AGL 120 ft`. */
export function formatAgl(feet: number): string {
  return `AGL ${formatAltitude(Math.max(0, feet))} ft`;
}

/** World m above the ground, never negative. */
export const heightAboveGround = (z: number, groundZ: number): number => Math.max(0, z - groundZ);
