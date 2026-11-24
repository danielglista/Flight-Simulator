import type { Size } from '../config/display';
import type { Point } from './camera';

export interface EdgeArrow {
  /** Where to draw it, inside the panel. */
  readonly x: number;
  readonly y: number;
  /** Screen direction toward the target, radians, atan2(dy, dx) with y down. */
  readonly angle: number;
}

/** Null when `target` (internal pixels) is on screen; otherwise a spot on the panel edge, `inset` px in. */
export function edgeArrow(view: Size, target: Point, inset = 14): EdgeArrow | null {
  if (target.x >= 0 && target.x < view.width && target.y >= 0 && target.y < view.height) return null;
  const cx = view.width / 2;
  const cy = view.height / 2;
  const dx = target.x - cx;
  const dy = target.y - cy;
  const tx = dx === 0 ? Infinity : (cx - inset) / Math.abs(dx);
  const ty = dy === 0 ? Infinity : (cy - inset) / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t, angle: Math.atan2(dy, dx) };
}
