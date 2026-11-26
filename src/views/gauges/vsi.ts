import { DIAL_R, PANEL_CELL, VSI_TABLE, type VsMode } from '../../config/display';
import { SCALES } from '../../config/scales';
import { GAUGE_BG, GAUGE_NEEDLE, GAUGE_NUM, GAUGE_RING, GAUGE_TICK, GAUGE_WINDOW } from '../../config/palette';
import { createFaceCache, fillArc, polar, tableAngle } from './dial';
import { drawLine, drawText, fillDisk } from './pixels';

const C = PANEL_CELL / 2;
const face = createFaceCache();

/** Dial values are in the shown unit; `altimeter` mode runs the dial ALTITUDE_SCALE times higher. */
const unitOf = (mode: VsMode): number => (mode === 'altimeter' ? SCALES.altitude : 1);

/** Needle angle, degrees clockwise from the top: 9 o'clock (270) at zero, up for a climb, pegged beyond the table. */
export function vsiAngle(fpm: number, mode: VsMode): number {
  const offset = Math.sign(fpm) * tableAngle(VSI_TABLE, Math.abs(fpm) / unitOf(mode));
  return (270 + offset + 360) % 360;
}

function paintFace(ctx: CanvasRenderingContext2D, mode: VsMode): void {
  fillDisk(ctx, C, C, DIAL_R, GAUGE_BG);
  fillArc(ctx, C, C, DIAL_R, DIAL_R, 0, 360, GAUGE_RING);
  const unit = unitOf(mode);
  const ticks = [0, 500, 1000, 1500, 2000, 3000, 4000];
  for (const v of ticks) {
    for (const sign of v === 0 ? [1] : [-1, 1]) {
      const a = vsiAngle(sign * v * unit, mode);
      const major = [0, 1000, 2000, 4000].includes(v);
      const [x0, y0] = polar(a, major ? 26 : 29);
      const [x1, y1] = polar(a, 33);
      drawLine(ctx, C + x0, C + y0, C + x1, C + y1, GAUGE_TICK);
    }
  }
  for (const v of [1000, 2000, 4000]) {
    for (const sign of [-1, 1]) {
      const [x, y] = polar(vsiAngle(sign * v * unit, mode), 19);
      drawText(ctx, String((v * unit) / 1000), Math.round(C + x), Math.round(C + y) - 2, GAUGE_NUM, '3x5', 'center');
    }
  }
}

/** The vertical speed dial in the cell at (ox, oy); `fpm` in the mode's unit, `digits` its text. */
export function drawVsi(ctx: CanvasRenderingContext2D, ox: number, oy: number, needleDeg: number, mode: VsMode, digits: string): void {
  ctx.drawImage(face.get(mode, (c) => paintFace(c, mode)), ox, oy);
  const w = digits.length * 6 - 1 + 4;
  ctx.fillStyle = GAUGE_WINDOW;
  ctx.fillRect(ox + C + 6 - Math.floor(w / 2), oy + C + 5, w, 11);
  drawText(ctx, digits, ox + C + 6, oy + C + 7, GAUGE_NUM, '5x7', 'center');
  const [x, y] = polar(needleDeg, 31);
  drawLine(ctx, ox + C, oy + C, ox + C + x, oy + C + y, GAUGE_NEEDLE, 2);
  fillDisk(ctx, ox + C, oy + C, 2, GAUGE_NEEDLE);
}
