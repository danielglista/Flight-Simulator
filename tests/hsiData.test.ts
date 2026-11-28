import { describe, expect, it } from 'vitest';
import { APPROACH_AIM_M, APPROACH_PATH_DEG, HSI_GS_FULL_DEG, HSI_GS_RANGE_M, HSI_LOC_FULL_DEG } from '../src/config/display';
import { hsiDistance, hsiGuide, hsiSentence } from '../src/views/hsiData';
import type { RunwayEnd } from '../src/views/runwaySelect';

const DEG = Math.PI / 180;
/** Lands northward from (0, 0), 1,000 m of runway. */
const north: RunwayEnd = { ident: 'AAA', name: '36', threshold: { x: 0, y: 0 }, dir: { x: 0, y: 1 }, length: 1000 };
const south: RunwayEnd = { ident: 'AAA', name: '18', threshold: { x: 0, y: 1000 }, dir: { x: 0, y: -1 }, length: 1000 };
const flat = (): number => 0;
/** On the glide path, `back` meters before the threshold and `x` m east of the line. */
const onPath = (back: number, x = 0) => ({ x, y: -back, z: Math.tan(APPROACH_PATH_DEG * DEG) * (back + APPROACH_AIM_M) });

describe('selected approach numbers', () => {
  it('is centered and on the path on the way in', () => {
    const g = hsiGuide(onPath(2000), north, flat);
    expect(g.courseDeg).toBeCloseTo(0, 9);
    expect(g.deviation).toBeCloseTo(0, 9);
    expect(g.glide).toBeCloseTo(0, 6);
    expect(g.bearingDeg).toBeCloseTo(0, 9);
    expect(g.distanceM).toBe(2000);
  });

  it('puts the line left of a plane that is right of it, as an angle from the far end', () => {
    const x = Math.tan((HSI_LOC_FULL_DEG / 2) * DEG) * 3000;
    expect(hsiGuide(onPath(2000, x), north, flat).deviation).toBeCloseTo(-0.5, 6);
    expect(hsiGuide(onPath(2000, -x), north, flat).deviation).toBeCloseTo(0.5, 6);
    expect(hsiGuide(onPath(2000, 900), north, flat).deviation).toBe(-1);
    expect(hsiGuide(onPath(2000, x), north, flat).bearingDeg).toBeGreaterThan(300);
  });

  it('works from the other end', () => {
    const g = hsiGuide({ x: 50, y: 3000, z: 100 }, south, flat);
    expect(g.courseDeg).toBeCloseTo(180, 9);
    // Heading south, a plane east of the line is left of it: the line is to the right.
    expect(g.deviation).toBeGreaterThan(0);
  });

  it('puts the diamond high when the plane is low, pegged beyond full scale', () => {
    const toAim = 2000 + APPROACH_AIM_M;
    const at = (angle: number) => hsiGuide({ x: 0, y: -2000, z: Math.tan(angle * DEG) * toAim }, north, flat).glide;
    expect(at(APPROACH_PATH_DEG - HSI_GS_FULL_DEG / 2)).toBeCloseTo(0.5, 6);
    expect(at(APPROACH_PATH_DEG + HSI_GS_FULL_DEG / 2)).toBeCloseTo(-0.5, 6);
    expect(at(0)).toBe(1);
  });

  it('aims where the runway says, when it does', () => {
    const end = { ident: 'SBY', name: '05', threshold: { x: 0, y: 0 }, dir: { x: 0, y: 1 }, length: 762, aimM: 60 };
    const g = hsiGuide({ x: 0, y: -1000, z: Math.tan(APPROACH_PATH_DEG * DEG) * 1060 }, end, () => 0);
    expect(g.glide).toBeCloseTo(0, 6);
    expect(hsiGuide({ x: 0, y: 61, z: 10 }, end, () => 0).glide).toBeNull();
  });
  it('hides the glide path far out, past the aim point and well off to the side', () => {
    expect(hsiGuide(onPath(HSI_GS_RANGE_M), north, flat).glide).toBeNull();
    expect(hsiGuide({ x: 0, y: APPROACH_AIM_M + 1, z: 10 }, north, flat).glide).toBeNull();
    expect(hsiGuide({ x: 2000, y: -1000, z: 50 }, north, flat).glide).toBeNull();
  });

  it('reads distance in world km and says where the line is', () => {
    expect(hsiDistance(3249)).toBe('3.2');
    expect(hsiSentence(null)).toBe('');
    expect(hsiSentence(hsiGuide(onPath(2000, 400), north, flat))).toContain('approach AAA 36, 2.0 kilometers, center line to the left');
  });
});
