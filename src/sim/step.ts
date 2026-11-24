import { CEILING_Z, PLACE_CLEARANCE, SPEED_MIN, STEP_S, TUNING_RANGES } from '../config/motion';
import { wrapHeading } from './angles';
import type { Command } from './commands';
import { sweepContact } from './contact';
import { initialState, type Axis, type SimState } from './state';

/** The world as the simulation sees it: the map size and the top surface. */
export interface SimWorld {
  readonly width: number;
  readonly height: number;
  /** Top surface: water or ground, world m. */
  heightAt(x: number, y: number): number;
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
 * Exactly one 1/60 s step: speed, heading, flight path angle, then position.
 * Once crashed, only the tick moves.
 */
export function advance(state: SimState, world: SimWorld): SimState {
  if (state.crash) return { ...state, tick: state.tick + 1 };
  const { craft, controls, tuning } = state;
  const speed = clamp(craft.speed + controls.throttle * tuning.speedRate * STEP_S, SPEED_MIN, tuning.speedMax);
  const heading = wrapHeading(craft.heading + controls.turn * tuning.turnRateDegS * DEG * STEP_S);

  const target = controls.pitch * tuning.pathMaxDeg * DEG;
  const maxMove = tuning.pathRateDegS * DEG * STEP_S;
  const diff = target - craft.pathAngle;
  let pathAngle = Math.abs(diff) <= maxMove ? target : craft.pathAngle + Math.sign(diff) * maxMove;

  const ground = speed * Math.cos(pathAngle) * STEP_S;
  const x = clamp(craft.x + Math.sin(heading) * ground, 0, world.width);
  const y = clamp(craft.y + Math.cos(heading) * ground, 0, world.height);
  let z = craft.z + speed * Math.sin(pathAngle) * STEP_S;
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
      craft: { ...hit, heading, speed: 0, pathAngle },
      crash: { tick, speed, pathAngle },
    };
  }
  return { ...state, tick, craft: { x, y, z, heading, speed, pathAngle } };
}
