import { HSI_DEV_PX, HSI_GS_PX, HSI_SIZE } from '../../config/display';
import { BUG_COLOR, GAUGE_BG, GAUGE_NEEDLE, GAUGE_NUM, GAUGE_RING, GAUGE_TICK, GAUGE_WINDOW, HSI_BEARING, HSI_COURSE, READOUT_UNIT } from '../../config/palette';
import { turnNeeded } from '../headingBug';
import { fillArc, polar } from './dial';
import { drawLine, drawText, fillDisk } from './pixels';

/** The HSI is drawn on a grid half the size of its cell and scaled up, for chunky pixels. All figures below are grid pixels. */
export const HSI_GRID = 80;
const SCALE = HSI_SIZE / HSI_GRID;
/** The card sits a little left and low: the glide scale is on its right, the heading window above it. */
const CX = 38;
const CY = 45;
const R = 33;
const CARDINALS: Readonly<Record<number, string>> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

/** Where a card mark sits on the dial, degrees clockwise from the top: heading-up, so the heading is always at the top. */
export const compassAngle = (markDeg: number, headingDeg: number): number => turnNeeded(headingDeg, markDeg);

/** The approach parts, already in dial pixels: equal values draw the same picture. */
export interface HsiApproach {
  readonly courseDeg: number;
  readonly bearingDeg: number;
  /** Deviation bar offset, pixels to the right of the course arrow. */
  readonly barPx: number;
  /** Glide slope diamond, pixels above the middle of its scale; null when hidden. */
  readonly glidePx: number | null;
  /** Airport code, runway name and distance in world km. */
  readonly ident: string;
  readonly name: string;
  readonly distance: string;
}

/** A line from `r0` to `r1` along dial angle `a`, shifted `off` pixels to its right, `size` pixels wide. */
function spoke(ctx: CanvasRenderingContext2D, a: number, r0: number, r1: number, color: string, size: number, off = 0): void {
  const [sx, sy] = polar(a + 90, off);
  const [x0, y0] = polar(a, r0);
  const [x1, y1] = polar(a, r1);
  const x = CX + sx - Math.floor(size / 2);
  const y = CY + sy - Math.floor(size / 2);
  drawLine(ctx, x + x0, y + y0, x + x1, y + y1, color, size);
}

/** The two strokes of an arrow head with its tip at radius `r`. */
function head(ctx: CanvasRenderingContext2D, a: number, r: number, color: string, size: number, half: number): void {
  const [tx, ty] = polar(a, r);
  const [bx, by] = polar(a, r - half - 2);
  const x = CX - Math.floor(size / 2);
  const y = CY - Math.floor(size / 2);
  for (const side of [-1, 1]) {
    const [sx, sy] = polar(a + 90, side * half);
    drawLine(ctx, x + tx, y + ty, x + bx + sx, y + by + sy, color, size);
  }
}

function drawCard(ctx: CanvasRenderingContext2D, headingDeg: number): void {
  fillDisk(ctx, CX, CY, R, GAUGE_BG);
  for (let mark = 0; mark < 360; mark += 10) {
    const a = compassAngle(mark, headingDeg);
    const long = mark % 30 === 0;
    spoke(ctx, a, long ? R - 4 : R - 2, R - 1, long ? GAUGE_NUM : GAUGE_RING, 1);
    if (long) {
      const [x, y] = polar(a, R - 10);
      drawText(ctx, CARDINALS[mark] ?? String(mark / 10), Math.round(CX + x), Math.round(CY + y) - 2, GAUGE_NUM, '3x5', 'center');
    }
  }
}

