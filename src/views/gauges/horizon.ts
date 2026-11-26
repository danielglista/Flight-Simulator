import { HORIZON_MIN_PX, HORIZON_PX_PER_DEG } from '../../config/display';
import { GAUGE_NUM, GAUGE_RING, GAUGE_TICK, HORIZON_GROUND, HORIZON_LINE, HORIZON_SKY, HORIZON_WINGS, PATH_MARKER_COLOR, READOUT_VALUE } from '../../config/palette';
import { createFaceCache, fillArc, polar } from './dial';
import { drawLine, drawText } from './pixels';

/** The horizon disc: radius and center inside its 80 px cell. The strip under it holds the pitch and bank numbers. */
export const HORIZON_R = 34;
export const HORIZON_CX = 40;
export const HORIZON_CY = 36;
const BANK_MARKS = [0, 10, 20, 30, 45, 60];
const RUNGS_DEG = [5, 10, 15, 20, 25, 30];

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Pixels the horizon sits below the center for this pitch (nose up = sky grows = the horizon moves down), pegged so some sky and ground stay. */
export const horizonOffsetPx = (pitchDeg: number): number => clamp(pitchDeg * HORIZON_PX_PER_DEG, -(HORIZON_R - HORIZON_MIN_PX), HORIZON_R - HORIZON_MIN_PX);

export interface HorizonColumn {
  readonly dx: number;
  /** Rows relative to the center: sky from `top` to `split`, ground from `split` to `bottom`. */
  readonly top: number;
  readonly split: number;
  readonly bottom: number;
  /** The horizon passes through this column inside the disc. */
  readonly onLine: boolean;
}

/**
 * The disc one column at a time. Bank is positive to the right; the horizon turns the other way, so in a right bank its
 * right end is higher on screen (a smaller row).
 */
export function horizonColumns(pitchDeg: number, bankDeg: number): HorizonColumn[] {
  const b = bankDeg * DEG;
  const cos = Math.max(Math.cos(b), 0.1);
  const out: HorizonColumn[] = [];
  for (let dx = -HORIZON_R; dx <= HORIZON_R; dx++) {
    const half = Math.round(Math.sqrt(HORIZON_R * HORIZON_R - dx * dx));
    const raw = horizonOffsetPx(pitchDeg) / cos - dx * Math.tan(b);
    out.push({ dx, top: -half, split: clamp(Math.round(raw), -half, half), bottom: half, onLine: raw >= -half && raw <= half });
  }
  return out;
}

/** Rows below the center where the flight-path marker sits: the nose points `pitch - path` degrees above the path. */
export const pathMarkerOffsetPx = (pitchDeg: number, pathDeg: number): number => clamp((pitchDeg - pathDeg) * HORIZON_PX_PER_DEG, -(HORIZON_R - 6), HORIZON_R - 6);

const overlay = createFaceCache();

function paintOverlay(ctx: CanvasRenderingContext2D): void {
  const cx = HORIZON_CX;
  const cy = HORIZON_CY;
  for (const m of BANK_MARKS) {
    for (const sign of m === 0 ? [1] : [-1, 1]) {
      const [x0, y0] = polar(sign * m, HORIZON_R - (m % 30 === 0 ? 7 : 4));
      const [x1, y1] = polar(sign * m, HORIZON_R - 1);
      drawLine(ctx, cx + x0, cy + y0, cx + x1, cy + y1, GAUGE_TICK);
    }
  }
  fillArc(ctx, cx, cy, HORIZON_R, HORIZON_R, 0, 360, GAUGE_RING);
  // Fixed wings and center dot.
  for (const s of [-1, 1]) {
    ctx.fillStyle = HORIZON_WINGS;
    ctx.fillRect(s < 0 ? cx - 22 : cx + 9, cy, 14, 2);
    ctx.fillRect(s < 0 ? cx - 22 : cx + 21, cy, 2, 5);
  }
  ctx.fillStyle = HORIZON_WINGS;
  ctx.fillRect(cx - 1, cy - 1, 3, 3);
}

