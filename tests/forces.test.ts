import { describe, expect, it } from 'vitest';
import { GRAVITY, RHO0, WING_AREA } from '../src/config/flight';
import { DEFAULT_TUNING } from '../src/config/motion';
import { densityRatio, drag, forcesOn, sagLimit, thrust } from '../src/sim/flight/forces';
import { initialState, type SimState } from '../src/sim/state';
import { advance, applyCommands, type SimWorld } from '../src/sim/step';

const DEG = Math.PI / 180;
const DEEP: SimWorld = { width: 1e7, height: 1e7, heightAt: () => -1e9, altitudeScale: 10 };
const FLAT: SimWorld = { ...DEEP, heightAt: () => 0 };
const run = (s: SimState, n: number, w = DEEP): SimState => {
  for (let i = 0; i < n; i++) s = advance(s, w);
  return s;
};
const hold = (s: SimState, pitch: -1 | 0 | 1): SimState => applyCommands(s, [{ kind: 'pitch', value: pitch }], DEEP);
const energy = (s: SimState): number => s.craft.z + (s.craft.speed * s.craft.speed) / (2 * GRAVITY);
const at = (patch: Partial<SimState['craft']>): SimState => {
  const s = initialState();
  return { ...s, craft: { ...s.craft, ...patch } };
};

describe('density', () => {
  it('is 1 at sea level and below', () => {
    expect(densityRatio(0, 10)).toBe(1);
    expect(densityRatio(-50, 10)).toBe(1);
  });
  it('is 0.907 at 1,000 real m and falls with height', () => {
    expect(densityRatio(100, 10)).toBeCloseTo(0.907, 3);
    expect(densityRatio(200, 10)).toBeLessThan(densityRatio(100, 10));
  });
  it('uses real height: scale 10 at 100 m equals scale 1 at 1,000 m', () => {
    expect(densityRatio(100, 10)).toBeCloseTo(densityRatio(1000, 1), 12);
  });
  it('is finite at absurd heights', () => {
    for (const z of [1e5, 1e9, Infinity]) expect(Number.isFinite(densityRatio(z, 10))).toBe(true);
  });
});

describe('drag', () => {
  it('equals q S (cd0 + k Cl^2) at a hand-worked point', () => {
    const q = 0.5 * RHO0 * 90 * 90;
    const cl = (24000 * GRAVITY) / (q * WING_AREA);
    expect(drag(90, 0, 1, DEFAULT_TUNING)).toBeCloseTo(q * WING_AREA * (0.07 + 0.045 * cl * cl), 6);
  });
  it('is lowest near 66 m/s in level flight at sea level', () => {
    const d = (v: number) => drag(v, 0, 1, DEFAULT_TUNING);
    expect(d(66)).toBeLessThan(d(61));
    expect(d(66)).toBeLessThan(d(75));
  });
  it('is finite at zero speed', () => {
    expect(Number.isFinite(drag(0, 0, 1, DEFAULT_TUNING))).toBe(true);
  });
});

describe('thrust', () => {
  it('is 0 at idle, full at sea level, and falls with height', () => {
    expect(thrust(0, DEFAULT_TUNING, 1)).toBe(0);
    expect(thrust(1, DEFAULT_TUNING, 1)).toBe(100000);
    expect(thrust(1, DEFAULT_TUNING, 0.5)).toBeLessThan(100000);
  });
});

describe('energy', () => {
  it('V^2/2 + G z is constant with no engine and no drag, in climb, dive and reversal', () => {
    const tuning = { ...DEFAULT_TUNING, thrustMaxKn: 0, cd0Counts: 0, inducedCounts: 0 };
    let s: SimState = { ...at({ speed: 120, spool: 0, lever: 0 }), tuning };
    const e0 = energy(s);
    for (const p of [1, -1, 0, 1, -1] as const) {
      s = run(hold(s, p), 300);
      expect(Math.abs(energy(s) - e0)).toBeLessThan(1e-9);
    }
  });
});

describe('trim and trade', () => {
  it('start, hands off, flat world: holds 90 m/s and 100 m for 60 s', () => {
    const s = run(initialState(), 3600, DEEP);
    expect(Math.abs(s.craft.speed - 90)).toBeLessThan(0.2);
    expect(s.craft.z).toBe(100);
  });
  it('holding S loses speed and gains height; W the reverse', () => {
    const up = run(hold(initialState(), 1), 240).craft;
    const down = run(hold(initialState(), -1), 240).craft;
    expect(up.speed).toBeLessThan(90);
    expect(up.z).toBeGreaterThan(100);
    expect(down.speed).toBeGreaterThan(90);
    expect(down.z).toBeLessThan(100);
  });
  it('full throttle raises energy height, idle lowers it', () => {
    const e0 = energy(initialState());
    expect(energy(run(at({ lever: 1, spool: 1 }), 600))).toBeGreaterThan(e0);
    expect(energy(run(at({ lever: 0, spool: 0 }), 600))).toBeLessThan(e0);
  });
  it('steeper angle gives lower climb speed', () => {
    const climb = (deg: number): number => {
      const s = at({ lever: 1, spool: 1 });
      return run(applyCommands({ ...s, tuning: { ...s.tuning, pathMaxDeg: deg } }, [{ kind: 'pitch', value: 1 }], DEEP), 600).craft.speed;
    };
    expect(climb(15)).toBeLessThan(climb(5));
  });
});

