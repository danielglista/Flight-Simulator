/** Rasterizing in cell coordinates: x is the column and y is the row, as floats. A cell's center is (col + 0.5, row + 0.5). */
export type CellPoint = readonly [number, number];

/**
 * Even-odd polygon fill over every ring at once, so holes work. Calls `set(index)` for each cell whose
 * center is inside. Edges far outside the grid are fine: they are clipped by row, and still count for parity.
 */
export function fillRings(rings: readonly (readonly CellPoint[])[], cols: number, rows: number, set: (index: number) => void): void {
  // Only rows the rings reach get a crossing list, so many small fills stay cheap.
  let lo = Infinity;
  let hi = -Infinity;
  for (const ring of rings) {
    for (const q of ring) {
      lo = Math.min(lo, q[1]);
      hi = Math.max(hi, q[1]);
    }
  }
  const rowA = Math.max(0, Math.ceil(lo - 0.5));
  const rowB = Math.min(rows - 1, Math.ceil(hi - 0.5) - 1);
  if (rowB < rowA) return;
  const xs: number[][] = [];
  for (let r = rowA; r <= rowB; r++) xs.push([]);
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i] as CellPoint;
      const b = ring[(i + 1) % n] as CellPoint;
      if (a[1] === b[1]) continue;
      const lo = Math.min(a[1], b[1]);
      const hi = Math.max(a[1], b[1]);
      // rows whose center y = r + 0.5 satisfies lo <= y < hi
      const r0 = Math.max(0, Math.ceil(lo - 0.5));
      const r1 = Math.min(rows - 1, Math.ceil(hi - 0.5) - 1);
      const slope = (b[0] - a[0]) / (b[1] - a[1]);
      for (let r = r0; r <= r1; r++) (xs[r - rowA] as number[]).push(a[0] + (r + 0.5 - a[1]) * slope);
    }
  }
  for (let r = rowA; r <= rowB; r++) {
    const row = xs[r - rowA] as number[];
    if (row.length < 2) continue;
    row.sort((p, q) => p - q);
    for (let k = 0; k + 1 < row.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((row[k] as number) - 0.5));
      const c1 = Math.min(cols - 1, Math.ceil((row[k + 1] as number) - 0.5) - 1);
      for (let c = c0; c <= c1; c++) set(r * cols + c);
    }
  }
}

/** Stamp discs of the given width (in cells) along a polyline. */
export function strokePolyline(points: readonly CellPoint[], widthCells: number, cols: number, rows: number, set: (index: number) => void): void {
  const rad = widthCells / 2;
  const stamp = (x: number, y: number): void => {
    const c0 = Math.max(0, Math.floor(x - rad));
    const c1 = Math.min(cols - 1, Math.ceil(x + rad));
    const r0 = Math.max(0, Math.floor(y - rad));
    const r1 = Math.min(rows - 1, Math.ceil(y + rad));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const dx = c + 0.5 - x;
        const dy = r + 0.5 - y;
        if (dx * dx + dy * dy <= rad * rad) set(r * cols + c);
      }
    }
  };
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as CellPoint;
    const b = points[i + 1];
    if (!b) {
      stamp(a[0], a[1]);
      break;
    }
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // Skip segments entirely outside the grid (with room for the width).
    if (Math.max(a[0], b[0]) < -rad || Math.min(a[0], b[0]) > cols + rad || Math.max(a[1], b[1]) < -rad || Math.min(a[1], b[1]) > rows + rad) continue;
    const steps = Math.max(1, Math.ceil(len / 0.5));
    for (let s = 0; s < steps; s++) stamp(a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps);
  }
}
