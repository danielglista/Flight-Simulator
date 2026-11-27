import {
  GRASS_BRAKE_MU,
  GRASS_MU,
  GRAVITY,
  LANDED_SPEED,
  SPOILER_CD,
  SPOILER_LEVER,
  SPOILER_LIFT,
  TD_BANK_DEG,
  TD_PITCH_MAX_DEG,
  TD_PITCH_MIN_DEG,
  GROUND_AUTH_FULL,
  GROUND_AUTH_ZERO,
  GROUND_BANK_TAU,
  LIFTOFF_CLEAR,
  LIFTOFF_MARGIN,
  NOSE_FALL_DEG,
  NOSE_FALL_MAX_DEG,
  PITCH_LAG,
  ROLL_MU,
  SPEED_CAP,
  STEER_LATERAL,
  STEER_MAX_DEG,
  STEER_RADIUS,
  TAIL_LIMIT_DEG,
  WING_AREA,
} from '../../config/flight';
import { STEP_S } from '../../config/motion';
import type { Tuning } from '../../config/motion';
import { wrapHeading } from '../angles';
import type { Axis, CrashCause, SimState } from '../state';
import type { SimWorld } from '../step';
import type { GroundKind } from '../world/groundKind';
import { aeroAt, dynamicPressure } from './aero';
import { nextPitchHold, pitchRamp } from './attitude';
import { densityRatio, stepEngine, thrust } from './forces';
import { stepGear } from './gear';
import { stepFlaps, wingAt, type Wing } from './wing';

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Heading rate on the ground, rad/s, clockwise positive: tight when taxiing, gentle when fast. Zero at rest. */
export function steerRate(speed: number, key: Axis): number {
  if (key === 0 || !(speed > 0)) return 0;
  return key * Math.min(speed / STEER_RADIUS, STEER_MAX_DEG * DEG, STEER_LATERAL / speed);
}

/** How well the nose bites on the ground, 0..1, from equivalent airspeed. */
export function groundAuthority(speed: number, sigma: number): number {
  return clamp((speed * Math.sqrt(sigma) - GROUND_AUTH_ZERO) / (GROUND_AUTH_FULL - GROUND_AUTH_ZERO), 0, 1);
}

/**
 * One step of the nose on the wheels. The key commands a pitch rate scaled by authority; the nose stays where it is
 * released while there is authority, falls as the tail loses bite, and is held between level and the tail limit.
 * From above the limit it eases down, never snaps.
 */
export function stepGroundNose(
  pitch: number,
  pitchRate: number,
  hold: number,
  key: Axis,
  speed: number,
  sigma: number,
  tuning: Tuning,
  dt: number,
): { pitch: number; pitchRate: number; hold: number } {
  const auth = groundAuthority(speed, sigma);
  const limit = TAIL_LIMIT_DEG * DEG;
  const nextHold = nextPitchHold(hold, key, dt);
  const target = key * tuning.pitchRateDegS * DEG * auth * pitchRamp(nextHold);
  let rate = pitchRate + (target - pitchRate) * (1 - Math.exp(-dt / PITCH_LAG));
  let p = pitch + rate * dt - (1 - auth) * NOSE_FALL_DEG * DEG * dt;
  if (pitch > limit) {
    p = Math.max(limit, Math.min(p, pitch) - NOSE_FALL_MAX_DEG * DEG * dt);
    rate = 0;
  } else if (p <= 0 || p >= limit) {
    p = clamp(p, 0, limit);
    rate = 0;
  }
  return { pitch: p, pitchRate: rate, hold: nextHold };
}

/** Ground spoilers are out on the wheels with the lever at or below SPOILER_LEVER. No key, no state. */
export const spoilersOut = (lever: number): boolean => lever <= SPOILER_LEVER;

/** True when the wings and thrust would lift more than the weight. Pitch and speed are those of the wheels. */
export function liftsOff(speed: number, pitch: number, spool: number, tuning: Tuning, sigma: number, liftMult = 1, wing: Wing = wingAt(0, 0, tuning)): boolean {
  const m = tuning.massT * 1000;
  const q = dynamicPressure(speed, sigma);
  const lift = q * WING_AREA * aeroAt(pitch, wing.stallRad, tuning, wing.cl0).cl * liftMult;
  return lift + thrust(spool, tuning, sigma) * Math.sin(pitch) > LIFTOFF_MARGIN * m * GRAVITY;
}

/** The conditions at contact with the ground. */
export interface Contact {
  readonly rough: boolean;
  readonly gearLocked: boolean;
  /** m/s, positive down. */
  readonly sink: number;
  /** Radians. */
  readonly bank: number;
  readonly pitch: number;
}

/**
 * Why a contact from the air is a crash, or null for a landing. Checked in order: terrain, gear, hard, bank, nose,
 * tail. Exactly at a limit survives.
 */
