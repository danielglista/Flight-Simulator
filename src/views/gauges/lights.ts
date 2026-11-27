import { LAMP_GREEN, LAMP_OFF_BG, LAMP_OFF_TEXT, LAMP_TEXT_DARK, STALL_COLOR, WARN_COLOR } from '../../config/palette';
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

/** The lamp states of the lights strip. */
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

/** Where lamp `i` sits in the strip, from the strip's top left: x, y, width, height. */
export const lampRect = (i: number): readonly [number, number, number, number] => [6 + i * 56, 9, 50, 14];

/** The lamps that are also buttons (the autopilot modes), by place in the strip. */
export const MODE_LAMPS = [
  { mode: 'hdg', index: 4, name: 'Heading hold' },
  { mode: 'alt', index: 5, name: 'Altitude hold' },
  { mode: 'spd', index: 6, name: 'Speed hold' },
] as const;

/** One place each in a strip, so several warnings can show at once. TRFC (G2) has no slot yet. */
export function drawLights(ctx: CanvasRenderingContext2D, ox: number, oy: number, l: Lights): void {
  const lamps: readonly (readonly [string, LampState])[] = [
    ['STALL', l.stall === 'stalled' ? 'red' : l.stall === 'warning' ? 'amber' : 'off'],
    ['GEAR', l.gear ? 'amber' : 'off'],
    ['TERR', l.terr ? 'red' : 'off'],
    ['AP', l.ap ? 'green' : 'off'],
    ['HDG', l.hdg],
    ['ALT', l.alt],
    ['SPD', l.spd],
  ];
  lamps.forEach(([label, state], i) => {
    const [x, y, w, h] = lampRect(i);
    drawLamp(ctx, ox + x, oy + y, w, h, label, state);
  });
}
