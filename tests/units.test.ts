import { describe, expect, it } from 'vitest';
import { CEILING_Z } from '../src/config/motion';
import { SCALES } from '../src/config/scales';
import { initialState } from '../src/sim/state';
import { displayedAltitudeFt, metersPerSecondToKnots, verticalSpeedFpm } from '../src/sim/units';
import { formatAltitude, formatSpeed, formatVerticalSpeed } from '../src/views/format';
import { readoutText } from '../src/views/instruments';

const DEG = Math.PI / 180;

describe('units', () => {
  it('converts speed, altitude and vertical speed', () => {
    expect(metersPerSecondToKnots(60)).toBeCloseTo(116.63, 2);
    expect(displayedAltitudeFt(100, SCALES)).toBeCloseTo(3280.8, 1);
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
    expect(formatAltitude(displayedAltitudeFt(CEILING_Z, SCALES))).toBe('19,690');
    expect(formatVerticalSpeed(3056.9)).toBe('+3,050');
    expect(formatVerticalSpeed(-520)).toBe('-500');
  });
  it('small values read 0, never -0 or +0', () => {
    expect(formatVerticalSpeed(-20)).toBe('0');
    expect(formatVerticalSpeed(24)).toBe('0');
    expect(formatSpeed(-0.2)).toBe('0');
    expect(formatAltitude(-3)).toBe('0');
  });
});

describe('readoutText', () => {
  it('start state', () => {
    expect(readoutText(initialState().craft, SCALES)).toEqual({ spd: '117', alt: '3,280', hdg: '045', vs: '0' });
  });
  it('a change too small to show gives the same text', () => {
    const c = initialState().craft;
    expect(readoutText({ ...c, z: c.z + 0.01 }, SCALES)).toEqual(readoutText(c, SCALES));
  });
  it('a crashed craft reads zero speed and V/S', () => {
    const c = { ...initialState().craft, speed: 0, pathAngle: -0.2 };
    const t = readoutText(c, SCALES);
    expect(t.spd).toBe('0');
    expect(t.vs).toBe('0');
  });
});
