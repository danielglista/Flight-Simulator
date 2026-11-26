import { ALT_LONG_FT, ALT_SHORT_FT, NEEDLE_QUANT_DEG, PANEL_CELL } from '../../config/display';

export type AngleTable = readonly (readonly [number, number])[];

/** Value to dial angle (degrees clockwise from the top), linear between table rows, pegged at both ends. */
export function tableAngle(table: AngleTable, v: number): number {
  const first = table[0];
  const last = table[table.length - 1];
  if (!first || !last) return 0;
  if (v <= first[0]) return first[1];
  if (v >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    const a = table[i - 1]!;
    const b = table[i]!;
    if (v <= b[0]) return a[1] + ((v - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
  }
  return last[1];
}

/** Rounds an angle to the redraw step. */
export const quantizeDeg = (deg: number, step = NEEDLE_QUANT_DEG): number => {
  const q = Math.round(deg / step) * step;
  return q === 0 ? 0 : q;
};

const mod = (v: number, m: number): number => ((v % m) + m) % m;

/** Altimeter hand angles for displayed feet: the long hand turns every ALT_LONG_FT, the short every ALT_SHORT_FT. */
export function altimeterHands(ft: number): { readonly longDeg: number; readonly shortDeg: number } {
  return { longDeg: (mod(ft, ALT_LONG_FT) / ALT_LONG_FT) * 360, shortDeg: (mod(ft, ALT_SHORT_FT) / ALT_SHORT_FT) * 360 };
}

/** A point `r` from the center at a dial angle (clockwise from the top), as unrounded pixel offsets. */
export function polar(deg: number, r: number): readonly [number, number] {
  const a = (deg * Math.PI) / 180;
  return [Math.sin(a) * r, -Math.cos(a) * r];
}

/** Fills the pixels of a ring segment between two radii and two dial angles, one pixel at a time. */
export function fillArc(ctx: CanvasRenderingContext2D, cx: number, cy: number, rIn: number, rOut: number, deg0: number, deg1: number, color: string): void {
  ctx.fillStyle = color;
  for (let r = rIn; r <= rOut; r += 1) {
    const step = Math.max(0.25, (0.5 / Math.max(r, 1)) * (180 / Math.PI));
    for (let d = deg0; d <= deg1 + 1e-9; d += step) {
      const [dx, dy] = polar(d, r);
      ctx.fillRect(Math.round(cx + dx), Math.round(cy + dy), 1, 1);
    }
  }
}

/** Offscreen faces keyed by a string: painted once, then copied. Created lazily, so importing this in tests needs no DOM. */
export interface FaceCache {
  get(key: string, paint: (ctx: CanvasRenderingContext2D) => void): CanvasImageSource;
}

export function createFaceCache(size = PANEL_CELL): FaceCache {
  let canvas: HTMLCanvasElement | null = null;
  let key = '';
  return {
    get(k, paint) {
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
      }
      if (k !== key) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, size, size);
          paint(ctx);
        }
        key = k;
      }
      return canvas;
    },
  };
}
