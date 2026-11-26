import { LANDED_HIDE_SPEED } from '../config/flight';
import type { ScaleConfig } from '../config/scales';
import { landed } from '../sim/flight/ground';
import type { Craft, Crash, SimState, Touchdown } from '../sim/state';
import { displayedAltitudeFt } from '../sim/units';
import { runwayFrame } from '../sim/world/airport';
import { groundAt, runwayAt, waterLevelAt, type WorldGrid } from '../sim/world/grid';
import { formatAltitude } from '../views/format';
import { surfaceName } from '../views/surfaceName';

/** Sink rate shown in feet per minute, unscaled like V/S: m/s x 196.85. */
export const sinkFpm = (sink: number): number => Math.round((sink * 196.85) / 10) * 10;
const withCommas = (n: number): string => n.toLocaleString('en-US');

const CAUSE_TEXT = {
  hard: (sink: number) => `hard landing ${withCommas(sinkFpm(sink))} ft/min`,
  bank: () => 'wing hit the ground',
  nose: () => 'nose-first landing',
  tail: () => 'tail strike',
  overrun: () => 'ran off the end of the airfield',
  gear: () => 'landed without the gear down',
} as const;

/**
 * `CRASHED: mountain, 3,670 ft - Enter to restart`; with a cause other than terrain,
 * `CRASHED: runway 07/25 TST, hard landing 1,240 ft/min - Enter to restart`. The height is displayed feet, as ALT shows it.
 */
export function crashMessage(grid: WorldGrid, scale: ScaleConfig, craft: Craft, crash: Crash | null = null): string {
  const wet = waterLevelAt(grid, scale, craft.x, craft.y) > groundAt(grid, scale, craft.x, craft.y);
  const what = wet ? 'water' : surfaceName(grid, craft.x, craft.y);
  if (crash && crash.cause !== 'terrain') return `CRASHED: ${what}, ${CAUSE_TEXT[crash.cause](crash.sink)} - Enter to restart`;
  const alt = formatAltitude(displayedAltitudeFt(craft.z, scale));
  return `CRASHED: ${what}, ${alt} ft - Enter to restart`;
}

/**
 * `LANDED: runway 07 TST, 380 ft/min, 210 m past threshold, 3 m left - Enter to restart`. The runway end is the one the
 * plane was heading down; off the runway it says where the wheels were. World meters; no grade.
 */
export function landingMessage(grid: WorldGrid, td: Touchdown): string {
  const sink = `${withCommas(sinkFpm(td.sink))} ft/min`;
  const hit = runwayAt(grid, td.x, td.y);
  if (!hit) return `LANDED: ${td.kind === 'grass' ? 'grass' : 'paving'}, off runway, ${sink} - Enter to restart`;
  const rw = hit.runway;
  const { along, across } = runwayFrame(rw, td.x, td.y);
  const ux = (rw.b.x - rw.a.x) / rw.length;
  const uy = (rw.b.y - rw.a.y) / rw.length;
  const forward = Math.sin(td.heading) * ux + Math.cos(td.heading) * uy >= 0;
  const past = Math.round(forward ? along : rw.length - along);
  const right = forward ? across : -across;
  const side = Math.abs(right) < 0.5 ? 'on the center line' : `${Math.round(Math.abs(right))} m ${right > 0 ? 'right' : 'left'}`;
  return `LANDED: runway ${forward ? rw.names[0] : rw.names[1]} ${hit.airport.ident}, ${sink}, ${withCommas(past)} m past threshold, ${side} - Enter to restart`;
}

export interface CrashBanner {
  /** Shows or hides the banner. Touches the page only when something changed. */
  update(state: SimState): void;
}

export function attachCrashBanner(grid: WorldGrid, scale: ScaleConfig): CrashBanner {
  const el = document.getElementById('crash-banner');
  let shownKey: string | null = null;
  return {
    update(state) {
      if (!el) return;
      const { crash, touchdown, craft } = state;
      // The landing banner appears once stopped and goes when the plane rolls on again.
      const wasShowingLanding = shownKey !== null && shownKey.startsWith('L');
      const showLanding = !crash && touchdown !== null && craft.onGround && (landed(state) || (wasShowingLanding && craft.speed < LANDED_HIDE_SPEED));
      const key = crash ? `C${crash.tick}` : showLanding && touchdown ? `L${touchdown.tick}` : null;
      if (key === shownKey) return;
      shownKey = key;
      el.hidden = key === null;
      el.classList.toggle('landed', showLanding);
      if (crash) el.textContent = crashMessage(grid, scale, craft, crash);
      else if (showLanding && touchdown) el.textContent = landingMessage(grid, touchdown);
    },
  };
}
