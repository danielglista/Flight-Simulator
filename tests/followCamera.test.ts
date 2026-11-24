import { describe, expect, it } from 'vitest';
import { advance } from '../src/sim/step';
import { initialState, type SimState } from '../src/sim/state';
import { screenToWorld, worldToScreen, ZOOM_LEVELS } from '../src/views/camera';
import { edgeArrow } from '../src/views/edgeArrow';
import { cameraFor, initialFollow, panned, recentered, zoomed } from '../src/views/followCamera';
import { distanceToX, planeColumn, sideMetersPerPixel, sliceWindow, SIDE_ZOOM_LEVELS, xToDistance } from '../src/views/sideCamera';

const bounds = { width: 5120, height: 5120, heightAt: () => 0, altitudeScale: 10 };
const craft = { x: 1234.5, y: 3456.7 };
const sizes = [
  { width: 640, height: 360 },
  { width: 639, height: 359 },
  { width: 641, height: 361 },
  { width: 501, height: 288 },
];

describe('follow camera', () => {
  it('puts the craft at the exact view center at every zoom and size', () => {
    for (const view of sizes) {
      for (let zoom = 0; zoom < ZOOM_LEVELS.length; zoom++) {
        const cam = cameraFor(initialFollow(zoom), craft);
        const p = worldToScreen(cam, view, craft.x, craft.y);
        expect(p).toEqual({ x: view.width / 2, y: view.height / 2 });
      }
    }
  });
  it('keeps the craft pixel fixed over 600 steps of turning flight', () => {
    for (const view of sizes) {
      let s: SimState = { ...initialState(), controls: { turn: 1, throttle: 0, pitch: 0, level: false } };
      const f = initialFollow(4);
      const first = worldToScreen(cameraFor(f, s.craft), view, s.craft.x, s.craft.y);
      for (let i = 0; i < 600; i++) {
        s = advance(s, bounds);
        const p = worldToScreen(cameraFor(f, s.craft), view, s.craft.x, s.craft.y);
        expect([Math.floor(p.x), Math.floor(p.y)]).toEqual([Math.floor(first.x), Math.floor(first.y)]);
      }
    }
  });
  it('zooms about the craft and keeps following', () => {
    const view = sizes[0]!;
    const f = zoomed(initialFollow(3), craft, view, { x: 10, y: 10 }, 2, bounds);
    expect(f.following).toBe(true);
    expect(f.free.zoom).toBe(5);
    const p = worldToScreen(cameraFor(f, craft), view, craft.x, craft.y);
    expect(p).toEqual({ x: 320, y: 180 });
    expect(zoomed(f, craft, view, { x: 0, y: 0 }, 9, bounds).free.zoom).toBe(5);
    expect(zoomed(f, craft, view, { x: 0, y: 0 }, -9, bounds).free.zoom).toBe(0);
  });
});

describe('free look', () => {
  const view = sizes[0]!;
  it('starts from the on-screen camera without a jump', () => {
    const f = initialFollow(2);
    const before = cameraFor(f, craft);
    const g = panned(f, craft, 0, 0, bounds);
    expect(g.following).toBe(false);
    expect(cameraFor(g, craft)).toEqual(before);
    const h = panned(f, craft, 10, -4, bounds);
    expect(h.free.x).toBeCloseTo(craft.x - 10 * ZOOM_LEVELS[2], 9);
    expect(h.free.y).toBeCloseTo(craft.y - 4 * ZOOM_LEVELS[2], 9);
  });
  it('does not move when the craft does, and C returns', () => {
    const g = panned(initialFollow(3), craft, 30, 30, bounds);
    expect(cameraFor(g, { x: 4000, y: 100 })).toEqual(g.free);
    const r = recentered(g);
    expect(r.following).toBe(true);
    expect(cameraFor(r, { x: 4000, y: 100 })).toMatchObject({ x: 4000, y: 100 });
  });
  it('zooms at the cursor, keeping the point under it fixed', () => {
    const g = panned(initialFollow(3), craft, 5, 5, bounds);
    const cursor = { x: 200, y: 100 };
    const under = screenToWorld(g.free, view, cursor.x, cursor.y);
    const z = zoomed(g, craft, view, cursor, 1, bounds);
    expect(z.following).toBe(false);
    expect(z.free.zoom).toBe(4);
    const after = screenToWorld(z.free, view, cursor.x, cursor.y);
    expect(after.x).toBeCloseTo(under.x, 6);
    expect(after.y).toBeCloseTo(under.y, 6);
  });
  it('keeps the zoom through both switches', () => {
    let f = zoomed(initialFollow(3), craft, view, { x: 0, y: 0 }, 2, bounds);
    f = panned(f, craft, 1, 1, bounds);
    expect(f.free.zoom).toBe(5);
    f = recentered(f);
    expect(f.free.zoom).toBe(5);
    expect(cameraFor(f, craft).zoom).toBe(5);
  });
});

describe('agreement between the views', () => {
  it('the side view plane column is the craft, and distances lie on the slice line', () => {
    const view = sizes[0]!;
    for (let k = 0; k < 200; k++) {
      const c = { x: (k * 977) % 5120, y: (k * 1553) % 5120, heading: (k * 0.37) % (2 * Math.PI) };
      for (let zoom = 0; zoom < SIDE_ZOOM_LEVELS.length; zoom++) {
        const w = sliceWindow(c, view, zoom);
        const mpp = sideMetersPerPixel(zoom);
        const dir = { x: Math.sin(c.heading), y: Math.cos(c.heading) };
        const col = planeColumn(view);
        const at = (x: number) => ({
          x: w.origin.x + dir.x * x * mpp,
          y: w.origin.y + dir.y * x * mpp,
        });
        expect(at(col).x).toBeCloseTo(c.x, 6);
        expect(at(col).y).toBeCloseTo(c.y, 6);
        const d = 123.4;
        const x = distanceToX(view, zoom, d);
        expect(at(x).x).toBeCloseTo(c.x + dir.x * d, 6);
        expect(at(x).y).toBeCloseTo(c.y + dir.y * d, 6);
        expect(xToDistance(view, zoom, x)).toBeCloseTo(d, 6);
      }
    }
  });
});

describe('edge arrow', () => {
  const view = { width: 640, height: 360 };
  it('is null on screen', () => {
    expect(edgeArrow(view, { x: 320, y: 180 })).toBeNull();
    expect(edgeArrow(view, { x: 0, y: 0 })).toBeNull();
    expect(edgeArrow(view, { x: 639, y: 359 })).toBeNull();
  });
  it('sits on the matching edge for each direction', () => {
    const e = edgeArrow(view, { x: 5000, y: 180 })!;
    expect(e.x).toBeGreaterThan(600);
    expect(e.y).toBeCloseTo(180, 6);
    expect(edgeArrow(view, { x: -5000, y: 180 })!.x).toBeLessThan(40);
    expect(edgeArrow(view, { x: 320, y: -5000 })!.y).toBeLessThan(40);
    expect(edgeArrow(view, { x: 320, y: 5000 })!.y).toBeGreaterThan(320);
  });
  it('is always inside the panel', () => {
    for (let k = 0; k < 500; k++) {
      const a = (k / 500) * 2 * Math.PI;
      const r = 400 + k * 7;
      const e = edgeArrow(view, { x: 320 + Math.cos(a) * r, y: 180 + Math.sin(a) * r })!;
      expect(e.x).toBeGreaterThanOrEqual(0);
      expect(e.x).toBeLessThanOrEqual(view.width);
      expect(e.y).toBeGreaterThanOrEqual(0);
      expect(e.y).toBeLessThanOrEqual(view.height);
    }
  });
});
