import { GRAVITY, RHO0, ROLL_MU, SPOILER_CD, SPOILER_LIFT, V2_MULT, VR_MULT, WING_AREA } from '../../config/flight';
import type { Tuning } from '../../config/motion';
import { aeroAt, dynamicPressure } from './aero';
import { thrust } from './forces';
import { wingAt } from './wing';

const DEG = Math.PI / 180;

/** Highest lift coefficient in level flight, from the same polar the sim flies. */
export function clMax(tuning: Tuning, flaps = 0): number {
  const wing = wingAt(flaps, 0, tuning);
  let best = 0;
  for (let a = 0; a <= tuning.stallDeg; a += 0.25) best = Math.max(best, aeroAt(a * DEG, wing.stallRad, tuning, wing.cl0).cl);
  return best;
}

/** Indicated stall speed in level flight at this bank, m/s: the 1 g speed at peak Cl, over the square root of cos(bank). */
export function levelStallSpeed(tuning: Tuning, bank = 0, flaps = 0): number {
  return Math.sqrt((2 * tuning.massT * 1000 * GRAVITY) / (RHO0 * WING_AREA * clMax(tuning, flaps) * Math.max(Math.cos(bank), 0.2)));
}

/** Takeoff speeds, indicated m/s. `v1` is null when no runway length is given. */
export interface VSpeeds {
  readonly v1: number | null;
  readonly vr: number;
  readonly v2: number;
}

/**
 * Accelerate-stop distance: full power from rest to `v` on paving with the gear down, then idle with brakes and spoilers
 * to a stop. Marched in 1 m/s steps with the ground step's own forces at sea level, level nose; the engine is taken at
 * full power from the start, so the figure is a little short.
 */
export function accelerateStopM(v: number, tuning: Tuning): number {
  const m = tuning.massT * 1000;
  const aero = aeroAt(0, tuning.stallDeg * DEG, tuning, undefined, tuning.gearDragCounts);
  const full = thrust(1, tuning, 1);
  const STEP = 1;
  let up = 0;
  for (let u = 0; u < v; u += STEP) {
    const mid = u + STEP / 2;
    const q = dynamicPressure(mid, 1);
    const normal = Math.max(0, m * GRAVITY - q * WING_AREA * aero.cl);
    const a = (tuning.groundMult * full - q * WING_AREA * aero.cd) / m - (ROLL_MU * normal) / m;
    if (a <= 0) return Infinity;
    up += (STEP * mid) / a;
  }
  let down = 0;
  const mu = ROLL_MU + tuning.brakePct / 100;
  for (let u = v; u > 0; u -= STEP) {
    const mid = Math.max(0, u - STEP / 2);
    const q = dynamicPressure(mid, 1);
    const normal = Math.max(0, m * GRAVITY - q * WING_AREA * aero.cl * SPOILER_LIFT);
    const d = (q * WING_AREA * (aero.cd + SPOILER_CD)) / m + (mu * normal) / m;
    down += (Math.min(STEP, u) * mid) / d;
  }
  return up + down;
}

/**
 * From mass and the wing, so a number cannot disagree with how the plane flies. V1 is accelerate-stop: the highest speed
 * (up to VR) from which the plane can still stop in the runway left, `runwayM` from where the roll starts; null with no runway.
 */
export function vSpeeds(tuning: Tuning, runwayM: number | null = null, flaps = 0): VSpeeds {
  const vs = levelStallSpeed(tuning, 0, flaps);
  const vr = VR_MULT * vs;
  let v1: number | null = null;
  if (runwayM !== null && Number.isFinite(runwayM)) {
    v1 = 0;
    for (let v = 1; v <= vr; v++) {
      if (accelerateStopM(v, tuning) > runwayM) break;
      v1 = v;
    }
  }
  return { v1, vr, v2: V2_MULT * vs };
}
