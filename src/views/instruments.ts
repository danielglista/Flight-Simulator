import type { ScaleConfig } from '../config/scales';
import { READOUT_BG, READOUT_LABEL, READOUT_UNIT, READOUT_VALUE, STALL_COLOR, WARN_COLOR } from '../config/palette';
import type { Size } from '../config/display';
import type { Craft } from '../sim/state';
import type { StallState } from '../sim/flight/aero';
import { displayedAltitudeFt, indicatedSpeed, metersPerSecondToKnots, verticalSpeedFpm } from '../sim/units';
import { formatAltitude, formatHeading, formatBank, formatPercent, formatPitch, formatSpeed, formatVerticalSpeed } from './format';

export interface ReadoutText {
  readonly spd: string;
  readonly alt: string;
  readonly hdg: string;
  readonly vs: string;
  readonly pit: string;
  readonly bnk: string;
  readonly thr: string;
  readonly eng: string;
  /** Empty, `STALL` (warning) or `STALL` with `stalled` set. */
  readonly warn: string;
  readonly stalled: boolean;
}

/**
 * The readout strings. Pure; a crashed craft already has speed 0, so SPD and V/S read 0.
 * `SPD` is indicated airspeed. `stall` comes from the caller, which knows about crashes.
 */
export function readoutText(craft: Craft, scale: ScaleConfig, stall: StallState = 'none'): ReadoutText {
  return {
    spd: formatSpeed(metersPerSecondToKnots(indicatedSpeed(craft, scale))),
    alt: formatAltitude(displayedAltitudeFt(craft.z, scale)),
    hdg: formatHeading(craft.heading),
    vs: formatVerticalSpeed(verticalSpeedFpm(craft)),
    pit: formatPitch((craft.pitch * 180) / Math.PI),
    bnk: formatBank((craft.bank * 180) / Math.PI),
    thr: formatPercent(craft.lever),
    eng: formatPercent(craft.spool),
    warn: stall === 'none' ? '' : 'STALL',
    stalled: stall === 'stalled',
  };
}

export const sameReadout = (a: ReadoutText, b: ReadoutText): boolean =>
  a.spd === b.spd && a.alt === b.alt && a.hdg === b.hdg && a.vs === b.vs && a.pit === b.pit && a.bnk === b.bnk && a.thr === b.thr && a.eng === b.eng && a.warn === b.warn && a.stalled === b.stalled;

/** One line for screen readers. */
export const readoutSentence = (t: ReadoutText): string =>
  `Speed ${t.spd} knots, altitude ${t.alt} feet, heading ${t.hdg}, vertical speed ${t.vs} feet per minute, pitch ${t.pit} degrees, bank ${t.bnk}, throttle ${t.thr} percent, engine ${t.eng} percent${t.warn ? (t.stalled ? ', stalled' : ', stall warning') : ''}`;

const FONT = 'ui-monospace, Consolas, monospace';

/** 3 x 3 block of right-aligned numbers, centered in the canvas; the last cell is the stall warning. */
export function drawReadouts(ctx: CanvasRenderingContext2D, size: Size, t: ReadoutText): void {
  ctx.fillStyle = READOUT_BG;
  ctx.fillRect(0, 0, size.width, size.height);
  const cellW = 106;
  const cellH = 44;
  const left = Math.floor((size.width - cellW * 3) / 2);
  const top = Math.floor((size.height - cellH * 3) / 2);
  const cells: readonly (readonly [string, string, string])[] = [
    ['SPD', t.spd, 'kt'],
    ['ALT', t.alt, 'ft'],
    ['V/S', t.vs, 'fpm'],
    ['HDG', t.hdg, 'deg'],
    ['PIT', t.pit, 'deg'],
    ['BNK', t.bnk, 'deg'],
    ['THR', t.thr, '%'],
    ['ENG', t.eng, '%'],
  ];
  ctx.textBaseline = 'alphabetic';
  cells.forEach(([label, value, unit], i) => {
    const x = left + (i % 3) * cellW;
    const y = top + Math.floor(i / 3) * cellH;
    ctx.textAlign = 'left';
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = READOUT_LABEL;
    ctx.fillText(label, x + 4, y + 12);
    ctx.font = `16px ${FONT}`;
    ctx.fillStyle = READOUT_VALUE;
    ctx.textAlign = 'right';
    ctx.fillText(value, x + cellW - 28, y + 34);
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = READOUT_UNIT;
    ctx.textAlign = 'left';
    ctx.fillText(unit, x + cellW - 24, y + 34);
  });
  if (t.warn) {
    const x = left + 2 * cellW;
    const y = top + 2 * cellH;
    ctx.font = `bold 16px ${FONT}`;
    ctx.textAlign = 'center';
    if (t.stalled) {
      ctx.fillStyle = STALL_COLOR;
      ctx.fillRect(x + 6, y + 8, cellW - 12, 28);
      ctx.fillStyle = '#fff';
    } else {
      ctx.fillStyle = WARN_COLOR;
    }
    ctx.fillText(t.warn, x + cellW / 2, y + 28);
  }
}
