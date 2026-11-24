import { runwayNumber, type Airport } from './airport';
import { cellIndex, worldHeight, worldWidth, type WorldGrid } from './grid';
import { Terrain } from './terrain';

const EPS = 1e-6;

function check(ok: boolean, a: Airport, what: string): void {
  if (!ok) throw new Error(`Airport ${a.ident}: ${what}`);
}

/** Throws, naming the airport, if it cannot sit on this grid. */
export function validateAirport(grid: WorldGrid, a: Airport, others: readonly Airport[] = []): void {
  check(a.blend > 0, a, 'blend must be positive');
  check(a.cellSize > 0 && a.cols > 0 && a.rows > 0, a, 'fine grid must have cells');
  check(a.surface.length === a.cols * a.rows, a, 'surface size does not match cols x rows');
  check(
    Math.abs(a.cols * a.cellSize - (a.maxX - a.minX)) < EPS &&
      Math.abs(a.rows * a.cellSize - (a.maxY - a.minY)) < EPS,
    a,
    'fine grid does not cover the boundary',
  );
  check(
    a.minX >= 0 && a.minY >= 0 && a.maxX <= worldWidth(grid) && a.maxY <= worldHeight(grid),
    a,
    'boundary is outside the map',
  );
  check(
    2 * a.blend < a.maxX - a.minX && 2 * a.blend < a.maxY - a.minY,
    a,
    'blend band leaves no flat interior',
  );
  for (const o of others) {
    const apart = a.maxX < o.minX || o.maxX < a.minX || a.maxY < o.minY || o.maxY < a.minY;
    check(apart, a, `boundary overlaps airport ${o.ident}`);
  }

  // Everything paved must lie on the flat interior, so surfaces and heights agree.
  const lo = { x: a.minX + a.blend - EPS, y: a.minY + a.blend - EPS };
  const hi = { x: a.maxX - a.blend + EPS, y: a.maxY - a.blend + EPS };
  const inside = (x: number, y: number): boolean => x >= lo.x && x <= hi.x && y >= lo.y && y <= hi.y;
  for (let r = 0; r < a.rows; r++) {
    for (let c = 0; c < a.cols; c++) {
      if (a.surface[r * a.cols + c] === Terrain.grass) continue;
      const x0 = a.minX + c * a.cellSize;
      const y0 = a.minY + r * a.cellSize;
      check(
        inside(x0, y0) && inside(x0 + a.cellSize, y0 + a.cellSize),
        a,
        `paving at cell ${c},${r} reaches the blend band`,
      );
    }
  }

  check(a.runways.length > 0, a, 'has no runways');
  for (const rw of a.runways) {
    const label = `runway ${rw.names.join('/')}`;
    check(rw.length > 0 && rw.width > 0, a, `${label} has no size`);
    const ux = (rw.b.x - rw.a.x) / rw.length;
    const uy = (rw.b.y - rw.a.y) / rw.length;
    const hw = rw.width / 2;
    for (const [px, py] of [
      [rw.a.x + uy * hw, rw.a.y - ux * hw],
      [rw.a.x - uy * hw, rw.a.y + ux * hw],
      [rw.b.x + uy * hw, rw.b.y - ux * hw],
      [rw.b.x - uy * hw, rw.b.y + ux * hw],
    ] as const) {
      check(inside(px, py), a, `${label} reaches the blend band or the boundary`);
    }
    const first = runwayNumber(rw.heading);
    const second = runwayNumber(rw.heading + Math.PI);
    check(rw.names[0] === first, a, `${label}: name ${rw.names[0]} does not match heading (${first})`);
    check(rw.names[1] === second, a, `${label}: name ${rw.names[1]} is not the reciprocal (${second})`);
  }

  // Dry base ground under the whole boundary.
  const c0 = Math.max(0, Math.floor(a.minX / grid.cellSize));
  const c1 = Math.min(grid.cols - 1, Math.floor((a.maxX - EPS) / grid.cellSize));
  const r0 = Math.max(0, Math.floor(a.minY / grid.cellSize));
  const r1 = Math.min(grid.rows - 1, Math.floor((a.maxY - EPS) / grid.cellSize));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const i = cellIndex(grid, c, r);
      check(
        (grid.elevation[i] ?? 0) >= 0 && (grid.water[i] ?? 0) === 0,
        a,
        `base ground is wet at cell ${c},${r}`,
      );
    }
  }
}

/** A copy of `grid` with these airports laid over it. Shares the base arrays. Throws if any is invalid. */
export function withAirports(grid: WorldGrid, airports: readonly Airport[]): WorldGrid {
  airports.forEach((a, i) => validateAirport(grid, a, airports.slice(0, i)));
  return { ...grid, airports };
}
