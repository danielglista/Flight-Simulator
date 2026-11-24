const TWO_PI = Math.PI * 2;

/** Wraps to 0..2pi. */
export function wrapHeading(h: number): number {
  const w = h % TWO_PI;
  return w < 0 ? w + TWO_PI : w;
}
