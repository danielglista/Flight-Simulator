import { FLAT_SHADING, SHADOW_MAX_PER_M, SHADOW_SCALE, SUN_FADE_ELEVATION, SUN_STEPS_PER_DAY, DAY_STEPS, type FaceShading, type Sun } from '../config/sun';
import { sunPosition, type SunPosition } from '../sim/sun';

/** [east, north]. */
type Vec = readonly [number, number];

/** Unit vector along the ground toward the sun. */
export function towardSun(sun: Sun): Vec {
  return [Math.sin(sun.azimuth), Math.cos(sun.azimuth)];
}

/** A step of `distance` along the ground the way shadows fall: away from the sun. */
export function shadowAlong(sun: Sun, distance: number): Vec {
  const [east, north] = towardSun(sun);
  return [-east * distance, -north * distance];
}

/** Where the shadow of a point `height` above the ground falls, measured from the point below it. */
export function shadowVector(sun: Sun, height: number): Vec {
  return shadowAlong(sun, height * sun.shadowPerM);
}

/** Brightness (1 = the material's own color) of a face whose outward horizontal unit normal is (nx, ny). */
export function faceLight(sun: Sun, nx: number, ny: number, shading: FaceShading = FLAT_SHADING): number {
  const [east, north] = towardSun(sun);
  return 1 + sun.strength * (shading.base + shading.amp * (nx * east + ny * north) - 1);
}

/** The sun at a position in the sky: long faint shadows low down, short full ones high up. */
export function sunFrom({ azimuth, elevation }: SunPosition): Sun {
  const t = Math.min(1, Math.max(0, elevation / SUN_FADE_ELEVATION));
  const shadowPerM = elevation > 0 ? Math.min(SHADOW_MAX_PER_M, SHADOW_SCALE / Math.tan(elevation)) : SHADOW_MAX_PER_M;
  return { azimuth, shadowPerM, strength: t * t * (3 - 2 * t) };
}

const steps: readonly Sun[] = Array.from({ length: SUN_STEPS_PER_DAY }, (_, i) => sunFrom(sunPosition((i * DAY_STEPS) / SUN_STEPS_PER_DAY)));

/** The sun of one of the day's steps. Always the same object for a step, so cached drawing can tell when it is stale. */
export function sunForStep(step: number): Sun {
  return steps[step] as Sun;
}
