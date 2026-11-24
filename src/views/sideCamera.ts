import type { Size } from '../config/display';
import type { Probe } from './probe';

/** World meters per internal pixel along the heading, from far to close. */
export const SIDE_ZOOM_LEVELS = [10, 5, 2.5, 1.25] as const;
/** World meters per pixel, vertical. The two closest levels share one scale (no exaggeration). */
const VERTICAL_MPP = [2.5, 2.5, 2.5, 1.25] as const;
export const DEFAULT_SIDE_ZOOM = 1;
/** Sea level sits this many pixels above the bottom edge (room for the readout). */
export const SEA_ROW_FROM_BOTTOM = 48;
/** The probe is this fraction of the width from the left. */
export const PROBE_X_FRACTION = 0.25;

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

export function probeColumn(view: Size): number {
  return Math.round(view.width * PROBE_X_FRACTION);
}

export function seaRow(view: Size): number {
  return view.height - SEA_ROW_FROM_BOTTOM;
}

/** Distance ahead of the probe (world m; negative is behind) to an internal x. */
export function distanceToX(view: Size, zoom: number, d: number): number {
  return probeColumn(view) + d / sideMetersPerPixel(zoom);
}

export function xToDistance(view: Size, zoom: number, x: number): number {
  return (x - probeColumn(view)) * sideMetersPerPixel(zoom);
}

/** World height to internal y. Up is a smaller y; this is the only vertical flip. */
export function heightToY(view: Size, zoom: number, h: number): number {
  return seaRow(view) - h / verticalMetersPerPixel(zoom);
}

export interface SliceWindow {
  readonly origin: { readonly x: number; readonly y: number };
  readonly heading: number;
  readonly length: number;
  readonly samples: number;
  /** Distance of the first sample from the probe (negative: behind). */
  readonly startDistance: number;
}

/** Arguments for sliceAlong: one sample per pixel column, covering the whole view. */
export function sliceWindow(probe: Probe, view: Size, zoom: number): SliceWindow {
  const mpp = sideMetersPerPixel(zoom);
  const start = xToDistance(view, zoom, 0);
  return {
    origin: {
      x: probe.x + Math.sin(probe.heading) * start,
      y: probe.y + Math.cos(probe.heading) * start,
    },
    heading: probe.heading,
    length: (view.width - 1) * mpp,
    samples: view.width,
    startDistance: start,
  };
}

/**
 * Terrain beside the flight line is drawn as hazy silhouettes behind the main
 * profile. The viewer is on the right of the heading looking left, so "behind"
 * is to the LEFT. Offsets in world meters, farthest first.
 */
export const LAYER_OFFSETS = [1200, 600, 250] as const;
/** Haze (0 clear, 1 sky) for each layer, same order. */
export const LAYER_HAZE = [0.7, 0.5, 0.3] as const;

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
