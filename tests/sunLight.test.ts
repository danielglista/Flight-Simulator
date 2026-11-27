import { describe, expect, it } from 'vitest';
import { FIXED_SUN, FLAT_SHADING, ROUND_SHADING, SHADOW_MAX_PER_M, SUN_STEPS_PER_DAY, type Sun } from '../src/config/sun';
import { faceLight, shadowAlong, shadowVector, sunForStep, sunFrom, towardSun } from '../src/views/sunLight';

const from = (deg: number, strength = 1): Sun => ({ azimuth: (deg * Math.PI) / 180, shadowPerM: 0.5, strength });
const close = (v: readonly number[]) => v.map((n) => expect.closeTo(n, 6));

describe('sun light', () => {
  it('stands in the southwest by default, so shadows fall northeast', () => {
    const [east, north] = towardSun(FIXED_SUN);
    expect(east).toBeLessThan(0);
    expect(north).toBeLessThan(0);
    const [x, y] = shadowVector(FIXED_SUN, 20);
    expect(x).toBeCloseTo(10 * Math.SQRT1_2, 6);
    expect(y).toBeCloseTo(10 * Math.SQRT1_2, 6);
  });
  it('casts away from wherever the sun is', () => {
    expect(shadowVector(from(90), 10)).toEqual(close([-5, 0]));
    expect(shadowVector(from(180), 10)).toEqual(close([0, 5]));
    expect(shadowAlong(from(270), 7)).toEqual(close([7, 0]));
  });
  it('lights the face turned to the sun most and the one turned away least', () => {
    const south = from(180);
    expect(faceLight(south, 0, -1)).toBeCloseTo(FLAT_SHADING.base + FLAT_SHADING.amp, 6);
    expect(faceLight(south, 0, 1)).toBeCloseTo(FLAT_SHADING.base - FLAT_SHADING.amp, 6);
    expect(faceLight(south, 1, 0)).toBeCloseTo(FLAT_SHADING.base, 6);
    expect(faceLight(south, 0, -1, ROUND_SHADING)).toBeCloseTo(ROUND_SHADING.base + ROUND_SHADING.amp, 6);
  });
  it('shades nothing at no strength, and half as much at half', () => {
    expect(faceLight(from(180, 0), 0, 1)).toBe(1);
    expect(faceLight(from(180, 0.5), 0, 1)).toBeCloseTo((1 + faceLight(from(180), 0, 1)) / 2, 6);
  });
});

describe('shadow length and fade', () => {
  const at = (degrees: number) => sunFrom({ azimuth: Math.PI, elevation: (degrees * Math.PI) / 180 });
  it('is half the height at noon, longer lower down, and capped', () => {
    expect(at(51).shadowPerM).toBeCloseTo(0.5, 2);
    expect(at(33.3).shadowPerM).toBeCloseTo(0.94, 2);
    expect(at(15).shadowPerM).toBe(SHADOW_MAX_PER_M);
    expect(at(0).shadowPerM).toBe(SHADOW_MAX_PER_M);
  });
  it('fades in from nothing at the horizon to full at 10 degrees', () => {
    expect(at(0).strength).toBe(0);
    expect(at(5).strength).toBeCloseTo(0.5, 6);
    expect(at(10).strength).toBeCloseTo(1, 6);
    expect(at(40).strength).toBe(1);
  });
  it('gives one object for each step of the day, nothing showing at sunrise', () => {
    expect(sunForStep(30)).toBe(sunForStep(30));
    expect(sunForStep(0).strength).toBe(0);
    expect(sunForStep(SUN_STEPS_PER_DAY / 2).azimuth).toBeCloseTo(Math.PI, 6);
  });
});
