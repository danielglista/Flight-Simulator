import { describe, expect, it } from 'vitest';
import { CLOUD_SEED, CLOUD_TILE_PX } from '../src/config/display';
import { cloudTile } from '../src/views/cloudTile';

const N = CLOUD_TILE_PX;
const tile = cloudTile(N, CLOUD_SEED);

describe('cloudTile', () => {
  it('has size x size alpha bytes', () => {
    expect(tile.length).toBe(N * N);
  });
  it('is identical for the same seed and differs for another', () => {
    expect(Array.from(cloudTile(N, CLOUD_SEED))).toEqual(Array.from(tile));
    expect(Array.from(cloudTile(N, CLOUD_SEED + 1))).not.toEqual(Array.from(tile));
  });
  it('uses clear plus three cloud levels only', () => {
    const levels = new Set(tile);
    expect(levels.size).toBeLessThanOrEqual(4);
    expect(levels.has(0)).toBe(true);
    expect(levels.size).toBeGreaterThan(2);
  });
  it('covers a modest part of the tile', () => {
    let cloudy = 0;
    for (const a of tile) if (a > 0) cloudy++;
    const coverage = cloudy / tile.length;
    expect(coverage).toBeGreaterThan(0.15);
    expect(coverage).toBeLessThan(0.6);
  });
  it('tiles: the wrap seam is no rougher than an interior seam', () => {
    const seam = (a: number, b: number, vertical: boolean) => {
      let sum = 0;
      for (let k = 0; k < N; k++) {
        const p = vertical ? tile[k * N + a] : tile[a * N + k];
        const q = vertical ? tile[k * N + b] : tile[b * N + k];
        sum += Math.abs((p ?? 0) - (q ?? 0));
      }
      return sum / N;
    };
    for (const vertical of [true, false]) {
      const wrap = seam(N - 1, 0, vertical);
      const interior = seam(N / 2 - 1, N / 2, vertical);
      expect(wrap).toBeLessThanOrEqual(interior * 2 + 8);
    }
  });
});