/** Bearing needle, course arrow, deviation dots and bar. */
function drawApproachParts(ctx: CanvasRenderingContext2D, headingDeg: number, g: HsiApproach): void {
  const bearing = compassAngle(g.bearingDeg, headingDeg);
  spoke(ctx, bearing, 18, R - 1, HSI_BEARING, 1);
  spoke(ctx, bearing, -(R - 1), -18, HSI_BEARING, 1);
  head(ctx, bearing, R - 1, HSI_BEARING, 1, 3);

  const course = compassAngle(g.courseDeg, headingDeg);
  spoke(ctx, course, 18, R - 2, HSI_COURSE, 2);
  spoke(ctx, course, -(R - 2), -18, HSI_COURSE, 2);
  head(ctx, course, R - 1, HSI_COURSE, 2, 4);
  for (const k of [-2, -1, 1, 2]) {
    const [x, y] = polar(course + 90, (k * HSI_DEV_PX) / 2);
    ctx.fillStyle = GAUGE_TICK;
    ctx.fillRect(Math.round(CX + x) - 1, Math.round(CY + y) - 1, 2, 2);
  }
  spoke(ctx, course, -16, 16, HSI_COURSE, 2, g.barPx);
}

/** The glide slope scale right of the card, and its diamond. */
function drawGlide(ctx: CanvasRenderingContext2D, glidePx: number): void {
  const x = HSI_GRID - 4;
  ctx.fillStyle = GAUGE_TICK;
  for (const k of [-2, -1, 1, 2]) ctx.fillRect(x - 1, CY + (k * HSI_GS_PX) / 2 - 1, 2, 2);
  ctx.fillRect(x - 3, CY, 7, 1);
  ctx.fillStyle = HSI_COURSE;
  for (let dy = -3; dy <= 3; dy++) {
    const half = 3 - Math.abs(dy);
    ctx.fillRect(x - half, CY - glidePx + dy, 2 * half + 1, 1);
  }
}

/** The fixed airplane, always pointing up. */
function drawOwnShip(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = GAUGE_NEEDLE;
  ctx.fillRect(CX, CY - 6, 1, 13);
  ctx.fillRect(CX - 5, CY - 2, 11, 1);
  ctx.fillRect(CX - 2, CY + 5, 5, 1);
}

/**
 * The HSI in the HSI_SIZE cell at (ox, oy). With `approach` null it is a heading indicator that asks for a runway.
 * `bugDeg` is null when no bug is shown; `digits` is the heading as text (`090`).
 */
export function drawHsi(ctx: CanvasRenderingContext2D, ox: number, oy: number, headingDeg: number, bugDeg: number | null, digits: string, approach: HsiApproach | null): void {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(SCALE, SCALE);
  drawCard(ctx, headingDeg);
  if (approach) drawApproachParts(ctx, headingDeg, approach);
  else {
    drawText(ctx, 'SELECT', CX, CY + 9, HSI_COURSE, '3x5', 'center');
    drawText(ctx, 'RWY', CX, CY + 15, HSI_COURSE, '3x5', 'center');
  }
  drawOwnShip(ctx);
  if (bugDeg !== null) {
    const a = compassAngle(bugDeg, headingDeg);
    fillArc(ctx, CX, CY, R, R, a - 6, a + 6, BUG_COLOR);
    for (const side of [-6, 6]) spoke(ctx, a + side, R, R + 3, BUG_COLOR, 2);
  }
  // Fixed lubber line at the top, and the heading in a window above it.
  spoke(ctx, 0, R - 6, R, GAUGE_NEEDLE, 1);
  ctx.fillStyle = GAUGE_RING;
  ctx.fillRect(CX - 8, 1, 17, 9);
  ctx.fillStyle = GAUGE_WINDOW;
  ctx.fillRect(CX - 7, 2, 15, 7);
  drawText(ctx, digits, CX, 3, GAUGE_NUM, '3x5', 'center');
  if (approach) {
    drawText(ctx, approach.ident, 2, 2, HSI_COURSE, '3x5');
    drawText(ctx, approach.name, 2, 8, HSI_COURSE, '3x5');
    drawText(ctx, approach.distance, HSI_GRID - 2, 2, GAUGE_NUM, '3x5', 'right');
    drawText(ctx, 'KM', HSI_GRID - 2, 8, READOUT_UNIT, '3x5', 'right');
    if (approach.glidePx !== null) drawGlide(ctx, approach.glidePx);
  }
  ctx.restore();
}
