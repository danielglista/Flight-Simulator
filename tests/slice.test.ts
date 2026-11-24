import { describe, expect, it } from 'vitest';
import { SCALES } from '../src/config/scales';
import { createGrid, heightAt, surfaceAt } from '../src/sim/world/grid';
import { sliceAlong } from '../src/sim/world/slice';
import { buildTestMap, TEST_MAP_LANDMARKS } from '../src/sim/world/testMap';
import { Terrain } from '../src/sim/world/terrain';

// Asymmetric 6 x 4 grid, cell 10 m, each cell has a unique elevation and terrain.
function asym() {
  const g = createGrid(6, 4, 10);
  for (let i = 0; i < g.elevation.length; i++) {
    g.elevation[i] = (i + 1) * 10;
    g.terrain[i] = 1 + (i % 8);
  }
  return g;
}

describe('sliceAlong', () => {
  const g = asym();
  const origin = { x: 25, y: 15 }; // center of cell (2, 1)

  it('matches heightAt and surfaceAt at every sample', () => {
    const h = 0.7;
    const s = sliceAlong(g, SCALES, origin, h, 30, 7);
    for (let i = 0; i < 7; i++) {
      const x = origin.x + Math.sin(h) * 5 * i;
      const y = origin.y + Math.cos(h) * 5 * i;
      expect(s.heightWorldM[i]).toBeCloseTo(heightAt(g, SCALES, x, y), 4);
      expect(s.surface[i]).toBe(surfaceAt(g, x, y));
    }
  });
  it('heading 0 goes north, 90 east, 180 south, 270 west', () => {
    const cell = (c: number, r: number) => (g.terrain[r * g.cols + c] as number);
    const cases: [number, [number, number]][] = [
      [0, [2, 2]],
      [Math.PI / 2, [3, 1]],
      [Math.PI, [2, 0]],
      [(3 * Math.PI) / 2, [1, 1]],
    ];
    for (const [h, [c, r]] of cases) {
      const s = sliceAlong(g, SCALES, origin, h, 10, 2);
      expect(s.surface[0]).toBe(cell(2, 1));
      expect(s.surface[1]).toBe(cell(c, r));
    }
  });
  it('includes both ends exactly', () => {
    const s = sliceAlong(g, SCALES, { x: 5, y: 5 }, Math.PI / 2, 40, 5);
    expect(s.heightWorldM[4]).toBeCloseTo(heightAt(g, SCALES, 45, 5 + Math.cos(Math.PI / 2) * 40), 4);
  });
  it('reversed from the far end gives the reversed slice', () => {
    const a = sliceAlong(g, SCALES, { x: 5, y: 5 }, Math.PI / 2, 40, 5);
    const b = sliceAlong(g, SCALES, { x: 45, y: 5 }, (3 * Math.PI) / 2, 40, 5);
    for (let i = 0; i < 5; i++) {
      expect(b.heightWorldM[i]).toBeCloseTo(a.heightWorldM[4 - i] as number, 4);
      expect(b.surface[i]).toBe(a.surface[4 - i]);
    }
  });
  it('reports ground and water separately', () => {
    const w = createGrid(4, 1, 10);
    w.terrain.fill(Terrain.grass);
    w.elevation.set([100, 100, 100, 100]);
    w.water.set([0, 40, 0, 0]);
    const s = sliceAlong(w, SCALES, { x: 5, y: 5 }, Math.PI / 2, 30, 4);
    expect(s.groundWorldM[1]).toBeCloseTo(10, 4);
    expect(s.waterWorldM[1]).toBeCloseTo(14, 4);
    expect(s.heightWorldM[1]).toBeCloseTo(14, 4);
    expect(Number.isNaN(s.waterWorldM[0] as number)).toBe(true);
    expect(s.heightWorldM[0]).toBeCloseTo(10, 4);
  });
  it('is sea at 0 off the map', () => {
    const s = sliceAlong(g, SCALES, { x: -100, y: -100 }, Math.PI, 50, 4);
    expect([...s.heightWorldM]).toEqual([0, 0, 0, 0]);
    expect([...s.surface]).toEqual([0, 0, 0, 0]);
  });
  it('handles one sample and has no NaN', () => {
    const one = sliceAlong(g, SCALES, origin, 1, 100, 1);
    expect(one.heightWorldM[0]).toBeCloseTo(heightAt(g, SCALES, 25, 15), 4);
    const s = sliceAlong(g, SCALES, origin, 2, 200, 50);
    expect([...s.heightWorldM].every(Number.isFinite)).toBe(true);
  });
});

describe('slice on the test map', () => {
  const grid = buildTestMap();
  const start = { x: 2560, y: 2560 };
  const at = (heading: number, length: number, samples: number) =>
    sliceAlong(grid, SCALES, start, heading, length, samples);

  it('heading 045 peaks near the summit about 1,690 m ahead', () => {
    const n = 2001;
    const s = at(Math.PI / 4, 2000, n);
    let best = 0;
    for (let i = 1; i < n; i++) if ((s.heightWorldM[i] as number) > (s.heightWorldM[best] as number)) best = i;
    const dist = best; // 1 m per sample
    expect(Math.abs(dist - 1690)).toBeLessThan(120);
    expect(s.heightWorldM[best]).toBeGreaterThan(150);
    void TEST_MAP_LANDMARKS;
  });
  it('due south reaches the level area at 3 world m', () => {
    // level area: cols 181-331, rows 70-120 -> y 700-1210, elevation 30 m real
    const s = at(Math.PI, 2560 - 1000, 2);
    expect(s.heightWorldM[1]).toBeCloseTo(3, 1);
  });
  it('due west reaches the sea', () => {
    const s = at((3 * Math.PI) / 2, 2560, 2);
    expect(s.heightWorldM[1]).toBe(0);
    expect(s.surface[1]).toBe(Terrain.seabed);
  });
});
