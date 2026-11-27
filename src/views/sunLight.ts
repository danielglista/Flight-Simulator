import { FLAT_SHADING, type FaceShading, type Sun } from '../config/sun';

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
