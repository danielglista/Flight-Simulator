import { DIAL_R, PANEL_CELL } from '../../config/display';
import { BUG_COLOR, GAUGE_BG, GAUGE_NEEDLE, GAUGE_NEEDLE_SHORT, GAUGE_NUM, GAUGE_RING, GAUGE_TICK, GAUGE_WINDOW } from '../../config/palette';
import { createFaceCache, fillArc, polar } from './dial';
import { drawLine, drawText, fillDisk } from './pixels';

const C = PANEL_CELL / 2;
const face = createFaceCache();

function paintFace(ctx: CanvasRenderingContext2D): void {
  fillDisk(ctx, C, C, DIAL_R, GAUGE_BG);
  fillArc(ctx, C, C, DIAL_R, DIAL_R, 0, 360, GAUGE_RING);
  for (let i = 0; i < 20; i++) {
    const major = i % 2 === 0;
    const [x0, y0] = polar(i * 18, major ? 28 : 30);
    const [x1, y1] = polar(i * 18, 33);
    drawLine(ctx, C + x0, C + y0, C + x1, C + y1, GAUGE_TICK);
  }
  for (let d = 0; d < 10; d++) {
    const [x, y] = polar(d * 36, 22);
    drawText(ctx, String(d), Math.round(C + x), Math.round(C + y) - 2, GAUGE_NUM, '3x5', 'center');
  }
}

/** The altimeter in the cell whose top-left corner is (ox, oy); `digits` is the displayed feet without commas. */
export function drawAltimeter(ctx: CanvasRenderingContext2D, ox: number, oy: number, longDeg: number, shortDeg: number, digits: string, bugDeg: number | null = null): void {
  ctx.drawImage(face.get('face', paintFace), ox, oy);
  if (bugDeg !== null) {
    const [x0, y0] = polar(bugDeg, 27);
    const [x1, y1] = polar(bugDeg, 35);
    drawLine(ctx, ox + C + x0, oy + C + y0, ox + C + x1, oy + C + y1, BUG_COLOR, 3);
  }
  const w = digits.length * 6 - 1 + 4;
  ctx.fillStyle = GAUGE_WINDOW;
  ctx.fillRect(ox + C - Math.floor(w / 2), oy + C + 3, w, 11);
  drawText(ctx, digits, ox + C, oy + C + 5, GAUGE_NUM, '5x7', 'center');
  const [sx, sy] = polar(shortDeg, 19);
  drawLine(ctx, ox + C, oy + C, ox + C + sx, oy + C + sy, GAUGE_NEEDLE_SHORT, 3);
  const [lx, ly] = polar(longDeg, 31);
  drawLine(ctx, ox + C, oy + C, ox + C + lx, oy + C + ly, GAUGE_NEEDLE, 2);
  fillDisk(ctx, ox + C, oy + C, 2, GAUGE_NEEDLE);
}
