import type { Size } from '../config/display';

/** World meters per internal pixel, from most zoomed out to most zoomed in. */
export const ZOOM_LEVELS = [40, 20, 10, 5, 2.5, 1.25] as const;
/** Start at 5 m per pixel: two pixels per 10 m cell. */
export const DEFAULT_ZOOM = 3;

/** Center in world meters; zoom is an index into ZOOM_LEVELS (higher = closer). */
export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** World extent: (0, 0) to (width, height). */
export interface Bounds {
  readonly width: number;
  readonly height: number;
}

export function metersPerPixel(zoom: number): number {
  return ZOOM_LEVELS[clampZoom(zoom)] as number;
}

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_LEVELS.length - 1, Math.max(0, Math.round(zoom)));
}

/** World to internal pixel. North (larger y) is up, so y flips here. */
export function worldToScreen(cam: Camera, view: Size, wx: number, wy: number): Point {
  const mpp = metersPerPixel(cam.zoom);
  return { x: (wx - cam.x) / mpp + view.width / 2, y: view.height / 2 - (wy - cam.y) / mpp };
}

export function screenToWorld(cam: Camera, view: Size, sx: number, sy: number): Point {
  const mpp = metersPerPixel(cam.zoom);
  return { x: cam.x + (sx - view.width / 2) * mpp, y: cam.y - (sy - view.height / 2) * mpp };
}

/** Keeps the camera center inside the map, so some map is always visible. */
export function clampToMap(cam: Camera, bounds: Bounds): Camera {
  return {
    x: Math.min(bounds.width, Math.max(0, cam.x)),
    y: Math.min(bounds.height, Math.max(0, cam.y)),
    zoom: clampZoom(cam.zoom),
  };
}

/** Drag by (dx, dy) internal pixels: the map follows the cursor. */
export function panBy(cam: Camera, dx: number, dy: number, bounds: Bounds): Camera {
  const mpp = metersPerPixel(cam.zoom);
  return clampToMap({ ...cam, x: cam.x - dx * mpp, y: cam.y + dy * mpp }, bounds);
}

/**
 * Zoom by whole levels (positive = closer), keeping the world point under the
 * cursor fixed except where clamping applies. Stops at both ends.
 */
export function zoomAt(
  cam: Camera,
  view: Size,
  cursor: Point,
  steps: number,
  bounds: Bounds,
): Camera {
  const zoom = clampZoom(cam.zoom + steps);
  if (zoom === clampZoom(cam.zoom)) return clampToMap(cam, bounds);
  const under = screenToWorld(cam, view, cursor.x, cursor.y);
  const mpp = metersPerPixel(zoom);
  return clampToMap(
    {
      zoom,
      x: under.x - (cursor.x - view.width / 2) * mpp,
      y: under.y + (cursor.y - view.height / 2) * mpp,
    },
    bounds,
  );
}
