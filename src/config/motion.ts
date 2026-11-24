/** Provisional B1 motion values (C1 replaces most of them). */
export const STEP_HZ = 60;
export const STEP_S = 1 / STEP_HZ;
export const SPEED_MIN = 0;
export const START_X = 2560;
export const START_Y = 2560;
export const START_HEADING = Math.PI / 4;
export const START_SPEED = 60;
/** World m above sea level (1,000 real m). Below the test map's 181.6 m peak, which the start heading points at. */
export const START_Z = 100;

/** Values that shape how flying feels, changeable live from the debug panel (B4). C1/C2 replace most of them. */
export interface Tuning {
  /** Turn rate, degrees per second. */
  readonly turnRateDegS: number;
  /** Throttle: speed change, m/s per second. */
  readonly speedRate: number;
  /** Top speed, m/s. */
  readonly speedMax: number;
  /** Flight path limit for climb and descent, degrees. */
  readonly pathMaxDeg: number;
  /** How fast the flight path angle moves toward its limit, degrees per second. */
  readonly pathRateDegS: number;
}

export const DEFAULT_TUNING: Tuning = {
  turnRateDegS: 30,
  speedRate: 40,
  speedMax: 150,
  pathMaxDeg: 15,
  pathRateDegS: 20,
};

export interface TuningRange {
  readonly label: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export const TUNING_RANGES: Readonly<Record<keyof Tuning, TuningRange>> = {
  turnRateDegS: { label: 'Turn rate', unit: 'deg/s', min: 5, max: 120, step: 5 },
  speedRate: { label: 'Throttle rate', unit: 'm/s per s', min: 5, max: 100, step: 5 },
  speedMax: { label: 'Top speed', unit: 'm/s', min: 50, max: 300, step: 10 },
  pathMaxDeg: { label: 'Climb limit', unit: 'deg', min: 5, max: 30, step: 1 },
  pathRateDegS: { label: 'Path rate', unit: 'deg/s', min: 5, max: 90, step: 5 },
};
/** 6,000 real m. */
export const CEILING_Z = 600;
/** Least height above ground after a click, world m. */
export const PLACE_CLEARANCE = 20;
/** Longest piece of a step checked for ground contact, world m. */
export const SWEEP_M = 0.5;
/** Most steps run for one animation frame; the rest are dropped. */
export const MAX_STEPS_PER_FRAME = 5;
