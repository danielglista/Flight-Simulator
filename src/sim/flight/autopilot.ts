import { ALT_TAU_S, AP_BANK_DEG, AP_CLIMB_FADE, AP_DOWN_DEG, AP_FLOOR_MULT, AP_HDG_GAIN, AP_PITCH_GAIN_DEG, AP_ROLL_GAIN, AP_SPD_DAMP, AP_SPD_GAIN, AP_UP_DEG, GRAVITY } from '../../config/flight';
import type { Tuning } from '../../config/motion';
import type { Autopilot, Craft } from '../state';
import { liftAngle } from './aero';
import { densityRatio, forcesOn, thrust } from './forces';
import { levelStallSpeed } from './vspeeds';

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Each is -1..1, a share of what the keys can command; null = the keys decide. */
export interface ApOutput {
  readonly pitch: number | null;
  readonly roll: number | null;
  readonly throttle: number | null;
}

/** Shortest signed turn from `from` to `to`, radians, positive = right; exactly opposite counts as right. */
export function headingError(from: number, to: number): number {
  const d = (((to - from) % TWO_PI) + TWO_PI) % TWO_PI;
  return d > Math.PI ? d - TWO_PI : d;
}

/**
 * The control law. Pure. ALT runs while `ap.alt`, HDG while `ap.hdg`, SPD while `ap.spd`. It has no more authority than the keys:
 * pitch is a share of the pitch rate, roll of the roll rate, throttle of the lever rate, and load, stall and nose
 * limits still apply in the step.
 */
export function autopilotOutput(craft: Craft, ap: Pick<Autopilot, 'hdg' | 'alt' | 'spd' | 'headingTarget' | 'targetZ' | 'targetIas'>, tuning: Tuning, altitudeScale: number): ApOutput {
  const sigma = densityRatio(craft.z, altitudeScale);
  const ias = craft.speed * Math.sqrt(sigma);
  const vs = levelStallSpeed(tuning, craft.bank, craft.flaps);
  const speedErr = ap.spd ? Math.max(ap.targetIas, AP_FLOOR_MULT * vs) - ias : 0;
  let pitch: number | null = null;
  let roll: number | null = null;
  let throttle: number | null = null;

  if (ap.alt) {
    const [fade0, fade1] = AP_CLIMB_FADE;
    let up = AP_UP_DEG * DEG * clamp((ias - fade0 * vs) / ((fade1 - fade0) * vs), 0, 1);
    let down = AP_DOWN_DEG * DEG;
    if (ap.spd && craft.lever >= 0.999 && speedErr > 0) up *= clamp(1 - (speedErr - 1) / 4, 0, 1);
    if (ap.spd && craft.lever <= 0.001 && speedErr < 0) down *= clamp(1 - (-speedErr - 1) / 4, 0.1, 1);
    const path = clamp(Math.asin(clamp((ap.targetZ - craft.z) / ALT_TAU_S / craft.speed, -1, 1)), -down, up);
    const alpha = craft.pitch - craft.pathAngle;
    const m = tuning.massT * 1000;
    const n = (Math.cos(craft.pathAngle) - (thrust(craft.spool, tuning, sigma) * Math.sin(alpha)) / (m * GRAVITY)) / Math.max(Math.cos(craft.bank), 0.5);
    const nose = path + Math.min(liftAngle(n, craft.speed, sigma, tuning, craft.flaps), (tuning.stallDeg - 4) * DEG);
    pitch = clamp((nose - craft.pitch) / (AP_PITCH_GAIN_DEG * DEG), -1, 1);
  }

  if (ap.hdg) {
    const bankWanted = clamp(AP_HDG_GAIN * headingError(craft.heading, ap.headingTarget), -AP_BANK_DEG * DEG, AP_BANK_DEG * DEG);
    roll = clamp(((bankWanted - craft.bank) * AP_ROLL_GAIN) / (tuning.rollRateDegS * DEG), -1, 1);
  }

  if (ap.spd) {
    const accel = (forcesOn(craft, tuning, altitudeScale).along - GRAVITY * Math.sin(craft.pathAngle)) * Math.sqrt(sigma);
    throttle = clamp(AP_SPD_GAIN * speedErr - AP_SPD_DAMP * accel, -1, 1);
  }
  return { pitch, roll, throttle };
}
