/** Mountain rules (E_PLAN §5.2): two settings per range, applied to real-meter elevation. */
export interface ReliefRules {
  /** Keep this fraction of the height above the smoothed surroundings. 1 leaves it alone. */
  readonly compress: number;
  /** Radius in cells of the smoothed surroundings that compression measures against. */
  readonly baseRadiusCells: number;
  /** Radius in cells of an extra blur that makes ridges wider and fewer. 0 leaves it alone. */
  readonly widenRadiusCells: number;
}

/** Separable box blur with edge clamping, `passes` times (3 passes approximate a gaussian). */
export function boxBlur(data: Float32Array, cols: number, rows: number, radius: number, passes = 2): Float32Array {
  if (radius <= 0) return data.slice();
  const src = data.slice();
  const dst = new Float32Array(data.length);
  const r = Math.floor(radius);
  const w = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    // horizontal
    for (let y = 0; y < rows; y++) {
      const o = y * cols;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[o + Math.min(cols - 1, Math.max(0, k))] as number;
      for (let x = 0; x < cols; x++) {
        dst[o + x] = sum / w;
        sum += (src[o + Math.min(cols - 1, x + r + 1)] as number) - (src[o + Math.max(0, x - r)] as number);
      }
    }
    // vertical: dst back into src
    for (let x = 0; x < cols; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += dst[Math.min(rows - 1, Math.max(0, k)) * cols + x] as number;
      for (let y = 0; y < rows; y++) {
        src[y * cols + x] = sum / w;
        sum += (dst[Math.min(rows - 1, y + r + 1) * cols + x] as number) - (dst[Math.max(0, y - r) * cols + x] as number);
      }
    }
  }
  return src;
}

/**
 * Apply the rules to elevation (real meters, in place). Only heights above sea level are touched, and only
 * the part above the smoothed surroundings is shrunk, so plateaus keep their elevation.
 */
export function applyReliefRules(elev: Float32Array, cols: number, rows: number, rules: ReliefRules): void {
  if (rules.widenRadiusCells > 0) {
    const wide = boxBlur(elev, cols, rows, rules.widenRadiusCells);
    for (let i = 0; i < elev.length; i++) if ((elev[i] as number) >= 0) elev[i] = Math.max(0, wide[i] as number);
  }
  if (rules.compress < 1) {
    const base = boxBlur(elev, cols, rows, rules.baseRadiusCells);
    for (let i = 0; i < elev.length; i++) {
      const e = elev[i] as number;
      const b = base[i] as number;
      if (e > 0 && e > b) elev[i] = b + (e - b) * rules.compress;
    }
  }
}
