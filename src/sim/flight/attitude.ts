import { AUTH_FULL, BANK_MAX_DEG, CL_ALPHA, GRAVITY, LEVEL_RATE_DEG, TURN_HELP_CAP_DEG, WING_AREA, AUTH_MIN, AUTH_ZERO, LOAD_FADE, LOAD_MAX, LOAD_MIN, PITCH_LAG, PITCH_MAX_CMD_DEG } from '../../config/flight';
import type { Tuning } from '../../config/motion';
import type { Axis } from '../state';
import { dynamicPressure } from './aero';

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** How well the controls bite: 0.2 when slow, full from AUTH_FULL (equivalent airspeed, m/s). */
export function authority(speed: number, sigma: number): number {
  return clamp((speed * Math.sqrt(sigma) - AUTH_ZERO) / (AUTH_FULL - AUTH_ZERO), AUTH_MIN, 1);
}

export interface PitchInput {
  readonly pitch: number;
  readonly pitchRate: number;
  readonly key: Axis;
  readonly speed: number;
  readonly sigma: number;
  /** Angle of attack, radians, at the start of the step. */
  readonly alpha: number;
  /** Separation 0..1 at the start of the step. */
  readonly separation: number;
  /** Load factor at the start of the step. */
  readonly loadFactor: number;
}

/**
 * One step of the nose. The keys command a pitch rate (it ramps, not jolts) and the attitude stays where it is
 * released. Nose-up stops working in a stall and near the load limit; nose-down fades near -1 g. While
 * separated the nose drops by itself, which is the stall. Returns the new pitch and pitch rate.
 */
export function stepPitch(i: PitchInput, tuning: Tuning, dt: number): { pitch: number; pitchRate: number } {
  const auth = authority(i.speed, i.sigma);
  // Separation on the positive side blocks nose-up; on the negative side it blocks nose-down.
  const sUp = i.alpha > 0 ? i.separation : 0;
  const sDown = i.alpha < 0 ? i.separation : 0;
  const fade =
    i.key > 0
      ? (1 - sUp) * clamp((LOAD_MAX - i.loadFactor) / LOAD_FADE, 0, 1)
      : i.key < 0
        ? (1 - sDown) * clamp(i.loadFactor - LOAD_MIN, 0, 1)
        : 1;
  const target = i.key * tuning.pitchRateDegS * DEG * auth * fade;
  let pitchRate = i.pitchRate + (target - i.pitchRate) * (1 - Math.exp(-dt / PITCH_LAG));
  let pitch = i.pitch + pitchRate * dt - Math.sign(i.alpha) * i.separation * tuning.stallDropDegS * DEG * dt;
  const max = PITCH_MAX_CMD_DEG * DEG;
  if (pitch > max || pitch < -max) {
    pitch = clamp(pitch, -max, max);
    pitchRate = 0;
  }
  return { pitch, pitchRate };
}

/**
 * One step of the bank. A held key rolls at the roll rate (scaled by authority) up to the limit; a released bank
 * stays put, except a small one (under `levelBelowDeg`), which settles to exactly level. A steep bank never rescues itself.
 */
export function stepBank(bank: number, key: Axis, speed: number, sigma: number, tuning: Tuning, dt: number): number {
  const max = BANK_MAX_DEG * DEG;
  if (key !== 0) return clamp(bank + key * tuning.rollRateDegS * DEG * authority(speed, sigma) * dt, -max, max);
  if (Math.abs(bank) < tuning.levelBelowDeg * DEG) {
    const move = LEVEL_RATE_DEG * DEG * dt;
    return Math.abs(bank) <= move ? 0 : bank - Math.sign(bank) * move;
  }
  return bank;
}

/**
 * Nose-up (radians) that a bank of this size asks for, so a shallow level turn holds height by itself:
 * the extra lift 1/cos(b) - 1 at the lift slope. It stops growing at `turnHelpDeg` and is capped. The step adds
 * the change in help as the bank changes, so rolling out gives it back.
 */
export function turnHelp(bank: number, speed: number, sigma: number, tuning: Tuning): number {
  const b = Math.min(Math.abs(bank), tuning.turnHelpDeg * DEG);
  const q = dynamicPressure(speed, sigma);
  const a = ((tuning.massT * 1000 * GRAVITY) / (q * WING_AREA)) * (1 / Math.cos(b) - 1) / CL_ALPHA;
  return clamp(a, 0, TURN_HELP_CAP_DEG * DEG);
}