export function touchdownCheck(c: Contact, tuning: Pick<Tuning, 'touchdownSinkMs'>): CrashCause | null {
  if (c.rough) return 'terrain';
  if (!c.gearLocked) return 'gear';
  if (c.sink > tuning.touchdownSinkMs) return 'hard';
  if (Math.abs(c.bank) > TD_BANK_DEG * DEG) return 'bank';
  if (c.pitch < TD_PITCH_MIN_DEG * DEG) return 'nose';
  if (c.pitch > TD_PITCH_MAX_DEG * DEG) return 'tail';
  return null;
}

/** Brake friction coefficient (added to rolling friction) on this ground. */
export const brakeMu = (kind: GroundKind, tuning: Pick<Tuning, 'brakePct'>): number =>
  kind === 'paved' ? tuning.brakePct / 100 : GRASS_BRAKE_MU * (tuning.brakePct / 40);

/** A survived touchdown, stopped on the ground and not crashed. The banner and restart use it. */
export const landed = (s: Pick<SimState, 'touchdown' | 'craft' | 'crash'>): boolean =>
  s.touchdown !== null && s.craft.onGround && s.craft.speed < LANDED_SPEED && !s.crash;

/**
 * Exactly one 1/60 s step on the wheels: lever and engine, nose, roll along the heading (thrust, drag, rolling
 * friction), steering, then position on the ground. Rough ground underneath is a crash (overrun). Lift beyond
 * weight leaves the ground. Bank eases to level and wings level is cleared.
 */
export function stepGround(state: SimState, world: SimWorld): SimState {
  const { craft, controls, tuning } = state;
  const m = tuning.massT * 1000;
  const { lever, spool } = stepEngine(craft, controls.throttle, tuning, STEP_S);
  const sigma = densityRatio(craft.z, world.altitudeScale);

  const nose = stepGroundNose(craft.pitch, craft.pitchRate, craft.pitchHold, controls.pitch, craft.speed, sigma, tuning, STEP_S);
  const pitch = nose.pitch;

  // Forces along the runway. The path is level, so the angle of attack is the pitch.
  const gear = stepGear(craft.gear, craft.gearDown, STEP_S);
  const flaps = stepFlaps(craft.flaps, craft.flapLever, STEP_S);
  const wing = wingAt(flaps, gear, tuning);
  const aero = aeroAt(pitch, wing.stallRad, tuning, wing.cl0, wing.extraCd0Counts);
  const spoilers = spoilersOut(lever);
  const q = dynamicPressure(craft.speed, sigma);
  const liftMult = spoilers ? SPOILER_LIFT : 1;
  const lift = q * WING_AREA * aero.cl * liftMult;
  const drag = q * WING_AREA * (aero.cd + (spoilers ? SPOILER_CD : 0));
  const t = thrust(spool, tuning, sigma);
  const normal = Math.max(0, m * GRAVITY - lift - t * Math.sin(pitch));
  const accel = (tuning.groundMult * t * Math.cos(pitch) - drag) / m;
  const kind = world.groundKind(craft.x, craft.y);
  const mu = (kind === 'paved' ? ROLL_MU : GRASS_MU) + (controls.brake ? brakeMu(kind, tuning) : 0);
  const pushed = Math.max(0, craft.speed + accel * STEP_S);
  const speed = clamp(pushed - ((mu * normal) / m) * STEP_S, 0, SPEED_CAP);
  const avg = (craft.speed + speed) / 2;

  const heading = wrapHeading(craft.heading + steerRate(craft.speed, controls.turn) * STEP_S);
  const bank = craft.bank * Math.exp(-STEP_S / GROUND_BANK_TAU);
  const x = clamp(craft.x + Math.sin(heading) * avg * STEP_S, 0, world.width);
  const y = clamp(craft.y + Math.cos(heading) * avg * STEP_S, 0, world.height);
  const z = world.heightAt(x, y);
  const tick = state.tick + 1;
  const nextControls = controls.level ? { ...controls, level: false } : controls;

  const hitBuilding = (world.obstacleAt?.(x, y, z) ?? NaN) > z;
  if (hitBuilding || world.groundKind(x, y) === 'rough') {
    return {
      ...state,
      tick,
      craft: { ...craft, x, y, z, heading, speed: 0, pathAngle: 0, pitch, pitchRate: 0, bank, rollRate: 0, lever: 0, spool: 0, onGround: false, gear, flaps },
      controls: nextControls,
      crash: { tick, speed, pathAngle: 0, cause: hitBuilding ? 'building' : 'overrun', sink: 0 },
    };
  }
  if (liftsOff(speed, pitch, spool, tuning, sigma, liftMult, wing)) {
    return {
      ...state,
      tick,
      craft: { ...craft, x, y, z: z + LIFTOFF_CLEAR, heading, speed, pathAngle: 0, pitch, pitchRate: nose.pitchRate, pitchHold: nose.hold, bank, rollRate: 0, lever, spool, onGround: false, gear, flaps },
      controls: nextControls,
      liftoffTick: tick,
    };
  }
  return {
    ...state,
    tick,
    craft: { ...craft, x, y, z, heading, speed, pathAngle: 0, pitch, pitchRate: nose.pitchRate, pitchHold: nose.hold, bank, rollRate: 0, lever, spool, onGround: true, gear, flaps },
    controls: nextControls,
  };
}
