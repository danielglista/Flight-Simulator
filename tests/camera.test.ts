import { describe, expect, it } from 'vitest';
import {
  ZOOM_LEVELS,
  clampToMap,
  panBy,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type Camera,
} from '../src/views/camera';

const view = { width: 320, height: 200 };
const bounds = { width: 5120, height: 5120 };

describe('camera', () => {
  it('round-trips world and screen at every zoom', () => {
    for (let zoom = 0; zoom < ZOOM_LEVELS.length; zoom++) {
      const cam: Camera = { x: 2000, y: 3000, zoom };
      const s = worldToScreen(cam, view, 2100, 3050);
      const w = screenToWorld(cam, view, s.x, s.y);
      expect(w.x).toBeCloseTo(2100, 6);
      expect(w.y).toBeCloseTo(3050, 6);
    }
  });
  it('puts the center in the middle and north up', () => {
    const cam: Camera = { x: 1000, y: 1000, zoom: 2 };
    expect(worldToScreen(cam, view, 1000, 1000)).toEqual({ x: 160, y: 100 });
    expect(worldToScreen(cam, view, 1000, 1100).y).toBeLessThan(100);
  });
  it('drag moves the map with the cursor', () => {
    const cam = panBy({ x: 1000, y: 1000, zoom: 2 }, 10, 5, bounds);
    expect(cam.x).toBe(900);
    expect(cam.y).toBe(1050);
  });
  it('zoom keeps the world point under the cursor fixed', () => {
    const cam: Camera = { x: 2560, y: 2560, zoom: 2 };
    const cursor = { x: 250, y: 40 };
    const before = screenToWorld(cam, view, cursor.x, cursor.y);
    const z = zoomAt(cam, view, cursor, 2, bounds);
    expect(z.zoom).toBe(4);
    const after = screenToWorld(z, view, cursor.x, cursor.y);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
  it('clamps the center to the map', () => {
    expect(clampToMap({ x: -50, y: 9999, zoom: 2 }, bounds)).toEqual({ x: 0, y: 5120, zoom: 2 });
    expect(panBy({ x: 10, y: 10, zoom: 2 }, 1000, -1000, bounds)).toMatchObject({ x: 0, y: 0 });
  });
  it('stops zooming at both ends', () => {
    const c = { x: 100, y: 100 };
    const max = ZOOM_LEVELS.length - 1;
    expect(zoomAt({ x: 1, y: 1, zoom: max }, view, c, 1, bounds).zoom).toBe(max);
    expect(zoomAt({ x: 1, y: 1, zoom: 0 }, view, c, -1, bounds).zoom).toBe(0);
  });
});
