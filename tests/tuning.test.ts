import { describe, expect, it } from 'vitest';
import { SCALES } from '../src/config/scales';
import { createLoop } from '../src/app/loop';
import { createStepper } from '../src/app/stepper';
import { CEILING_Z, DEFAULT_TUNING, START_LEVER, TUNING_RANGES, type Tuning } from '../src/config/motion';
import type { Command } from '../src/sim/commands';
import { stepPitch } from '../src/sim/flight/attitude';
import { forcesOn } from '../src/sim/flight/forces';
import { initialState, type SimState } from '../src/sim/state';
import { advance, applyCommands, type SimWorld } from '../src/sim/step';

const DEG = Math.PI / 180;
const W: SimWorld = { width: 5120, height: 5120, heightAt: () => 0, altitudeScale: SCALES.altitude, groundKind: () => 'rough' as const };
const KEYS = Object.keys(TUNING_RANGES) as (keyof Tuning)[];
const tune = (key: keyof Tuning, value: number): Command => ({ kind: 'tune', key, value });
const run = (s: SimState, n: number, w = W): SimState => {
  for (let i = 0; i < n; i++) s = advance(s, w);
  return s;
};

describe('tune command', () => {
  it('sets a value inside the range', () => {
    expect(applyCommands(initialState(), [tune('rollRateDegS', 60)], W).tuning.rollRateDegS).toBe(60);
  });
  it('ignores unknown keys and non-finite values, and returns the same state', () => {
    const s = initialState();
    expect(applyCommands(s, [{ kind: 'tune', key: 'bogus' as keyof Tuning, value: 5 }], W)).toBe(s);
    expect(applyCommands(s, [{ kind: 'tune', key: 'toString' as keyof Tuning, value: 5 }], W)).toBe(s);
    for (const v of [NaN, Infinity, -Infinity]) expect(applyCommands(s, [tune('massT', v)], W)).toBe(s);
  });
  it('clamps at both ends', () => {
    for (const k of KEYS) {
      const r = TUNING_RANGES[k];
      expect(applyCommands(initialState(), [tune(k, -1e9)], W).tuning[k]).toBe(r.min);
      expect(applyCommands(initialState(), [tune(k, 1e9)], W).tuning[k]).toBe(r.max);
    }
  });
  it('same state object when the value is unchanged', () => {
    const s = initialState();
    expect(applyCommands(s, [tune('massT', DEFAULT_TUNING.massT)], W)).toBe(s);
  });
  it('works while crashed and survives restart, place and rotate', () => {
    let s: SimState = { ...initialState(), crash: { tick: 1, speed: 1, pathAngle: 0, cause: "terrain" as const, sink: 0 } };
    s = applyCommands(s, [tune('stallDeg', 18)], W);
    expect(s.tuning.stallDeg).toBe(18);
    s = applyCommands(s, [{ kind: 'restart' }], W);
    expect(s.crash).toBeNull();
    expect(s.tuning.stallDeg).toBe(18);
    s = applyCommands(s, [{ kind: 'place', x: 5, y: 5 }, { kind: 'rotate', by: 1 }], W);
    expect(s.tuning.stallDeg).toBe(18);
  });
  it('defaults are in range and on a step', () => {
    for (const k of KEYS) {
      const r = TUNING_RANGES[k];
      const v = DEFAULT_TUNING[k];
      expect(v).toBeGreaterThanOrEqual(r.min);
      expect(v).toBeLessThanOrEqual(r.max);
      const n = (v - r.min) / r.step;
      expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-9);
    }
    expect(initialState().tuning).toEqual(DEFAULT_TUNING);
  });
});

