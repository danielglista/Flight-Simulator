import { CANVAS_PANELS, type CanvasPanelId, type Size } from '../config/display';
import { fitScale } from './scaling';

function drawPlaceholder(ctx: CanvasRenderingContext2D, label: string, size: Size): void {
  const { width: w, height: h } = size;
  ctx.fillStyle = '#0d1a2b';
  ctx.fillRect(0, 0, w, h);

  // Checker, so scaling and crispness are visible.
  ctx.fillStyle = '#10213a';
  for (let y = 0; y < h; y += 8) {
    for (let x = 0; x < w; x += 8) {
      if (((x + y) / 8) % 2 === 0) ctx.fillRect(x, y, 8, 8);
    }
  }

  // One-pixel inner border.
  ctx.strokeStyle = '#5fd0a0';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  ctx.fillStyle = '#c8d3e6';
  ctx.font = '10px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${label} ${w}x${h}`, w / 2, h / 2);
}

export type DrawFn = (ctx: CanvasRenderingContext2D, size: Size) => void;

export interface PanelHandle {
  readonly canvas: HTMLCanvasElement;
  /** Current internal size; it follows the panel size. */
  readonly size: Size;
  /** Schedules one redraw on the next animation frame; repeated calls share it. */
  requestDraw(): void;
  /** Draws now and cancels a pending request. */
  render(): void;
}

function setupPanel(id: CanvasPanelId, draw?: DrawFn): PanelHandle {
  const panel = document.getElementById(`panel-${id}`);
  const canvas = panel?.querySelector('canvas');
  if (!panel || !canvas) throw new Error(`Missing panel or canvas for "${id}"`);

  const { label, internal } = CANVAS_PANELS[id];
  const size: { width: number; height: number } = { ...internal };
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not supported');

  let queued = false;
  let rafId = 0;
  const render = (): void => {
    if (queued) {
      cancelAnimationFrame(rafId);
      queued = false;
    }
    const { scale, cssWidth, cssHeight } = fitScale(
      { width: panel.clientWidth, height: panel.clientHeight },
      internal,
      window.devicePixelRatio,
    );
    void cssWidth;
    void cssHeight;
    // Keep the whole-number scale, but grow the internal canvas to cover the
    // panel (the last pixel row or column may be cropped), so there are no margins.
    const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    size.width = Math.max(1, Math.ceil((panel.clientWidth * dpr) / scale));
    size.height = Math.max(1, Math.ceil((panel.clientHeight * dpr) / scale));
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
    canvas.style.width = `${(size.width * scale) / dpr}px`;
    canvas.style.height = `${(size.height * scale) / dpr}px`;
    canvas.dataset['scale'] = String(scale);
    ctx.imageSmoothingEnabled = false;
    if (draw) draw(ctx, size);
    else drawPlaceholder(ctx, label, size);
  };

  const requestDraw = (): void => {
    if (queued) return;
    queued = true;
    rafId = requestAnimationFrame(() => {
      queued = false;
      render();
    });
  };

  new ResizeObserver(render).observe(panel);
  render();
  return { canvas, size, requestDraw, render };
}

/** Panels without a draw function keep the A1 placeholder. */
export function initPanels(
  draws: Partial<Record<CanvasPanelId, DrawFn>> = {},
): Record<CanvasPanelId, PanelHandle> {
  const ids = Object.keys(CANVAS_PANELS) as CanvasPanelId[];
  return Object.fromEntries(ids.map((id) => [id, setupPanel(id, draws[id])])) as Record<
    CanvasPanelId,
    PanelHandle
  >;
}
