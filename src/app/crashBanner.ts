import type { ScaleConfig } from '../config/scales';
import type { Craft, Crash } from '../sim/state';
import { displayedAltitudeFt } from '../sim/units';
import { groundAt, waterLevelAt, type WorldGrid } from '../sim/world/grid';
import { formatAltitude } from '../views/format';
import { surfaceName } from '../views/surfaceName';

/** `CRASHED: mountain, 3,670 ft - Enter to restart`. The height is displayed feet, as ALT shows it. */
export function crashMessage(grid: WorldGrid, scale: ScaleConfig, craft: Craft): string {
  const wet = waterLevelAt(grid, scale, craft.x, craft.y) > groundAt(grid, scale, craft.x, craft.y);
  const what = wet ? 'water' : surfaceName(grid, craft.x, craft.y);
  const alt = formatAltitude(displayedAltitudeFt(craft.z, scale));
  return `CRASHED: ${what}, ${alt} ft - Enter to restart`;
}

export interface CrashBanner {
  /** Shows or hides the banner. Touches the page only when something changed. */
  update(crash: Crash | null, craft: Craft): void;
}

export function attachCrashBanner(grid: WorldGrid, scale: ScaleConfig): CrashBanner {
  const el = document.getElementById('crash-banner');
  let shownTick: number | null = null;
  return {
    update(crash, craft) {
      if (!el) return;
      const tick = crash ? crash.tick : null;
      if (tick === shownTick) return;
      shownTick = tick;
      el.hidden = !crash;
      if (crash) el.textContent = crashMessage(grid, scale, craft);
    },
  };
}