describe('tuning in motion', () => {
  it('roll rate and turn multiplier', () => {
    const roll = (rate: number): number => run(applyCommands(initialState(), [tune('rollRateDegS', rate), { kind: 'turn', value: 1 }], W), 30).craft.bank / DEG;
    // The roll rate builds through a lag, and authority is full at start speed, so the bank scales with the rate.
    expect(roll(30)).toBeGreaterThan(5);
    expect(roll(60) / roll(30)).toBeCloseTo(2, 6);
    const turned = (mult: number): number => {
      const s0 = applyCommands(initialState(), [tune('turnMult', mult), { kind: 'turn', value: 1 }], W);
      const s = run(s0, 120);
      return s.craft.heading - s0.craft.heading;
    };
    expect(turned(4) / turned(2)).toBeGreaterThan(1.8);
  });
  it('lever rate', () => {
    let s = applyCommands(initialState(), [tune('leverRatePctS', 10), { kind: 'throttle', value: 1 }], W);
    s = run(s, 60);
    expect(s.craft.lever).toBeCloseTo(START_LEVER + 0.1, 9);
  });
  it('spool time constant: 63% of the way after one tau', () => {
    let s = applyCommands(initialState(), [tune('spoolTauS', 1), { kind: 'throttle', value: 1 }], W);
    s = { ...s, craft: { ...s.craft, lever: 1, spool: 0 }, controls: { ...s.controls, throttle: 0 } };
    s = run(s, 60);
    expect(s.craft.spool).toBeCloseTo(1 - Math.exp(-1), 9);
  });
  it('raising mass sinks the plane: the start trim is for 24 t', () => {
    const height = (m: number): number => run(applyCommands(initialState(), [tune('massT', m)], { ...W, heightAt: () => -1e9 }), 600, { ...W, heightAt: () => -1e9 }).craft.z;
    expect(height(40)).toBeLessThan(height(24));
    expect(height(24)).toBeLessThan(height(12));
  });
  it('pitch rate: a key held past the ramp commands about the slider value, and a tap far less', () => {
    const base = { pitch: 0, pitchRate: 0, hold: 0, key: 1 as const, speed: 90, sigma: 1, alpha: 0.05, separation: 0, loadFactor: 1 };
    const settled = (rate: number, steps: number): number => {
      let p = { pitch: 0, pitchRate: 0, hold: 0 };
      for (let i = 0; i < steps; i++) p = stepPitch({ ...base, ...p, pitch: 0 }, { ...DEFAULT_TUNING, pitchRateDegS: rate }, 1 / 60);
      return p.pitchRate / DEG;
    };
    expect(settled(20, 180)).toBeGreaterThan(settled(10, 180) * 1.4);
    expect(settled(10, 180)).toBeGreaterThan(9);
    expect(settled(10, 180)).toBeLessThanOrEqual(10);
    expect(settled(10, 6)).toBeLessThan(1);
  });
  it('a higher stall angle stalls later: the same pull separates more with a 10 deg stall angle than with 20', () => {
    const pull = (deg: number): number => {
      let s = applyCommands(initialState(), [tune('stallDeg', deg), { kind: 'pitch', value: 1 }], W);
      let peak = 0;
      for (let i = 0; i < 60 * 8; i++) {
        s = advance(s, W);
        peak = Math.max(peak, forcesOn(s.craft, s.tuning, SCALES.altitude).separation);
      }
      return peak;
    };
    expect(pull(10)).toBeGreaterThan(0.3);
    expect(pull(20)).toBeLessThan(pull(10));
  });
  it('10,000 steps at every maximum and with mid-run changes: finite, above ground, under the ceiling', () => {
    const hills: SimWorld = { ...W, heightAt: (x, y) => 40 + 30 * Math.sin(x / 300) * Math.cos(y / 300) };
    for (const [mode, mid] of [['max', false], ['min', false], ['mid', true]] as const) {
      let s = initialState();
      if (!mid) for (const k of KEYS) s = applyCommands(s, [tune(k, mode === 'max' ? TUNING_RANGES[k].max : TUNING_RANGES[k].min)], hills);
      for (let i = 0; i < 10000; i++) {
        const cmds: Command[] = [];
        if (i % 37 === 0) cmds.push({ kind: 'turn', value: ([-1, 0, 1] as const)[Math.floor(i / 37) % 3]! });
        if (i % 53 === 0) cmds.push({ kind: 'pitch', value: ([1, 1, 0, -1, 1] as const)[Math.floor(i / 53) % 5]! });
        if (i % 211 === 0) cmds.push({ kind: 'throttle', value: ([1, 0, -1] as const)[Math.floor(i / 211) % 3]! });
        if (mid && i % 97 === 0) {
          const k = KEYS[Math.floor(i / 97) % KEYS.length]!;
          const r = TUNING_RANGES[k];
          cmds.push(tune(k, i % 2 ? r.min : r.max));
        }
        if (s.crash && i % 7 === 0) cmds.push({ kind: 'restart' });
        s = advance(applyCommands(s, cmds, hills), hills);
        for (const v of Object.values(s.craft)) expect(typeof v === 'boolean' || Number.isFinite(v)).toBe(true);
        expect(s.craft.z).toBeGreaterThanOrEqual(hills.heightAt(s.craft.x, s.craft.y) - 1e-9);
        expect(s.craft.z).toBeLessThanOrEqual(CEILING_Z);
        expect(Math.abs(s.craft.pitch)).toBeLessThanOrEqual(30 * DEG + 1e-12);
        expect(Math.abs(s.craft.bank)).toBeLessThanOrEqual(60 * DEG + 1e-12);
        expect(Math.abs(s.craft.pathAngle)).toBeLessThanOrEqual(80 * DEG + 1e-12);
        expect(s.craft.speed === 0 || (s.craft.speed >= 20 && s.craft.speed <= 300)).toBe(true);
      }
    }
  }, 30000);
  it('is frame-rate independent with tune commands at fixed ticks', () => {
    const script: [number, Command][] = [
      [10, { kind: 'turn', value: 1 }],
      [50, tune('rollRateDegS', 90)],
      [100, tune('thrustMaxKn', 60)],
      [150, { kind: 'throttle', value: 1 }],
      [200, tune('stallDeg', 12)],
      [220, { kind: 'pitch', value: 1 }],
    ];
    const final = (times: number[]): string => {
      const stepper = createStepper();
      let s = initialState();
      let i = 0;
      const step = (): void => {
        const cmds: Command[] = [];
        while (i < script.length && script[i]![0] <= s.tick) cmds.push(script[i++]![1]);
        s = advance(applyCommands(s, cmds, W), W);
      };
      for (const dt of times) {
        const { steps } = stepper.advance(dt);
        for (let n = 0; n < steps && s.tick < 400; n++) step();
      }
      while (s.tick < 400) step();
      return JSON.stringify(s);
    };
    const even = (hz: number): number[] => Array.from({ length: hz * 8 }, () => 1 / hz);
    const irregular = Array.from({ length: 400 }, (_, k) => 0.005 + ((k * 7919) % 40) / 1000);
    const ref = final(even(60));
    expect(final(even(30))).toBe(ref);
    expect(final(even(144))).toBe(ref);
    expect(final(irregular)).toBe(ref);
  });
});

