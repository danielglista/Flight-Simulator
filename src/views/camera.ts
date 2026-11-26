import type { Size } from '../config/display';

/** World meters per internal pixel, from most zoomed out to most zoomed in. */
export const ZOOM_LEVELS = [40, 20, 10, 5, 2.5, 1.25, 0.5] as const;
/** Start at 5 m per pixel: two pixels per 10 m cell. */
export const DEFAULT_ZOOM = 3;
/** The closest level: a 22.5 m runway is 45 px wide. The ground zoom starts here (C4B). */
export const CLOSE_ZOOM = ZOOM_LEVELS.length - 1;

/**
 * Position between zoom levels as a number of pixels per meter that is straight on a log scale, so `zoom` may be
 * fractional while the zoom eases. Whole numbers give exactly the level.
 */
export function interpolateLevels(levels: readonly number[], zoom: number): number {
  const last = levels.length - 1;
  const z = Math.min(last, Math.max(0, zoom));
  const i = Math.min(last - 1, Math.floor(z));
  const f = z - i;
  const a = levels[i] as number;
  const b = levels[i + 1] as number;
  return f === 0 ? a : f === 1 ? b : a * Math.pow(b / a, f);
}

/** The fractional zoom whose meters-per-pixel is `mpp` (the inverse of `interpolateLevels` for a descending list). */
export function zoomForLevels(levels: readonly number[], mpp: number): number {
  const last = levels.length - 1;
  if (mpp >= (levels[0] as number)) return 0;
  if (mpp <= (levels[last] as number)) return last;
  let i = 0;
  while (i < last - 1 && mpp < (levels[i + 1] as number)) i++;
  const a = levels[i] as number;
  const b = levels[i + 1] as number;
  return i + Math.log(mpp / a) / Math.log(b / a);
}

export const zoomForMpp = (mpp: number): number => zoomForLevels(ZOOM_LEVELS, mpp);

/** Center in world meters; zoom is an index into ZOOM_LEVELS (higher = closer). */
export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  /** Heading (radians, clockwise from north) that points up on screen. Default 0 = north up. */
  readonly rotation?: number;
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

/** Meters per pixel at a zoom; a fractional zoom (mid-ease) lies between the two levels around it. */
export function metersPerPixel(zoom: number): number {
  return interpolateLevels(ZOOM_LEVELS, zoom);
}

/** On-screen zoom readout: the level number, 1x = farthest out. A fractional (easing) zoom shows the nearest level. */
export function zoomLabel(zoom: number): string {
  return `ZOOM ${Math.round(zoom) + 1}x`;
}

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_LEVELS.length - 1, Math.max(0, Math.round(zoom)));
}

/** Screen-frame meters (right, up) to world meters (east, north) for a view whose `rotation` points up. */
function screenToWorldDelta(rotation: number, right: number, up: number): Point {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return { x: right * c + up * s, y: -right * s + up * c };
}

/** World to internal pixel. The camera's heading is up; with rotation 0 that is north (larger y). */
export function worldToScreen(cam: Camera, view: Size, wx: number, wy: number): Point {
  const mpp = metersPerPixel(cam.zoom);
  const r = cam.rotation ?? 0;
  const dx = wx - cam.x;
  const dy = wy - cam.y;
  const right = dx * Math.cos(r) - dy * Math.sin(r);
  const up = dx * Math.sin(r) + dy * Math.cos(r);
  return { x: right / mpp + view.width / 2, y: view.height / 2 - up / mpp };
}

export function screenToWorld(cam: Camera, view: Size, sx: number, sy: number): Point {
  const mpp = metersPerPixel(cam.zoom);
  const d = screenToWorldDelta(cam.rotation ?? 0, (sx - view.width / 2) * mpp, (view.height / 2 - sy) * mpp);
  return { x: cam.x + d.x, y: cam.y + d.y };
}

/** Keeps the camera center inside the map, so some map is always visible. */
export function clampToMap(cam: Camera, bounds: Bounds): Camera {
  return {
    x: Math.min(bounds.width, Math.max(0, cam.x)),
    y: Math.min(bounds.height, Math.max(0, cam.y)),
    zoom: clampZoom(cam.zoom),
    ...(cam.rotation === undefined ? {} : { rotation: cam.rotation }),
  };
}

/** Drag by (dx, dy) internal pixels: the map follows the cursor. */
export function panBy(cam: Camera, dx: number, dy: number, bounds: Bounds): Camera {
  const mpp = metersPerPixel(cam.zoom);
  const d = screenToWorldDelta(cam.rotation ?? 0, dx * mpp, -dy * mpp);
  return clampToMap({ ...cam, x: cam.x - d.x, y: cam.y - d.y }, bounds);
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
  const off = screenToWorldDelta(cam.rotation ?? 0, (cursor.x - view.width / 2) * mpp, (view.height / 2 - cursor.y) * mpp);
  return clampToMap({ ...cam, zoom, x: under.x - off.x, y: under.y - off.y }, bounds);
}
