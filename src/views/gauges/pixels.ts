import { FONT_3X5, FONT_3X5_SIZE, FONT_5X7, FONT_5X7_SIZE } from '../../config/pixelFont';

export type PixelFont = '5x7' | '3x5';
export type Pixel = readonly [number, number];

const fontOf = (font: PixelFont) => (font === '5x7' ? { glyphs: FONT_5X7, ...FONT_5X7_SIZE } : { glyphs: FONT_3X5, ...FONT_3X5_SIZE });

/** Bresenham line, both endpoints included, no gaps. */
export function linePixels(x0: number, y0: number, x1: number, y1: number): Pixel[] {
  const out: Pixel[] = [];
  let x = Math.round(x0);
  let y = Math.round(y0);
  const ex = Math.round(x1);
  const ey = Math.round(y1);
  const dx = Math.abs(ex - x);
  const dy = -Math.abs(ey - y);
  const sx = x < ex ? 1 : -1;
  const sy = y < ey ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x, y]);
    if (x === ex && y === ey) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

/** A line of `size` x `size` squares along the Bresenham path. */
export function drawLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, size = 1): void {
  ctx.fillStyle = color;
  for (const [x, y] of linePixels(x0, y0, x1, y1)) ctx.fillRect(x, y, size, size);
}

/** A filled disk, one rectangle per row. */
export function fillDisk(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(r * r - dy * dy) + 0.5);
    ctx.fillRect(cx - half, cy + dy, 2 * half + 1, 1);
  }
}

/** Width in pixels of `text` (one pixel between letters). */
export function textWidth(text: string, font: PixelFont = '5x7'): number {
  if (!text) return 0;
  return text.length * (fontOf(font).width + 1) - 1;
}

export const textHeight = (font: PixelFont = '5x7'): number => fontOf(font).height;

/** True when the font has a glyph for the character (unknown ones draw blank). */
export const hasGlyph = (ch: string, font: PixelFont = '5x7'): boolean => ch in fontOf(font).glyphs;

/** The set pixels of `text`, relative to its top-left corner. */
export function textPixels(text: string, font: PixelFont = '5x7'): Pixel[] {
  const { glyphs, width } = fontOf(font);
  const out: Pixel[] = [];
  [...text].forEach((ch, i) => {
    const rows = (glyphs[ch] ?? glyphs[' '] ?? '').split('/');
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === '#') out.push([i * (width + 1) + x, y]);
    });
  });
  return out;
}

/** The same pixels as horizontal runs `[x, y, width]`: fewer rectangles to fill. */
const runCache = new Map<string, readonly (readonly [number, number, number])[]>();

export function textRuns(text: string, font: PixelFont = '5x7'): readonly (readonly [number, number, number])[] {
  const key = `${font}|${text}`;
  const hit = runCache.get(key);
  if (hit) return hit;
  const { glyphs, width } = fontOf(font);
  const out: [number, number, number][] = [];
  [...text].forEach((ch, i) => {
    (glyphs[ch] ?? glyphs[' '] ?? '').split('/').forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        if (row[x] !== '#') {
          x++;
          continue;
        }
        const start = x;
        while (x < row.length && row[x] === '#') x++;
        out.push([i * (width + 1) + start, y, x - start]);
      }
    });
  });
  if (runCache.size > 500) runCache.clear();
  runCache.set(key, out);
  return out;
}

export type TextAlign = 'left' | 'center' | 'right';

/** Draws pixel text with `x` as its left, center or right edge and `y` as its top. */
export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, font: PixelFont = '5x7', align: TextAlign = 'left'): void {
  const w = textWidth(text, font);
  const left = align === 'left' ? x : align === 'center' ? x - Math.floor(w / 2) : x - w;
  ctx.fillStyle = color;
  for (const [px, py, pw] of textRuns(text, font)) ctx.fillRect(left + px, y + py, pw, 1);
}
