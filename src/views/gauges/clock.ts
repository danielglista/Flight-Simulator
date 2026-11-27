import { CLOCK_DAY_MIN, CLOCK_SUNRISE_MIN, DAY_STEPS } from '../../config/sun';
import { GAUGE_NEEDLE_SHORT, GAUGE_NUM, GAUGE_RING, READOUT_LABEL } from '../../config/palette';
import { drawText, fillDisk } from './pixels';

/** Where the clock starts in the lamps strip (the divider line), and its center, from the strip's left. */
export const CLOCK_LEFT = 340;
const CENTER_X = 370;
/** The sun's arc, from the strip's top: its horizon row and radii. */
const ARC_BASE = 17;
const ARC_RX = 23;
const ARC_RY = 13;
const ARC_DOTS = 18;
const DIGITS_Y = 22;

/** The time shown, whole minutes since midnight, for a time of day in sim steps since sunrise. */
export const clockMinutes = (time: number): number => CLOCK_SUNRISE_MIN + Math.floor((time * CLOCK_DAY_MIN) / DAY_STEPS);

/** `HH:MM`, 24-hour. */
export const clockText = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** The sun's center in the strip: left at sunrise, highest at noon, right at sunset. */
export function sunSpot(minutes: number): readonly [number, number] {
  const a = Math.PI * Math.min(1, Math.max(0, (minutes - CLOCK_SUNRISE_MIN) / CLOCK_DAY_MIN));
  return [Math.round(CENTER_X - ARC_RX * Math.cos(a)), Math.round(ARC_BASE - ARC_RY * Math.sin(a))];
}

/** The clock (E8): the sun on a dotted arc from sunrise to sunset, with the time under it. */
export function drawClock(ctx: CanvasRenderingContext2D, stripX: number, stripY: number, minutes: number): void {
  ctx.fillStyle = READOUT_LABEL;
  for (let i = 0; i <= ARC_DOTS; i++) {
    const [x, y] = sunSpot(CLOCK_SUNRISE_MIN + (i * CLOCK_DAY_MIN) / ARC_DOTS);
    ctx.fillRect(stripX + x, stripY + y, 1, 1);
  }
  ctx.fillStyle = GAUGE_RING;
  ctx.fillRect(stripX + CENTER_X - ARC_RX - 3, stripY + ARC_BASE + 1, 2 * ARC_RX + 7, 1);
  const [sx, sy] = sunSpot(minutes);
  fillDisk(ctx, stripX + sx, stripY + sy, 2, GAUGE_NEEDLE_SHORT);
  drawText(ctx, clockText(minutes), stripX + CENTER_X, stripY + DIGITS_Y, GAUGE_NUM, '5x7', 'center');
}
