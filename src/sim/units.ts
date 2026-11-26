import type { ScaleConfig } from '../config/scales';
import { densityRatio } from './flight/forces';
import type { Craft } from './state';

const KNOTS_PER_MS = 3600 / 1852;
const FEET_PER_M = 1 / 0.3048;

export function metersPerSecondToKnots(v: number): number {
  return v * KNOTS_PER_MS;
}

export function knotsToMetersPerSecond(kt: number): number {
  return kt / KNOTS_PER_MS;
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

/** Climb rate in ft/min as the altimeter changes: the world rate times the altitude scale (D2's `altimeter` V/S mode). */
export function altimeterVerticalSpeedFpm(craft: Pick<Craft, 'speed' | 'pathAngle'>, scale: ScaleConfig): number {
  return verticalSpeedFpm(craft) * scale.altitude;
}

/** Indicated airspeed, m/s: true speed scaled by the square root of air density. Stall speed is constant in these terms. */
export function indicatedSpeed(craft: Pick<Craft, 'speed' | 'z'>, scale: ScaleConfig): number {
  return craft.speed * Math.sqrt(densityRatio(craft.z, scale.altitude));
}
