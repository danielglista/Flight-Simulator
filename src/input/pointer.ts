import type { Point } from '../views/camera';

/** One zoom level per this many pixels of wheel travel. */
export const WHEEL_STEP = 100;
/** A press that moves less than this (internal px) is a click. */
export const CLICK_THRESHOLD = 4;

/** CSS pixels to internal pixels, right at any DPR or scale. */
export function toInternal(canvas: HTMLCanvasElement, e: MouseEvent): Point {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) * canvas.width) / r.width,
    y: ((e.clientY - r.top) * canvas.height) / r.height,
  };
}

export function wheelPixels(e: WheelEvent): number {
  if (e.deltaMode === 1) return e.deltaY * 33; // lines
  if (e.deltaMode === 2) return e.deltaY * 400; // pages
  return e.deltaY;
}

/** Collects wheel travel and returns whole zoom steps (positive = wheel down). */
export function createWheelAccumulator(): (e: WheelEvent) => number {
  let acc = 0;
  return (e) => {
    acc += wheelPixels(e);
    const steps = Math.trunc(acc / WHEEL_STEP);
    acc -= steps * WHEEL_STEP;
    return steps;
  };
}
