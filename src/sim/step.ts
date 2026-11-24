import {
  CEILING_Z,
  PATH_MAX_DEG,
  PATH_RATE_DEG_S,
  PLACE_CLEARANCE,
  SPEED_MAX,
  SPEED_MIN,
  SPEED_RATE,
  STEP_S,
  TURN_RATE_DEG_S,
} from '../config/motion';
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
  let { craft, controls, crash } = state;
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
      case 'restart':
        if (crash) {
          craft = initialState().craft;
          crash = null;
        }
        break;
    }
  }
  if (craft === state.craft && controls === state.controls && crash === state.crash) return state;
  return { ...state, craft, controls, crash };
}

/**
 * Exactly one 1/60 s step: speed, heading, flight path angle, then position.
 * Once crashed, only the tick moves.
 */
export function advance(state: SimState, world: SimWorld): SimState {
  if (state.crash) return { ...state, tick: state.tick + 1 };
  const { craft, controls } = state;
  const speed = clamp(craft.speed + controls.throttle * SPEED_RATE * STEP_S, SPEED_MIN, SPEED_MAX);
  const heading = wrapHeading(craft.heading + controls.turn * TURN_RATE_DEG_S * DEG * STEP_S);

  const target = controls.pitch * PATH_MAX_DEG * DEG;
  const maxMove = PATH_RATE_DEG_S * DEG * STEP_S;
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
