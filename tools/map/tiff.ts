/**
 * Decode one tile of a GeoTIFF with 32-bit float samples, deflate compression and the floating-point
 * predictor (TIFF predictor 3), after it has been inflated. Pure: no Node imports.
 *
 * Each row is stored as byte planes (all most significant bytes, then the next, ...), with a byte-wise
 * running difference over the whole row.
 */
export function decodeFloatPredictorTile(inflated: Uint8Array, width: number, height: number): Float32Array {
  const rowBytes = width * 4;
  if (inflated.length < rowBytes * height) throw new Error(`tile is ${inflated.length} bytes, expected ${rowBytes * height}`);
  const out = new Float32Array(width * height);
  const view = new DataView(new ArrayBuffer(4));
  const row = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y++) {
    const base = y * rowBytes;
    let acc = 0;
    for (let i = 0; i < rowBytes; i++) {
      acc = (acc + (inflated[base + i] as number)) & 0xff;
      row[i] = acc;
    }
    for (let x = 0; x < width; x++) {
      view.setUint8(0, row[x] as number);
      view.setUint8(1, row[width + x] as number);
      view.setUint8(2, row[2 * width + x] as number);
      view.setUint8(3, row[3 * width + x] as number);
      out[y * width + x] = view.getFloat32(0, false);
    }
  }
  return out;
}

/** A rectangle of elevation samples on a regular lat/lon grid, sampled bilinearly. */
export interface ElevationGrid {
  readonly cols: number;
  readonly rows: number;
  /** Row 0 is the northernmost. Meters. */
  readonly data: Float32Array;
  /** Longitude of the western edge and latitude of the northern edge, degrees. */
  readonly west: number;
  readonly north: number;
  /** Degrees per sample. */
  readonly step: number;
}

/** Catmull-Rom weights for four neighbors, t in 0..1 between the middle two. */
function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

/**
 * Bicubic (Catmull-Rom) sample at a degree position; samples are centered in their cells. Clamps at the
 * edges. Smoother than bilinear, so stretching the data in a city core shows no creases.
 */
export function sampleElevation(g: ElevationGrid, lat: number, lon: number): number {
  const fx = (lon - g.west) / g.step - 0.5;
  const fy = (g.north - lat) / g.step - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const at = (x: number, y: number): number => g.data[Math.max(0, Math.min(g.rows - 1, y)) * g.cols + Math.max(0, Math.min(g.cols - 1, x))] as number;
  const row = (y: number): number => cubic(at(x0 - 1, y), at(x0, y), at(x0 + 1, y), at(x0 + 2, y), tx);
  return cubic(row(y0 - 1), row(y0), row(y0 + 1), row(y0 + 2), ty);
}
