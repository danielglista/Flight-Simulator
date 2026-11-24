import { describe, expect, it } from 'vitest';
import { SLOPE_SATURATE_PX, SLOPE_SHADE } from '../src/config/display';
import type { Slice } from '../src/sim/world/slice';
import { envelope, laneOffsets, slopeShade } from '../src/views/sideLayers';
import { planeColumn, sideMetersPerPixel, sliceWindow } from '../src/views/sideCamera';

const view = { width: 640, height: 360 };

const slice = (h: number[], surface: number[], water?: number[]): Slice => ({
  heightWorldM: Float32Array.from(h),
  groundWorldM: Float32Array.from(h.map((v) => v - 1)),
  waterWorldM: Float32Array.from(water ?? h.map(() => NaN)),
  surface: Uint8Array.from(surface),
});

describe('sliceWindow with parallax', () => {
  const p = { x: 2560, y: 2560, heading: 0.7 };
  it('k = 1 equals the plain window', () => {
    for (let z = 0; z < 4; z++) expect(sliceWindow(p, view, z, 1)).toEqual(sliceWindow(p, view, z));
  });
  it('k = 0.5 doubles meters per pixel', () => {
    const a = sliceWindow(p, view, 1);
    const b = sliceWindow(p, view, 1, 0.5);
    expect(b.length).toBeCloseTo(a.length * 2, 6);
    expect(b.startDistance).toBeCloseTo(a.startDistance * 2, 6);
    expect(b.samples).toBe(view.width);
  });
  it('puts the plane column at the plane for every k', () => {
    for (const k of [0.5, 0.85, 1, 1.3]) {
      const w = sliceWindow(p, view, 2, k);
      const step = w.length / (w.samples - 1);
      expect(step).toBeCloseTo(sideMetersPerPixel(2) / k, 9);
      const d = planeColumn(view) * step + w.startDistance;
      expect(d).toBeCloseTo(0, 6);
      expect(w.origin.x + Math.sin(w.heading) * planeColumn(view) * step).toBeCloseTo(p.x, 6);
      expect(w.origin.y + Math.cos(w.heading) * planeColumn(view) * step).toBeCloseTo(p.y, 6);
    }
  });
});

describe('laneOffsets', () => {
  it('one lane is the near edge', () => {
    expect(laneOffsets({ nearM: 250, farM: 400, lanes: 1 })).toEqual([250]);
  });
  it('spaces lanes evenly, ends included', () => {
    expect(laneOffsets({ nearM: 900, farM: 1500, lanes: 4 })).toEqual([900, 1100, 1300, 1500]);
  });
  it('handles negative (foreground) offsets', () => {
    expect(laneOffsets({ nearM: -250, farM: -120, lanes: 3 })).toEqual([-250, -185, -120]);
  });
});

describe('envelope', () => {
  it('one slice comes back equal', () => {
    const s = slice([1, 5, 3], [2, 3, 4]);
    expect(envelope([s])).toEqual(s);
  });
  it('takes the highest lane per column with its own ground, water and surface', () => {
    const a = slice([10, 2, 7], [1, 1, 1]);
    const b = slice([4, 9, 7], [2, 2, 2], [5, 12, 8]);
    const e = envelope([a, b]);
    expect(Array.from(e.heightWorldM)).toEqual([10, 9, 7]);
    expect(Array.from(e.surface)).toEqual([1, 2, 1]); // tie at column 2: the first lane wins
    expect(e.waterWorldM[1]).toBe(12);
    expect(Number.isNaN(e.waterWorldM[0])).toBe(true);
    expect(e.groundWorldM[1]).toBe(8);
  });
  it('uses the shortest length', () => {
    expect(envelope([slice([1, 2, 3], [0, 0, 0]), slice([4, 5], [0, 0])]).heightWorldM.length).toBe(2);
  });
  it('rejects an empty list', () => {
    expect(() => envelope([])).toThrow();
  });
});

describe('slopeShade', () => {
  it('is 1 on flat ground', () => {
    expect(slopeShade(100, 100)).toBe(1);
  });
  it('is lighter when the ground rises to the right, darker when it falls', () => {
    expect(slopeShade(102, 100)).toBeGreaterThan(1); // y smaller to the right = higher
    expect(slopeShade(100, 102)).toBeLessThan(1);
  });
  it('is symmetric and saturates', () => {
    expect(slopeShade(102, 100) - 1).toBeCloseTo(1 - slopeShade(100, 102), 9);
    const big = SLOPE_SATURATE_PX * 10;
    expect(slopeShade(big, 0)).toBeCloseTo(1 + SLOPE_SHADE, 9);
    expect(slopeShade(0, big)).toBeCloseTo(1 - SLOPE_SHADE, 9);
  });
  it('scales with strength', () => {
    expect(slopeShade(100 + 100, 100, 0.4)).toBeCloseTo(1 + SLOPE_SHADE * 0.4, 9);
  });
});
