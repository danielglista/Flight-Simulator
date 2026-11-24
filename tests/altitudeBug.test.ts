import { describe, expect, it } from 'vitest';
import { SCALES } from '../src/config/scales';
import { actionFor } from '../src/input/keyboard';
import { displayedAltitudeFt } from '../src/sim/units';
import { bugWorldZ, climbNeededFt, formatClimb, interceptDistance, stepAltBug, tapeY } from '../src/views/altitudeBug';

describe('stepAltBug', () => {
  it('steps and keeps whole 10 ft', () => {
    expect(stepAltBug(3300, 100, 20000)).toBe(3400);
    expect(stepAltBug(3300, -10, 20000)).toBe(3290);
    expect(stepAltBug(3303, 0, 20000)).toBe(3300);
  });
  it('clamps to 0 and the maximum', () => {
    expect(stepAltBug(50, -100, 20000)).toBe(0);
    expect(stepAltBug(19950, 100, 20000)).toBe(20000);
  });
});

describe('bugWorldZ', () => {
  it('round-trips with the displayed altitude', () => {
    expect(displayedAltitudeFt(bugWorldZ(4000, SCALES), SCALES)).toBeCloseTo(4000, 6);
  });
});

describe('climbNeededFt / formatClimb', () => {
  it('is signed', () => {
    expect(climbNeededFt(3000, 3400)).toBe(400);
    expect(climbNeededFt(3000, 2900)).toBe(-100);
  });
  it('formats to the nearest 10 ft with a sign', () => {
    expect(formatClimb(404)).toBe('+400 ft');
    expect(formatClimb(-116)).toBe('-120 ft');
    expect(formatClimb(2)).toBe('0 ft');
  });
});

describe('interceptDistance', () => {
  it('is the run to the bug along the path', () => {
    expect(interceptDistance(100, 150, Math.atan(0.25))).toBeCloseTo(200, 6);
    expect(interceptDistance(100, 50, -Math.atan(0.25))).toBeCloseTo(200, 6);
  });
  it('is null when level, moving away, or already there', () => {
    expect(interceptDistance(100, 150, 0)).toBeNull();
    expect(interceptDistance(100, 150, -0.1)).toBeNull();
    expect(interceptDistance(100, 50, 0.1)).toBeNull();
    expect(interceptDistance(100, 100, 0.1)).toBeNull();
  });
});

describe('tapeY', () => {
  it('puts the center altitude on the center row and up is smaller y', () => {
    expect(tapeY(3000, 3000, 100, 0.4, 50)).toBe(100);
    expect(tapeY(3010, 3000, 100, 0.4, 50)).toBeCloseTo(96, 6);
  });
  it('clamps to the tape edges', () => {
    expect(tapeY(9000, 3000, 100, 0.4, 50)).toBe(50);
    expect(tapeY(0, 3000, 100, 0.4, 50)).toBe(150);
  });
});

describe('altitude bug keys', () => {
  it('Minus and Equal are actions that repeat', () => {
    expect(actionFor({ code: 'Minus' })).toBe('Minus');
    expect(actionFor({ code: 'Equal', repeat: true })).toBe('Equal');
    expect(actionFor({ code: 'Equal', ctrlKey: true })).toBeNull();
  });
});
