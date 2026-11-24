import { describe, expect, it } from 'vitest';
import {
  SIDE_ZOOM_LEVELS,
  baseHeight,
  followRow,
  planeRow,
  verticalMetersPerPixel,
  distanceToX,
  exaggeration,
  pathLineOffset,
  heightToY,
  planeColumn,
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
  it('puts the plane a quarter of the way across', () => {
    expect(distanceToX(view, 1, 0)).toBe(160);
    expect(planeColumn(view)).toBe(160);
  });
  it('higher is up, and sea level is fixed', () => {
    expect(heightToY(view, 1, 100, 0)).toBeLessThan(heightToY(view, 1, 0, 0));
    for (let z = 0; z < 4; z++) expect(heightToY(view, z, 0, 0)).toBe(seaRow(view));
  });
  it('has the planned exaggeration', () => {
    expect([0, 1, 2, 3].map(exaggeration)).toEqual([4, 2, 1, 1]);
  });
  it('peak height in pixels', () => {
    expect(seaRow(view) - heightToY(view, 1, 182, 0)).toBeCloseTo(72.8, 1);
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

describe('vertical follow', () => {
  const views = [
    { width: 640, height: 360 },
    { width: 640, height: 361 },
  ];
  const heights = [0, 1, 5, 99.9, 100, 209.9, 210, 210.1, 211, 333.3, 419, 420, 420.5, 421, 599.99, 600];
  it('follow row is 40% down', () => {
    expect(followRow(view)).toBe(144);
  });
  it('does not scroll at low altitude', () => {
    for (let z = 0; z < 4; z++) {
      expect(baseHeight(view, z, 0)).toBe(0);
      expect(baseHeight(view, z, 100)).toBe(0);
    }
    // Thresholds: 420 m at the three farther zooms, 210 m at the closest.
    expect(baseHeight(view, 0, 420)).toBe(0);
    expect(baseHeight(view, 2, 420)).toBe(0);
    expect(baseHeight(view, 3, 210)).toBe(0);
    expect(baseHeight(view, 3, 211)).toBeGreaterThan(0);
    expect(baseHeight(view, 1, 421)).toBeGreaterThan(0);
  });
  it('plane row is constant from the threshold to the ceiling, at every zoom and view height', () => {
    for (const v of views) {
      for (let zoom = 0; zoom < 4; zoom++) {
        const mpp = verticalMetersPerPixel(zoom);
        const start = (seaRow(v) - followRow(v)) * mpp;
        for (const z of heights) {
          if (z < start) continue;
          expect(planeRow(v, zoom, z)).toBe(followRow(v));
          // The plane's own drawn row matches the scrolled height mapping to within one pixel.
          const y = heightToY(v, zoom, z, baseHeight(v, zoom, z));
          expect(Math.floor(y)).toBe(followRow(v));
        }
      }
    }
  });
  it('scrolls in whole pixels, so every height moves together', () => {
    for (const v of views) {
      for (let zoom = 0; zoom < 4; zoom++) {
        const mpp = verticalMetersPerPixel(zoom);
        for (const z of heights) {
          const px = baseHeight(v, zoom, z) / mpp;
          expect(px).toBe(Math.round(px));
        }
      }
    }
  });
  it('has no jump at the threshold', () => {
    for (let zoom = 0; zoom < 4; zoom++) {
      const mpp = verticalMetersPerPixel(zoom);
      const start = (seaRow(view) - followRow(view)) * mpp;
      expect(planeRow(view, zoom, start - 0.01)).toBe(planeRow(view, zoom, start));
      expect(planeRow(view, zoom, start + 0.01)).toBe(planeRow(view, zoom, start));
    }
  });
  it('a whole-pixel rise in z moves terrain by exactly that many pixels', () => {
    const zoom = 1;
    const z0 = 500;
    const z1 = z0 + 2.5 * 3;
    const a = heightToY(view, zoom, 123, baseHeight(view, zoom, z0));
    const b = heightToY(view, zoom, 123, baseHeight(view, zoom, z1));
    expect(b - a).toBeCloseTo(3, 9);
  });
});

describe('pathLineOffset', () => {
  it('is level at 0, up for a positive path, and steeper with exaggeration', () => {
    const level = pathLineOffset(0, 4, 40);
    expect(level.dx).toBeCloseTo(40, 9);
    expect(level.dy).toBeCloseTo(0, 9);
    const up = pathLineOffset(0.1, 1, 40);
    expect(up.dy).toBeLessThan(0);
    expect(Math.hypot(up.dx, up.dy)).toBeCloseTo(40, 9);
    expect(Math.abs(pathLineOffset(0.1, 4, 40).dy)).toBeGreaterThan(Math.abs(up.dy));
  });
});
