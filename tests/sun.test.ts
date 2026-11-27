import { describe, expect, it } from 'vitest';
import { DAY_STEPS, SUN_START_TIME } from '../src/config/sun';
import { advance, applyCommands } from '../src/sim/step';
import { initialState } from '../src/sim/state';
import { SUN_CLOCK_START, setHold, setTime, sunPosition, sunStep, timeOfDay } from '../src/sim/sun';
import { realWorld } from './helpers';

const MINUTE = 60 * 60;
const deg = (r: number) => (r * 180) / Math.PI;

describe('sun path', () => {
  it.each([
    [0, 90, 0],
    [3, 122, 33],
    [6, 180, 51],
    [9, 238, 33],
    [12, 270, 0],
  ])('at %i min stands at azimuth %i, elevation %i', (minutes, azimuth, elevation) => {
    const p = sunPosition(minutes * MINUTE);
    expect(Math.round(deg(p.azimuth))).toBe(azimuth);
    expect(Math.round(deg(p.elevation))).toBe(elevation);
  });
});

describe('sun clock', () => {
  it('starts mid-morning and wraps from sunset straight to sunrise', () => {
    expect(timeOfDay(0, SUN_CLOCK_START)).toBe(SUN_START_TIME);
    expect(SUN_START_TIME).toBe(3 * MINUTE);
    expect(timeOfDay(9 * MINUTE - 1, SUN_CLOCK_START)).toBe(DAY_STEPS - 1);
    expect(timeOfDay(9 * MINUTE, SUN_CLOCK_START)).toBe(0);
  });
  it('takes 60 fixed positions, one every 12 s', () => {
    expect(sunStep(0)).toBe(0);
    expect(sunStep(12 * 60 - 1)).toBe(0);
    expect(sunStep(12 * 60)).toBe(1);
    expect(sunStep(DAY_STEPS - 1)).toBe(59);
  });
  it('can be set and held, and carries on from where it was held', () => {
    const set = setTime(SUN_CLOCK_START, 500, 1000);
    expect(timeOfDay(500, set)).toBe(1000);
    expect(timeOfDay(560, set)).toBe(1060);
    const held = setHold(set, 560, true);
    expect(timeOfDay(9000, held)).toBe(1060);
    expect(timeOfDay(9000, setTime(held, 9000, 2000))).toBe(2000);
    expect(timeOfDay(9001, setTime(held, 9000, 2000))).toBe(2000);
    expect(timeOfDay(9060, setHold(held, 9000, false))).toBe(1120);
  });
});

describe('sun commands', () => {
  const { world } = realWorld();
  const time = (s: ReturnType<typeof initialState>) => timeOfDay(s.tick, s.sunClock);
  it('sets and holds the time, ignoring bad values', () => {
    let s = applyCommands(initialState(), [{ kind: 'sunTime', value: 100 }], world);
    expect(time(s)).toBe(100);
    expect(applyCommands(s, [{ kind: 'sunTime', value: Number.NaN }], world)).toBe(s);
    s = advance(applyCommands(s, [{ kind: 'sunHold', value: true }], world), world);
    expect(time(s)).toBe(100);
    s = advance(applyCommands(s, [{ kind: 'sunHold', value: false }], world), world);
    expect(time(s)).toBe(101);
  });
  it('is left alone by a new start', () => {
    let s = applyCommands(initialState(), [{ kind: 'sunTime', value: 100 }], world);
    s = applyCommands(advance(s, world), [{ kind: 'start', spec: s.start }], world);
    expect(time(s)).toBe(101);
  });
});
