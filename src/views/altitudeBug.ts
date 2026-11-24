/** Altitude bug arithmetic. Displayed feet (the same feet as the ALT readout); pure, so it can be tested. */

import type { ScaleConfig } from '../config/scales';

const M_PER_FT = 0.3048;

/** Moves the bug by `deltaFt`, kept to whole 10 ft (the ALT readout's step) inside [0, maxFt]. */
export function stepAltBug(bugFt: number, deltaFt: number, maxFt: number): number {
  const moved = Math.round((bugFt + deltaFt) / 10) * 10;
  return Math.min(maxFt, Math.max(0, moved));
}

/** Displayed feet to world z (m). */
export function bugWorldZ(bugFt: number, scale: ScaleConfig): number {
  return (bugFt * M_PER_FT) / scale.altitude;
}

/** Signed feet still to climb (positive) or descend (negative). Unrounded, so the tape moves smoothly. */
export function climbNeededFt(altFt: number, bugFt: number): number {
  return bugFt - altFt;
}

/** The bug's distance ahead of the plane along the current path (world m), or null if the path is not heading to it. */
export function interceptDistance(z: number, bugZ: number, pathAngle: number): number | null {
  const dz = bugZ - z;
  const rise = Math.tan(pathAngle);
  if (dz === 0 || rise === 0 || !Number.isFinite(rise)) return null;
  const d = dz / rise;
  return d > 0 ? d : null;
}

/**
 * Screen y on the altitude tape for `ft`, with `centerFt` on row `centerY`. Up is a smaller y.
 * Clamped to the tape ([top, bottom]) so a far-off bug stays visible at the edge.
 */
export function tapeY(ft: number, centerFt: number, centerY: number, pxPerFt: number, half: number): number {
  const y = centerY - (ft - centerFt) * pxPerFt;
  return Math.min(centerY + half, Math.max(centerY - half, y));
}

/** `+400 ft`, `-120 ft`, or `0 ft`, to the nearest 10. */
export function formatClimb(needFt: number): string {
  const r = Math.round(needFt / 10) * 10;
  return `${r > 0 ? '+' : ''}${r} ft`;
}