/** Pitch and bank in degrees, `fpmDeg` = pitch - path (null on the ground or after a crash), `label` the pitch and bank numbers. */
export function drawHorizon(ctx: CanvasRenderingContext2D, ox: number, oy: number, pitchDeg: number, bankDeg: number, fpmDeg: number | null, label: string): void {
  const cx = ox + HORIZON_CX;
  const cy = oy + HORIZON_CY;
  const columns = horizonColumns(pitchDeg, bankDeg);
  for (const c of columns) {
    ctx.fillStyle = HORIZON_SKY;
    ctx.fillRect(cx + c.dx, cy + c.top, 1, c.split - c.top);
    ctx.fillStyle = HORIZON_GROUND;
    ctx.fillRect(cx + c.dx, cy + c.split, 1, c.bottom - c.split + 1);
  }
  // The horizon line: a vertical run per column, so steep banks leave no gaps.
  ctx.fillStyle = HORIZON_LINE;
  let prev: number | null = null;
  for (const c of columns) {
    if (c.onLine) {
      const from = prev === null ? c.split : Math.min(prev, c.split);
      const to = prev === null ? c.split : Math.max(prev, c.split);
      ctx.fillRect(cx + c.dx, cy + from, 1, to - from + 1);
      prev = c.split;
    } else prev = null;
  }
  // Ladder, turning with the horizon.
  const b = bankDeg * DEG;
  const d = [Math.cos(b), -Math.sin(b)] as const;
  const n = [Math.sin(b), Math.cos(b)] as const;
  for (const a of RUNGS_DEG) {
    for (const sign of [-1, 1]) {
      const off = (pitchDeg - sign * a) * HORIZON_PX_PER_DEG;
      const half = a % 10 === 0 ? 9 : 4;
      const px = n[0] * off;
      const py = n[1] * off;
      const ends = [px - d[0] * half, py - d[1] * half, px + d[0] * half, py + d[1] * half] as const;
      if (Math.hypot(ends[0], ends[1]) > HORIZON_R - 3 || Math.hypot(ends[2], ends[3]) > HORIZON_R - 3) continue;
      drawLine(ctx, cx + ends[0], cy + ends[1], cx + ends[2], cy + ends[3], HORIZON_LINE);
      if (a % 10 === 0 && Math.hypot(ends[2] + d[0] * 6, ends[3] + d[1] * 6) < HORIZON_R - 4) drawText(ctx, String(a), Math.round(cx + ends[2] + d[0] * 5), Math.round(cy + ends[3] + d[1] * 5) - 2, GAUGE_NUM, '3x5', 'center');
    }
  }
  ctx.drawImage(overlay.get('overlay', paintOverlay), ox, oy);
  // Bank pointer on the fixed scale: it moves the way the plane banks.
  const [bx0, by0] = polar(bankDeg, HORIZON_R - 12);
  const [bx1, by1] = polar(bankDeg, HORIZON_R - 6);
  drawLine(ctx, cx + bx0, cy + by0, cx + bx1, cy + by1, HORIZON_WINGS, 2);
  if (fpmDeg !== null) {
    const my = cy + Math.round(pathMarkerOffsetPx(fpmDeg, 0));
    ctx.fillStyle = PATH_MARKER_COLOR;
    for (const [dx, dy] of [[-2, -3], [-1, -3], [0, -3], [1, -3], [2, -3], [-3, -2], [3, -2], [-3, -1], [3, -1], [-3, 0], [3, 0], [-3, 1], [3, 1], [-3, 2], [3, 2], [-2, 3], [-1, 3], [0, 3], [1, 3], [2, 3]] as const) ctx.fillRect(cx + dx, my + dy, 1, 1);
  }
  drawText(ctx, label, ox + 40, oy + 72, READOUT_VALUE, '5x7', 'center');
}
