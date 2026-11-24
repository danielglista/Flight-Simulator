import type { Size } from '../config/display';
import { panBy, screenToWorld, zoomAt, type Bounds, type Camera, type Point } from '../views/camera';
import { CLICK_THRESHOLD, createWheelAccumulator, toInternal } from './pointer';

export interface MapPointerOptions {
  readonly canvas: HTMLCanvasElement;
  getView(): Size;
  readonly bounds: Bounds;
  getCamera(): Camera;
  setCamera(camera: Camera): void;
  /** Cursor in internal pixels, or null when it has left the canvas. */
  setCursor(cursor: Point | null): void;
  /** A click (press and release without moving), as a world point. */
  onClick(world: Point): void;
}

/** Drag to pan, click to place the probe, wheel to zoom at the cursor. Returns a function that removes the listeners. */
export function attachMapPointer(o: MapPointerOptions): () => void {
  const { canvas } = o;
  let pressed = false;
  let panning = false;
  let start: Point = { x: 0, y: 0 };
  let last: Point = { x: 0, y: 0 };
  const accumulate = createWheelAccumulator();

  const end = (): void => {
    pressed = false;
    panning = false;
    canvas.classList.remove('dragging');
  };

  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    pressed = true;
    panning = false;
    start = last = toInternal(canvas, e);
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent): void => {
    const p = toInternal(canvas, e);
    if (pressed) {
      if (!panning && Math.hypot(p.x - start.x, p.y - start.y) >= CLICK_THRESHOLD) {
        panning = true;
        canvas.classList.add('dragging');
        last = start; // no jump: the map follows from where the press began
      }
      if (panning) {
        o.setCamera(panBy(o.getCamera(), p.x - last.x, p.y - last.y, o.bounds));
        last = p;
      }
    }
    o.setCursor(p);
  };
  const onUp = (e: PointerEvent): void => {
    const wasClick = pressed && !panning;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    end();
    if (wasClick) {
      const p = toInternal(canvas, e);
      o.onClick(screenToWorld(o.getCamera(), o.getView(), p.x, p.y));
    }
  };
  // Cancel and lost capture are never clicks.
  const onCancel = (e: PointerEvent): void => {
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    end();
  };
  const onLeave = (): void => {
    if (!pressed) o.setCursor(null);
  };
  const onWheel = (e: WheelEvent): void => {
    if (e.ctrlKey) return; // leave browser zoom alone
    e.preventDefault();
    const steps = accumulate(e);
    if (steps === 0) return;
    const p = toInternal(canvas, e);
    o.setCamera(zoomAt(o.getCamera(), o.getView(), p, -steps, o.bounds));
    o.setCursor(p);
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('lostpointercapture', end);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onCancel);
    canvas.removeEventListener('lostpointercapture', end);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('wheel', onWheel);
  };
}
