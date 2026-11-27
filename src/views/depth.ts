import {
  CLOUD_ALPHA_HIGH,
  CLOUD_ALPHA_LOW,
  CLOUD_BASE_M,
  DEPTH_CAMERA_M,
  DEPTH_TOP_Z,
  HAZE_MAX,
  PLANE_SIZE_HYSTERESIS,
  PLANE_SIZE_TIERS,
  SHADOW_ALPHA,
  SHADOW_FADE_HIGH_M,
  SHADOW_FADE_LOW_M,
  SHADOW_MAX_PX,
  SHADOW_PX_PER_M,
} from '../config/display';
import type { Sun } from '../config/sun';
import type { Point } from './camera';
import { shadowAlong } from './sunLight';

export function smoothstep(lo: number, hi: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/**
 * Scale of something at height `h` seen from a camera `DEPTH_CAMERA_M` above a plane at altitude `z`,
 * relative to sea level (scale 1). All world meters. The plane itself is heightScale(z, z) = 1 + z / D.
 */
export function heightScale(h: number, z: number, camera: number = DEPTH_CAMERA_M): number {
  return (z + camera) / (z + camera - h);
}

/** Height above the ground below, never negative. */
export function agl(z: number, groundZ: number): number {
  return Math.max(0, z - groundZ);
}

/**
 * Where the shadow sits relative to the plane, in screen pixels. It falls away from the sun in the world;
 * `rotation` (camera heading, radians clockwise) turns it with the map. Its length shows height only.
 */
export function shadowOffsetPx(aglM: number, rotation: number, sun: Sun): Point {
  const len = Math.min(SHADOW_MAX_PX, SHADOW_PX_PER_M * Math.max(0, aglM));
  const [east, north] = shadowAlong(sun, len);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  // With north up, screen x is east and screen y is south.
  return { x: east * cos - north * sin, y: -east * sin - north * cos };
}

/** Full strength low down, gone above SHADOW_FADE_HIGH_M. */
export function shadowAlpha(aglM: number): number {
  return SHADOW_ALPHA * (1 - smoothstep(SHADOW_FADE_LOW_M, SHADOW_FADE_HIGH_M, aglM));
}

/** Haze over the terrain: none on the ground, HAZE_MAX from DEPTH_TOP_Z up. */
export function hazeAlpha(z: number): number {
  return HAZE_MAX * smoothstep(0, DEPTH_TOP_Z, z);
}

/** Cloud strength: CLOUD_ALPHA_LOW well under the base, CLOUD_ALPHA_HIGH well above it, smooth across 100 m around it. */
export function cloudAlpha(z: number): number {
  const t = smoothstep(CLOUD_BASE_M - 50, CLOUD_BASE_M + 50, z);
  return CLOUD_ALPHA_LOW + (CLOUD_ALPHA_HIGH - CLOUD_ALPHA_LOW) * t;
}

/** Altitude the plane sprite of tier `i` stands for. */
export function tierAltitude(tier: number): number {
  return (tier / (PLANE_SIZE_TIERS - 1)) * DEPTH_TOP_Z;
}

/** Sprite size step for altitude `z`. The `previous` tier is kept until z is clearly past the boundary, so it does not flicker. */
export function planeSizeTier(z: number, previous: number): number {
  const t = (Math.min(DEPTH_TOP_Z, Math.max(0, z)) / DEPTH_TOP_Z) * (PLANE_SIZE_TIERS - 1);
  const prev = Math.min(PLANE_SIZE_TIERS - 1, Math.max(0, previous));
  if (Math.abs(t - prev) < 0.5 + PLANE_SIZE_HYSTERESIS) return prev;
  return Math.round(t);
}
