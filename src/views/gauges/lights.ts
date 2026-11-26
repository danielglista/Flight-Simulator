import { LAMP_GREEN, LAMP_OFF_BG, LAMP_OFF_TEXT, LAMP_TEXT_DARK, READOUT_LABEL, STALL_COLOR, WARN_COLOR } from '../../config/palette';
import { drawText } from './pixels';

export type LampState = 'off' | 'green' | 'amber' | 'red';

/** A lamp: a box with its label, always readable. Color is never the only cue: an unlit lamp is dark. */
export function drawLamp(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, state: LampState): void {
  const bg = state === 'green' ? LAMP_GREEN : state === 'amber' ? WARN_COLOR : state === 'red' ? STALL_COLOR : LAMP_OFF_BG;
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  const text = state === 'off' ? LAMP_OFF_TEXT : state === 'red' ? '#ffffff' : LAMP_TEXT_DARK;
  drawText(ctx, label, x + Math.floor(w / 2), y + Math.floor((h - 7) / 2), text, '5x7', 'center');
}

/** The lamp states of the LIGHTS cell. */
export interface Lights {
  readonly stall: 'off' | 'warning' | 'stalled';
  readonly gear: boolean;
  readonly terr: boolean;
  /** Autopilot (D4): AP is lit green while it holds; each mode is amber while capturing and green once inside its margin. */
  readonly ap: boolean;
  readonly hdg: 'off' | 'amber' | 'green';
  readonly alt: 'off' | 'amber' | 'green';
  readonly spd: 'off' | 'amber' | 'green';
}

/** One place each, so two warnings can show at once. The slot under TERR is left for TRFC (G2). */
export function drawLights(ctx: CanvasRenderingContext2D, ox: number, oy: number, l: Lights): void {
  drawText(ctx, 'LIGHTS', ox + 4, oy + 4, READOUT_LABEL);
  const lamps: readonly (readonly [number, number, string, LampState])[] = [
    [0, 0, 'STALL', l.stall === 'stalled' ? 'red' : l.stall === 'warning' ? 'amber' : 'off'],
    [0, 1, 'GEAR', l.gear ? 'amber' : 'off'],
    [0, 2, 'TERR', l.terr ? 'red' : 'off'],
    [1, 0, 'AP', l.ap ? 'green' : 'off'],
    [1, 1, 'HDG', l.hdg],
    [1, 2, 'ALT', l.alt],
    [1, 3, 'SPD', l.spd],
  ];
  for (const [col, row, label, state] of lamps) drawLamp(ctx, ox + 4 + col * 38, oy + 16 + row * 15, 34, 11, label, state);
}
