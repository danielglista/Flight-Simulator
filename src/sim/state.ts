import { DEFAULT_TUNING, START_HEADING, START_LEVER, START_PITCH, START_SPEED, START_X, START_Y, START_Z, type Tuning } from '../config/motion';

export type Axis = -1 | 0 | 1;

export interface Craft {
  /** World meters. */
  readonly x: number;
  readonly y: number;
  /** World m above sea level. On the ground this is exactly the ground height under the wheels. */
  readonly z: number;
  /** Radians clockwise from north, 0..2pi. Also the direction of travel on the ground. */
  readonly heading: number;
  /** m/s. */
  readonly speed: number;
  /** Direction of travel, radians, positive = climbing. */
  readonly pathAngle: number;
  /** Where the nose points, radians, positive = up. The angle of attack is pitch - pathAngle. */
  readonly pitch: number;
  /** Rate of change of pitch, rad/s; follows the keys with a short lag. */
  readonly pitchRate: number;
  /** Signed seconds the pitch key has been held in one direction (positive = nose up); 0 when released. Sets how hard the key pulls. */
  readonly pitchHold: number;
  /** Radians, positive = right wing down. Banked lift turns the heading. */
  readonly bank: number;
  /** Rate of change of bank, rad/s, positive = right wing down; follows the keys with a lag. */
  readonly rollRate: number;
  /** Throttle lever, 0..1. Stays where the keys leave it. */
  readonly lever: number;
  /** Engine output, 0..1; follows the lever with a lag. */
  readonly spool: number;
  /** Wheels on the ground (C4). The ground step runs instead of the air step. */
  readonly onGround: boolean;
  /** Gear lever (C4B): true = chosen down. */
  readonly gearDown: boolean;
  /** Actual gear position, 0 (up) to 1 (down and locked); moves toward the lever over GEAR_TIME_S. */
  readonly gear: number;
  /** Flap lever (C6): 0 up, 1 takeoff, 2 landing. */
  readonly flapLever: FlapLever;
  /** Actual flap position, 0..1; moves toward lever / 2 over FLAP_TIME_S. */
  readonly flaps: number;
}

export type FlapLever = 0 | 1 | 2;

/** Why the autopilot refused or let go: a stability row (`stability.ts`), not settled long enough, or a flight key held. */
export type ApReason = 'GROUND' | 'LOW' | 'BANK' | 'PITCH' | 'STALL' | 'SLOW' | 'TERRAIN' | 'UNSETTLED' | 'controls';

export interface ApNotice {
  readonly tick: number;
  readonly kind: 'refused' | 'dropped';
  readonly reason: ApReason;
}

/** The autopilot (D4): three modes, each on or off by itself, and their targets. */
export interface Autopilot {
  readonly hdg: boolean;
  readonly alt: boolean;
  readonly spd: boolean;
  /** Radians clockwise from north. */
  readonly headingTarget: number;
  /** World m. */
  readonly targetZ: number;
  /** Indicated m/s. */
  readonly targetIas: number;
  readonly notice: ApNotice | null;
}

export const AUTOPILOT_OFF: Autopilot = { hdg: false, alt: false, spd: false, headingTarget: 0, targetZ: 0, targetIas: 0, notice: null };

/** Whether any mode is on. */
export const apActive = (a: Pick<Autopilot, 'hdg' | 'alt' | 'spd'>): boolean => a.hdg || a.alt || a.spd;

export interface Controls {
  /** Roll: +1 = bank right (D). Steers on the ground. */
  readonly turn: Axis;
  readonly throttle: Axis;
  /** +1 = nose up. */
  readonly pitch: Axis;
  /** Wings level is running: the bank rolls to zero and stops. Any roll key cancels it. */
  readonly level: boolean;
  /** Wheel brakes (Space held). Act only on the ground. */
  readonly brake: boolean;
}

/** Why the plane crashed. `terrain` is any contact with rough ground, water or a slope. */
export type CrashCause = 'terrain' | 'hard' | 'bank' | 'nose' | 'tail' | 'overrun' | 'gear' | 'building';

/** What the craft was doing at impact. */
export interface Crash {
  readonly tick: number;
  readonly speed: number;
  readonly pathAngle: number;
  readonly cause: CrashCause;
  /** Sink rate at impact, m/s, positive down (0 for an overrun). */
  readonly sink: number;
}

/** The last touchdown that was survived. */
export interface Touchdown {
  readonly tick: number;
  readonly x: number;
  readonly y: number;
  readonly heading: number;
  /** m/s, positive down. */
  readonly sink: number;
  readonly speed: number;
  readonly bank: number;
  readonly pitch: number;
  readonly kind: 'paved' | 'grass';
}

/** Where a start or restart puts the craft. Plain data. On the ground, `z` is replaced by the ground height. */
export interface StartSpec {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
  readonly speed: number;
  readonly pathAngle: number;
  readonly pitch: number;
  readonly lever: number;
  readonly spool: number;
  readonly onGround: boolean;
  /** Gear starts fully down (true) or fully up (false). */
  readonly gearDown: boolean;
  /** Flap lever the start begins with, flaps already at that position. */
  readonly flapLever: FlapLever;
}

/** Today's start: in the air, level, trimmed, gear up. */
export const AIR_START: StartSpec = {
  x: START_X,
  y: START_Y,
  z: START_Z,
  heading: START_HEADING,
  speed: START_SPEED,
  pathAngle: 0,
  pitch: START_PITCH,
  lever: START_LEVER,
  spool: START_LEVER,
  onGround: false,
  gearDown: false,
  flapLever: 0,
};

export interface SimState {
  readonly tick: number;
  readonly craft: Craft;
  readonly controls: Controls;
  readonly crash: Crash | null;
  /** Live-tunable motion values. Changed only by the `tune` command. */
  readonly tuning: Tuning;
  /** Where `restart` goes. */
  readonly start: StartSpec;
  /** Tick of the last liftoff from the ground, or null. */
  readonly liftoffTick: number | null;
  /** The last survived touchdown, or null (C5). Cleared by a restart or a new start. */
  readonly touchdown: Touchdown | null;
  readonly autopilot: Autopilot;
  /** Consecutive steps with `stability().stable` (D4). */
  readonly stableTicks: number;
}

/** The craft a start puts in the world. `groundHeight` is the top surface at the start's x and y. */
export function craftAt(start: StartSpec, groundHeight: number): Craft {
  return {
    x: start.x,
    y: start.y,
    z: start.onGround ? groundHeight : Math.max(start.z, groundHeight + 1),
    heading: start.heading,
    speed: start.speed,
    pathAngle: start.pathAngle,
    pitch: start.pitch,
    pitchRate: 0,
    pitchHold: 0,
    bank: 0,
    rollRate: 0,
    lever: start.lever,
    spool: start.spool,
    onGround: start.onGround,
    gearDown: start.gearDown,
    gear: start.gearDown ? 1 : 0,
    flapLever: start.flapLever,
    flaps: start.flapLever / 2,
  };
}

export function initialState(start: StartSpec = AIR_START): SimState {
  return {
    tick: 0,
    // The start's own z is used as given; `craftAt` only corrects it when a world is at hand.
    craft: { ...craftAt(start, -Infinity), z: start.z },
    controls: { turn: 0, throttle: 0, pitch: 0, level: false, brake: false },
    crash: null,
    tuning: DEFAULT_TUNING,
    start,
    liftoffTick: null,
    touchdown: null,
    autopilot: AUTOPILOT_OFF,
    stableTicks: 0,
  };
}
