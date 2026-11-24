import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../src/config/motion';
import { stallState } from '../src/sim/flight/aero';
import { authority, stepPitch, type PitchInput } from '../src/sim/flight/attitude';
import { forcesOn } from '../src/sim/flight/forces';
import { initialState, type SimState } from '../src/sim/state';
import { advance, applyCommands, type SimWorld } from '../src/sim/step';

const DEG = Math.PI / 180;
const DEEP: SimWorld = { width: 1e7, height: 1e7, heightAt: () => -1e9, altitudeScale: 10 };
const run = (s: SimState, n: number): SimState => {
  for (let i = 0; i < n; i++) s = advance(s, DEEP);
  return s;
};
const key = (s: SimState, v: -1 | 0 | 1, thr?: -1 | 0 | 1): SimState =>
  applyCommands(s, [{ kind: 'pitch', value: v }, ...(thr === undefined ? [] : [{ kind: 'throttle' as const, value: thr }])], DEEP);
const secs = (s: SimState, n: number): SimState => run(s, Math.round(n * 60));
const base: PitchInput = { pitch: 0, pitchRate: 0, key: 0, speed: 90, sigma: 1, alpha: 0.05, separation: 0, loadFactor: 1 };

describe('pitch keys', () => {
  it('pitch holds exactly with no key, below separation', () => {
    const s = secs(key(initialState(), 0), 20);
    expect(s.craft.pitch).toBe(initialState().craft.pitch);
  });
  it('rate ramps up rather than jolting', () => {
    const one = stepPitch({ ...base, key: 1 }, DEFAULT_TUNING, 1 / 60);
    expect(one.pitchRate).toBeGreaterThan(0);
    expect(one.pitchRate).toBeLessThan(10 * DEG * 0.2);
  });
  it('authority is weaker at 35 m/s than 60 m/s, never below 0.2, and 1 when fast', () => {
    expect(authority(35, 1)).toBeLessThan(authority(60, 1));
    expect(authority(5, 1)).toBe(0.2);
    expect(authority(120, 1)).toBe(1);
  });
  it('nose-up is zero when fully separated, nose-down is not', () => {
    const sep = { ...base, alpha: 0.4, separation: 1, speed: 90 };
    let up = { pitch: 0, pitchRate: 0 };
    let down = { pitch: 0, pitchRate: 0 };
    for (let i = 0; i < 30; i++) {
      up = stepPitch({ ...sep, ...up, key: 1 }, DEFAULT_TUNING, 1 / 60);
      down = stepPitch({ ...sep, ...down, key: -1 }, DEFAULT_TUNING, 1 / 60);
    }
    expect(up.pitchRate).toBe(0);
    expect(down.pitchRate).toBeLessThan(-0.05);
  });
  it('nose limit +/-30 deg zeroes the rate', () => {
    const r = stepPitch({ ...base, key: 1, pitch: 30 * DEG, pitchRate: 0.3 }, DEFAULT_TUNING, 1 / 60);
    expect(r.pitch).toBe(30 * DEG);
    expect(r.pitchRate).toBe(0);
  });
  it('load: held S at 170 m/s stays under 4 g, held W over -1.1 g', () => {
    for (const k of [1, -1] as const) {
      let s = key({ ...initialState(), craft: { ...initialState().craft, speed: 170 } }, k);
      let hi = -Infinity;
      let lo = Infinity;
      for (let i = 0; i < 600; i++) {
        s = advance(s, DEEP);
        const n = forcesOn(s.craft, s.tuning, 10).loadFactor;
        hi = Math.max(hi, n);
        lo = Math.min(lo, n);
      }
      if (k === 1) expect(hi).toBeLessThan(4.0);
      else expect(lo).toBeGreaterThan(-1.1);
    }
  });
});

describe('stall and recovery', () => {
  it('holding S at start throttle stalls between 8 and 16 s, then the path falls below -10 deg with S still held', () => {
    let s = key(initialState(), 1);
    let stalledAt = -1;
    let lowPath = 0;
    let deep = false;
    for (let i = 0; i < 60 * 30; i++) {
      s = advance(s, DEEP);
      if (stalledAt < 0 && stallState(s.craft, s.tuning) === 'stalled') {
        stalledAt = i / 60;
      }
      const f = forcesOn(s.craft, s.tuning, 10);
      if (!deep && f.separation >= 0.5) {
        deep = true;
        expect(f.loadFactor).toBeLessThan(1); // lift below weight once well into the stall
      }
      if (stalledAt >= 0) lowPath = Math.min(lowPath, s.craft.pathAngle);
    }
    expect(stalledAt).toBeGreaterThan(8);
    expect(stalledAt).toBeLessThan(16);
    expect(lowPath).toBeLessThan(-10 * DEG);
  });
  it('the stall is physics, not a script: a heavier plane stalls at a higher speed', () => {
    const stallSpeed = (m: number): number => {
      let s = key({ ...initialState(), tuning: { ...DEFAULT_TUNING, massT: m } }, 1);
      for (let i = 0; i < 60 * 40; i++) {
        s = advance(s, DEEP);
        if (stallState(s.craft, s.tuning) === 'stalled') return s.craft.speed;
      }
      return NaN;
    };
    expect(stallSpeed(40)).toBeGreaterThan(stallSpeed(12));
  });
  /** A mushing stall from 400 m: idle, S held. */
  const mush = (): SimState => {
    const s0 = initialState();
    let s = key({ ...s0, craft: { ...s0.craft, z: 400 } }, 0, -1);
    s = secs(s, 3);
    s = key(s, 1, 0);
    return secs(s, 8);
  };
  it('the mush is a stall', () => {
    expect(stallState(mush().craft, DEFAULT_TUNING)).toBe('stalled');
  });
  it('W for 1 s + full throttle, 2 s, S 1 s, 4 s recovers, losing under 80 m', () => {
    let s = mush();
    const z0 = s.craft.z;
    s = secs(key(s, -1, 1), 1);
    s = secs(key(s, 0), 2);
    s = secs(key(s, 1), 1);
    s = secs(key(s, 0), 4);
    expect(stallState(s.craft, s.tuning)).toBe('none');
    expect(Math.abs(s.craft.pathAngle)).toBeLessThan(3 * DEG);
    expect(z0 - s.craft.z).toBeLessThan(80);
  });
  it('keeping S held with the engine idle does not recover in 8 s', () => {
    expect(stallState(secs(key(mush(), 1, -1), 8).craft, DEFAULT_TUNING)).not.toBe('none');
  });
});
