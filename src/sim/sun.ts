import { DAY_STEPS, SUN_LATITUDE, SUN_START_TIME, SUN_STEPS_PER_DAY } from '../config/sun';

/**
 * The time of day (E8.2), in sim steps since sunrise, 0 to DAY_STEPS. The day runs from sunrise to sunset and the next
 * step is sunrise again.
 */
export interface SunClock {
  /** Added to the tick to give the time of day. */
  readonly offset: number;
  /** The time the sun is held at, or null while it moves. */
  readonly held: number | null;
}

export const SUN_CLOCK_START: SunClock = { offset: SUN_START_TIME, held: null };

const wrap = (time: number): number => ((time % DAY_STEPS) + DAY_STEPS) % DAY_STEPS;

export function timeOfDay(tick: number, clock: SunClock): number {
  return clock.held ?? wrap(tick + clock.offset);
}

/** The clock showing `time` at `tick`; a held sun stays held, at the new time. */
export function setTime(clock: SunClock, tick: number, time: number): SunClock {
  const t = wrap(time);
  return { offset: wrap(t - tick), held: clock.held === null ? null : t };
}

/** Holds the sun where it is, or lets it carry on from there. */
export function setHold(clock: SunClock, tick: number, hold: boolean): SunClock {
  if (hold === (clock.held !== null)) return clock;
  const time = timeOfDay(tick, clock);
  return { offset: wrap(time - tick), held: hold ? time : null };
}

/** Which of the day's fixed sun positions a time falls in, 0 to SUN_STEPS_PER_DAY - 1. */
export function sunStep(time: number): number {
  return Math.floor(wrap(time) / (DAY_STEPS / SUN_STEPS_PER_DAY));
}

export interface SunPosition {
  /** Radians clockwise from north, toward the sun. */
  readonly azimuth: number;
  /** Radians above the horizon. */
  readonly elevation: number;
}

/** The sun on an equinox day at SUN_LATITUDE: up in the east, south at noon, down in the west. */
export function sunPosition(time: number): SunPosition {
  // Hour angle: -90 deg at sunrise, 0 at noon, +90 at sunset.
  const hour = (time / DAY_STEPS - 0.5) * Math.PI;
  const sine = Math.cos(SUN_LATITUDE) * Math.cos(hour);
  // The cosine of a right angle is not quite zero in floating point; at sunrise the sun is on the horizon.
  const elevation = sine > 1e-9 ? Math.asin(sine) : 0;
  const azimuth = Math.PI + Math.atan2(Math.sin(hour), Math.cos(hour) * Math.sin(SUN_LATITUDE));
  return { azimuth, elevation };
}
