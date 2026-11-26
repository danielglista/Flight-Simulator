import { describe, expect, it } from 'vitest';
import { CEILING_Z } from '../src/config/motion';
import { SCALES } from '../src/config/scales';
import { initialState } from '../src/sim/state';
import { displayedAltitudeFt, indicatedSpeed, metersPerSecondToKnots, verticalSpeedFpm } from '../src/sim/units';
import { formatAltitude, formatSpeed, formatVerticalSpeed } from '../src/views/format';
import { readoutText } from '../src/views/instruments';

const DEG = Math.PI / 180;

describe('units', () => {
  it('converts speed, altitude and vertical speed', () => {
    expect(metersPerSecondToKnots(60)).toBeCloseTo(116.63, 2);
    expect(displayedAltitudeFt(200, SCALES)).toBeCloseTo(3280.8, 1);
    expect(verticalSpeedFpm({ speed: 60, pathAngle: 15 * DEG })).toBeCloseTo(3056.9, 1);
  });
  it('altitude scale changes altitude but not V/S', () => {
    expect(displayedAltitudeFt(100, { ...SCALES, altitude: 20 })).toBeCloseTo(6561.7, 1);
    expect(verticalSpeedFpm({ speed: 60, pathAngle: 15 * DEG })).toBeCloseTo(3056.9, 1);
  });
});

describe('formats', () => {
  it('rounds and adds commas', () => {
    expect(formatSpeed(116.63)).toBe('117');
    expect(formatAltitude(3280.8)).toBe('3,280');
    expect(formatAltitude(displayedAltitudeFt(CEILING_Z, SCALES))).toBe('40,000');
    expect(formatVerticalSpeed(3056.9)).toBe('+3,060');
    expect(formatVerticalSpeed(-520)).toBe('-520');
  });
  it('small values read 0, never -0 or +0', () => {
    expect(formatVerticalSpeed(-4)).toBe('0');
    expect(formatVerticalSpeed(4)).toBe('0');
    expect(formatSpeed(-0.2)).toBe('0');
    expect(formatAltitude(-3)).toBe('0');
  });
});

describe('readoutText', () => {
  it('start state', () => {
    expect(readoutText(initialState().craft, SCALES)).toEqual({
      spd: '167', alt: '3,280', hdg: '045', vs: '0', pit: '+5.4', bnk: '0', thr: '46', eng: '46', gear: 'UP', flp: 'UP', brk: '', warn: '', stalled: false,
    });
  });
  it('a change too small to show gives the same text', () => {
    const c = initialState().craft;
    expect(readoutText({ ...c, z: c.z + 0.01 }, SCALES)).toEqual(readoutText(c, SCALES));
  });
  it('SPD is indicated: equal to true speed at sea level, lower aloft', () => {
    const c = { ...initialState().craft, z: 0 };
    expect(indicatedSpeed(c, SCALES)).toBe(c.speed);
    expect(indicatedSpeed({ ...c, z: 200 }, SCALES)).toBeCloseTo(90 * Math.sqrt(0.907), 1);
  });
  it('warning text for each state, and the PIT format', () => {
    const c = initialState().craft;
    expect(readoutText(c, SCALES, 'warning')).toMatchObject({ warn: 'STALL', stalled: false });
    expect(readoutText(c, SCALES, 'stalled')).toMatchObject({ warn: 'STALL', stalled: true });
    expect(readoutText({ ...c, pitch: -12 * DEG }, SCALES).pit).toBe('-12.0');
    expect(readoutText({ ...c, pitch: 0 }, SCALES).pit).toBe('0.0');
    expect(readoutText({ ...c, pitch: 5.14 * DEG }, SCALES).pit).toBe('+5.1');
  });
  it('a crashed craft reads zero speed and V/S', () => {
    const c = { ...initialState().craft, speed: 0, pathAngle: -0.2 };
    const t = readoutText(c, SCALES);
    expect(t.spd).toBe('0');
    expect(t.vs).toBe('0');
  });
});
