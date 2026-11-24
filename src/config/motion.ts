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
/** Most steps run for one animation frame; the rest are dropped. */
export const MAX_STEPS_PER_FRAME = 5;
