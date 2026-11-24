import type { Size } from '../config/display';
import { panBy, zoomAt, type Bounds, type Camera, type Point } from '../views/camera';

export interface MapPointerOptions {
  readonly canvas: HTMLCanvasElement;
  getView(): Size;
  readonly bounds: Bounds;
  getCamera(): Camera;
  setCamera(camera: Camera): void;
  /** Cursor in internal pixels, or null when it has left the canvas. */
  setCursor(cursor: Point | null): void;
}

/** One zoom level per this many pixels of wheel travel. */
const WHEEL_STEP = 100;

function wheelPixels(e: WheelEvent): number {
  if (e.deltaMode === 1) return e.deltaY * 33; // lines
  if (e.deltaMode === 2) return e.deltaY * 400; // pages
  return e.deltaY;
}

/** Drag to pan, wheel to zoom at the cursor. Returns a function that removes the listeners. */
export function attachMapPointer(o: MapPointerOptions): () => void {
  const { canvas } = o;
  let dragging = false;
  let last: Point = { x: 0, y: 0 };
  let wheelAcc = 0;

  /** CSS pixels to internal pixels, right at any DPR or scale. */
  const internal = (e: MouseEvent): Point => {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * canvas.width) / r.width,
      y: ((e.clientY - r.top) * canvas.height) / r.height,
    };
  };

  const endDrag = (): void => {
    dragging = false;
    canvas.classList.remove('dragging');
  };

  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    dragging = true;
    last = internal(e);
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
  };
  const onMove = (e: PointerEvent): void => {
    const p = internal(e);
    if (dragging) {
      o.setCamera(panBy(o.getCamera(), p.x - last.x, p.y - last.y, o.bounds));
      last = p;
    }
    o.setCursor(p);
  };
  const onUp = (e: PointerEvent): void => {
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    endDrag();
  };
  const onLeave = (): void => {
    if (!dragging) o.setCursor(null);
  };
  const onWheel = (e: WheelEvent): void => {
    if (e.ctrlKey) return; // leave browser zoom alone
    e.preventDefault();
    wheelAcc += wheelPixels(e);
    const steps = Math.trunc(wheelAcc / WHEEL_STEP);
    if (steps === 0) return;
    wheelAcc -= steps * WHEEL_STEP;
    o.setCamera(zoomAt(o.getCamera(), o.getView(), internal(e), -steps, o.bounds));
    o.setCursor(internal(e));
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('lostpointercapture', endDrag);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('lostpointercapture', endDrag);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('wheel', onWheel);
  };
}
