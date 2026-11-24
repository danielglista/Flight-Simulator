import { SPEED_MAX, SPEED_MIN, SPEED_RATE, STEP_S, TURN_RATE_DEG_S } from '../config/motion';
import { wrapHeading } from './angles';
import type { Command } from './commands';
import type { Axis, SimState } from './state';

export interface SimBounds {
  readonly width: number;
  readonly height: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function toAxis(v: number): Axis | null {
  return v === -1 || v === 0 || v === 1 ? v : null;
}

/** Applies commands at the current tick. Time and tick do not change. */
export function applyCommands(
  state: SimState,
  commands: readonly Command[],
  bounds: SimBounds,
): SimState {
  let { craft, controls } = state;
  for (const c of commands) {
    switch (c.kind) {
      case 'turn': {
        const v = toAxis(c.value);
        if (v !== null) controls = { ...controls, turn: v };
        break;
      }
      case 'throttle': {
        const v = toAxis(c.value);
        if (v !== null) controls = { ...controls, throttle: v };
        break;
      }
      case 'place':
        if (Number.isFinite(c.x) && Number.isFinite(c.y)) {
          craft = {
            ...craft,
            x: clamp(c.x, 0, bounds.width),
            y: clamp(c.y, 0, bounds.height),
          };
        }
        break;
      case 'rotate':
        if (Number.isFinite(c.by)) craft = { ...craft, heading: wrapHeading(craft.heading + c.by) };
        break;
    }
  }
  return craft === state.craft && controls === state.controls ? state : { ...state, craft, controls };
}

/** Exactly one 1/60 s step: speed, then heading, then position with the new heading. */
export function advance(state: SimState, bounds: SimBounds): SimState {
  const { craft, controls } = state;
  const speed = clamp(craft.speed + controls.throttle * SPEED_RATE * STEP_S, SPEED_MIN, SPEED_MAX);
  const heading = wrapHeading(
    craft.heading + (controls.turn * TURN_RATE_DEG_S * Math.PI * STEP_S) / 180,
  );
  const x = clamp(craft.x + Math.sin(heading) * speed * STEP_S, 0, bounds.width);
  const y = clamp(craft.y + Math.cos(heading) * speed * STEP_S, 0, bounds.height);
  return { ...state, tick: state.tick + 1, craft: { x, y, heading, speed } };
}
