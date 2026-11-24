import { describe, expect, it } from 'vitest';
import { SCALES } from '../src/config/scales';
import { TERRAIN_COLORS } from '../src/config/palette';
import { fineSurfaceAt } from '../src/sim/world/airport';
import { surfaceAt } from '../src/sim/world/grid';
import { withAirports } from '../src/sim/world/placeAirports';
import { buildTestAirport } from '../src/sim/world/testAirport';
import { buildTestMap } from '../src/sim/world/testMap';
import { bakePatch, frameX, frameY } from '../src/views/airportLayer';
import { ZOOM_LEVELS } from '../src/views/camera';
import { tinted } from '../src/views/terrainColors';
import { surfaceName } from '../src/views/surfaceName';

const air = buildTestAirport(SCALES);
const grid = withAirports(buildTestMap(), [air]);

describe('bakePatch', () => {
  for (const mpp of ZOOM_LEVELS.filter((m) => m <= 10)) {
    it(`matches the surface at every pixel center at ${mpp} m/px`, () => {
      const p = bakePatch(air, mpp);
      expect(p.width).toBe(Math.ceil((air.maxX - air.minX) / mpp));
      let checked = 0;
      for (let py = 0; py < p.height; py += 3) {
        for (let px = 0; px < p.width; px += 3) {
          const x = air.minX + (px + 0.5) * mpp;
          const y = air.maxY - (py + 0.5) * mpp;
          const want = tinted(TERRAIN_COLORS[fineSurfaceAt(air, x, y)] as [number, number, number], air.fieldElevationM);
          const o = (py * p.width + px) * 4;
          expect([p.data[o], p.data[o + 1], p.data[o + 2], p.data[o + 3]]).toEqual([
            Math.round(want[0]),
            Math.round(want[1]),
            Math.round(want[2]),
            255,
          ]);
          // Off the runway, the fine code is also what surfaceAt says.
          const code = surfaceAt(grid, x, y);
          if (code !== 10) expect(code).toBe(fineSurfaceAt(air, x, y));
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(100);
    });
  }
  it('is transparent past the boundary', () => {
    const p = bakePatch(air, 11); // 1400 / 11 is not whole, so the last pixels overhang
    const lastCol = p.width - 1;
    const x = air.minX + (lastCol + 0.5) * 11;
    expect(x).toBeGreaterThan(air.maxX);
    expect(p.data[(0 * p.width + lastCol) * 4 + 3]).toBe(0);
    expect(p.data[3]).toBe(255);
  });
  it('shows the flipped-grid check: apron is in the northern half of the picture', () => {
    const p = bakePatch(air, 5);
    const at = (x: number, y: number) => {
      const px = Math.floor((x - air.minX) / 5);
      const py = Math.floor((air.maxY - y) / 5);
      return (py * p.width + px) * 4;
    };
    const apron = TERRAIN_COLORS[9] as [number, number, number];
    const north = at(2560, 955 + 165);
    const south = at(2560, 955 - 165);
    expect(p.data[north]).toBe(Math.round(tinted(apron, 30)[0]));
    expect(p.data[south]).not.toBe(p.data[north]);
  });
});

describe('map frame', () => {
  it('puts north at a smaller y', () => {
    const f = { ox: 10, oy: 20, mpp: 5, mapHeight: 5120 };
    expect(frameY(f, 5120)).toBe(20);
    expect(frameY(f, 0)).toBe(20 + 1024);
    expect(frameX(f, 100)).toBe(30);
  });
});

describe('surfaceName', () => {
  it('names the runway with its ends and airport', () => {
    const rw = air.runways[0]!;
    expect(surfaceName(grid, (rw.a.x + rw.b.x) / 2, (rw.a.y + rw.b.y) / 2)).toBe('runway 07/25 TST');
    expect(surfaceName(grid, 2560, 955 + 165)).toBe('apron');
    expect(surfaceName(grid, 100, 100)).toBe('seabed');
  });
});