describe('tune through the loop', () => {
  const DT = 1000 / 60;
  const make = (startPaused = false) => {
    const frames: number[] = [];
    const loop = createLoop({
      world: W,
      draw: () => {},
      requestDraw: () => {},
      sampleKeys: () => [],
      clearKeys: () => {},
      startPaused,
      onFrame: (s) => frames.push(s),
    });
    return { loop, frames };
  };
  it('applies at once while running, and survives an immediate pause', () => {
    const { loop } = make();
    loop.frame(0);
    loop.frame(DT);
    const tick = loop.state.tick;
    const craft = loop.state.craft;
    loop.send(tune('massT', 30));
    expect(loop.state.tuning.massT).toBe(30);
    expect(loop.state.tick).toBe(tick);
    expect(loop.state.craft).toBe(craft);
    loop.pause();
    expect(loop.state.tuning.massT).toBe(30);
  });
  it('applies while paused', () => {
    const { loop } = make(true);
    loop.send(tune('rollRateDegS', 90));
    expect(loop.state.tuning.rollRateDegS).toBe(90);
    expect(loop.state.tick).toBe(0);
  });
  it('onFrame skips the first frame and the first after a resume', () => {
    const { loop, frames } = make();
    loop.frame(0);
    expect(frames).toHaveLength(0);
    loop.frame(DT);
    loop.frame(2 * DT);
    expect(frames).toHaveLength(2);
    loop.pause();
    loop.frame(5000);
    expect(frames).toHaveLength(2);
    loop.resume();
    loop.frame(10000);
    expect(frames).toHaveLength(2);
    loop.frame(10000 + DT);
    expect(frames).toHaveLength(3);
    expect(frames[2]).toBeCloseTo(DT / 1000, 9);
  });
});
