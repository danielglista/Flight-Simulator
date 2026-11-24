import { AUTH_FULL, BANK_MAX_DEG, CL_ALPHA, GRAVITY, LEVEL_GAIN, ROLL_LAG_S, TURN_HELP_CAP_DEG, WING_AREA, AUTH_MIN, AUTH_ZERO, LOAD_FADE, LOAD_MAX, LOAD_MIN, PITCH_LAG, PITCH_MAX_CMD_DEG } from '../../config/flight';
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

export interface BankInput {
  readonly bank: number;
  readonly rollRate: number;
  readonly key: Axis;
  /** Wings-level is on: roll toward zero bank and stop there. A held key cancels it. */
  readonly level: boolean;
  readonly speed: number;
  readonly sigma: number;
}

/** Wings level is done when the bank and the roll rate are both this small (radians, rad/s). */
const LEVEL_DONE_BANK = 0.2 * DEG;
const LEVEL_DONE_RATE = 2 * DEG;

/**
 * One step of the bank. The keys command a roll rate (scaled by authority) that follows through a lag, so a tap
 * is a small repeatable change and a hold is a full roll. A released bank stays where it is. Wings level rolls
 * toward zero at up to the roll rate, easing in, and stops at exactly zero without crossing it. Returns the new
 * bank, roll rate, and whether wings level is still running.
 */
export function stepBank(i: BankInput, tuning: Tuning, dt: number): { bank: number; rollRate: number; level: boolean } {
  const max = BANK_MAX_DEG * DEG;
  const r = tuning.rollRateDegS * DEG * authority(i.speed, i.sigma);
  const level = i.level && i.key === 0;
  const target = i.key !== 0 ? i.key * r : level ? clamp(-i.bank * LEVEL_GAIN, -r, r) : 0;
  let rollRate = i.rollRate + (target - i.rollRate) * (1 - Math.exp(-dt / ROLL_LAG_S));
  let bank = i.bank + rollRate * dt;
  if (bank > max || bank < -max) {
    bank = clamp(bank, -max, max);
    rollRate = 0;
  }
  if (level) {
    const crossed = i.bank !== 0 && Math.sign(bank) !== Math.sign(i.bank);
    if (crossed || (Math.abs(bank) < LEVEL_DONE_BANK && Math.abs(rollRate) < LEVEL_DONE_RATE)) {
      return { bank: 0, rollRate: 0, level: false };
    }
  }
  return { bank, rollRate, level };
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
