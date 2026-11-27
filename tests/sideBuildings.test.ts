import { describe, expect, it } from 'vitest';
import { FIXED_SUN, type Sun } from '../src/config/sun';
import { besideLine, lineSpan, skylineRuns, wallsSeen } from '../src/views/sideBuildings';
import { faceLight } from '../src/views/sunLight';

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

describe('lit walls in the side view', () => {
  const from = (deg: number): Sun => ({ ...FIXED_SUN, azimuth: (deg * Math.PI) / 180 });
  const SOUTH_SUN = from(180);
  it('shows one wall square on, lit by the way it faces', () => {
    // Heading east looks north, at the south wall, which is 10 m long.
    const walls = wallsSeen(b, -50, 100, EAST, SOUTH_SUN);
    expect(walls).toHaveLength(1);
    expect([walls[0]!.from, walls[0]!.to]).toEqual([45, 55].map((v) => expect.closeTo(v, 6)));
    expect(walls[0]!.light).toBeCloseTo(faceLight(SOUTH_SUN, 0, -1), 6);
    expect(walls[0]!.light).toBeGreaterThan(wallsSeen(b, -50, 100, (3 * Math.PI) / 2, SOUTH_SUN)[0]!.light);
  });
  it('shows two walls at an angle, filling the outline, the one facing back on the left', () => {
    const turned = { ...b, angle: 30 };
    const [left, right] = wallsSeen(turned, 0, 0, NORTH, SOUTH_SUN);
    const outline = besideLine(turned, 0, 0, NORTH);
    expect(left!.from).toBeCloseTo(outline.from, 6);
    expect(left!.to).toBeCloseTo(right!.from, 6);
    expect(right!.to).toBeCloseTo(outline.to, 6);
    expect(left!.light).toBeGreaterThan(right!.light);
    expect(left!.face).not.toBe(right!.face);
  });
  it('changes with the sun', () => {
    const light = (deg: number) => wallsSeen(b, 50, 100, NORTH, from(deg))[0]!.light;
    // Heading north looks west, at the east wall.
    expect(light(90)).toBeGreaterThan(light(180));
    expect(light(180)).toBeGreaterThan(light(270));
  });
});
