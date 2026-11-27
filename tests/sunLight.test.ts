import { describe, expect, it } from 'vitest';
import { FIXED_SUN, FLAT_SHADING, ROUND_SHADING, type Sun } from '../src/config/sun';
import { faceLight, shadowAlong, shadowVector, towardSun } from '../src/views/sunLight';

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
