/** A tiny RGB drawing buffer. Pixel (0, 0) is the top left. */
export type Rgb = readonly [number, number, number];

export class Raster {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    background: Rgb = [255, 255, 255],
  ) {
    this.data = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      this.data[i * 3] = background[0];
      this.data[i * 3 + 1] = background[1];
      this.data[i * 3 + 2] = background[2];
    }
  }

  pixel(x: number, y: number, c: Rgb): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return;
    const i = (iy * this.width + ix) * 3;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
  }

  line(x0: number, y0: number, x1: number, y1: number, c: Rgb, thickness = 1): void {
    let ax = Math.round(x0);
    let ay = Math.round(y0);
    const bx = Math.round(x1);
    const by = Math.round(y1);
    const dx = Math.abs(bx - ax);
    const dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1;
    const sy = ay < by ? 1 : -1;
    let err = dx + dy;
    const r = Math.floor((thickness - 1) / 2);
    // Guard against huge off-screen segments.
    for (let guard = 0; guard < 100000; guard++) {
      for (let oy = -r; oy <= r + ((thickness - 1) % 2); oy++) {
        for (let ox = -r; ox <= r + ((thickness - 1) % 2); ox++) this.pixel(ax + ox, ay + oy, c);
      }
      if (ax === bx && ay === by) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        ax += sx;
      }
      if (e2 <= dx) {
        err += dx;
        ay += sy;
      }
    }
  }

  polyline(points: readonly (readonly [number, number])[], c: Rgb, closed = false, thickness = 1): void {
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i] as readonly [number, number];
      const b = points[i + 1] as readonly [number, number];
      this.line(a[0], a[1], b[0], b[1], c, thickness);
    }
    if (closed && points.length > 2) {
      const a = points[points.length - 1] as readonly [number, number];
      const b = points[0] as readonly [number, number];
      this.line(a[0], a[1], b[0], b[1], c, thickness);
    }
  }

  /** Outline of an axis-aligned box given by its center and size, in pixels. */
  box(cx: number, cy: number, w: number, h: number, c: Rgb, thickness = 1): void {
    const l = cx - w / 2;
    const r = cx + w / 2;
    const t = cy - h / 2;
    const b = cy + h / 2;
    this.polyline(
      [
        [l, t],
        [r, t],
        [r, b],
        [l, b],
      ],
      c,
      true,
      thickness,
    );
  }

  circle(cx: number, cy: number, radius: number, c: Rgb, thickness = 1): void {
    const steps = Math.max(32, Math.ceil(radius * 2));
    const pts: [number, number][] = [];
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
    }
    this.polyline(pts, c, true, thickness);
  }

  cross(cx: number, cy: number, size: number, c: Rgb, thickness = 1): void {
    this.line(cx - size, cy, cx + size, cy, c, thickness);
    this.line(cx, cy - size, cx, cy + size, c, thickness);
  }
}
