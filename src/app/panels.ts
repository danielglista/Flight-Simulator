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

function setupPanel(id: CanvasPanelId): void {
  const panel = document.getElementById(`panel-${id}`);
  const canvas = panel?.querySelector('canvas');
  if (!panel || !canvas) throw new Error(`Missing panel or canvas for "${id}"`);

  const { label, internal } = CANVAS_PANELS[id];
  canvas.width = internal.width;
  canvas.height = internal.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not supported');

  const render = (): void => {
    const { scale, cssWidth, cssHeight } = fitScale(
      { width: panel.clientWidth, height: panel.clientHeight },
      internal,
      window.devicePixelRatio,
    );
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.dataset['scale'] = String(scale);
    ctx.imageSmoothingEnabled = false;
    drawPlaceholder(ctx, label, internal);
  };

  new ResizeObserver(render).observe(panel);
  render();
}

export function initPanels(): void {
  for (const id of Object.keys(CANVAS_PANELS) as CanvasPanelId[]) setupPanel(id);
}
