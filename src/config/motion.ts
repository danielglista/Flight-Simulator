/** Provisional B1 motion values (C1 replaces most of them). */
export const STEP_HZ = 60;
export const STEP_S = 1 / STEP_HZ;
export const TURN_RATE_DEG_S = 30;
export const SPEED_RATE = 40; // m/s per second
export const SPEED_MIN = 0;
export const SPEED_MAX = 150;
export const START_X = 2560;
export const START_Y = 2560;
export const START_HEADING = Math.PI / 4;
export const START_SPEED = 60;
/** World m above sea level (1,000 real m). Below the test map's 181.6 m peak, which the start heading points at. */
export const START_Z = 100;
/** Climb and descent limits for the flight path, B3. C1/C2 replace the rule that drives the angle. */
export const PATH_MAX_DEG = 15;
export const PATH_RATE_DEG_S = 20;
/** 6,000 real m. */
export const CEILING_Z = 600;
/** Least height above ground after a click, world m. */
export const PLACE_CLEARANCE = 20;
/** Longest piece of a step checked for ground contact, world m. */
export const SWEEP_M = 0.5;
/** Most steps run for one animation frame; the rest are dropped. */
export const MAX_STEPS_PER_FRAME = 5;
