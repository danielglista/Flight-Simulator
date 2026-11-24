/** Cells per tile side at each noise octave, and the weight of each. All divide into the tile so it wraps. */
const OCTAVES: readonly (readonly [number, number])[] = [
  [4, 0.55],
  [8, 0.3],
  [16, 0.15],
];
/** Noise levels (0..1) where cloud starts, and the alpha of each of the 3 steps above it. */
const CUTOFF = 0.56;
const STEP = 0.1;
const STEP_ALPHA = [96, 176, 255] as const;

/** Deterministic hash of an integer lattice point to 0..1. */
function lattice(x: number, y: number, octave: number, seed: number): number {
  let h = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(octave + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in 0..1 at tile fraction (u, v), `cells` lattice cells per side, wrapping at the edges. */
function noise(u: number, v: number, cells: number, octave: number, seed: number): number {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const at = (ix: number, iy: number) => lattice(ix % cells, iy % cells, octave, seed);
  const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
  const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
  return a + (b - a) * ty;
}

/**
 * Alpha bytes (size x size) of a seamless cloud tile: seeded value noise, posterized to 3 levels above clear.
 * Same seed, same bytes. The left and right edges (and top and bottom) continue into each other.
 */
export function cloudTile(size: number, seed: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let n = 0;
      OCTAVES.forEach(([cells, weight], i) => {
        n += weight * noise(px / size, py / size, cells, i, seed);
      });
      const level = Math.floor((n - CUTOFF) / STEP);
      out[py * size + px] = level < 0 ? 0 : (STEP_ALPHA[Math.min(level, STEP_ALPHA.length - 1)] ?? 255);
    }
  }
  return out;
}
