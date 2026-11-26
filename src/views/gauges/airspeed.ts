import { ASI_TABLE, DIAL_R, PANEL_CELL, V1_MERGE_KT, VMARK_LABEL_MIN_DEG } from '../../config/display';
import type { VSpeeds } from '../../sim/flight/vspeeds';
import { metersPerSecondToKnots } from '../../sim/units';
import { BUG_COLOR, GAUGE_BG, GAUGE_NEEDLE, GAUGE_NUM, GAUGE_RING, GAUGE_TICK, GAUGE_WINDOW, STALL_COLOR, VMARK_COLOR, VMARK_NEXT_COLOR, WARN_COLOR } from '../../config/palette';
import { createFaceCache, fillArc, polar, quantizeDeg, tableAngle } from './dial';
import { drawLine, drawText, fillDisk } from './pixels';

const C = PANEL_CELL / 2;
const face = createFaceCache();
const arcs = createFaceCache();

const TICK_KT = 20;
const LABELS_KT = [60, 120, 180, 240, 300, 400];

function paintFace(ctx: CanvasRenderingContext2D): void {
  fillDisk(ctx, C, C, DIAL_R, GAUGE_BG);
  fillArc(ctx, C, C, DIAL_R, DIAL_R, 0, 360, GAUGE_RING);
  for (let kt = 0; kt <= 400; kt += TICK_KT) {
    const deg = tableAngle(ASI_TABLE, kt);
    const long = LABELS_KT.includes(kt);
    const [x0, y0] = polar(deg, long ? 25 : 28);
    const [x1, y1] = polar(deg, 32);
    drawLine(ctx, C + x0, C + y0, C + x1, C + y1, GAUGE_TICK);
  }
  for (const kt of LABELS_KT) {
    const [x, y] = polar(tableAngle(ASI_TABLE, kt), 19);
    drawText(ctx, String(kt / 10), Math.round(C + x), Math.round(C + y) - 2, GAUGE_NUM, '3x5', 'center');
  }
}

function paintArcs(ctx: CanvasRenderingContext2D, redKt: number, amberKt: number): void {
  if (redKt <= 0) return;
  fillArc(ctx, C, C, 33, 35, 0, tableAngle(ASI_TABLE, redKt), STALL_COLOR);
  fillArc(ctx, C, C, 33, 35, tableAngle(ASI_TABLE, redKt), tableAngle(ASI_TABLE, amberKt), WARN_COLOR);
}

/** A takeoff speed on the dial rim: V1, VR or V2. */
export interface SpeedMark {
  readonly label: '1' | 'R' | '2';
  /** Dial angle of the speed. */
  readonly deg: number;
  /** Dial angle of the letter: as `deg`, except V1's moves back when it would sit on VR's. */
  readonly labelDeg: number;
  /** The next speed still to be reached. */
  readonly next: boolean;
}

/** True when there is a V1 too close to VR to show apart from it. */
export const v1Merged = (speeds: VSpeeds): boolean => speeds.v1 !== null && metersPerSecondToKnots(speeds.vr - speeds.v1) <= V1_MERGE_KT;

/** Marks for the speeds that exist (no V1 off a runway, nor one merged into VR). `ias` and the speeds are indicated m/s. */
export function speedMarks(speeds: VSpeeds, ias: number): SpeedMark[] {
  const all: readonly (readonly [SpeedMark['label'], number | null])[] = [
    ['1', v1Merged(speeds) ? null : speeds.v1],
    ['R', speeds.vr],
    ['2', speeds.v2],
  ];
  const nextLabel = all.find(([, v]) => v !== null && v > ias)?.[0];
  const angle = (v: number): number => quantizeDeg(tableAngle(ASI_TABLE, metersPerSecondToKnots(v)));
  const vrDeg = angle(speeds.vr);
  const marks: SpeedMark[] = [];
  for (const [label, v] of all) {
    if (v === null) continue;
    const deg = angle(v);
    const labelDeg = label === '1' ? Math.min(deg, vrDeg - VMARK_LABEL_MIN_DEG) : deg;
    marks.push({ label, deg, labelDeg, next: label === nextLabel });
  }
  return marks;
}

function drawMarks(ctx: CanvasRenderingContext2D, ox: number, oy: number, marks: readonly SpeedMark[]): void {
  for (const m of marks) {
    const color = m.next ? VMARK_NEXT_COLOR : VMARK_COLOR;
    const [x0, y0] = polar(m.deg, 31);
    const [x1, y1] = polar(m.deg, 36);
    drawLine(ctx, ox + C + x0, oy + C + y0, ox + C + x1, oy + C + y1, color, 2);
    const [lx, ly] = polar(m.labelDeg, 27);
    const x = Math.round(ox + C + lx);
    const y = Math.round(oy + C + ly);
    ctx.fillStyle = GAUGE_BG;
    ctx.fillRect(x - 3, y - 4, 7, 9);
    drawText(ctx, m.label, x, y - 3, color, '5x7', 'center');
  }
}

/** The airspeed dial in the cell whose top-left corner is (ox, oy). */
export function drawAirspeed(ctx: CanvasRenderingContext2D, ox: number, oy: number, spdDeg: number, redKt: number, amberKt: number, digits: string, bugDeg: number | null = null, marks: readonly SpeedMark[] = []): void {
  ctx.drawImage(face.get('face', paintFace), ox, oy);
  ctx.drawImage(arcs.get(`${redKt}|${amberKt}`, (c) => paintArcs(c, redKt, amberKt)), ox, oy);
  if (bugDeg !== null) {
    const [x0, y0] = polar(bugDeg, 27);
    const [x1, y1] = polar(bugDeg, 35);
    drawLine(ctx, ox + C + x0, oy + C + y0, ox + C + x1, oy + C + y1, BUG_COLOR, 3);
  }
  const w = digits.length * 6 - 1 + 4;
  ctx.fillStyle = GAUGE_WINDOW;
  ctx.fillRect(ox + C - Math.floor(w / 2), oy + C + 3, w, 11);
  drawText(ctx, digits, ox + C, oy + C + 5, GAUGE_NUM, '5x7', 'center');
  drawMarks(ctx, ox, oy, marks);
  const [x, y] = polar(spdDeg, 31);
  drawLine(ctx, ox + C, oy + C, ox + C + x, oy + C + y, GAUGE_NEEDLE, 2);
  fillDisk(ctx, ox + C, oy + C, 2, GAUGE_NEEDLE);
}
