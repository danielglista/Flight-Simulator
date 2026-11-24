import { describe, expect, it } from 'vitest';
import { START_PROBE, formatHeading, moveProbe, turnBy, wrapHeading } from '../src/views/probe';

describe('probe', () => {
  it('wraps both ways through north', () => {
    const r = turnBy({ ...START_PROBE, heading: 0.1 }, -0.2).heading;
    expect(r).toBeCloseTo(2 * Math.PI - 0.1, 9);
    const f = turnBy({ ...START_PROBE, heading: 2 * Math.PI - 0.1 }, 0.2).heading;
    expect(f).toBeCloseTo(0.1, 9);
    expect(wrapHeading(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 9);
  });
  it('formats headings', () => {
    expect(formatHeading(0)).toBe('360');
    expect(formatHeading(Math.PI / 4)).toBe('045');
    expect(formatHeading((359.7 * Math.PI) / 180)).toBe('360');
    expect(formatHeading(Math.PI / 2)).toBe('090');
  });
  it('clamps position to the map', () => {
    const p = moveProbe(START_PROBE, -5, 99999, { width: 5120, height: 5120 });
    expect(p.x).toBe(0);
    expect(p.y).toBe(5120);
  });
});
