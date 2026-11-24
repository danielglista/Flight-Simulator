import { describe, expect, it } from 'vitest';
import { fitScale } from '../src/app/scaling';

const internal = { width: 320, height: 200 };

describe('fitScale', () => {
  it('fits exactly at 2x', () => {
    expect(fitScale({ width: 640, height: 400 }, internal, 1)).toEqual({
      scale: 2,
      cssWidth: 640,
      cssHeight: 400,
    });
  });

  it('rounds down when the panel is not an exact multiple', () => {
    const r = fitScale({ width: 900, height: 599 }, internal, 1);
    expect(r.scale).toBe(2);
    expect(r.cssWidth).toBe(640);
  });

  it('is limited by the tighter axis', () => {
    expect(fitScale({ width: 1920, height: 410 }, internal, 1).scale).toBe(2);
  });

  it('never drops below 1', () => {
    expect(fitScale({ width: 100, height: 50 }, internal, 1).scale).toBe(1);
  });

  it('uses whole device pixels at fractional DPR', () => {
    const r = fitScale({ width: 640, height: 400 }, internal, 1.5);
    expect(r.scale).toBe(3); // 960x600 device px -> 3x
    expect(r.cssWidth * 1.5).toBe(960);
    expect(r.cssHeight * 1.5).toBe(600);
  });

  it('grows to 3x at 1920x1080-sized panels', () => {
    expect(fitScale({ width: 960, height: 600 }, internal, 1).scale).toBe(3);
  });

  it('does not return NaN for bad input', () => {
    for (const r of [
      fitScale({ width: 0, height: 0 }, internal, 1),
      fitScale({ width: -5, height: 10 }, internal, 0),
      fitScale({ width: NaN, height: 400 }, internal, NaN),
      fitScale({ width: 640, height: 400 }, { width: 0, height: 0 }, 1),
    ]) {
      expect(Number.isFinite(r.scale)).toBe(true);
      expect(Number.isFinite(r.cssWidth)).toBe(true);
      expect(Number.isFinite(r.cssHeight)).toBe(true);
      expect(r.scale).toBeGreaterThanOrEqual(1);
    }
  });
});
