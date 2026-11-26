import { SPOOL_FULL_RESPONSE } from '../src/config/flight';
import { spoolUpTau } from '../src/sim/flight/forces';
import { SPOOL_STABLE } from '../src/config/flight';
import { stepEngine } from '../src/sim/flight/forces';
import { describe, expect, it } from 'vitest';
import { SCALES } from '../src/config/scales';
import { GRAVITY } from '../src/config/flight';
import { DEFAULT_TUNING, START_LEVER, START_PITCH, START_Z } from '../src/config/motion';
import { densityRatio, forcesOn, thrust } from '../src/sim/flight/forces';
import { CEILING_Z } from '../src/config/motion';
import { stallState } from '../src/sim/flight/aero';
import { initialState, type SimState } from '../src/sim/state';
import { advance, applyCommands, type SimWorld } from '../src/sim/step';

const DEG = Math.PI / 180;
const DEEP: SimWorld = { width: 1e7, height: 1e7, heightAt: () => -1e9, altitudeScale: SCALES.altitude, groundKind: () => 'rough' as const };
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

describe('thrust', () => {
  it('is 0 at idle, full at sea level, and falls with height', () => {
    expect(thrust(0, DEFAULT_TUNING, 1)).toBe(0);
    expect(thrust(1, DEFAULT_TUNING, 1)).toBe(100000);
    expect(thrust(1, DEFAULT_TUNING, 0.5)).toBeLessThan(100000);
  });
});

describe('energy', () => {
  it('V^2/2 + G z is constant with no engine and no drag below separation, in climb, dive and reversal', () => {
    const tuning = { ...DEFAULT_TUNING, thrustMaxKn: 0, cd0Counts: 0, inducedCounts: 0 };
    let s: SimState = { ...at({ speed: 120, spool: 0, lever: 0 }), tuning };
    const e0 = energy(s);
    for (const p of [1, -1, 0, 1, -1] as const) {
      for (let i = 0; i < 60; i++) {
        s = advance(hold(s, p), DEEP);
        expect(Math.abs(forcesOn(s.craft, tuning, SCALES.altitude).separation)).toBe(0);
      }
      expect(Math.abs(energy(s) - e0)).toBeLessThan(1e-9);
    }
  });
});

/** Level-flight trim at 90 m/s and the start height, found by bisection on the forces, not read from config. */
function solveTrim(): { pitch: number; lever: number } {
  const probe = (pitch: number, spool: number) => forcesOn({ ...initialState().craft, pitch, spool }, DEFAULT_TUNING, SCALES.altitude);
  let lever = 0.3;
  let pitch = 0.1;
  for (let k = 0; k < 40; k++) {
    let lo = 0;
    let hi = 0.3;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (probe(mid, lever).dPathDt < 0) lo = mid;
      else hi = mid;
    }
    pitch = (lo + hi) / 2;
    const f = probe(pitch, 0);
    // along = 0  =>  T cos(a) = D
    lever = f.drag / Math.cos(f.alpha) / (DEFAULT_TUNING.thrustMaxKn * 1000 * Math.pow(f.sigma, 0.7));
  }
  return { pitch, lever };
}

