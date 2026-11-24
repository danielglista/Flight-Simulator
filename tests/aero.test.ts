import { describe, expect, it } from 'vitest';
import { GRAVITY, RHO0, WING_AREA } from '../src/config/flight';
import { DEFAULT_TUNING } from '../src/config/motion';
import { aeroAt, liftAngle, stallState } from '../src/sim/flight/aero';

const DEG = Math.PI / 180;
const T = DEFAULT_TUNING;
const STALL = T.stallDeg * DEG;
const at = (deg: number) => aeroAt(deg * DEG, STALL, T);

describe('lift curve', () => {
  it('is linear below 10 deg: Cl 0.704 at 5 deg', () => {
    expect(at(5).cl).toBeCloseTo(0.25 + 5.2 * 5 * DEG, 12);
    expect(at(5).cl).toBeCloseTo(0.704, 3);
    expect(at(5).separation).toBe(0);
  });
  it('peaks between 1.4 and 1.55 at 12 to 15 deg and falls for the next 4 deg', () => {
    let best = 0;
    let where = 0;
    for (let d = 0; d <= 25; d += 0.05) {
      if (at(d).cl > best) {
        best = at(d).cl;
        where = d;
      }
    }
    expect(best).toBeGreaterThan(1.4);
    expect(best).toBeLessThan(1.55);
    expect(where).toBeGreaterThan(12);
    expect(where).toBeLessThan(15);
    expect(at(where + 4).cl).toBeLessThan(best);
  });
  it('is continuous and finite from -180 to 180 deg', () => {
    let prev = at(-180);
    for (let d = -179.9; d <= 180; d += 0.1) {
      const c = at(d);
      expect(Number.isFinite(c.cl) && Number.isFinite(c.cd)).toBe(true);
      expect(Math.abs(c.cl - prev.cl)).toBeLessThan(0.03); // steepest where separation starts: about 0.026
      expect(Math.abs(c.cd - prev.cd)).toBeLessThan(0.1);
      prev = c;
    }
  });
  it('separates on the negative side too', () => {
    expect(at(-5).separation).toBe(0);
    expect(at(-16).separation).toBeGreaterThan(0.9);
  });
});

describe('drag', () => {
  it('equals cd0 + k Cl^2 below separation', () => {
    const a = at(8);
    expect(a.cd).toBeCloseTo(0.07 + 0.045 * a.cl * a.cl, 12);
  });
  it('is lowest in level flight between 61 and 75 m/s, and more than doubles from 10 to 20 deg', () => {
    const level = (v: number): number => {
      const q = 0.5 * RHO0 * v * v;
      const cl = (T.massT * 1000 * GRAVITY) / (q * WING_AREA);
      return q * WING_AREA * aeroAt((cl - 0.25) / 5.2, STALL, T).cd;
    };
    let low = 0;
    let lowD = Infinity;
    for (let v = 50; v <= 120; v += 0.5) {
      if (level(v) < lowD) {
        lowD = level(v);
        low = v;
      }
    }
    expect(low).toBeGreaterThan(61);
    expect(low).toBeLessThan(75);
    expect(at(20).cd).toBeGreaterThan(2 * at(10).cd);
  });
});

describe('stall speed and state', () => {
  it('level stall speed from the peak Cl is 60 to 62 m/s at sea level', () => {
    let clMax = 0;
    for (let d = 0; d <= 20; d += 0.01) clMax = Math.max(clMax, at(d).cl);
    const v = Math.sqrt((2 * T.massT * 1000 * GRAVITY) / (RHO0 * WING_AREA * clMax));
    expect(v).toBeGreaterThan(60);
    expect(v).toBeLessThan(62);
  });
  it('warning comes before stalled as the angle of attack rises', () => {
    const states = [];
    for (let d = 0; d <= 20; d += 0.1) states.push(stallState({ pitch: d * DEG, pathAngle: 0 }, T));
    expect(states[0]).toBe('none');
    expect(states.indexOf('warning')).toBeGreaterThan(-1);
    expect(states.indexOf('warning')).toBeLessThan(states.indexOf('stalled'));
    expect(states.at(-1)).toBe('stalled');
  });
  it('a negative angle of attack never warns', () => {
    expect(stallState({ pitch: -20 * DEG, pathAngle: 0 }, T)).toBe('none');
  });
});

describe('liftAngle', () => {
  it('gives n times weight and is capped at the start of separation', () => {
    const a = liftAngle(1, 90, 1, T);
    const q = 0.5 * RHO0 * 90 * 90;
    expect(q * WING_AREA * aeroAt(a, STALL, T).cl).toBeCloseTo(T.massT * 1000 * GRAVITY, 3);
    expect(liftAngle(1, 30, 1, T)).toBeCloseTo((T.stallDeg - 2.5) * DEG, 12);
    expect(Number.isFinite(liftAngle(1, 0, 1, T))).toBe(true);
  });
});
