import { describe, expect, it } from 'vitest';
import { crashMessage } from '../src/app/crashBanner';
import { SCALES } from '../src/config/scales';
import { heightAt, surfaceAt, groundAt, waterLevelAt } from '../src/sim/world/grid';
import { withAirports } from '../src/sim/world/placeAirports';
import { buildTestAirport } from '../src/sim/world/testAirport';
import { buildTestMap, TEST_MAP_LANDMARKS } from '../src/sim/world/testMap';

describe('crashMessage', () => {
  const grid = withAirports(buildTestMap(), [buildTestAirport(SCALES)]);
  const craft = (x: number, y: number) => ({ x, y, z: heightAt(grid, SCALES, x, y), heading: 0, speed: 0, pathAngle: 0 });
  it('names the mountain with the real height', () => {
    const p = TEST_MAP_LANDMARKS.peak;
    const c = craft((p.col + 0.5) * grid.cellSize, (p.row + 0.5) * grid.cellSize);
    const m = crashMessage(grid, SCALES, c);
    expect(m).toMatch(/^CRASHED: (snow|mountain), 1,\d{3} m - Enter to restart$/);
  });
  it('says water over a lake and a runway on the runway', () => {
    const lc = TEST_MAP_LANDMARKS.lakeCenter;
    const lx = (lc.col + 0.5) * grid.cellSize;
    const ly = (lc.row + 0.5) * grid.cellSize;
    expect(waterLevelAt(grid, SCALES, lx, ly)).toBeGreaterThan(groundAt(grid, SCALES, lx, ly));
    expect(crashMessage(grid, SCALES, craft(lx, ly))).toContain('CRASHED: water,');
    const rw = grid.airports[0]!.runways[0]!;
    const mx = (rw.a.x + rw.b.x) / 2;
    const my = (rw.a.y + rw.b.y) / 2;
    expect(surfaceAt(grid, mx, my)).toBeGreaterThan(0);
    expect(crashMessage(grid, SCALES, craft(mx, my))).toContain('runway 07/25 TST');
  });
});
