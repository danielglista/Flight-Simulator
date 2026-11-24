import { describe, expect, it } from 'vitest';
import { SCALES } from '../src/config/scales';
import { heightAt } from '../src/sim/world/grid';
import { Terrain } from '../src/sim/world/terrain';
import { buildTestMap, TEST_MAP_CELLS, TEST_MAP_LANDMARKS as L } from '../src/sim/world/testMap';

const map = buildTestMap();
const n = TEST_MAP_CELLS;

describe('test map', () => {
  it('is identical on every build', () => {
    const again = buildTestMap();
    expect(again.terrain).toEqual(map.terrain);
    expect(again.elevation).toEqual(map.elevation);
  });
  it('has a sea border at elevation 0', () => {
    for (let k = 0; k < n; k++) {
      for (let b = 0; b < 4; b++) {
        for (const i of [b * n + k, k * n + b, (n - 1 - b) * n + k, k * n + (n - 1 - b)]) {
          expect(map.terrain[i]).toBe(Terrain.water);
          expect(map.elevation[i]).toBe(0);
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
        if (!seen[j] && map.terrain[j] === Terrain.water) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    expect(seen[L.riverSource.row * n + L.riverSource.col]).toBe(1);
    expect(seen[L.lakeCenter.row * n + L.lakeCenter.col]).toBe(1);
    expect(map.elevation[L.riverSource.row * n + L.riverSource.col]).toBeGreaterThan(500);
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
});
