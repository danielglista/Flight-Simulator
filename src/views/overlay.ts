export const FONT = '12px ui-monospace, Consolas, monospace';
const NICE_LENGTHS = [50, 100, 200, 500, 1000, 2000];

/** Text with a one-pixel black shadow. Sets alignment itself so callers cannot leak it. */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: CanvasTextAlign = 'left',
): void {
  ctx.font = FONT;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = align;
  ctx.fillStyle = '#000';
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x, y);
}

/** Scale bar in world meters (displayed distance does not exist before E1). */
export function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  metersPerPixel: number,
  x: number,
  y: number,
): void {
  let len = NICE_LENGTHS[0] as number;
  for (const l of NICE_LENGTHS) if (l / metersPerPixel <= 160) len = l;
  const px = Math.round(len / metersPerPixel);
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 1, y - 1, px + 2, 5);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x, y, px, 3);
  drawText(ctx, `${len} m world`, x, y - 4);
}
