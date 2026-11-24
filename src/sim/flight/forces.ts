import { COS_FLOOR, GRAVITY, SPEED_FLOOR, THRUST_LAPSE, WING_AREA } from '../../config/flight';
import type { Tuning } from '../../config/motion';
import type { Craft } from '../state';
import { aeroAt, dynamicPressure } from './aero';

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

export interface Forces {
  readonly sigma: number;
  /** Angle of attack, radians. */
  readonly alpha: number;
  /** Separation 0..1. */
  readonly separation: number;
  /** Newtons. */
  readonly thrust: number;
  readonly lift: number;
  readonly drag: number;
  /** Lift divided by weight. */
  readonly loadFactor: number;
  /** Weight along the path, positive when it slows the craft. */
  readonly weight: number;
  /** Thrust minus drag along the flight direction, per unit mass, m/s per s. */
  readonly along: number;
  /** Speed change, m/s per s, with this path angle. */
  readonly dVdt: number;
  /** Path angle change, rad/s. */
  readonly dPathDt: number;
  /** Heading change, rad/s, clockwise positive. Banked lift times `turnMult`; never affects energy. */
  readonly dHeadingDt: number;
}

/** Everything that changes speed and path, for the step and the debug panel alike. */
export function forcesOn(craft: Craft, tuning: Tuning, altitudeScale: number): Forces {
  const sigma = densityRatio(craft.z, altitudeScale);
  const m = tuning.massT * 1000;
  const q = dynamicPressure(craft.speed, sigma);
  const alpha = craft.pitch - craft.pathAngle;
  const aero = aeroAt(alpha, tuning.stallDeg * DEG, tuning);
  const t = thrust(craft.spool, tuning, sigma);
  const lift = q * WING_AREA * aero.cl;
  const drag = q * WING_AREA * aero.cd;
  const along = (t * Math.cos(alpha) - drag) / m;
  const g = craft.pathAngle;
  const cosB = Math.cos(craft.bank);
  const v = Math.max(craft.speed, SPEED_FLOOR);
  return {
    sigma,
    alpha,
    separation: aero.separation,
    thrust: t,
    lift,
    drag,
    loadFactor: lift / (m * GRAVITY),
    weight: m * GRAVITY * Math.sin(g),
    along,
    dVdt: along - GRAVITY * Math.sin(g),
    dPathDt: ((lift * cosB + t * Math.sin(alpha)) / m - GRAVITY * Math.cos(g)) / v,
    dHeadingDt: (tuning.turnMult * lift * Math.sin(craft.bank)) / (m * v * Math.max(Math.cos(g), COS_FLOOR)),
  };
}
