import { DIAL_R, PANEL_CELL } from '../../config/display';
import { BUG_COLOR, GAUGE_BG, GAUGE_NEEDLE, GAUGE_NUM, GAUGE_RING, GAUGE_TICK, GAUGE_WINDOW } from '../../config/palette';
import { turnNeeded } from '../headingBug';
import { createFaceCache, fillArc, polar } from './dial';
import { drawLine, drawText, fillDisk } from './pixels';

const C = PANEL_CELL / 2;
const face = createFaceCache();
const CARDINALS: Readonly<Record<number, string>> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

/** Where a card mark sits on the dial, degrees clockwise from the top: heading-up, so the heading is always at the top. */
export const compassAngle = (markDeg: number, headingDeg: number): number => turnNeeded(headingDeg, markDeg);

function paintFace(ctx: CanvasRenderingContext2D): void {
  fillDisk(ctx, C, C, DIAL_R, GAUGE_BG);
  fillArc(ctx, C, C, DIAL_R, DIAL_R, 0, 360, GAUGE_RING);
}

/** The compass card in the cell at (ox, oy). `bugDeg` is null when no bug is shown; `digits` is the heading as text (`090`). */
export function drawCompass(ctx: CanvasRenderingContext2D, ox: number, oy: number, headingDeg: number, bugDeg: number | null, digits: string): void {
  ctx.drawImage(face.get('face', paintFace), ox, oy);
  for (let mark = 0; mark < 360; mark += 10) {
    const a = compassAngle(mark, headingDeg);
    const long = mark % 30 === 0;
    const [x0, y0] = polar(a, long ? 29 : 31);
    const [x1, y1] = polar(a, 34);
    drawLine(ctx, ox + C + x0, oy + C + y0, ox + C + x1, oy + C + y1, GAUGE_TICK);
    if (long) {
      const [lx, ly] = polar(a, 22);
      const letter = CARDINALS[mark];
      if (letter) drawText(ctx, letter, Math.round(ox + C + lx), Math.round(oy + C + ly) - 3, GAUGE_NUM, '5x7', 'center');
      else drawText(ctx, String(mark / 10), Math.round(ox + C + lx), Math.round(oy + C + ly) - 2, GAUGE_NUM, '3x5', 'center');
    }
  }
  if (bugDeg !== null) {
    const a = compassAngle(bugDeg, headingDeg);
    const [x0, y0] = polar(a, 27);
    const [x1, y1] = polar(a, 35);
    drawLine(ctx, ox + C + x0, oy + C + y0, ox + C + x1, oy + C + y1, BUG_COLOR, 3);
  }
  // Fixed lubber line at the top, and the heading in a window.
  drawLine(ctx, ox + C, oy + C - 37, ox + C, oy + C - 30, GAUGE_NEEDLE, 2);
  ctx.fillStyle = GAUGE_WINDOW;
  ctx.fillRect(ox + C - 12, oy + C - 5, 25, 11);
  drawText(ctx, digits, ox + C, oy + C - 3, GAUGE_NUM, '5x7', 'center');
}
