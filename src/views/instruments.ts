import type { ScaleConfig } from '../config/scales';
import { CALLOUT_BG, CALLOUT_COLOR, CALLOUT_PROMPT_COLOR, PANEL_LINE, READOUT_BG } from '../config/palette';
import { CALLOUT_TEXT_SCALE, N1_IDLE_PCT, HSI_SIZE, PANEL_CELL, PANEL_COLS, PANEL_H, PANEL_ROWS, PANEL_W, VS_MODE, type Size, type VsMode } from '../config/display';
import type { Craft } from '../sim/state';
import { spoilersOut } from '../sim/flight/ground';
import type { StallState } from '../sim/flight/aero';
import { altimeterVerticalSpeedFpm, displayedAltitudeFt, indicatedSpeed, metersPerSecondToKnots, verticalSpeedFpm } from '../sim/units';
import { drawAirspeed } from './gauges/airspeed';
import { drawAltimeter } from './gauges/altimeter';
import { drawHsi } from './gauges/hsi';
import { drawHorizon } from './gauges/horizon';
import { drawConfig } from './gauges/gearFlaps';
import { drawLights } from './gauges/lights';
import { drawPower } from './gauges/power';
import { drawText, textHeight, textWidth } from './gauges/pixels';
import { drawVsi } from './gauges/vsi';
import type { PanelState } from './panelState';
import { formatAltitude, formatHeading, formatBank, formatPitch, formatSpeed, formatVerticalSpeed, powerPct } from './format';

export interface ReadoutText {
  readonly spd: string;
  readonly alt: string;
  readonly hdg: string;
  readonly vs: string;
  readonly pit: string;
  readonly bnk: string;
  readonly thr: string;
  readonly eng: string;
  /** `UP`, `DN`, or `--` while the gear moves (C4B). */
  readonly gear: string;
  /** `UP`, `1`, `2`, with `>` while the flaps move (C6). */
  readonly flp: string;
  /** `ON` while the wheel brakes are held, `SPL` while the ground spoilers are out, both as `ON SPL`; blank otherwise (C5). */
  readonly brk: string;
  /** The warning the sentence names: empty, `STALL` (warning, or stalled with `stalled` set), `TERR` or `GEAR`, in that priority. The panel's lamps show each one on its own. */
  readonly warn: string;
  readonly stalled: boolean;
}

/**
 * The readout strings. Pure; a crashed craft already has speed 0, so SPD and V/S read 0.
 * `SPD` is indicated airspeed. `stall` comes from the caller, which knows about crashes.
 */
export function readoutText(craft: Craft, scale: ScaleConfig, stall: StallState = 'none', braking = false, gearWarn = false, vsMode: VsMode = VS_MODE.mode, terr = false): ReadoutText {
  return {
    spd: formatSpeed(metersPerSecondToKnots(indicatedSpeed(craft, scale))),
    alt: formatAltitude(displayedAltitudeFt(craft.z, scale)),
    hdg: formatHeading(craft.heading),
    vs: formatVerticalSpeed(vsMode === 'altimeter' ? altimeterVerticalSpeedFpm(craft, scale) : verticalSpeedFpm(craft)),
    pit: formatPitch((craft.pitch * 180) / Math.PI),
    bnk: formatBank((craft.bank * 180) / Math.PI),
    thr: String(powerPct(craft.lever)),
    eng: String(powerPct(craft.spool)),
    gear: craft.gear >= 1 ? 'DN' : craft.gear <= 0 ? 'UP' : '--',
    brk: brakeText(craft, braking),
    flp: flapText(craft),
    warn: stall !== 'none' ? 'STALL' : terr ? 'TERR' : gearWarn ? 'GEAR' : '',
    stalled: stall === 'stalled',
  };
}

/** The FLP cell: the lever step, with `>` while the flaps are still travelling to it. */
export function flapText(craft: Pick<Craft, 'flapLever' | 'flaps'>): string {
  const label = craft.flapLever === 0 ? 'UP' : String(craft.flapLever);
  return Math.abs(craft.flaps - craft.flapLever / 2) > 1e-9 ? `>${label}` : label;
}

/** The BRK cell: brakes only count on the ground; spoilers show once the plane is rolling (they are out at idle on the wheels). */
export function brakeText(craft: Pick<Craft, 'onGround' | 'lever' | 'speed'>, braking: boolean): string {
  if (!craft.onGround) return '';
  const parts = [braking ? 'ON' : '', spoilersOut(craft.lever) && craft.speed > 1 ? 'SPL' : ''].filter(Boolean);
  return parts.join(' ');
}

export const sameReadout = (a: ReadoutText, b: ReadoutText): boolean =>
  a.spd === b.spd && a.alt === b.alt && a.hdg === b.hdg && a.vs === b.vs && a.pit === b.pit && a.bnk === b.bnk && a.thr === b.thr && a.eng === b.eng && a.gear === b.gear && a.brk === b.brk && a.flp === b.flp && a.warn === b.warn && a.stalled === b.stalled;

const powerWords = (v: string): string => (v === String(N1_IDLE_PCT) ? 'idle' : `${v} percent`);