describe('engine', () => {
  it('lever stops at 0 and 1 and holds with no key', () => {
    let s = applyCommands(initialState(), [{ kind: 'throttle', value: 1 }], DEEP);
    s = run(s, 300);
    expect(s.craft.lever).toBe(1);
    s = applyCommands(s, [{ kind: 'throttle', value: 0 }], DEEP);
    expect(run(s, 60).craft.lever).toBe(1);
    s = applyCommands(s, [{ kind: 'throttle', value: -1 }], DEEP);
    expect(run(s, 300).craft.lever).toBe(0);
  });
  it('spool lags the lever and never overshoots', () => {
    let s = applyCommands(initialState(), [{ kind: 'throttle', value: 1 }], DEEP);
    let prev = s.craft.spool;
    for (let i = 0; i < 600; i++) {
      s = advance(s, DEEP);
      expect(s.craft.spool).toBeLessThanOrEqual(s.craft.lever + 1e-12);
      expect(s.craft.spool).toBeGreaterThanOrEqual(prev);
      prev = s.craft.spool;
    }
  });
});

describe('sag limit', () => {
  const max = 15 * DEG;
  it('does nothing at or above 60 m/s equivalent and is continuous', () => {
    expect(sagLimit(60, 1, max)).toBe(max);
    expect(sagLimit(200, 0.5, max)).toBe(max);
    expect(Math.abs(sagLimit(59.99, 1, max) - sagLimit(60, 1, max))).toBeLessThan(0.01);
    expect(sagLimit(45, 1, max)).toBeCloseTo(-15 * DEG, 12);
    expect(sagLimit(10, 1, max)).toBeCloseTo(-15 * DEG, 12);
  });
  it('idle hands-off settles between 45 and 70 m/s, descending, without oscillating', () => {
    const s = run(at({ lever: 0, spool: 0 }), 60 * 240);
    expect(s.craft.speed).toBeGreaterThan(45);
    expect(s.craft.speed).toBeLessThan(70);
    expect(s.craft.pathAngle).toBeLessThan(0);
    let lo = Infinity;
    let hi = -Infinity;
    let t = s;
    for (let i = 0; i < 600; i++) {
      t = advance(t, DEEP);
      lo = Math.min(lo, t.craft.speed);
      hi = Math.max(hi, t.craft.speed);
    }
    expect(hi - lo).toBeLessThan(0.5);
  });
});

describe('ceiling', () => {
  it('held S at 600 m keeps the angle at 0 and speed as in level flight', () => {
    const base = at({ z: 600, speed: 120, lever: 0.5, spool: 0.5 });
    const level = run(base, 300);
    const climb = run(hold(base, 1), 300);
    expect(climb.craft.pathAngle).toBe(0);
    expect(climb.craft.z).toBe(600);
    expect(climb.craft.speed).toBeCloseTo(level.craft.speed, 9);
  });
});

describe('crash and restart', () => {
  it('zeroes lever and spool on impact, keeps impact speed, restores the start on restart', () => {
    let s = applyCommands(at({ z: 5, speed: 100, lever: 0.8, spool: 0.8 }), [{ kind: 'pitch', value: -1 }], FLAT);
    while (!s.crash) s = advance(s, FLAT);
    expect(s.craft.lever).toBe(0);
    expect(s.craft.spool).toBe(0);
    expect(s.crash.speed).toBeGreaterThan(50);
    s = applyCommands(s, [{ kind: 'restart' }], FLAT);
    expect(s.craft.lever).toBe(0.321);
    expect(s.craft.spool).toBe(0.321);
  });
});

describe('forcesOn', () => {
  it('matches the step: dV/dt is (T - D)/m - G sin(path)', () => {
    const c = at({ pathAngle: 5 * DEG }).craft;
    const f = forcesOn(c, DEFAULT_TUNING, 10);
    expect(f.dVdt).toBeCloseTo((f.thrust - f.drag) / 24000 - GRAVITY * Math.sin(5 * DEG), 12);
    expect(f.weight).toBeCloseTo(24000 * GRAVITY * Math.sin(5 * DEG), 6);
  });
});
