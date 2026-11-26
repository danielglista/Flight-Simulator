import { SPOOL_STABLE } from '../../config/flight';
import { N1_IDLE_PCT, N1_RED_PCT, N1_SWEEP_DEG, N1_ZERO_DEG, PANEL_CELL } from '../../config/display';
import { GAUGE_BG, GAUGE_NEEDLE, GAUGE_NUM, GAUGE_RING, GAUGE_TICK, GAUGE_WINDOW, N1_FILL, N1_GAP, N1_LEVER, N1_RED, N1_STABLE, READOUT_UNIT } from '../../config/palette';
import { powerPct } from '../format';
import { createFaceCache, fillArc, polar } from './dial';
import { drawLine, drawText, fillDisk, textWidth } from './pixels';

const C = PANEL_CELL / 2;
const R = 36;
const overlay = createFaceCache();

/** Dial angle (degrees clockwise from the top, may pass 360) of a power reading. */
export const powerAngle = (pct: number): number => N1_ZERO_DEG + (Math.min(100, Math.max(0, pct)) / 100) * N1_SWEEP_DEG;

/**
 * The two readouts. At the minimum they say IDLE instead of a number. The lever's line is dropped (null) when the box
 * already says IDLE for both.
 */
export function powerLabels(leverPct: number, enginePct: number): { readonly engine: string; readonly lever: string | null } {
  const idle = (pct: number): boolean => pct <= N1_IDLE_PCT;
  return {
    engine: idle(enginePct) ? 'IDLE' : String(enginePct),
    lever: !idle(leverPct) ? `THR ${leverPct}` : idle(enginePct) ? null : 'IDLE',
  };
}

/** A pie slice from `deg0` to `deg1` clockwise, radius `r`, as horizontal runs `[x, y, width]` from its center. */
export function sectorRuns(r: number, deg0: number, deg1: number): readonly (readonly [number, number, number])[] {
  const out: [number, number, number][] = [];
  const span = deg1 - deg0;
  for (let y = -r; y <= r; y++) {
    let start: number | null = null;
    for (let x = -r; x <= r + 1; x++) {
      const deg = (Math.atan2(x, -y) * 180) / Math.PI;
      const inside = x * x + y * y <= r * r && (((deg - deg0) % 360) + 360) % 360 <= span;
      if (inside) start ??= x;
      else if (start !== null) {
        out.push([start, y, x - start]);
        start = null;
      }
    }
  }
  return out;
}

/** Ring, ticks, numbers and the red arc: drawn over the engine fill. The lower right quarter holds the digits. */
function paintOverlay(ctx: CanvasRenderingContext2D): void {
  const end = powerAngle(100);
  fillArc(ctx, C, C, R - 3, R - 3, N1_ZERO_DEG, end, GAUGE_RING);
  fillArc(ctx, C, C, R - 2, R, powerAngle(N1_RED_PCT), end, N1_RED);
  for (let pct = 0; pct <= 100; pct += 10) {
    const deg = powerAngle(pct);
    const [x0, y0] = polar(deg, pct % 20 === 0 ? R - 9 : R - 6);
    const [x1, y1] = polar(deg, R - 3);
    drawLine(ctx, C + x0, C + y0, C + x1, C + y1, GAUGE_TICK);
  }
  // Below this mark the engine is still sluggish.
  const [sx0, sy0] = polar(powerAngle(powerPct(SPOOL_STABLE)), R - 7);
  const [sx1, sy1] = polar(powerAngle(powerPct(SPOOL_STABLE)), R + 1);
  drawLine(ctx, C + sx0, C + sy0, C + sx1, C + sy1, N1_STABLE, 2);
  for (let pct = 20; pct <= 100; pct += 20) {
    const [x, y] = polar(powerAngle(pct), R - 14);
    drawText(ctx, String(pct / 10), Math.round(C + x), Math.round(C + y) - 2, GAUGE_NUM, '3x5', 'center');
  }
}

/**
 * The power dial in the cell whose top-left corner is (ox, oy). White needle and green fill: engine. Marker on the
 * rim: lever. Amber band: the gap while the engine catches up. Both values are readings from `powerPct`.
 */
export function drawPower(ctx: CanvasRenderingContext2D, ox: number, oy: number, leverPct: number, enginePct: number): void {
  const cx = ox + C;
  const cy = oy + C;
  fillDisk(ctx, cx, cy, R, GAUGE_BG);
  const engine = powerAngle(enginePct);
  const lever = powerAngle(leverPct);
  ctx.fillStyle = N1_FILL;
  for (const [x, y, w] of sectorRuns(R - 4, N1_ZERO_DEG, engine)) ctx.fillRect(cx + x, cy + y, w, 1);
  ctx.drawImage(overlay.get('overlay', paintOverlay), ox, oy);
  if (leverPct !== enginePct) fillArc(ctx, cx, cy, R - 2, R, Math.min(engine, lever), Math.max(engine, lever), N1_GAP);
  const [lx0, ly0] = polar(lever, R - 4);
  const [lx1, ly1] = polar(lever, R + 2);
  drawLine(ctx, cx + lx0, cy + ly0, cx + lx1, cy + ly1, N1_LEVER, 3);
  const [nx, ny] = polar(engine, R - 6);
  drawLine(ctx, cx, cy, cx + nx, cy + ny, GAUGE_NEEDLE, 2);
  fillDisk(ctx, cx, cy, 2, GAUGE_NEEDLE);

  const labels = powerLabels(leverPct, enginePct);
  ctx.fillStyle = GAUGE_RING;
  ctx.fillRect(cx + 6, cy + 6, 27, 13);
  ctx.fillStyle = GAUGE_WINDOW;
  ctx.fillRect(cx + 7, cy + 7, 25, 11);
  drawText(ctx, labels.engine, cx + 31, cy + 9, GAUGE_NUM, '5x7', 'right');
  if (labels.lever === null) return;
  // Label and number apart, with a narrower gap than a space, so the label stays clear of the rim.
  const [head, value] = labels.lever.split(' ');
  const right = ox + PANEL_CELL - 3;
  if (value === undefined) {
    drawText(ctx, labels.lever, right, cy + 25, READOUT_UNIT, '5x7', 'right');
    return;
  }
  drawText(ctx, value, right, cy + 25, READOUT_UNIT, '5x7', 'right');
  drawText(ctx, head ?? '', right - textWidth(value) - 3, cy + 25, READOUT_UNIT, '5x7', 'right');
}
