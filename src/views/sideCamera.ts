import type { Size } from '../config/display';
import type { Craft } from '../sim/state';

/** World meters per internal pixel along the heading, from far to close. */
export const SIDE_ZOOM_LEVELS = [10, 5, 2.5, 1.25] as const;
/** World meters per pixel, vertical. The two closest levels share one scale (no exaggeration). */
const VERTICAL_MPP = [2.5, 2.5, 2.5, 1.25] as const;
export const DEFAULT_SIDE_ZOOM = 1;
/** Sea level sits this many pixels above the bottom edge (room for the readout). */
export const SEA_ROW_FROM_BOTTOM = 48;
/** The plane is this fraction of the width from the left. */
export const PLANE_X_FRACTION = 0.25;

export function clampSideZoom(z: number): number {
  return Math.min(SIDE_ZOOM_LEVELS.length - 1, Math.max(0, Math.round(z)));
}

export function sideMetersPerPixel(zoom: number): number {
  return SIDE_ZOOM_LEVELS[clampSideZoom(zoom)] as number;
}

export function verticalMetersPerPixel(zoom: number): number {
  return VERTICAL_MPP[clampSideZoom(zoom)] as number;
}

export function exaggeration(zoom: number): number {
  return sideMetersPerPixel(zoom) / verticalMetersPerPixel(zoom);
}

/** Length of the path line in the side view, pixels. */
export const PATH_LINE_PX = 40;

/**
 * Screen offset (x right, y down) from the plane to the end of its path line. The line points where the
 * plane will go on screen, so the view's vertical exaggeration steepens it.
 */
export function pathLineOffset(pathAngle: number, exaggeration: number, length: number): { readonly dx: number; readonly dy: number } {
  const dx = Math.cos(pathAngle);
  const dy = -Math.sin(pathAngle) * exaggeration;
  const n = Math.hypot(dx, dy);
  return { dx: (dx / n) * length, dy: (dy / n) * length };
}

export function planeColumn(view: Size): number {
  return Math.round(view.width * PLANE_X_FRACTION);
}

export function seaRow(view: Size): number {
  return view.height - SEA_ROW_FROM_BOTTOM;
}

/** Distance ahead of the plane (world m; negative is behind) to an internal x. */
export function distanceToX(view: Size, zoom: number, d: number): number {
  return planeColumn(view) + d / sideMetersPerPixel(zoom);
}

export function xToDistance(view: Size, zoom: number, x: number): number {
  return (x - planeColumn(view)) * sideMetersPerPixel(zoom);
}

/** The plane sits on this row once it climbs high enough that the view must scroll. */
export function followRow(view: Size): number {
  return Math.round(0.4 * view.height);
}

/** Whole pixels the view has scrolled up for a plane at height z (0 while low). */
function scrollPixels(view: Size, zoom: number, z: number): number {
  const mpp = verticalMetersPerPixel(zoom);
  return Math.max(0, Math.ceil(z / mpp - (seaRow(view) - followRow(view))));
}

/**
 * World m shown at the sea-level row: 0 at low altitude, then a whole number of
 * pixels, so every terrain layer scrolls together and nothing shimmers.
 */
export function baseHeight(view: Size, zoom: number, z: number): number {
  return scrollPixels(view, zoom, z) * verticalMetersPerPixel(zoom);
}

/** World height to internal y, with the view scrolled to `base`. Up is a smaller y; this is the only vertical flip. */
export function heightToY(view: Size, zoom: number, h: number, base: number): number {
  return seaRow(view) - (h - base) / verticalMetersPerPixel(zoom);
}

/** The pixel row of the plane sprite's center. Exactly followRow while scrolling. */
export function planeRow(view: Size, zoom: number, z: number): number {
  if (scrollPixels(view, zoom, z) > 0) return followRow(view);
  return Math.floor(heightToY(view, zoom, z, 0));
}

export interface SliceWindow {
  readonly origin: { readonly x: number; readonly y: number };
  readonly heading: number;
  readonly length: number;
  readonly samples: number;
  /** Distance of the first sample from the plane (negative: behind). */
  readonly startDistance: number;
}

/** Arguments for sliceAlong: one sample per pixel column, covering the whole view. */
export function sliceWindow(craft: Pick<Craft, 'x' | 'y' | 'heading'>, view: Size, zoom: number, k = 1): SliceWindow {
  // A layer with parallax factor k covers 1/k as many meters per pixel, anchored at the plane's column.
  const mpp = sideMetersPerPixel(zoom) / k;
  const start = (0 - planeColumn(view)) * mpp;
  return {
    origin: {
      x: craft.x + Math.sin(craft.heading) * start,
      y: craft.y + Math.cos(craft.heading) * start,
    },
    heading: craft.heading,
    length: (view.width - 1) * mpp,
    samples: view.width,
    startDistance: start,
  };
}

/**
 * Terrain beside the flight line is drawn as hazy silhouettes behind the main
 * profile (layers: SIDE_LAYERS in config/display.ts). The viewer is on the right
 * of the heading looking left, so "behind" is to the LEFT.
 */
/** A slice window moved sideways to the left of the heading by `offset` meters. */
export function shiftLeft(w: SliceWindow, offset: number): SliceWindow {
  return {
    ...w,
    origin: {
      x: w.origin.x - Math.cos(w.heading) * offset,
      y: w.origin.y + Math.sin(w.heading) * offset,
    },
  };
}

/** Drawing-only exaggeration of water depth. Surface heights are never changed. */
export const WATER_EXAGGERATION = 10;
/** Visual depth saturates toward this (world m), so deep sea still fits under the view. */
export const WATER_VISUAL_MAX_M = 16;
/** Even the shallowest water is drawn at least this many pixels deep. */
export const WATER_MIN_PX = 5;

/**
 * Depth (world m) to draw for a true depth: about WATER_EXAGGERATION times
 * larger when shallow, levelling off at WATER_VISUAL_MAX_M. Always increasing,
 * so a shelf still slopes the right way.
 */
export function visualWaterDepth(depthWorldM: number): number {
  if (!(depthWorldM > 0)) return 0;
  return WATER_VISUAL_MAX_M * Math.tanh((depthWorldM * WATER_EXAGGERATION) / WATER_VISUAL_MAX_M);
}
