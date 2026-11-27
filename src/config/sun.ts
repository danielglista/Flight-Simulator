/** The sun as the drawing code needs it (E8). Views take it as an argument; only `main.ts` picks which one. */
export interface Sun {
  /** Radians clockwise from north, toward the sun. */
  readonly azimuth: number;
  /** Shadow length per meter of height. */
  readonly shadowPerM: number;
  /** 0..1: how much face shading shows. (E8.2 fades the shadows by it too.) */
  readonly strength: number;
}

/** E8.1's fixed southwest sun. The game's sun now moves (below); tests use this one. */
export const FIXED_SUN: Sun = { azimuth: (225 * Math.PI) / 180, shadowPerM: 0.5, strength: 1 };

/** How a face's brightness goes with the angle between its outward normal and the sun: `base + amp * cos`. */
export interface FaceShading {
  readonly base: number;
  readonly amp: number;
}

/** Flat walls and slopes. */
export const FLAT_SHADING: FaceShading = { base: 0.9, amp: 0.25 };
/** Round walls and domes seen from the side. */
export const ROUND_SHADING: FaceShading = { base: 0.92, amp: 0.2 };
/** Brightness of the half of a pitched roof that faces away from the sun. */
export const ROOF_AWAY_LIGHT = 0.72;

/** Sim steps from sunrise to sunset (12 min at 60 Hz). The next step is sunrise again. */
export const DAY_STEPS = 12 * 60 * 60;
/** What the clock reads: sunrise and the length of the day, minutes. One real second is one clock minute. */
export const CLOCK_SUNRISE_MIN = 6 * 60;
export const CLOCK_DAY_MIN = 12 * 60;
/** A game starts a quarter of the way through the day: mid-morning. */
export const SUN_START_TIME = DAY_STEPS / 4;
/** Fixed sun positions in a day; the sun moves from one to the next every 12 s. */
export const SUN_STEPS_PER_DAY = 60;
/** The sun follows an equinox day at this latitude, radians. */
export const SUN_LATITUDE = (39 * Math.PI) / 180;
/** Shadow length per meter of height is this over tan(elevation), at most the cap. Stylized: noon gives about 0.5. */
export const SHADOW_SCALE = 0.62;
export const SHADOW_MAX_PER_M = 1.5;
/** Shadows and face shading come up from nothing at the horizon to full at this elevation, radians. */
export const SUN_FADE_ELEVATION = (10 * Math.PI) / 180;
