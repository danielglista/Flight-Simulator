import { describe, expect, it } from 'vitest';
import { topBugShown, bugCrossing, stepBug, turnNeeded } from '../src/views/headingBug';

const RAD = Math.PI / 180;

describe('stepBug', () => {
  it('wraps both ways into [0, 360)', () => {
    expect(stepBug(358, 5)).toBe(3);
    expect(stepBug(2, -5)).toBe(357);
    expect(stepBug(0, -360)).toBe(0);
    expect(stepBug(90, 0)).toBe(90);
  });
});

describe('turnNeeded', () => {
  it('is signed, positive = right, and takes the short way across north', () => {
    expect(turnNeeded(90, 135)).toBe(45);
    expect(turnNeeded(90, 45)).toBe(-45);
    expect(turnNeeded(350, 10)).toBe(20);
    expect(turnNeeded(10, 350)).toBe(-20);
    expect(turnNeeded(45, 45)).toBe(0);
  });
  it('treats exactly opposite as a right turn of 180', () => {
    expect(turnNeeded(0, 180)).toBe(180);
    expect(turnNeeded(270, 90)).toBe(180);
  });
});

describe('bugCrossing', () => {
  const track = (from: number, ratePerPoint: number, n = 6): number[] => Array.from({ length: n }, (_, i) => (from + ratePerPoint * i) * RAD);
  it('finds where a right turn reaches the bug, with the fraction inside the segment', () => {
    const c = bugCrossing(track(0, 10), 25);
    expect(c?.index).toBe(2);
    expect(c?.t).toBeCloseTo(0.5, 9);
  });
  it('finds a left turn, and a crossing through north', () => {
    expect(bugCrossing(track(20, -10), 5)?.index).toBe(1);
    expect(bugCrossing(track(350, 10), 5)?.index).toBe(1);
  });
  it('is null when the path is straight, turns away, ends short, or starts on the bug', () => {
    expect(bugCrossing(track(0, 0), 30)).toBeNull();
    expect(bugCrossing(track(0, -10), 30)).toBeNull();
    expect(bugCrossing(track(0, 10), 80)).toBeNull();
    expect(bugCrossing(track(30, 10), 30)).toBeNull();
  });
});

describe('top view bug visibility', () => {
  it('shows only airborne, following and not crashed', () => {
    expect(topBugShown(true, false, false)).toBe(true);
    expect(topBugShown(false, false, false)).toBe(false);
    expect(topBugShown(true, true, false)).toBe(false);
    expect(topBugShown(true, false, true)).toBe(false);
  });
});
