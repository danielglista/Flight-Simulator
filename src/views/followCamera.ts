import type { Size } from '../config/display';
import type { Craft } from '../sim/state';
import { clampZoom, panBy, zoomAt, type Bounds, type Camera, type Point } from './camera';

/**
 * Top-view camera state: locked to the craft, or free look at `free`.
 * `free.zoom` is the zoom in both modes; `free.x/y` matter only in free look.
 */
export interface FollowCamera {
  readonly following: boolean;
  readonly free: Camera;
}

type Position = Pick<Craft, 'x' | 'y'>;

export function initialFollow(zoom: number): FollowCamera {
  return { following: true, free: { x: 0, y: 0, zoom } };
}

/** The camera to draw and to convert pointer positions with. No lag: the craft is exactly at the center. */
export function cameraFor(f: FollowCamera, craft: Position): Camera {
  return f.following ? { x: craft.x, y: craft.y, zoom: f.free.zoom } : f.free;
}

/** Starts or continues free look from what is on screen, so nothing jumps. */
export function panned(f: FollowCamera, craft: Position, dx: number, dy: number, bounds: Bounds): FollowCamera {
  return { following: false, free: panBy(cameraFor(f, craft), dx, dy, bounds) };
}

/** Following: zooms about the craft and keeps following. Free look: zooms at the cursor. */
export function zoomed(
  f: FollowCamera,
  _craft: Position,
  view: Size,
  cursor: Point,
  steps: number,
  bounds: Bounds,
): FollowCamera {
  if (f.following) return { following: true, free: { ...f.free, zoom: clampZoom(f.free.zoom + steps) } };
  return { following: false, free: zoomAt(f.free, view, cursor, steps, bounds) };
}

export function recentered(f: FollowCamera): FollowCamera {
  return f.following ? f : { ...f, following: true };
}
