/** Provisional motion values. */
export const STEP_HZ = 60;
export const STEP_S = 1 / STEP_HZ;
export const START_X = 2000;
export const START_Y = 2000;
export const START_HEADING = Math.PI / 4;
export const START_SPEED = 90;
/** Lever and engine at the start: level trim at START_SPEED and START_Z. */
export const START_LEVER = 0.321;
/** World m above sea level (1,000 real m). Below the test map's 181.6 m peak, which the start heading points at. */
export const START_Z = 100;

/** Values that shape how flying feels, changeable live from the debug panel (B4). C1/C2 replace most of them. */
export interface Tuning {
  /** Turn rate, degrees per second. */
  readonly turnRateDegS: number;
  /** Flight path limit for climb and descent, degrees. */
  readonly pathMaxDeg: number;
  /** How fast the flight path angle moves toward its limit, degrees per second. */
  readonly pathRateDegS: number;
  /** Throttle lever speed, percent of full travel per second. */
  readonly leverRatePctS: number;
  /** Engine spool time constant, seconds. */
  readonly spoolTauS: number;
  /** Sea-level thrust at full power, kN. */
  readonly thrustMaxKn: number;
  /** Mass, tonnes. */
  readonly massT: number;
  /** Zero-lift drag coefficient, in 1/10,000. */
  readonly cd0Counts: number;
  /** Induced drag factor k, in 1/10,000. */
  readonly inducedCounts: number;
}

export const DEFAULT_TUNING: Tuning = {
  turnRateDegS: 30,
  pathMaxDeg: 15,
  pathRateDegS: 20,
  leverRatePctS: 50,
  spoolTauS: 1.2,
  thrustMaxKn: 100,
  massT: 24,
  cd0Counts: 700,
  inducedCounts: 450,
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
  pathMaxDeg: { label: 'Climb limit', unit: 'deg', min: 5, max: 30, step: 1 },
  pathRateDegS: { label: 'Path rate', unit: 'deg/s', min: 5, max: 90, step: 5 },
  leverRatePctS: { label: 'Lever rate', unit: '%/s', min: 10, max: 200, step: 10 },
  spoolTauS: { label: 'Engine spool', unit: 's', min: 0.2, max: 5, step: 0.1 },
  thrustMaxKn: { label: 'Max thrust', unit: 'kN', min: 40, max: 200, step: 5 },
  massT: { label: 'Mass', unit: 't', min: 12, max: 40, step: 1 },
  cd0Counts: { label: 'Parasite drag', unit: 'counts', min: 200, max: 2000, step: 50 },
  inducedCounts: { label: 'Induced drag', unit: 'counts', min: 200, max: 1200, step: 50 },
};
/** 6,000 real m. */
export const CEILING_Z = 600;
/** Least height above ground after a click, world m. */
export const PLACE_CLEARANCE = 20;
/** Longest piece of a step checked for ground contact, world m. */
export const SWEEP_M = 0.5;
/** Most steps run for one animation frame; the rest are dropped. */
export const MAX_STEPS_PER_FRAME = 5;
