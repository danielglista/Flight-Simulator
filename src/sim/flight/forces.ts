import { CL_CAP, GRAVITY, Q_FLOOR, RHO0, SAG_DEG, SAG_FULL, SAG_START, THRUST_LAPSE, WING_AREA } from '../../config/flight';
import type { Tuning } from '../../config/motion';
import type { Craft } from '../state';

const DEG = Math.PI / 180;

/** Air density relative to sea level, standard troposphere. `z` is world m; `altitudeScale` is real m per world m. */
export function densityRatio(z: number, altitudeScale: number): number {
  const h = Math.max(0, z * altitudeScale);
  const base = Math.max(0, 1 - 2.25577e-5 * h);
  return Math.pow(base, 4.2559);
}

/** Engine thrust, N. */
export function thrust(spool: number, tuning: Tuning, sigma: number): number {
  return spool * tuning.thrustMaxKn * 1000 * Math.pow(sigma, THRUST_LAPSE);
}

/**
 * Drag, N, for level-ish flight along a path. The lift coefficient is the one the path would need
 * (the path is commanded in C1). C2 changes where it comes from, not Cd(Cl).
 */
export function drag(speed: number, pathAngle: number, sigma: number, tuning: Tuning): number {
  const q = 0.5 * RHO0 * sigma * speed * speed;
  const m = tuning.massT * 1000;
  const cl = Math.min(CL_CAP, (m * GRAVITY * Math.cos(pathAngle)) / (Math.max(q, Q_FLOOR) * WING_AREA));
  const cd = tuning.cd0Counts / 10000 + (tuning.inducedCounts / 10000) * cl * cl;
  return q * WING_AREA * cd;
}

/** Slow-flight placeholder, deleted in C2: the highest path angle allowed at this speed. */
export function sagLimit(speed: number, sigma: number, pathMaxRad: number): number {
  const ve = speed * Math.sqrt(sigma);
  const f = Math.min(1, Math.max(0, (ve - SAG_FULL) / (SAG_START - SAG_FULL)));
  if (f >= 1) return pathMaxRad;
  return -SAG_DEG * DEG + (pathMaxRad + SAG_DEG * DEG) * f;
}

export interface Forces {
  readonly sigma: number;
  /** Newtons. */
  readonly thrust: number;
  readonly drag: number;
  /** Weight along the path, positive when it slows the craft. */
  readonly weight: number;
  /** Speed change, m/s per s. */
  readonly dVdt: number;
}

/** Everything that changes speed, for the step and the debug panel alike. */
export function forcesOn(craft: Craft, tuning: Tuning, altitudeScale: number): Forces {
  const sigma = densityRatio(craft.z, altitudeScale);
  const t = thrust(craft.spool, tuning, sigma);
  const d = drag(craft.speed, craft.pathAngle, sigma, tuning);
  const m = tuning.massT * 1000;
  const w = m * GRAVITY * Math.sin(craft.pathAngle);
  return { sigma, thrust: t, drag: d, weight: w, dVdt: (t - d) / m - GRAVITY * Math.sin(craft.pathAngle) };
}
