import { describe, expect, it } from 'vitest';
import { GEAR_AGL_M } from '../src/config/flight';
import { TAKEOFF_HUD_AGL_M } from '../src/config/display';
import { DEFAULT_TUNING } from '../src/config/motion';
import { SCALES } from '../src/config/scales';
import { densityRatio } from '../src/sim/flight/forces';
import { stability } from '../src/sim/flight/stability';
import { levelStallSpeed } from '../src/sim/flight/vspeeds';
import type { Crash } from '../src/sim/state';
import type { SimWorld } from '../src/sim/step';
import { DEG, flat } from './apHelpers';
import { craft } from './helpers';

const tuning = DEFAULT_TUNING;
const cruise = { z: 200, speed: 90, pitch: 0.09, pathAngle: 0 };
const at = (patch: Parameters<typeof craft>[0], world: SimWorld = flat, crash: Crash | null = null) => stability({ craft: craft({ ...cruise, ...patch }), crash, tuning }, world);
const speedFor = (mult: number, z = 200): number => (mult * levelStallSpeed(tuning, 0, 0)) / Math.sqrt(densityRatio(z, SCALES.altitude));

describe('stability', () => {
  it('cruise is stable', () => {
    expect(at({})).toEqual({ stable: true, danger: false, reason: null, dangerReason: null });
  });

  it('GROUND: on the ground or crashed', () => {
    expect(at({ onGround: true })).toMatchObject({ stable: false, danger: true, reason: 'GROUND' });
    const crash: Crash = { tick: 1, speed: 0, pathAngle: 0, cause: 'terrain', sink: 0 };
    expect(at({}, flat, crash)).toMatchObject({ danger: true, reason: 'GROUND' });
  });

  it('LOW: engage over 45 m, let go under 30 m', () => {
    expect(at({ z: 50 })).toMatchObject({ stable: true });
    expect(at({ z: 40 })).toMatchObject({ stable: false, danger: false, reason: 'LOW' });
    expect(at({ z: 25 })).toMatchObject({ danger: true, dangerReason: 'LOW' });
  });

  it('LOW with the gear out: needs 150 m, both ways', () => {
    expect(at({ z: GEAR_AGL_M + 5, gear: 1 })).toMatchObject({ stable: true });
    expect(at({ z: GEAR_AGL_M - 5, gear: 1 })).toMatchObject({ stable: false, danger: true, reason: 'LOW' });
    expect(at({ z: 100, gear: 0.04 })).toMatchObject({ stable: true });
  });

  it('the gear height equals the takeoff HUD height', () => {
    expect(GEAR_AGL_M).toBe(TAKEOFF_HUD_AGL_M);
  });

  it('BANK: 30 and 45 degrees', () => {
    expect(at({ bank: 29 * DEG }).stable).toBe(true);
    expect(at({ bank: 31 * DEG })).toMatchObject({ stable: false, danger: false, reason: 'BANK' });
    expect(at({ bank: -46 * DEG })).toMatchObject({ danger: true, dangerReason: 'BANK' });
  });

  it('PITCH: 15 and 25 degrees', () => {
    const p = (deg: number) => ({ pitch: deg * DEG, pathAngle: deg * DEG - 0.05 });
    expect(at(p(14)).stable).toBe(true);
    expect(at(p(16))).toMatchObject({ stable: false, danger: false, reason: 'PITCH' });
    expect(at({ pitch: -26 * DEG, pathAngle: -26 * DEG + 0.05 })).toMatchObject({ danger: true, dangerReason: 'PITCH' });
  });

  it('STALL: any stall state', () => {
    expect(at({ pitch: 0.2, pathAngle: -0.1 })).toMatchObject({ stable: false, danger: true, reason: 'STALL', dangerReason: 'STALL' });
  });

  it('SLOW: 1.15 and 1.05 times the stall speed', () => {
    expect(at({ speed: speedFor(1.2) }).stable).toBe(true);
    expect(at({ speed: speedFor(1.1) })).toMatchObject({ stable: false, danger: false, reason: 'SLOW' });
    expect(at({ speed: speedFor(1.02) })).toMatchObject({ danger: true, dangerReason: 'SLOW' });
  });

  it('TERRAIN: terrain ahead is both', () => {
    const cliff: SimWorld = { ...flat, heightAt: (x) => (x > 400 ? 500 : 0) };
    expect(at({ heading: Math.PI / 2, z: 200 }, cliff)).toMatchObject({ stable: false, danger: true, reason: 'TERRAIN' });
  });

  it('the first matching row names the reason', () => {
    expect(at({ bank: 50 * DEG, pitch: 30 * DEG, speed: speedFor(1.0), z: 20 })).toMatchObject({ reason: 'LOW', dangerReason: 'LOW' });
    expect(at({ bank: 50 * DEG, pitch: 30 * DEG, speed: speedFor(1.0) })).toMatchObject({ reason: 'BANK' });
  });
});
