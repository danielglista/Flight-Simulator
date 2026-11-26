import { describe, expect, it } from 'vitest';
import { SCALES } from '../src/config/scales';
import { createGrid, groundAt, heightAt, surfaceAt, waterLevelAt } from '../src/sim/world/grid';
import { Terrain } from '../src/sim/world/terrain';

function small() {
  const g = createGrid(4, 4, 10);
  g.elevation[0] = 100; // col 0, row 0 (southwest)
  g.elevation[1] = 300; // col 1, row 0
  g.terrain[0] = Terrain.forest;
  g.terrain[3 * 4] = Terrain.desert; // col 0, row 3 (north)
  return g;
}

describe('surfaceAt', () => {
  it('uses row 0 as south', () => {
    const g = small();
    expect(surfaceAt(g, 5, 5)).toBe(Terrain.forest);
    expect(surfaceAt(g, 5, 35)).toBe(Terrain.desert);
  });
  it('treats outside the map, the far edge and bad input as water', () => {
    const g = small();
    for (const [x, y] of [[-1, 5], [5, -1], [40, 5], [5, 40], [NaN, 5], [5, Infinity]] as const) {
      expect(surfaceAt(g, x, y)).toBe(Terrain.seabed);
    }
  });
});

describe('heightAt', () => {
  it('is exact at cell centers and divided by the altitude scale', () => {
    const g = small();
    expect(heightAt(g, SCALES, 5, 5)).toBe(100 / SCALES.altitude);
    expect(heightAt(g, SCALES, 15, 5)).toBe(300 / SCALES.altitude);
  });
  it('is the mean halfway between two centers', () => {
    expect(heightAt(small(), SCALES, 10, 5)).toBe(200 / SCALES.altitude);
  });
  it('is 0 outside the map and for NaN', () => {
    const g = small();
    expect(heightAt(g, SCALES, -0.1, 5)).toBe(0);
    expect(heightAt(g, SCALES, 40.1, 5)).toBe(0);
    expect(heightAt(g, SCALES, NaN, 5)).toBe(0);
  });
  it('does not read past the array at the edges', () => {
    const g = small();
    for (const [x, y] of [[0, 0], [40, 40], [0, 40], [40, 0]] as const) {
      expect(Number.isFinite(heightAt(g, SCALES, x, y))).toBe(true);
    }
  });
  it('is continuous across a chunk border', () => {
    const g = createGrid(512, 512, 10);
    for (let i = 0; i < g.elevation.length; i++) g.elevation[i] = (i % 512) * 2; // ramp in x
    const a = heightAt(g, SCALES, 2559.99, 1000);
    const b = heightAt(g, SCALES, 2560.01, 1000);
    expect(Math.abs(a - b)).toBeLessThan(0.001);
  });
  it('keeps ground and water apart: water is flat at elevation + depth', () => {
    const g = small();
    g.elevation[0] = 100; // bed, real m
    g.water[0] = 50; // 50 m of water: surface at 150 m real = 15 m world
    expect(groundAt(g, SCALES, 5, 5)).toBe(100 / SCALES.altitude);
    expect(waterLevelAt(g, SCALES, 5, 5)).toBe(150 / SCALES.altitude);
    expect(heightAt(g, SCALES, 5, 5)).toBe(150 / SCALES.altitude);
    expect(waterLevelAt(g, SCALES, 9.9, 5)).toBe(150 / SCALES.altitude); // flat across the cell
    expect(Number.isNaN(waterLevelAt(g, SCALES, 15, 5))).toBe(true); // next cell is dry
    expect(heightAt(g, SCALES, 15, 5)).toBe(300 / SCALES.altitude); // dry: ground
  });
  it('treats ground below sea level as open sea at 0', () => {
    const g = small();
    g.elevation[0] = -200; // 20 m world below sea level
    expect(groundAt(g, SCALES, 5, 5)).toBe(-200 / SCALES.altitude);
    expect(waterLevelAt(g, SCALES, 5, 5)).toBe(0);
    expect(heightAt(g, SCALES, 5, 5)).toBe(0);
  });
  it('is dry at and above sea level, and open sea outside the map', () => {
    const g = small();
    g.elevation[0] = 0;
    expect(Number.isNaN(waterLevelAt(g, SCALES, 5, 5))).toBe(true);
    expect(waterLevelAt(g, SCALES, -5, 5)).toBe(0);
  });
  it('never puts the top surface below the bed', () => {
    const g = small();
    g.elevation[0] = 0;
    g.water[0] = 5; // surface 5 m real, but the next cell is 300 m: blended ground is higher near the edge
    expect(heightAt(g, SCALES, 9.9, 5)).toBeGreaterThanOrEqual(groundAt(g, SCALES, 9.9, 5));
  });
});
