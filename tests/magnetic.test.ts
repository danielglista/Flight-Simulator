import { describe, expect, it } from 'vitest';
import type { Airport } from '../src/sim/world/airport';
import { magneticDeg, magneticVariation } from '../src/views/magnetic';

const at = (x: number, variationDeg?: number): Airport =>
  ({ minX: x - 10, maxX: x + 10, minY: -10, maxY: 10, ...(variationDeg === undefined ? {} : { variationDeg }) }) as Airport;

describe('magnetic variation', () => {
  const airports = [at(0, 11), at(1000, 15)];

  it('reads each airport value at its field', () => {
    expect(magneticVariation(airports, 0, 0)).toBe(11);
    expect(magneticVariation(airports, 1000, 0)).toBe(15);
  });

  it('blends between them, nearer counting more', () => {
    expect(magneticVariation(airports, 500, 0)).toBeCloseTo(13, 9);
    expect(magneticVariation(airports, 250, 0)).toBeCloseTo(11.4, 9);
  });

  it('is zero with no stated value', () => {
    expect(magneticVariation([], 5, 5)).toBe(0);
    expect(magneticVariation([at(0)], 5, 5)).toBe(0);
  });

  it('adds to a true direction and wraps', () => {
    expect(magneticDeg(80, 12)).toBe(92);
    expect(magneticDeg(355, 12)).toBe(7);
    expect(magneticDeg(5, -12)).toBe(353);
  });
});
