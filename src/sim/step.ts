import { CEILING_NOSE_RATE_DEG, CEILING_SOFT_M, GRAVITY, PATH_LIMIT_DEG, SPEED_CAP, SPEED_FLOOR } from '../config/flight';
import { CEILING_Z, PLACE_CLEARANCE, STEP_S, TUNING_RANGES } from '../config/motion';
import { wrapHeading } from './angles';
import type { Command } from './commands';
import { sweepContact } from './contact';
import { liftAngle } from './flight/aero';
import { stepBank, stepPitch, turnHelp } from './flight/attitude';
import { densityRatio, forcesOn } from './flight/forces';
import { initialState, type Axis, type SimState } from './state';

/** The world as the simulation sees it: the map size and the top surface. */
export interface SimWorld {
  readonly width: number;
  readonly height: number;
  /** Top surface: water or ground, world m. */
  heightAt(x: number, y: number): number;
  /** Real meters of altitude per world meter; air density needs real height. */
  readonly altitudeScale: number;
}

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function toAxis(v: number): Axis | null {
  return v === -1 || v === 0 || v === 1 ? v : null;
}

/** Applies commands at the current tick. Time and tick do not change. */
export function applyCommands(state: SimState, commands: readonly Command[], world: SimWorld): SimState {
  let { craft, controls, crash, tuning } = state;
  for (const c of commands) {
    switch (c.kind) {
      case 'turn':
      case 'throttle':
      case 'pitch': {
        const v = toAxis(c.value);
        if (v !== null) controls = { ...controls, [c.kind]: v };
        break;
      }
      case 'place':
        if (!crash && Number.isFinite(c.x) && Number.isFinite(c.y)) {
          const x = clamp(c.x, 0, world.width);
          const y = clamp(c.y, 0, world.height);
          craft = { ...craft, x, y, z: Math.max(craft.z, world.heightAt(x, y) + PLACE_CLEARANCE) };
        }
        break;
      case 'rotate':
        if (!crash && Number.isFinite(c.by)) craft = { ...craft, heading: wrapHeading(craft.heading + c.by) };
        break;
      case 'tune': {
        const range = Object.hasOwn(TUNING_RANGES, c.key) ? TUNING_RANGES[c.key] : undefined;
        if (range && Number.isFinite(c.value)) {
          const value = clamp(c.value, range.min, range.max);
          if (tuning[c.key] !== value) tuning = { ...tuning, [c.key]: value };
        }
        break;
      }
      case 'restart':
        if (crash) {
          craft = initialState().craft;
          crash = null;
        }
        break;
    }
  }
  if (craft === state.craft && controls === state.controls && crash === state.crash && tuning === state.tuning) {
    return state;
  }
  return { ...state, craft, controls, crash, tuning };
}

/**
 * Exactly one 1/60 s step: lever and engine, nose pitch, forces (new pitch, old path), path angle, ceiling,
 * heading, speed (using the new path), then position. Once crashed, only the tick moves.
 */
export function advance(state: SimState, world: SimWorld): SimState {
  if (state.crash) return { ...state, tick: state.tick + 1 };
  const { craft, controls, tuning } = state;
  const lever = clamp(craft.lever + controls.throttle * (tuning.leverRatePctS / 100) * STEP_S, 0, 1);
  const spool = craft.spool + (lever - craft.spool) * (1 - Math.exp(-STEP_S / tuning.spoolTauS));
  const sigma0 = densityRatio(craft.z, world.altitudeScale);
  const bank = stepBank(craft.bank, controls.turn, craft.speed, sigma0, tuning, STEP_S);
  // Turn help is fed in as the bank changes, so there is one pitch value and rolling out gives it back.
  const help = turnHelp(bank, craft.speed, sigma0, tuning) - turnHelp(craft.bank, craft.speed, sigma0, tuning);

  const before = forcesOn(craft, tuning, world.altitudeScale);
  const attitude = stepPitch(
    {
      pitch: craft.pitch + help,
      pitchRate: craft.pitchRate,
      key: controls.pitch,
      speed: craft.speed,
      sigma: before.sigma,
      alpha: before.alpha,
      separation: before.separation,
      loadFactor: before.loadFactor,
    },
    tuning,
    STEP_S,
  );
  let pitch = attitude.pitch;
  const pitchRate = attitude.pitchRate;

  const f = forcesOn({ ...craft, pitch, bank, lever, spool }, tuning, world.altitudeScale);
  const pathLimit = PATH_LIMIT_DEG * DEG;
  let pathAngle = clamp(craft.pathAngle + f.dPathDt * STEP_S, -pathLimit, pathLimit);

  // Soft ceiling: near the top the path is turned level, so energy is redirected, never added or removed.
  const ceilingPath = (CEILING_Z - craft.z) / CEILING_SOFT_M;
  if (pathAngle > ceilingPath) {
    pathAngle = Math.max(ceilingPath, 0);
    const target = pathAngle + liftAngle(1 / Math.cos(bank), craft.speed, f.sigma, tuning);
    pitch = Math.min(pitch, Math.max(target, craft.pitch - CEILING_NOSE_RATE_DEG * DEG * STEP_S));
  }

  const heading = wrapHeading(craft.heading + f.dHeadingDt * STEP_S);
  const speed = clamp(craft.speed + (f.along - GRAVITY * Math.sin(pathAngle)) * STEP_S, SPEED_FLOOR, SPEED_CAP);
  const avg = (craft.speed + speed) / 2;

  const ground = avg * Math.cos(pathAngle) * STEP_S;
  const x = clamp(craft.x + Math.sin(heading) * ground, 0, world.width);
  const y = clamp(craft.y + Math.cos(heading) * ground, 0, world.height);
  let z = craft.z + avg * Math.sin(pathAngle) * STEP_S;
  if (z >= CEILING_Z) {
    z = CEILING_Z;
    if (pathAngle > 0) pathAngle = 0;
  }

  const tick = state.tick + 1;
  const hit = sweepContact(world.heightAt, craft, { x, y, z });
  if (hit) {
    return {
      ...state,
      tick,
      craft: { ...hit, heading, speed: 0, pathAngle, pitch, pitchRate: 0, bank, lever: 0, spool: 0 },
      crash: { tick, speed, pathAngle },
    };
  }
  return { ...state, tick, craft: { x, y, z, heading, speed, pathAngle, pitch, pitchRate, bank, lever, spool } };
}
