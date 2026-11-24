import { describe, expect, it } from 'vitest';
import { createStepper } from '../src/app/stepper';

describe('stepper', () => {
  for (const hz of [30, 60, 144]) {
    it(`10 s at ${hz} Hz gives 600 steps`, () => {
      const s = createStepper();
      let total = 0;
      for (let i = 0; i < hz * 10; i++) total += s.advance(1 / hz).steps;
      expect(Math.abs(total - 600)).toBeLessThanOrEqual(1);
    });
  }
  it('limits a long frame to 5 steps and keeps a fraction below 1', () => {
    const r = createStepper().advance(2.0083);
    expect(r.steps).toBe(5);
    expect(r.alpha).toBeGreaterThanOrEqual(0);
    expect(r.alpha).toBeLessThan(1);
  });
  it('treats negative, zero and NaN as 0', () => {
    const s = createStepper();
    expect(s.advance(-1).steps).toBe(0);
    expect(s.advance(0).steps).toBe(0);
    expect(s.advance(NaN).steps).toBe(0);
  });
});
