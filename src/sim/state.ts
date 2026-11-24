import { DEFAULT_TUNING, START_HEADING, START_LEVER, START_PITCH, START_SPEED, START_X, START_Y, START_Z, type Tuning } from '../config/motion';

export type Axis = -1 | 0 | 1;

export interface Craft {
  /** World meters. */
  readonly x: number;
  readonly y: number;
  /** World m above sea level. */
  readonly z: number;
  /** Radians clockwise from north, 0..2pi. */
  readonly heading: number;
  /** m/s. */
  readonly speed: number;
  /** Direction of travel, radians, positive = climbing. */
  readonly pathAngle: number;
  /** Where the nose points, radians, positive = up. The angle of attack is pitch - pathAngle. */
  readonly pitch: number;
  /** Rate of change of pitch, rad/s; follows the keys with a short lag. */
  readonly pitchRate: number;
  /** Radians, positive = right wing down. Banked lift turns the heading. */
  readonly bank: number;
  /** Rate of change of bank, rad/s, positive = right wing down; follows the keys with a lag. */
  readonly rollRate: number;
  /** Throttle lever, 0..1. Stays where the keys leave it. */
  readonly lever: number;
  /** Engine output, 0..1; follows the lever with a lag. */
  readonly spool: number;
}

export interface Controls {
  /** Roll: +1 = bank right (D). Also steers on the ground from C4. */
  readonly turn: Axis;
  readonly throttle: Axis;
  /** +1 = nose up. */
  readonly pitch: Axis;
  /** Wings level is running: the bank rolls to zero and stops. Any roll key cancels it. */
  readonly level: boolean;
}

/** What the craft was doing at impact. */
export interface Crash {
  readonly tick: number;
  readonly speed: number;
  readonly pathAngle: number;
}

export interface SimState {
  readonly tick: number;
  readonly craft: Craft;
  readonly controls: Controls;
  readonly crash: Crash | null;
  /** Live-tunable motion values. Changed only by the `tune` command. */
  readonly tuning: Tuning;
}

export function initialState(): SimState {
  return {
    tick: 0,
    craft: { x: START_X, y: START_Y, z: START_Z, heading: START_HEADING, speed: START_SPEED, pathAngle: 0, pitch: START_PITCH, pitchRate: 0, bank: 0, rollRate: 0, lever: START_LEVER, spool: START_LEVER },
    controls: { turn: 0, throttle: 0, pitch: 0, level: false },
    crash: null,
    tuning: DEFAULT_TUNING,
  };
}
