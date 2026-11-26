import { describe, expect, it } from 'vitest';
import { crashMessage } from '../src/app/crashBanner';
import { sweepContact } from '../src/sim/contact';
import { terrainAhead } from '../src/sim/flight/terrain';
import { initialState, type SimState } from '../src/sim/state';
import { advance, applyCommands, type SimWorld } from '../src/sim/step';
import { createGrid, type WorldGrid } from '../src/sim/world/grid';
import { createObstacles, topOf, type ObstacleFn } from '../src/sim/world/obstacles';

const scale = { altitude: 5, geoDistance: 25 };
const flat = (): number => 10;
// A building from y 495 to 505, x 480 to 520, roof at 40.
const wall: ObstacleFn = (x, y) => (x >= 480 && x <= 520 && y >= 495 && y <= 505 ? 40 : NaN);
const world: SimWorld = { width: 2000, height: 2000, heightAt: flat, altitudeScale: 5, groundKind: () => 'rough', obstacleAt: wall };

describe('obstacles from the map', () => {
  const grid: WorldGrid = {
    ...createGrid(100, 100, 10),
    buildings: [
      { x: 200, y: 200, width: 40, depth: 10, angle: 0, height: 20, style: 0 },
      { x: 500, y: 500, width: 40, depth: 10, angle: 45, height: 30, style: 0 },
    ],
  };
  grid.elevation.fill(50); // 10 world m
  const at = createObstacles(grid, scale);
  it('gives the roof over a point, and NaN beside it', () => {
    expect(at(200, 219)).toBeCloseTo(30, 6); // width runs north
    expect(at(200, 221)).toBeNaN();
    expect(at(206, 200)).toBeNaN();
    expect(at(900, 900)).toBeNaN();
  });
  it('follows a turned footprint', () => {
    const d = 18 * Math.SQRT1_2;
    expect(at(500 + d, 500 + d)).toBeCloseTo(40, 6);
    expect(at(500 - d, 500 + d)).toBeNaN();
  });
  it('is empty without buildings, and topOf takes the higher of ground and roof', () => {
    expect(createObstacles(createGrid(10, 10, 10), scale)(5, 5)).toBeNaN();
    expect(topOf(flat, wall, 500, 500)).toBe(40);
    expect(topOf(flat, wall, 0, 0)).toBe(10);
    expect(topOf(flat, undefined, 500, 500)).toBe(10);
  });
});

describe('sweeping into a building', () => {
  it('hits a roof from above', () => {
    const hit = sweepContact(flat, { x: 500, y: 500, z: 45 }, { x: 500, y: 501, z: 35 }, wall)!;
    expect(hit.building).toBe(true);
    expect(hit.z).toBeCloseTo(40, 1);
  });
  it('hits a wall and stays at the height it was hit', () => {
    const hit = sweepContact(flat, { x: 500, y: 480, z: 25 }, { x: 500, y: 520, z: 25 }, wall)!;
    expect(hit.building).toBe(true);
    expect(hit.y).toBeCloseTo(495, 1);
    expect(hit.z).toBeCloseTo(25, 6);
  });
  it('misses over the top and beside it', () => {
    expect(sweepContact(flat, { x: 500, y: 480, z: 40.1 }, { x: 500, y: 520, z: 40.1 }, wall)).toBeNull();
    expect(sweepContact(flat, { x: 521, y: 480, z: 25 }, { x: 521, y: 520, z: 25 }, wall)).toBeNull();
  });
  it('still reports the ground as ground', () => {
    const hit = sweepContact(flat, { x: 0, y: 0, z: 15 }, { x: 0, y: 5, z: 5 }, wall)!;
    expect(hit.building).toBe(false);
    expect(hit.z).toBe(10);
  });
});

describe('flying into a building', () => {
  const flying = (z: number, speed: number, y = 400): SimState => {
    const s = initialState();
    return { ...s, craft: { ...s.craft, x: 500, y, z, heading: 0, speed, pathAngle: 0, onGround: false } };
  };
  const fly = (s: SimState, ticks: number): SimState => {
    for (let i = 0; i < ticks && !s.crash; i++) s = advance(s, world);
    return s;
  };
  it('is a crash that stops at the wall, even at 300 m/s', () => {
    for (const speed of [90, 300]) {
      const s = fly(flying(25, speed), 300);
      expect(s.crash?.cause).toBe('building');
      expect(s.craft.y).toBeCloseTo(495, 0);
      expect(s.craft.z).toBeGreaterThan(15);
    }
  });
  it('does not happen above the roof', () => {
    const s = fly(flying(80, 90), 90);
    expect(s.craft.y).toBeGreaterThan(520);
    expect(s.crash).toBeNull();
  });
  it('is named in the banner', () => {
    const s = fly(flying(25, 90), 300);
    expect(crashMessage(createGrid(200, 200, 10), scale, s.craft, s.crash)).toContain('hit a building');
  });
  it('never happens by placing the plane over one', () => {
    const placed = applyCommands(flying(15, 90), [{ kind: 'place', x: 500, y: 500 }], world);
    expect(placed.craft.z).toBeGreaterThan(40);
  });
  it('sets off the terrain warning first', () => {
    const craft = { ...flying(25, 90, 100).craft, gear: 0 };
    expect(terrainAhead(craft, flat)).toBe(false);
    expect(terrainAhead(craft, flat, false, wall)).toBe(true);
    expect(terrainAhead({ ...craft, z: 80 }, flat, false, wall)).toBe(false);
  });
});
