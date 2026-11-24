import { START_HEADING, START_SPEED, START_X, START_Y } from '../config/motion';

export type Axis = -1 | 0 | 1;

export interface Craft {
  /** World meters. */
  readonly x: number;
  readonly y: number;
  /** Radians clockwise from north, 0..2pi. */
  readonly heading: number;
  /** m/s. */
  readonly speed: number;
}

export interface Controls {
  readonly turn: Axis;
  readonly throttle: Axis;
}

export interface SimState {
  readonly tick: number;
  readonly craft: Craft;
  readonly controls: Controls;
}

export function initialState(): SimState {
  return {
    tick: 0,
    craft: { x: START_X, y: START_Y, heading: START_HEADING, speed: START_SPEED },
    controls: { turn: 0, throttle: 0 },
  };
}
