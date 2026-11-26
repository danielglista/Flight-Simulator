import { describe, expect, it } from 'vitest';
import { besideLine, lineSpan, skylineRuns } from '../src/views/sideBuildings';

// 20 m along north, 10 m across, centered at (0, 100).
const b = { x: 0, y: 100, width: 20, depth: 10, angle: 0 };
const NORTH = 0;
const EAST = Math.PI / 2;

describe('buildings in the side view', () => {
  it('finds where the flight line goes through a footprint', () => {
    expect(lineSpan(b, 0, 0, NORTH)).toEqual([90, 110]);
    const east = lineSpan(b, -50, 100, EAST)!;
    expect(east[0]).toBeCloseTo(45, 6);
    expect(east[1]).toBeCloseTo(55, 6);
    expect(lineSpan(b, 6, 0, NORTH)).toBeNull(); // 6 m to the side of a 10 m wide face
    expect(lineSpan(b, 4, 0, NORTH)).not.toBeNull();
  });
  it('follows a building turned to the street grid', () => {
    const turned = { ...b, angle: 45 };
    const span = lineSpan(turned, 0, 0, NORTH)!;
    expect((span[0] + span[1]) / 2).toBeCloseTo(100, 6);
    expect(span[1] - span[0]).toBeCloseTo(10 * Math.SQRT2, 6); // across the narrow faces
  });
  it('keeps only the highest building in each column of a skyline', () => {
    const block = (x: number, width: number, top: number, color: string) => ({ x, width, top, foot: 100, color });
    const runs = skylineRuns([block(-2, 6, 50, 'a'), block(2, 6, 20, 'b'), block(3, 2, 60, 'c')], 10);
    expect(runs).toEqual([block(0, 2, 50, 'a'), block(2, 6, 20, 'b')]);
    expect(skylineRuns([], 10)).toEqual([]);
  });
  it('says how far to the left a building is, and how long it looks', () => {
    // Heading north, west is left.
    expect(besideLine(b, 30, 0, NORTH)).toEqual({ from: 90, to: 110, left: 30 });
    expect(besideLine(b, -30, 0, NORTH).left).toBeCloseTo(-30, 6);
    const east = besideLine(b, 0, 60, EAST); // heading east, north is left
    expect(east.left).toBeCloseTo(40, 6);
    expect(east.to - east.from).toBeCloseTo(10, 6);
  });
});