/** One line for screen readers. */
export const readoutSentence = (t: ReadoutText): string =>
  `Speed ${t.spd} knots, altitude ${t.alt} feet, heading ${t.hdg}, vertical speed ${t.vs} feet per minute, pitch ${t.pit} degrees, bank ${t.bnk}, throttle ${powerWords(t.thr)}, engine ${powerWords(t.eng)}, ${t.brk ? `brakes ${t.brk}, ` : ''}flaps ${t.flp === 'UP' ? 'up' : t.flp.replace('>', 'moving to ')}, gear ${t.gear === 'DN' ? 'down' : t.gear === 'UP' ? 'up' : 'moving'}${t.warn === 'GEAR' ? ', gear warning' : t.warn === 'TERR' ? ', terrain warning' : t.warn ? (t.stalled ? ', stalled' : ', stall warning') : ''}`;

/** Top-left corner of the instrument block, centered in the canvas. */
export const panelOrigin = (size: Size): { readonly left: number; readonly top: number } => ({
  left: Math.floor((size.width - PANEL_W) / 2),
  top: Math.floor((size.height - PANEL_H) / 2),
});

/** Where the HSI starts (its side is HSI_SIZE). Clicking it opens the runway menu (D5C). */
export function hsiOrigin(size: Size): readonly [number, number] {
  const { left, top } = panelOrigin(size);
  return [left + PANEL_CELL * PANEL_COLS, top];
}

/**
 * The panel, centered:
 *   POWER  | SPD | horizon |
 *   CONFIG | ALT | V/S     | HSI (two cells square)
 *   lamps strip, full width
 */
export function drawPanel(ctx: CanvasRenderingContext2D, size: Size, s: PanelState): void {
  ctx.fillStyle = READOUT_BG;
  ctx.fillRect(0, 0, size.width, size.height);
  const { left, top } = panelOrigin(size);
  const cell = (col: number, row: number): readonly [number, number] => [left + col * PANEL_CELL, top + row * PANEL_CELL];
  const t = s.text;

  ctx.fillStyle = PANEL_LINE;
  for (let c = 0; c <= PANEL_COLS; c++) ctx.fillRect(left + c * PANEL_CELL, top, 1, HSI_SIZE);
  for (let r = 0; r < PANEL_ROWS; r++) ctx.fillRect(left, top + r * PANEL_CELL, PANEL_CELL * PANEL_COLS, 1);
  ctx.fillRect(left + PANEL_W - 1, top, 1, PANEL_H);
  ctx.fillRect(left, top, 1, PANEL_H);
  for (const y of [0, HSI_SIZE, PANEL_H - 1]) ctx.fillRect(left, top + y, PANEL_W, 1);

  drawAirspeed(ctx, ...cell(1, 0), s.spdDeg, s.stallRedKt, s.stallAmberKt, t.spd, s.spdBugDeg, s.speedMarks);
  drawHorizon(ctx, ...cell(2, 0), s.pitchDeg, s.bankDeg, s.fpmDeg, `${t.pit} ${t.bnk}`);
  drawConfig(ctx, ...cell(0, 1), s.config);
  drawPower(ctx, ...cell(0, 0), s.leverPct, s.enginePct);
  drawAltimeter(ctx, ...cell(1, 1), s.altLongDeg, s.altShortDeg, t.alt.replace(',', ''), s.altBugDeg);
  drawVsi(ctx, ...cell(2, 1), s.vsDeg, s.vsMode, t.vs);
  drawHsi(ctx, ...hsiOrigin(size), s.headingDeg, s.headingBug, t.hdg, s.hsi);
  drawLights(ctx, left, top + HSI_SIZE, s.lights);
  // Last, over the top of the speed dial and horizon: not in the lamps, so it does not read as a fault.
  if (s.callout) drawCallout(ctx, left + PANEL_CELL * 2, top + 1, s.callout, s.gearPrompt);
}

/** The takeoff call-out: large text centered on `cx`, with GEAR UP under it when asked for. */
function drawCallout(ctx: CanvasRenderingContext2D, cx: number, y: number, text: string, gearUp: boolean): void {
  const k = CALLOUT_TEXT_SCALE;
  const w = textWidth(text) * k;
  const h = textHeight() * k;
  const x = cx - Math.floor(w / 2);
  ctx.fillStyle = CALLOUT_BG;
  ctx.fillRect(x - 2, y, w + 4, h + 4);
  ctx.save();
  ctx.translate(x, y + 2);
  ctx.scale(k, k);
  drawText(ctx, text, 0, 0, CALLOUT_COLOR);
  ctx.restore();
  if (!gearUp) return;
  const prompt = 'GEAR UP';
  const pw = textWidth(prompt);
  ctx.fillStyle = CALLOUT_BG;
  ctx.fillRect(cx - Math.floor(pw / 2) - 3, y + h + 4, pw + 6, textHeight() + 4);
  drawText(ctx, prompt, cx, y + h + 6, CALLOUT_PROMPT_COLOR, '5x7', 'center');
}
