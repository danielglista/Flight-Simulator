import { GEAR_TIME_S, GEAR_WARN_AGL, GEAR_WARN_IAS } from '../../config/flight';
import type { Tuning } from '../../config/motion';
import type { Craft } from '../state';

/** The gear position after one step of `dt` seconds: it moves toward the lever at 1 / GEAR_TIME_S per second and stops exactly at the ends. */
export function stepGear(gear: number, gearDown: boolean, dt: number): number {
  const target = gearDown ? 1 : 0;
  const d = dt / GEAR_TIME_S;
  const next = gear < target ? Math.min(target, gear + d) : Math.max(target, gear - d);
  // Many small steps leave rounding dust (0.9999999999999974); snap, so "fully down" is exactly 1.
  return Math.abs(target - next) < 1e-9 ? target : next;
}

/** Extra zero-lift drag from the gear, in 1/10,000 (counts): none when up, full when down. */
export function gearDragCounts(craft: Pick<Craft, 'gear'>, tuning: Pick<Tuning, 'gearDragCounts'>): number {
  return craft.gear * tuning.gearDragCounts;
}

/** True only when the gear is fully down and locked. Anything else at touchdown is a crash. */
export const gearLocked = (craft: Pick<Craft, 'gear'>): boolean => craft.gear >= 1;

/**
 * The gear warning: airborne, low, slow, gear not down and descending. `agl` is height above the ground in world m and
 * `indicated` the indicated speed in m/s. The caller lets a stall warning win the cell.
 */
export function gearWarning(craft: Pick<Craft, 'onGround' | 'gear' | 'pathAngle'>, agl: number, indicated: number): boolean {
  return !craft.onGround && agl < GEAR_WARN_AGL && indicated < GEAR_WARN_IAS && craft.gear < 1 && craft.pathAngle < 0;
}