describe('trim and trade', () => {
  it('start values are the recomputed trim', () => {
    const t = solveTrim();
    expect(Math.abs(t.pitch - START_PITCH)).toBeLessThan(1e-3);
    expect(Math.abs(t.lever - START_LEVER)).toBeLessThan(1e-3);
  });
  it('start, hands off, flat world: holds 90 m/s and the start height for 60 s', () => {
    const s = run(initialState(), 3600, DEEP);
    expect(Math.abs(s.craft.speed - 90)).toBeLessThan(0.5);
    expect(Math.abs(s.craft.z - START_Z)).toBeLessThan(2);
  });
  it('holding S loses speed and gains height; W the reverse', () => {
    const up = run(hold(initialState(), 1), 240).craft;
    const down = run(hold(initialState(), -1), 240).craft;
    expect(up.speed).toBeLessThan(90);
    expect(up.z).toBeGreaterThan(START_Z);
    expect(down.speed).toBeGreaterThan(90);
    expect(down.z).toBeLessThan(START_Z);
  });
  it('full throttle raises energy height, idle lowers it', () => {
    const e0 = energy(initialState());
    expect(energy(run(at({ lever: 1, spool: 1 }), 600))).toBeGreaterThan(e0);
    expect(energy(run(at({ lever: 0, spool: 0 }), 600))).toBeLessThan(e0);
  });
  it('a higher held attitude gives a lower climb speed', () => {
    const climb = (pitchDeg: number): number => {
      const s = at({ lever: 1, spool: 1, pitch: pitchDeg * DEG });
      return run(s, 600).craft.speed;
    };
    expect(climb(12)).toBeLessThan(climb(7));
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

describe('idle', () => {
  it('idle hands-off settles between 45 and 70 m/s, descending, short of the stall, without oscillating', () => {
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
  it('held S at full throttle from 200 m under it: never above it, path settles at 0, nose never jumps, not stalled later', () => {
    let s = hold(at({ z: CEILING_Z - 200, speed: 150, lever: 1, spool: 1 }), 1);
    let maxJump = 0;
    for (let i = 0; i < 60 * 40; i++) {
      const n = advance(s, DEEP);
      maxJump = Math.max(maxJump, Math.abs(n.craft.pitch - s.craft.pitch));
      expect(n.craft.z).toBeLessThanOrEqual(CEILING_Z);
      s = n;
    }
    expect(s.craft.z).toBeGreaterThan(CEILING_Z - 1);
    expect(Math.abs(s.craft.pathAngle)).toBeLessThan(0.5 * DEG);
    expect(maxJump).toBeLessThan(3 * DEG);
    expect(stallState(s.craft, s.tuning)).toBe('none');
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
    expect(s.craft.lever).toBe(START_LEVER);
    expect(s.craft.spool).toBe(START_LEVER);
  });
});

describe('forcesOn', () => {
  it('dV/dt is (T cos(a) - D)/m - G sin(path); load factor is lift over weight', () => {
    const c = at({ pathAngle: 5 * DEG }).craft;
    const f = forcesOn(c, DEFAULT_TUNING, SCALES.altitude);
    expect(f.dVdt).toBeCloseTo((f.thrust * Math.cos(f.alpha) - f.drag) / 24000 - GRAVITY * Math.sin(5 * DEG), 12);
    expect(f.loadFactor).toBeCloseTo(f.lift / (24000 * GRAVITY), 12);
    expect(f.weight).toBeCloseTo(24000 * GRAVITY * Math.sin(5 * DEG), 6);
  });
});

describe('spool from idle', () => {
  const dt = 1 / 60;
  const off = { ...DEFAULT_TUNING, spoolIdleTauS: 0 };
  const secondsTo = (target: number, from: number, tuning = DEFAULT_TUNING): number => {
    let c = { lever: 1, spool: from };
    let n = 0;
    while (c.spool < target && n < 6000) {
      c = stepEngine(c, 0, tuning, dt);
      n++;
    }
    return n * dt;
  };

  it('takes about 3 s from idle to the stable mark', () => {
    expect(secondsTo(SPOOL_STABLE, 0)).toBeGreaterThan(2.7);
    expect(secondsTo(SPOOL_STABLE, 0)).toBeLessThan(3.3);
    expect(secondsTo(SPOOL_STABLE, 0, off)).toBeLessThan(0.5);
  });

  it('eases to the normal lag with no step anywhere', () => {
    expect(spoolUpTau(0, DEFAULT_TUNING)).toBe(DEFAULT_TUNING.spoolIdleTauS);
    expect(spoolUpTau(SPOOL_FULL_RESPONSE, DEFAULT_TUNING)).toBe(DEFAULT_TUNING.spoolTauS);
    expect(spoolUpTau(1, DEFAULT_TUNING)).toBe(DEFAULT_TUNING.spoolTauS);
    let last = spoolUpTau(0, DEFAULT_TUNING);
    for (let s = 0.005; s <= 0.5; s += 0.005) {
      const tau = spoolUpTau(s, DEFAULT_TUNING);
      expect(tau).toBeLessThanOrEqual(last);
      expect(last - tau).toBeLessThan(0.3);
      last = tau;
    }
  });

  it('never slows spooling down', () => {
    const down = { lever: 0, spool: 0.2 };
    expect(stepEngine(down, 0, DEFAULT_TUNING, dt).spool).toBe(stepEngine(down, 0, off, dt).spool);
  });

  it('still reaches a lever set low, without passing it', () => {
    let c = { lever: 0.1, spool: 0 };
    for (let i = 0; i < 60 * 120; i++) c = stepEngine(c, 0, DEFAULT_TUNING, dt);
    expect(c.spool).toBeLessThanOrEqual(0.1);
    expect(c.spool).toBeCloseTo(0.1, 3);
  });
});
