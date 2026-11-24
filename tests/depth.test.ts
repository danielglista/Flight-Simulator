import { describe, expect, it } from 'vitest';
import { CLOUD_ALPHA_HIGH, CLOUD_ALPHA_LOW, CLOUD_BASE_M, DEPTH_CAMERA_M, HAZE_MAX, PLANE_SIZE_TIERS, SHADOW_ALPHA, SHADOW_FADE_HIGH_M, SHADOW_FADE_LOW_M, SHADOW_MAX_PX } from '../src/config/display';
import { CEILING_Z } from '../src/config/motion';
import { agl, cloudAlpha, hazeAlpha, heightScale, planeSizeTier, shadowAlpha, shadowOffsetPx, tierAltitude } from '../src/views/depth';

describe('heightScale', () => {
  it('is 1 at sea level and grows with height', () => {
    expect(heightScale(0, 300)).toBe(1);
    expect(heightScale(50, 0)).toBeGreaterThan(1);
    expect(heightScale(100, 0)).toBeGreaterThan(heightScale(50, 0));
  });
  it('tends to 1 as the plane climbs', () => {
    expect(heightScale(100, CEILING_Z)).toBeLessThan(heightScale(100, 0));
    expect(heightScale(100, 1e6)).toBeCloseTo(1, 3);
  });
  it('stays finite for any height up to the ceiling', () => {
    for (let h = 0; h <= CEILING_Z; h += 25) expect(Number.isFinite(heightScale(h, 0))).toBe(true);
  });
  it('gives the plane 1 + z / D', () => {
    expect(heightScale(CEILING_Z, CEILING_Z)).toBeCloseTo(1 + CEILING_Z / DEPTH_CAMERA_M, 12);
  });
});

describe('agl', () => {
  it('is height over ground, never negative', () => {
    expect(agl(120, 20)).toBe(100);
    expect(agl(10, 20)).toBe(0);
  });
});

describe('shadowOffsetPx', () => {
  it('is zero on the ground and capped high up', () => {
    expect(shadowOffsetPx(0, 0)).toEqual({ x: 0, y: 0 });
    const far = shadowOffsetPx(1e5, 0);
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(SHADOW_MAX_PX, 9);
  });
  it('falls right and down with north up', () => {
    const o = shadowOffsetPx(50, 0);
    expect(o.x).toBeGreaterThan(0);
    expect(o.y).toBeGreaterThan(0);
  });
  it('falls up and right with east up (rotation 90 degrees)', () => {
    const o = shadowOffsetPx(50, Math.PI / 2);
    expect(o.x).toBeGreaterThan(0);
    expect(o.y).toBeLessThan(0);
  });
  it('has the same length at any rotation', () => {
    const len = (r: number) => Math.hypot(shadowOffsetPx(60, r).x, shadowOffsetPx(60, r).y);
    for (const r of [0.3, 1, 2, 4, 5.5]) expect(len(r)).toBeCloseTo(len(0), 9);
  });
});

describe('shadowAlpha', () => {
  it('is full low, zero high, and falls in between', () => {
    expect(shadowAlpha(0)).toBeCloseTo(SHADOW_ALPHA, 12);
    expect(shadowAlpha(SHADOW_FADE_LOW_M)).toBeCloseTo(SHADOW_ALPHA, 12);
    expect(shadowAlpha(SHADOW_FADE_HIGH_M)).toBeCloseTo(0, 12);
    expect(shadowAlpha(1e4)).toBe(0);
    let prev = Infinity;
    for (let a = SHADOW_FADE_LOW_M; a <= SHADOW_FADE_HIGH_M; a += 5) {
      expect(shadowAlpha(a)).toBeLessThanOrEqual(prev);
      prev = shadowAlpha(a);
    }
  });
});

describe('hazeAlpha', () => {
  it('is 0 on the ground, HAZE_MAX at the ceiling, and rises between', () => {
    expect(hazeAlpha(0)).toBe(0);
    expect(hazeAlpha(CEILING_Z)).toBeCloseTo(HAZE_MAX, 12);
    expect(hazeAlpha(CEILING_Z * 2)).toBeCloseTo(HAZE_MAX, 12);
    let prev = -1;
    for (let z = 0; z <= CEILING_Z; z += 20) {
      expect(hazeAlpha(z)).toBeGreaterThanOrEqual(prev);
      prev = hazeAlpha(z);
    }
  });
});

describe('cloudAlpha', () => {
  it('is LOW well under the base, HIGH well above it, and rises between', () => {
    expect(cloudAlpha(0)).toBeCloseTo(CLOUD_ALPHA_LOW, 12);
    expect(cloudAlpha(CLOUD_BASE_M + 50)).toBeCloseTo(CLOUD_ALPHA_HIGH, 12);
    expect(cloudAlpha(CEILING_Z)).toBeCloseTo(CLOUD_ALPHA_HIGH, 12);
    let prev = 0;
    for (let z = 0; z <= CEILING_Z; z += 10) {
      expect(cloudAlpha(z)).toBeGreaterThanOrEqual(prev);
      prev = cloudAlpha(z);
    }
  });
});

describe('planeSizeTier', () => {
  it('covers the first and last tier and never leaves the range', () => {
    expect(planeSizeTier(0, 0)).toBe(0);
    expect(planeSizeTier(CEILING_Z, 0)).toBe(PLANE_SIZE_TIERS - 1);
    expect(planeSizeTier(1e5, 0)).toBe(PLANE_SIZE_TIERS - 1);
    expect(planeSizeTier(-50, 3)).toBe(0);
  });
  it('rises with altitude when climbing steadily', () => {
    let tier = 0;
    for (let z = 0; z <= CEILING_Z; z += 1) {
      const next = planeSizeTier(z, tier);
      expect(next).toBeGreaterThanOrEqual(tier);
      tier = next;
    }
    expect(tier).toBe(PLANE_SIZE_TIERS - 1);
  });
  it('does not flip on a wobble across a boundary', () => {
    const boundary = (tierAltitude(0) + tierAltitude(1)) / 2;
    let tier = planeSizeTier(boundary - 0.5, 0);
    expect(tier).toBe(0);
    for (const dz of [0.5, -0.5, 1, -1, 0.5]) {
      tier = planeSizeTier(boundary + dz, tier);
      expect(tier).toBe(0);
    }
  });
});
