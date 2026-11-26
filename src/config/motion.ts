/** Provisional motion values. */
export const STEP_HZ = 60;
export const STEP_S = 1 / STEP_HZ;
/** The island sits in a 2,560 m sea pad (`SEA_PAD_CELLS` in testMap.ts), so the air start is 2,560 m east and north of where it was. */
export const START_X = 4560;
export const START_Y = 4560;
export const START_HEADING = Math.PI / 4;
export const START_SPEED = 90;
/** Lever and engine at the start: level trim at START_SPEED and START_Z (a test recomputes both). */
export const START_LEVER = 0.3202;
/** Nose attitude at the start, radians (5.38 deg): the trim angle of attack, since the path is level. */
export const START_PITCH = 0.09388;
/** World m above sea level (1,000 real m at the 5:1 altitude scale). Below the test map's 363 m peak, which the start heading points at. */
export const START_Z = 200;

/** Values that shape how flying feels, changeable live from the debug panel (B4). C1/C2 replace most of them. */
export interface Tuning {
  /** Roll rate with a key held at full authority, degrees per second. */
  readonly rollRateDegS: number;
  /** Multiplier on the heading change from banked lift (GAME_DESIGN.md: turns are quicker than real ones). It touches heading only, never energy. */
  readonly turnMult: number;
  /** Banks up to this many degrees get automatic nose-up, so shallow turns hold height. */
  readonly turnHelpDeg: number;
  /** Nose pitch rate after the key has been held PITCH_RAMP_S seconds, at full authority, degrees per second. */
  readonly pitchRateDegS: number;
  /** Center of the stall in angle of attack, degrees. The lift peak is about 2 deg below it. */
  readonly stallDeg: number;
  /** How fast the nose drops while stalled, degrees per second. */
  readonly stallDropDegS: number;
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
  /** Multiplier on thrust while on the ground only (GAME_DESIGN.md's ground acceleration allowance). */
  readonly groundMult: number;
  /** Extra zero-lift drag with the gear fully down, in 1/10,000 (C4B). */
  readonly gearDragCounts: number;
  /** Wheel-brake friction coefficient on paving, x 100 (C5). */
  readonly brakePct: number;
  /** Greatest survivable sink rate at touchdown, m/s (C5). */
  readonly touchdownSinkMs: number;
  /** Added Cl0 with full flaps, x 100 (C6). */
  readonly flapLiftPct: number;
  /** Extra zero-lift drag with full flaps, in 1/10,000 (C6). */
  readonly flapDragCounts: number;
}

export const DEFAULT_TUNING: Tuning = {
  rollRateDegS: 20,
  turnMult: 1.5,
  turnHelpDeg: 30,
  pitchRateDegS: 8,
  stallDeg: 16,
  stallDropDegS: 14,
  leverRatePctS: 50,
  spoolTauS: 1.2,
  thrustMaxKn: 100,
  massT: 24,
  cd0Counts: 700,
  inducedCounts: 450,
  groundMult: 1.5,
  gearDragCounts: 200,
  brakePct: 40,
  touchdownSinkMs: 5,
  flapLiftPct: 60,
  flapDragCounts: 500,
};

export interface TuningRange {
  readonly label: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export const TUNING_RANGES: Readonly<Record<keyof Tuning, TuningRange>> = {
  rollRateDegS: { label: 'Roll rate', unit: 'deg/s', min: 5, max: 90, step: 5 },
  turnMult: { label: 'Turn multiplier', unit: 'x', min: 1, max: 4, step: 0.25 },
  turnHelpDeg: { label: 'Turn help', unit: 'deg', min: 0, max: 45, step: 5 },
  pitchRateDegS: { label: 'Pitch rate', unit: 'deg/s', min: 4, max: 30, step: 1 },
  stallDeg: { label: 'Stall angle', unit: 'deg', min: 10, max: 20, step: 1 },
  stallDropDegS: { label: 'Stall nose drop', unit: 'deg/s', min: 2, max: 40, step: 1 },
  leverRatePctS: { label: 'Lever rate', unit: '%/s', min: 10, max: 200, step: 10 },
  spoolTauS: { label: 'Engine spool', unit: 's', min: 0.2, max: 5, step: 0.1 },
  thrustMaxKn: { label: 'Max thrust', unit: 'kN', min: 40, max: 200, step: 5 },
  massT: { label: 'Mass', unit: 't', min: 12, max: 40, step: 1 },
  cd0Counts: { label: 'Parasite drag', unit: 'counts', min: 200, max: 2000, step: 50 },
  inducedCounts: { label: 'Induced drag', unit: 'counts', min: 200, max: 1200, step: 50 },
  groundMult: { label: 'Ground thrust', unit: 'x', min: 1, max: 3, step: 0.1 },
  gearDragCounts: { label: 'Gear drag', unit: 'counts', min: 0, max: 1000, step: 50 },
  brakePct: { label: 'Brakes', unit: 'mu x100', min: 5, max: 80, step: 5 },
  touchdownSinkMs: { label: 'Touchdown limit', unit: 'm/s', min: 1, max: 10, step: 0.5 },
  flapLiftPct: { label: 'Flap lift', unit: 'dCl x100', min: 0, max: 120, step: 5 },
  flapDragCounts: { label: 'Flap drag', unit: 'counts', min: 0, max: 1500, step: 50 },
};
/** C5 Final start: meters before the threshold, meters past it that the path aims at, path angle (deg) and true speed (m/s). */
export const FINAL_DIST_M = 1400;
export const FINAL_AIM_M = 150;
export const FINAL_PATH_DEG = 3;
export const FINAL_SPEED = 69;
/** Where the runway start stands: world m past the threshold. */
export const RUNWAY_START_M = 40;
/** 40,000 displayed ft: 12,192 real m at the 5:1 altitude scale. */
export const CEILING_Z = 2438.4;
/** Least height above ground after a click, world m. */
export const PLACE_CLEARANCE = 20;
/** Longest piece of a step checked for ground contact, world m. */
export const SWEEP_M = 0.5;
/** Most steps run for one animation frame; the rest are dropped. */
export const MAX_STEPS_PER_FRAME = 5;
