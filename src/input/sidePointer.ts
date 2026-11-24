import type { Point } from '../views/camera';

import { createWheelAccumulator, toInternal } from './pointer';

/** Degrees turned per internal pixel of horizontal drag. */
export const DEGREES_PER_PIXEL = 0.5;

export interface SidePointerOptions {
  readonly canvas: HTMLCanvasElement;
  /** Turn by this many radians (positive = right). */
  onTurn(radians: number): void;
  /** Zoom by whole levels (positive = closer). */
  onZoom(steps: number): void;
  /** Cursor in internal pixels, or null when it has left the canvas. */
  setCursor(cursor: Point | null): void;
}

/** Drag left/right to turn, wheel to zoom, hover to link with the top view. */
export function attachSidePointer(o: SidePointerOptions): () => void {
  const { canvas } = o;
  let dragging = false;
  let lastX = 0;
  const accumulate = createWheelAccumulator();

  const end = (): void => {
    dragging = false;
    canvas.classList.remove('dragging');
  };
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    dragging = true;
    lastX = toInternal(canvas, e).x;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
  };
  const onMove = (e: PointerEvent): void => {
    const p = toInternal(canvas, e);
    if (dragging) {
      o.onTurn(((p.x - lastX) * DEGREES_PER_PIXEL * Math.PI) / 180);
      lastX = p.x;
    }
    o.setCursor(p);
  };
  const onUp = (e: PointerEvent): void => {
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    end();
  };
  const onLeave = (): void => {
    if (!dragging) o.setCursor(null);
  };
  const onWheel = (e: WheelEvent): void => {
    if (e.ctrlKey) return;
    e.preventDefault();
    const steps = accumulate(e);
    if (steps === 0) return;
    o.onZoom(-steps);
    o.setCursor(toInternal(canvas, e));
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('lostpointercapture', end);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('lostpointercapture', end);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('wheel', onWheel);
  };
}
