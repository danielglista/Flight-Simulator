import { describe, expect, it } from 'vitest';
import { SEA_COLOR, TERRAIN_COLORS, WATER_SHALLOW, waterColor } from '../src/config/palette';
import { SCALES } from '../src/config/scales';
import { createGrid } from '../src/sim/world/grid';
import { Terrain } from '../src/sim/world/terrain';
import { buildTestMap } from '../src/sim/world/testMap';
import { colorChunk, reduce2x, shadeStep } from '../src/views/terrainColors';

/** Ground that rises toward the southeast ('se-high') or the northwest ('nw-high'). */
function ramp(dir: 'nw-high' | 'se-high') {
  const g = createGrid(16, 16, 10);
  g.terrain.fill(Terrain.grass);
  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 16; c++) {
      const t = c + (15 - r); // larger toward the southeast
      g.elevation[r * 16 + c] = dir === 'se-high' ? t * 20 : (30 - t) * 20;
    }
  }
  return g;
}

describe('hillshade', () => {
  it('lights slopes that face northwest more than ones that face southeast', () => {
    expect(shadeStep(ramp('se-high'), SCALES, 8, 8)).toBeGreaterThan(0);
    expect(shadeStep(ramp('nw-high'), SCALES, 8, 8)).toBeLessThan(0);
  });
  it('is zero on flat ground', () => {
    expect(shadeStep(createGrid(8, 8, 10), SCALES, 4, 4)).toBe(0);
  });
});

describe('colorChunk', () => {
  it('colors water by depth and leaves it unshaded', () => {
    const g = createGrid(8, 8, 10);
    g.terrain.fill(Terrain.grass);
    for (let i = 0; i < 64; i++) g.elevation[i] = 100 + i * 30;
    g.elevation[0] = -5; // sea, 5 m deep
    g.elevation[1] = 100;
    g.water[1] = 30; // lake, 30 m deep
    const px = colorChunk(g, SCALES, 0, 0, 8);
    const at = (col: number) => Array.from(px.slice(((7 * 8) + col) * 4, ((7 * 8) + col) * 4 + 3));
    // Bytes are rounded by the clamped array, so allow one step of difference.
    const near = (got: number[], want: readonly number[]) =>
      got.forEach((v, k) => expect(Math.abs(v - (want[k] as number))).toBeLessThanOrEqual(1));
    near(at(0), waterColor(5));
    near(at(1), waterColor(30));
  });
  it('is lighter where shallow than where deep', () => {
    expect(waterColor(2)[0]).toBeGreaterThan(waterColor(80)[0]);
    expect(waterColor(0)).toEqual(Array.from(WATER_SHALLOW));
  });
  it('writes the north row first', () => {
    const g = createGrid(4, 4, 10);
    g.elevation.fill(-300); // sea floor, so every cell is sea except the desert one
    g.elevation[3 * 4 + 1] = 0;
    g.terrain[3 * 4 + 1] = Terrain.desert; // north row
    const px = colorChunk(g, SCALES, 0, 0, 4);
    const d = TERRAIN_COLORS[Terrain.desert] as readonly number[];
    expect(px[4]).toBe(d[0]); // image row 0, x 1
    expect(px[(3 * 4 + 1) * 4]).toBe(SEA_COLOR[0]); // south row is deep sea
  });
  it('matches a whole-map render at chunk borders', () => {
    const g = buildTestMap();
    const whole = colorChunk(g, SCALES, 0, 0, 512);
    const southeast = colorChunk(g, SCALES, 1, 0); // east column, south row of chunks
    for (const y of [0, 100, 255]) {
      for (const x of [0, 1, 255]) {
        const a = ((256 + y) * 512 + 256 + x) * 4;
        const b = (y * 256 + x) * 4;
        expect(Array.from(whole.slice(a, a + 4))).toEqual(Array.from(southeast.slice(b, b + 4)));
      }
    }
  });
});

describe('reduce2x', () => {
  it('gives the mean of each 2 x 2 block', () => {
    const src = new Uint8ClampedArray(2 * 2 * 4);
    [0, 100, 200, 40].forEach((v, i) => (src[i * 4] = v));
    expect(reduce2x(src, 2)[0]).toBe(85);
  });
});
