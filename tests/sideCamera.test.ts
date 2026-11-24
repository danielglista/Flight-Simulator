import { describe, expect, it } from 'vitest';
import {
  SIDE_ZOOM_LEVELS,
  distanceToX,
  exaggeration,
  heightToY,
  probeColumn,
  seaRow,
  shiftLeft,
  sliceWindow,
  visualWaterDepth,
  WATER_EXAGGERATION,
  WATER_VISUAL_MAX_M,
  xToDistance,
} from '../src/views/sideCamera';

const view = { width: 640, height: 360 };

describe('side camera', () => {
  it('round-trips distance and x at every zoom', () => {
    for (let z = 0; z < SIDE_ZOOM_LEVELS.length; z++) {
      expect(xToDistance(view, z, distanceToX(view, z, 777))).toBeCloseTo(777, 6);
    }
  });
  it('puts the probe a quarter of the way across', () => {
    expect(distanceToX(view, 1, 0)).toBe(160);
    expect(probeColumn(view)).toBe(160);
  });
  it('higher is up, and sea level is fixed', () => {
    expect(heightToY(view, 1, 100)).toBeLessThan(heightToY(view, 1, 0));
    for (let z = 0; z < 4; z++) expect(heightToY(view, z, 0)).toBe(seaRow(view));
  });
  it('has the planned exaggeration', () => {
    expect([0, 1, 2, 3].map(exaggeration)).toEqual([4, 2, 1, 1]);
  });
  it('peak height in pixels', () => {
    expect(seaRow(view) - heightToY(view, 1, 182)).toBeCloseTo(72.8, 1);
  });
  it('window covers the view with one sample per column', () => {
    const p = { x: 2560, y: 2560, heading: Math.PI / 2 };
    for (let z = 0; z < 4; z++) {
      const w = sliceWindow(p, view, z);
      expect(w.samples).toBe(640);
      const step = w.length / (w.samples - 1);
      expect(step).toBeCloseTo(SIDE_ZOOM_LEVELS[z] as number, 9);
      expect(w.startDistance).toBeCloseTo(-160 * step, 6);
      expect(w.origin.x).toBeCloseTo(2560 + w.startDistance, 6);
    }
  });
  it('shifts layers to the left of the heading', () => {
    const at = (heading: number) => {
      const w = sliceWindow({ x: 1000, y: 1000, heading }, view, 1);
      const l = shiftLeft(w, 100);
      return { dx: l.origin.x - w.origin.x, dy: l.origin.y - w.origin.y };
    };
    // Heading east: left is north. Heading north: left is west.
    expect(at(Math.PI / 2).dx).toBeCloseTo(0, 6);
    expect(at(Math.PI / 2).dy).toBeCloseTo(100, 6);
    expect(at(0).dx).toBeCloseTo(-100, 6);
    expect(at(0).dy).toBeCloseTo(0, 6);
  });
  it('draws shallow water about 4x deeper, and never past the cap', () => {
    expect(visualWaterDepth(0.5)).toBeGreaterThan(0.5 * WATER_EXAGGERATION * 0.9);
    expect(visualWaterDepth(0.5)).toBeLessThanOrEqual(0.5 * WATER_EXAGGERATION);
    expect(visualWaterDepth(1000)).toBeLessThanOrEqual(WATER_VISUAL_MAX_M);
    expect(visualWaterDepth(0)).toBe(0);
    expect(visualWaterDepth(NaN)).toBe(0);
  });
  it('keeps deeper water drawn deeper', () => {
    let prev = 0;
    for (const d of [0.1, 0.5, 1, 3, 10, 30]) {
      const v = visualWaterDepth(d);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });
});
