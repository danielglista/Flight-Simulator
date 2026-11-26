/** Just enough of the ESRI shapefile format for TIGER/Line roads: polyline shapes (`.shp`) and their text fields (`.dbf`). */

export interface ShapeLine {
  readonly name: string;
  /** Lon, lat. A shape with several parts gives one line per part. */
  readonly line: readonly (readonly [number, number])[];
}

const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** The values of one text field, in record order. */
export function readDbfField(dbf: Uint8Array, field: string): string[] {
  const v = view(dbf);
  const count = v.getUint32(4, true);
  const headLen = v.getUint16(8, true);
  const recordLen = v.getUint16(10, true);
  const text = new TextDecoder();
  let offset = 1; // each record starts with a deletion flag
  let width = 0;
  for (let at = 32; dbf[at] !== 0x0d && at < headLen; at += 32) {
    const name = text.decode(dbf.subarray(at, at + 11)).split('\0')[0];
    const len = dbf[at + 16] as number;
    if (name === field) {
      width = len;
      break;
    }
    offset += len;
  }
  if (width === 0) throw new Error(`dbf has no field ${field}`);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const at = headLen + i * recordLen + offset;
    out.push(text.decode(dbf.subarray(at, at + width)).trim());
  }
  return out;
}

/** Every polyline whose record `keep` accepts, with its record number (0-based) matching the dbf. */
export function readPolylines(shp: Uint8Array, names: readonly string[], keep: (name: string) => boolean): ShapeLine[] {
  const v = view(shp);
  if (v.getInt32(0, false) !== 9994) throw new Error('not a shapefile');
  if (v.getInt32(32, true) !== 3) throw new Error('shapefile does not hold polylines');
  const out: ShapeLine[] = [];
  let at = 100;
  for (let i = 0; at + 8 <= shp.length; i++) {
    const length = v.getInt32(at + 4, false) * 2;
    const body = at + 8;
    at = body + length;
    const name = names[i] ?? '';
    if (v.getInt32(body, true) !== 3 || !keep(name)) continue;
    const parts = v.getInt32(body + 36, true);
    const points = v.getInt32(body + 40, true);
    const firstPoint = body + 44 + parts * 4;
    for (let p = 0; p < parts; p++) {
      const from = v.getInt32(body + 44 + p * 4, true);
      const to = p + 1 < parts ? v.getInt32(body + 44 + (p + 1) * 4, true) : points;
      const line: [number, number][] = [];
      for (let k = from; k < to; k++) line.push([v.getFloat64(firstPoint + k * 16, true), v.getFloat64(firstPoint + k * 16 + 8, true)]);
      out.push({ name, line });
    }
  }
  return out;
}
