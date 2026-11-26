import { GRAVITY, WING_AREA } from '../../config/flight';
import type { Tuning } from '../../config/motion';
import { aeroAt, dynamicPressure } from './aero';
import { wingAt } from './wing';
import { densityRatio, thrust } from './forces';

const DEG = Math.PI / 180;

export interface Trim {
  /** Nose attitude, radians. */
  readonly pitch: number;
  /** Throttle lever and engine output, 0..1 (the same number: the engine has settled). */
  readonly lever: number;
  /** True when the plane can fly this speed and path with at most full power. */
  readonly ok: boolean;
}

/**
 * Steady flight at `speed` (true m/s) on a straight path of `path` radians (negative = descending), wings level, at
 * world height `z`: the pitch that lifts the weight across the path, and the lever that holds the speed. Solved from
 * the same aero and thrust the sim uses, so the residual force is zero. `gearCounts` is the extra gear drag.
 */
export function trimAt(speed: number, path: number, z: number, altitudeScale: number, tuning: Tuning, gearCounts = 0, flaps = 0): Trim {
  const m = tuning.massT * 1000;
  const sigma = densityRatio(z, altitudeScale);
  const q = dynamicPressure(speed, sigma);
  const need = m * GRAVITY * Math.cos(path);
  const wing = wingAt(flaps, 0, tuning);
  const stall = wing.stallRad;
  const extra = gearCounts + wing.extraCd0Counts;
  // Lift rises with alpha up to its peak; bisect for the alpha that carries the weight, thrust's up-component aside.
  const liftAt = (a: number): number => q * WING_AREA * aeroAt(a, stall, tuning, wing.cl0, extra).cl;
  let lo = -5 * DEG;
  let hi = (tuning.stallDeg - 2) * DEG;
  if (liftAt(hi) < need) return { pitch: hi + path, lever: 1, ok: false };
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (liftAt(mid) < need) lo = mid;
    else hi = mid;
  }
  // Thrust adds a little lift; refine alpha once with it included.
  let alpha = (lo + hi) / 2;
  let t = 0;
  for (let k = 0; k < 4; k++) {
    const drag = q * WING_AREA * aeroAt(alpha, stall, tuning, wing.cl0, extra).cd;
    t = (drag + m * GRAVITY * Math.sin(path)) / Math.cos(alpha);
    lo = -5 * DEG;
    hi = (tuning.stallDeg - 2) * DEG;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (liftAt(mid) + t * Math.sin(mid) < need) lo = mid;
      else hi = mid;
    }
    alpha = (lo + hi) / 2;
  }
  const full = thrust(1, tuning, sigma);
  const lever = Math.min(1, Math.max(0, t / full));
  return { pitch: alpha + path, lever, ok: t >= 0 && t <= full };
}
