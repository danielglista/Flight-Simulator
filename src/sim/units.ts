import type { ScaleConfig } from '../config/scales';
import type { Craft } from './state';

const KNOTS_PER_MS = 3600 / 1852;
const FEET_PER_M = 1 / 0.3048;

export function metersPerSecondToKnots(v: number): number {
  return v * KNOTS_PER_MS;
}

/** World z (m) to displayed feet: world m -> real m through the altitude scale -> ft. */
export function displayedAltitudeFt(worldZ: number, scale: ScaleConfig): number {
  return worldZ * scale.altitude * FEET_PER_M;
}

/**
 * Climb rate in ft/min from speed and path angle alone. Unscaled world feet:
 * the altitude scale is NOT applied, so it can disagree with how fast ALT changes (GAME_DESIGN.md 4.1).
 */
export function verticalSpeedFpm(craft: Pick<Craft, 'speed' | 'pathAngle'>): number {
  return craft.speed * Math.sin(craft.pathAngle) * 60 * FEET_PER_M;
}
