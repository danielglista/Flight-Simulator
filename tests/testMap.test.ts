import { describe, expect, it } from 'vitest';
import { SCALES } from '../src/config/scales';
import { heightAt } from '../src/sim/world/grid';
import { Terrain } from '../src/sim/world/terrain';
import { buildTestMap, TEST_MAP_CELLS, TEST_MAP_LANDMARKS as L } from '../src/sim/world/testMap';

const map = buildTestMap();
const n = TEST_MAP_CELLS;
/** Wet: inland water over the ground, or ground below sea level. */
const wet = (i: number): boolean => (map.water[i] ?? 0) > 0 || (map.elevation[i] as number) < 0;

describe('test map', () => {
  it('is identical on every build', () => {
    const again = buildTestMap();
    expect(again.terrain).toEqual(map.terrain);
    expect(again.elevation).toEqual(map.elevation);
    expect(again.water).toEqual(map.water);
  });
  it('has a sea border on the sea floor, below sea level', () => {
    for (let k = 0; k < n; k++) {
      for (let b = 0; b < 4; b++) {
        for (const i of [b * n + k, k * n + b, (n - 1 - b) * n + k, k * n + (n - 1 - b)]) {
          expect(map.terrain[i]).toBe(Terrain.seabed);
          expect(map.elevation[i]).toBeLessThan(0);
          expect(map.water[i]).toBe(0);
        }
      }
    }
  });
  it('uses every terrain code except airport', () => {
    const seen = new Set(map.terrain);
    for (const [name, code] of Object.entries(Terrain)) {
      expect(seen.has(code), name).toBe(name !== 'airport');
    }
  });
  it('has a peak of about 1,800 m real', () => {
    let max = 0;
    for (const e of map.elevation) max = Math.max(max, e);
    expect(max).toBeGreaterThan(1700);
    expect(max).toBeLessThan(1950);
    expect(map.elevation[L.peak.row * n + L.peak.col]).toBe(max);
    const h = heightAt(map, SCALES, (L.peak.col + 0.5) * 10, (L.peak.row + 0.5) * 10);
    expect(h).toBeCloseTo(max / 10, 5);
  });
  it('has water joining the mountains, the lake and the sea', () => {
    const seen = new Uint8Array(n * n);
    const stack = [0];
    seen[0] = 1;
    while (stack.length) {
      const i = stack.pop() as number;
      const c = i % n;
      const r = (i - c) / n;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const cc = c + dc;
        const rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= n || rr >= n) continue;
        const j = rr * n + cc;
        if (!seen[j] && wet(j)) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    expect(seen[L.riverSource.row * n + L.riverSource.col]).toBe(1);
    expect(seen[L.lakeCenter.row * n + L.lakeCenter.col]).toBe(1);
    const src = L.riverSource.row * n + L.riverSource.col;
    expect((map.elevation[src] as number) + (map.water[src] as number)).toBeGreaterThan(500);
  });
  it('has a constant-elevation level area of grass', () => {
    const v = L.level;
    for (let r = v.rowMin; r <= v.rowMax; r++) {
      for (let c = v.colMin; c <= v.colMax; c++) {
        expect(map.elevation[r * n + c]).toBe(v.elevationM);
        expect(map.terrain[r * n + c]).toBe(Terrain.grass);
      }
    }
  });
  it('keeps water surfaces at or below the dry land beside them', () => {
    let checked = 0;
    for (let r = 1; r < n - 1; r++) {
      for (let c = 1; c < n - 1; c++) {
        const i = r * n + c;
        if (!wet(i)) continue;
        const surface = (map.water[i] as number) > 0 ? (map.elevation[i] as number) + (map.water[i] as number) : 0;
        for (const j of [i - 1, i + 1, i - n, i + n]) {
          if (wet(j)) continue;
          checked++;
          expect(map.elevation[j], `water at ${c},${r}`).toBeGreaterThanOrEqual(surface);
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
  it('has river and lake beds below their water, with the lake deepest in the middle', () => {
    const lc = L.lakeCenter.row * n + L.lakeCenter.col;
    const edge = L.lakeCenter.row * n + L.lakeCenter.col + L.lakeRadius - 1;
    expect(map.water[lc]).toBeGreaterThan(map.water[edge] as number);
    expect((map.elevation[lc] as number) + (map.water[lc] as number)).toBe(25); // flat lake surface
    const r = L.riverSource.row * n + L.riverSource.col;
    expect(map.water[r]).toBeGreaterThan(0);
    expect(map.terrain[lc]).not.toBe(Terrain.seabed); // the bed is ordinary ground
  });
  it('deepens the sea floor away from the coast', () => {
    const coast = 256 * n + 31; // just off the west coast, row 256
    const far = 256 * n + 5;
    expect(map.elevation[coast] as number).toBeLessThan(0);
    expect(map.elevation[far] as number).toBeLessThan(map.elevation[coast] as number);
  });
});
