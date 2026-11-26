import { CL0, CL_ALPHA, CL_PLATE, CD_PLATE, GRAVITY, Q_FLOOR, RHO0, STALLED_AT, STALL_NEG_DEG, STALL_WIDTH_DEG, WARN_MARGIN_DEG, WING_AREA } from '../../config/flight';
import type { Tuning } from '../../config/motion';
import type { Craft } from '../state';
import { wingAt } from './wing';

const DEG = Math.PI / 180;

const smoothstep = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

export interface Aero {
  /** Separation 0..1: 0 is attached flow, 1 is fully stalled. */
  readonly separation: number;
  readonly cl: number;
  readonly cd: number;
}

/**
 * Lift and drag coefficients at angle of attack `a` (radians). Attached flow follows the linear
 * polar; past the stall center the flow separates smoothly into a flat plate. One expression
 * covers any angle, so no input gives a jump or a NaN. `stallRad` is the center of the positive
 * stall; flaps (C6) will shift `CL0` and `stallRad`, so both are parameters.
 */
export function aeroAt(
  a: number,
  stallRad: number,
  tuning: Pick<Tuning, 'cd0Counts' | 'inducedCounts'>,
  cl0 = CL0,
  /** Extra zero-lift drag in 1/10,000 (the gear, C4B). */
  extraCd0Counts = 0,
): Aero {
  const w = STALL_WIDTH_DEG * DEG;
  const center = a >= 0 ? stallRad : STALL_NEG_DEG * DEG;
  const s = smoothstep((Math.abs(a) - (center - w / 2)) / w);
  const lin = cl0 + CL_ALPHA * a;
  const cd0 = (tuning.cd0Counts + extraCd0Counts) / 10000;
  const k = tuning.inducedCounts / 10000;
  const sinA = Math.sin(a);
  return {
    separation: s,
    cl: (1 - s) * lin + s * CL_PLATE * Math.sin(2 * a),
    cd: (1 - s) * (cd0 + k * lin * lin) + s * (cd0 + CD_PLATE * sinA * sinA),
  };
}

/** Dynamic pressure, Pa, floored so it can be divided by. */
export const dynamicPressure = (speed: number, sigma: number): number => Math.max(0.5 * RHO0 * sigma * speed * speed, Q_FLOOR);

/**
 * The angle of attack that gives `n` times weight, capped where separation starts.
 * Used by the ceiling and by turn help.
 */
export function liftAngle(n: number, speed: number, sigma: number, tuning: Tuning, flaps = 0): number {
  const q = dynamicPressure(speed, sigma);
  const wing = wingAt(flaps, 0, tuning);
  const cl = (n * tuning.massT * 1000 * GRAVITY) / (q * WING_AREA);
  const a = (cl - wing.cl0) / CL_ALPHA;
  return Math.min(a, wing.stallRad - (STALL_WIDTH_DEG * DEG) / 2);
}

export type StallState = 'none' | 'warning' | 'stalled';

/** Warning from a few degrees before the stall center; stalled once separation is clearly under way. The caller checks for a crash. */
export function stallState(craft: Pick<Craft, 'pitch' | 'pathAngle'> & { readonly onGround?: boolean; readonly flaps?: number }, tuning: Tuning): StallState {
  if (craft.onGround) return 'none';
  const a = craft.pitch - craft.pathAngle;
  const wing = wingAt(craft.flaps ?? 0, 0, tuning);
  const { separation } = aeroAt(a, wing.stallRad, tuning, wing.cl0);
  if (a > 0 && separation >= STALLED_AT) return 'stalled';
  if (a >= wing.stallRad - WARN_MARGIN_DEG * DEG) return 'warning';
  return 'none';
}
