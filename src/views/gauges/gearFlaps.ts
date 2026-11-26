import { BAR_ENGINE, BAR_LEVER, GAUGE_BG, GAUGE_RING, READOUT_LABEL, READOUT_UNIT } from '../../config/palette';
import { drawLamp, type LampState } from './lights';
import { drawText } from './pixels';

const TRACK_X = 30;
const TRACK_TOP = 28;
const NOTCH = 16;

export interface ConfigState {
  /** 0, 1 or 2. */
  readonly flapLever: number;
  /** Actual flaps, 0..1. */
  readonly flaps: number;
  /** Actual gear, 0 (up) to 1 (down), and where the lever is. */
  readonly gear: number;
  readonly gearLever: boolean;
  readonly brake: boolean;
  readonly spoilers: boolean;
}

/** Flap lever with UP, 1, 2 notches and a bar for the real position; gear lamp with a lever mark; BRK and SPL lamps (on the ground only). */
export function drawConfig(ctx: CanvasRenderingContext2D, ox: number, oy: number, c: ConfigState): void {
  drawText(ctx, 'CONFIG', ox + 4, oy + 4, READOUT_LABEL);
  drawText(ctx, 'FLP', ox + 4, oy + 15, READOUT_UNIT);
  ctx.fillStyle = GAUGE_RING;
  ctx.fillRect(ox + TRACK_X, oy + TRACK_TOP, 1, NOTCH * 2 + 1);
  ['UP', '1', '2'].forEach((label, i) => {
    ctx.fillRect(ox + TRACK_X - 2, oy + TRACK_TOP + i * NOTCH, 5, 1);
    drawText(ctx, label, ox + 4, oy + TRACK_TOP + i * NOTCH - 3, READOUT_UNIT);
  });
  // The real position: a bar beside the track, filled from the UP notch down.
  ctx.fillStyle = GAUGE_BG;
  ctx.fillRect(ox + 37, oy + TRACK_TOP, 4, NOTCH * 2 + 1);
  ctx.fillStyle = BAR_ENGINE;
  const travel = Math.round(Math.min(1, Math.max(0, c.flaps)) * NOTCH * 2);
  ctx.fillRect(ox + 37, oy + TRACK_TOP, 4, travel);
  ctx.fillStyle = BAR_LEVER;
  ctx.fillRect(ox + TRACK_X - 4, oy + TRACK_TOP + c.flapLever * NOTCH - 2, 9, 5);

  drawText(ctx, 'GEAR', ox + 46, oy + 15, READOUT_UNIT);
  const state: LampState = c.gear >= 1 ? 'green' : c.gear <= 0 ? 'off' : 'amber';
  drawLamp(ctx, ox + 46, oy + 26, 20, 14, c.gear >= 1 ? 'DN' : c.gear <= 0 ? 'UP' : '--', state);
  // Lever slot: the handle is at the top for up, the bottom for down.
  ctx.fillStyle = GAUGE_RING;
  ctx.fillRect(ox + 71, oy + 26, 1, 14);
  ctx.fillStyle = BAR_LEVER;
  ctx.fillRect(ox + 69, oy + (c.gearLever ? 35 : 26), 5, 5);

  drawLamp(ctx, ox + 46, oy + 48, 21, 11, 'BRK', c.brake ? 'amber' : 'off');
  drawLamp(ctx, ox + 46, oy + 62, 21, 11, 'SPL', c.spoilers ? 'amber' : 'off');
}
