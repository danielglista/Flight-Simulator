import { describe, expect, it } from 'vitest';
import { GRAVITY } from '../src/config/flight';
import { DEFAULT_TUNING } from '../src/config/motion';
import { stallState } from '../src/sim/flight/aero';
import { forcesOn } from '../src/sim/flight/forces';
import { wrapHeading } from '../src/sim/angles';
import { initialState, type SimState } from '../src/sim/state';
import { advance, applyCommands, type SimWorld } from '../src/sim/step';

const DEG = Math.PI / 180;
const DEEP: SimWorld = { width: 1e7, height: 1e7, heightAt: () => -1e9, altitudeScale: 10 };
const energy = (s: SimState): number => s.craft.z + (s.craft.speed * s.craft.speed) / (2 * GRAVITY);
const key = (s: SimState, turn: -1 | 0 | 1, pitch: -1 | 0 | 1 = 0): SimState =>
  applyCommands(s, [{ kind: 'turn', value: turn }, { kind: 'pitch', value: pitch }], DEEP);
const run = (s: SimState, n: number): SimState => {
  for (let i = 0; i < n; i++) s = advance(s, DEEP);
  return s;
};
const secs = (s: SimState, n: number): SimState => run(s, Math.round(n * 60));
const banked = (deg: number, patch: Partial<SimState['craft']> = {}, tuning = DEFAULT_TUNING): SimState => {
  const s = initialState();
  return { ...s, tuning, craft: { ...s.craft, bank: deg * DEG, ...patch } };
};

/** Rolls in with the D key (so turn help is fed in as a player would get it) and releases at this bank. */
const rolledIn = (deg: number, tuning = DEFAULT_TUNING): SimState => {
  const s0 = initialState();
  const s = secs(key({ ...s0, tuning }, 1), deg / tuning.rollRateDegS);
  return key(s, 0);
};

/**
 * A test tool, not an autopilot: S/W taps from height and path error, so a turn can be held level.
 * It must not go in src/.
 */
function holdLevel(s: SimState, z0: number, seconds: number): SimState {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    const err = (z0 - s.craft.z) * 0.02 - s.craft.pathAngle * 2;
    s = advance(key(s, 0, err > 0.01 ? 1 : err < -0.01 ? -1 : 0), DEEP);
  }
  return s;
}

describe('roll', () => {
  it('rolls 45 deg in 1 s, stops exactly at 60, and holds exactly with no key at 30', () => {
    let s = secs(key(initialState(), 1), 1);
    expect(s.craft.bank / DEG).toBeCloseTo(45, 6);
    s = secs(s, 1);
    expect(s.craft.bank).toBe(60 * DEG);
    expect(secs(key(banked(30), 0), 10).craft.bank).toBe(30 * DEG);
  });
  it('a small bank levels to exactly 0 without overshoot; levelBelowDeg 0 never levels', () => {
    let s = key(banked(7), 0);
    let prev = s.craft.bank;
    for (let i = 0; i < 120; i++) {
      s = advance(s, DEEP);
      expect(s.craft.bank).toBeLessThanOrEqual(prev);
      expect(s.craft.bank).toBeGreaterThanOrEqual(0);
      prev = s.craft.bank;
    }
    expect(s.craft.bank).toBe(0);
    expect(secs(key(banked(7, {}, { ...DEFAULT_TUNING, levelBelowDeg: 0 }), 0), 5).craft.bank).toBe(7 * DEG);
  });
  it('D turns right and A left, and mirrored runs mirror exactly', () => {
    const right = secs(key(initialState(), 1), 6);
    const left = secs(key(initialState(), -1), 6);
    const h0 = initialState().craft.heading;
    expect(right.craft.bank).toBeGreaterThan(0);
    expect(left.craft.bank).toBe(-right.craft.bank);
    expect(wrapHeading(right.craft.heading - h0 + Math.PI) - Math.PI).toBeGreaterThan(0);
    expect(wrapHeading(left.craft.heading - h0 + Math.PI) - Math.PI).toBeCloseTo(-(wrapHeading(right.craft.heading - h0 + Math.PI) - Math.PI), 9);
    expect(left.craft.z).toBeCloseTo(right.craft.z, 9);
  });
});

