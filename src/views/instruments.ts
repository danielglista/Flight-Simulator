import type { ScaleConfig } from '../config/scales';
import { READOUT_BG, READOUT_LABEL, READOUT_UNIT, READOUT_VALUE } from '../config/palette';
import type { Size } from '../config/display';
import type { Craft } from '../sim/state';
import { displayedAltitudeFt, metersPerSecondToKnots, verticalSpeedFpm } from '../sim/units';
import { formatAltitude, formatHeading, formatPercent, formatSpeed, formatVerticalSpeed } from './format';

export interface ReadoutText {
  readonly spd: string;
  readonly alt: string;
  readonly hdg: string;
  readonly vs: string;
  readonly thr: string;
  readonly eng: string;
}

/** The six readout strings. Pure; a crashed craft already has speed 0, so SPD and V/S read 0. */
export function readoutText(craft: Craft, scale: ScaleConfig): ReadoutText {
  return {
    spd: formatSpeed(metersPerSecondToKnots(craft.speed)),
    alt: formatAltitude(displayedAltitudeFt(craft.z, scale)),
    hdg: formatHeading(craft.heading),
    vs: formatVerticalSpeed(verticalSpeedFpm(craft)),
    thr: formatPercent(craft.lever),
    eng: formatPercent(craft.spool),
  };
}

export const sameReadout = (a: ReadoutText, b: ReadoutText): boolean =>
  a.spd === b.spd && a.alt === b.alt && a.hdg === b.hdg && a.vs === b.vs && a.thr === b.thr && a.eng === b.eng;

/** One line for screen readers. */
export const readoutSentence = (t: ReadoutText): string =>
  `Speed ${t.spd} knots, altitude ${t.alt} feet, heading ${t.hdg}, vertical speed ${t.vs} feet per minute, throttle ${t.thr} percent, engine ${t.eng} percent`;

const FONT = 'ui-monospace, Consolas, monospace';

/** 2 x 3 block of right-aligned numbers, centered in the canvas. */
export function drawReadouts(ctx: CanvasRenderingContext2D, size: Size, t: ReadoutText): void {
  ctx.fillStyle = READOUT_BG;
  ctx.fillRect(0, 0, size.width, size.height);
  const cellW = 130;
  const cellH = 44;
  const left = Math.floor((size.width - cellW * 2) / 2);
  const top = Math.floor((size.height - cellH * 3) / 2);
  const cells: readonly (readonly [string, string, string])[] = [
    ['SPD', t.spd, 'kt'],
    ['ALT', t.alt, 'ft'],
    ['HDG', t.hdg, 'deg'],
    ['V/S', t.vs, 'fpm'],
    ['THR', t.thr, '%'],
    ['ENG', t.eng, '%'],
  ];
  ctx.textBaseline = 'alphabetic';
  cells.forEach(([label, value, unit], i) => {
    const x = left + (i % 2) * cellW;
    const y = top + Math.floor(i / 2) * cellH;
    ctx.textAlign = 'left';
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = READOUT_LABEL;
    ctx.fillText(label, x + 4, y + 12);
    ctx.font = `20px ${FONT}`;
    ctx.fillStyle = READOUT_VALUE;
    ctx.textAlign = 'right';
    ctx.fillText(value, x + cellW - 30, y + 36);
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = READOUT_UNIT;
    ctx.textAlign = 'left';
    ctx.fillText(unit, x + cellW - 26, y + 36);
  });
}