describe('turn rate', () => {
  it('in a settled level 30 deg turn it is turnMult x G x tan(b) / V, and doubles with turnMult', () => {
    const rate = (mult: number): { measured: number; expected: number } => {
      let s = secs(rolledIn(30, { ...DEFAULT_TUNING, turnMult: mult }), 5);
      const h = s.craft.heading;
      s = secs(s, 4);
      return { measured: wrapHeading(s.craft.heading - h) / 4, expected: (mult * GRAVITY * Math.tan(30 * DEG)) / s.craft.speed };
    };
    const a = rate(2);
    expect(Math.abs(a.measured - a.expected) / a.expected).toBeLessThan(0.05);
    expect(rate(4).measured / a.measured).toBeGreaterThan(1.9);
  });
});

describe('energy and stall speed', () => {
  const loss = (bankDeg: number, mult = 2): number => {
    const s0 = banked(bankDeg, { speed: 120 }, { ...DEFAULT_TUNING, turnMult: mult });
    return energy(s0) - energy(holdLevel(s0, 100, 10));
  };
  it('held level for 10 s from 120 m/s, steeper banks lose more energy', () => {
    const l = [0, 30, 45, 60].map((b) => loss(b));
    expect(l[0]).toBeLessThan(l[1]!);
    expect(l[1]).toBeLessThan(l[2]!);
    expect(l[2]).toBeLessThan(l[3]!);
  });
  it('turnMult changes the heading but not the energy', () => {
    const a = secs(banked(45), 10);
    const b = secs(banked(45, {}, { ...DEFAULT_TUNING, turnMult: 4 }), 10);
    expect(Math.abs(energy(a) - energy(b))).toBeLessThan(1e-9);
    expect(a.craft.heading).not.toBeCloseTo(b.craft.heading, 3);
  });
  it('held level at start power from 90 m/s, 60 deg stalls and 30 deg does not; idle, a steeper bank stalls at a higher speed', () => {
    const outcome = (bankDeg: number, idle = false): { stalled: boolean; speed: number } => {
      let s = banked(bankDeg, { speed: idle ? 120 : 90, ...(idle ? { lever: 0, spool: 0 } : {}) });
      for (let i = 0; i < 60 * 20; i++) {
        const err = (100 - s.craft.z) * 0.02 - s.craft.pathAngle * 2;
        s = advance(key(s, 0, err > 0.01 ? 1 : err < -0.01 ? -1 : 0), DEEP);
        if (stallState(s.craft, s.tuning) === 'stalled') return { stalled: true, speed: s.craft.speed };
      }
      return { stalled: false, speed: s.craft.speed };
    };
    expect(outcome(30).stalled).toBe(false);
    expect(outcome(60).stalled).toBe(true);
    const a = outcome(45, true);
    const b = outcome(60, true);
    expect(a.stalled && b.stalled).toBe(true);
    expect(b.speed).toBeGreaterThan(a.speed);
  });
});

describe('turn help and no rescue', () => {
  it('a 30 deg turn released for 10 s holds height within 3 m; without help it sinks over 10 m', () => {
    expect(Math.abs(secs(rolledIn(30), 10).craft.z - 100)).toBeLessThan(3);
    expect(100 - secs(rolledIn(30, { ...DEFAULT_TUNING, turnHelpDeg: 0 }), 10).craft.z).toBeGreaterThan(10);
  });
  it('rolling in and back out restores the pitch within 0.3 deg', () => {
    let s = secs(key(initialState(), 1), 2 / 3);
    expect(s.craft.pitch).toBeGreaterThan(initialState().craft.pitch + 0.5 * DEG);
    s = secs(key(s, -1), 2 / 3);
    s = secs(key(s, 0), 1);
    expect(s.craft.bank).toBe(0);
    expect(Math.abs(s.craft.pitch - initialState().craft.pitch)).toBeLessThan(0.3 * DEG);
  });
  it('45 deg released sinks over 15 m', () => {
    expect(100 - secs(rolledIn(45), 10).craft.z).toBeGreaterThan(15);
  });
  it('60 deg released at 90 m/s for 10 s: bank still 60, height falling', () => {
    let s = secs(rolledIn(60), 10);
    expect(s.craft.bank).toBeCloseTo(60 * DEG, 9);
    expect(s.craft.z).toBeLessThan(100);
    expect(forcesOn(s.craft, s.tuning, 10).dHeadingDt).toBeGreaterThan(0);
  });
});
