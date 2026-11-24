import {
  OUTLINE,
  PITCH_FRAMES,
  PITCH_MAX_DEG,
  PITCH_STEP_DEG,
  PLANE_SIDE,
  PLANE_TOP,
  SIDE_SPRITE_SIZE,
  TOP_FRAMES,
  TOP_SPRITE_SIZE,
  WRECK,
  WRECK_SIZE,
  type ShapePart,
} from '../config/planeShape';
import { wrapHeading } from '../sim/angles';

function inside(points: ShapePart['points'], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i] as readonly [number, number];
    const [xj, yj] = points[j] as readonly [number, number];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * Pure RGBA, size x size. The sprite's forward (+y) points `angle` radians
 * clockwise from screen-up. Each pixel is tested at its center, so there is no
 * smoothing, and filled pixels get a one-pixel dark outline. For an odd size the
 * center pixel is at index (size - 1) / 2 and sits exactly on the sprite origin.
 */
export function rasterize(parts: readonly ShapePart[], angle: number, size: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  const c = (size - 1) / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const filled = new Uint8Array(size * size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const sx = px - c; // screen right
      const sy = c - py; // screen up
      const x = sx * cos - sy * sin;
      const y = sx * sin + sy * cos;
      for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i] as ShapePart;
        if (!inside(part.points, x, y)) continue;
        const o = (py * size + px) * 4;
        data[o] = part.color[0];
        data[o + 1] = part.color[1];
        data[o + 2] = part.color[2];
        data[o + 3] = 255;
        filled[py * size + px] = 1;
        break;
      }
    }
  }
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      if (filled[py * size + px]) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx >= 0 && ny >= 0 && nx < size && ny < size && filled[ny * size + nx]) {
            near = true;
            break;
          }
        }
      }
      if (!near) continue;
      const o = (py * size + px) * 4;
      data[o] = OUTLINE[0];
      data[o + 1] = OUTLINE[1];
      data[o + 2] = OUTLINE[2];
      data[o + 3] = 255;
    }
  }
  return data;
}

/** Nearest of the TOP_FRAMES rotated frames; 357.5 degrees and above wrap to frame 0. */
export function frameIndex(heading: number): number {
  return Math.round((wrapHeading(heading) / (Math.PI * 2)) * TOP_FRAMES) % TOP_FRAMES;
}

export function frameAngle(index: number): number {
  return (index * Math.PI * 2) / TOP_FRAMES;
}

/** Nearest of the PITCH_FRAMES side frames for a nose pitch in radians; 0 is the middle frame. */
export function pitchFrameIndex(pitch: number): number {
  const deg = Math.min(PITCH_MAX_DEG, Math.max(-PITCH_MAX_DEG, (pitch * 180) / Math.PI));
  return Math.round(deg / PITCH_STEP_DEG) + (PITCH_FRAMES - 1) / 2;
}

/** rasterize turns clockwise, so a nose-up frame is a negative angle. */
export function pitchFrameAngle(index: number): number {
  return (-(index - (PITCH_FRAMES - 1) / 2) * PITCH_STEP_DEG * Math.PI) / 180;
}

function toCanvas(data: Uint8ClampedArray, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not supported');
  ctx.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, size, size), 0, 0);
  return canvas;
}

export interface PlaneSprites {
  /** Draws the top sprite with its center pixel at floor(x), floor(y) (internal pixels). */
  drawTop(ctx: CanvasRenderingContext2D, heading: number, x: number, y: number): void;
  /** Draws the side sprite, nose right, tilted to `pitch` (radians, positive = nose up), center at floor(x), floor(y). */
  drawSide(ctx: CanvasRenderingContext2D, pitch: number, x: number, y: number): void;
  /** Draws the wreck marker with its center pixel at floor(x), floor(y). Same in both views. */
  drawWreck(ctx: CanvasRenderingContext2D, x: number, y: number): void;
  /** Builds every frame now, so none is built mid-flight. */
  warm(): void;
}

export function createPlaneSprites(): PlaneSprites {
  const top = new Map<number, HTMLCanvasElement>();
  const side = new Map<number, HTMLCanvasElement>();
  let wreck: HTMLCanvasElement | null = null;
  const topFrame = (i: number): HTMLCanvasElement => {
    let c = top.get(i);
    if (!c) {
      c = toCanvas(rasterize(PLANE_TOP, frameAngle(i), TOP_SPRITE_SIZE), TOP_SPRITE_SIZE);
      top.set(i, c);
    }
    return c;
  };
  const sideFrame = (i: number): HTMLCanvasElement => {
    let c = side.get(i);
    if (!c) {
      c = toCanvas(rasterize(PLANE_SIDE, pitchFrameAngle(i), SIDE_SPRITE_SIZE), SIDE_SPRITE_SIZE);
      side.set(i, c);
    }
    return c;
  };
  const wreckFrame = (): HTMLCanvasElement => {
    wreck ??= toCanvas(rasterize(WRECK, 0, WRECK_SIZE), WRECK_SIZE);
    return wreck;
  };
  return {
    drawTop(ctx, heading, x, y) {
      const h = (TOP_SPRITE_SIZE - 1) / 2;
      ctx.drawImage(topFrame(frameIndex(heading)), Math.floor(x) - h, Math.floor(y) - h);
    },
    drawSide(ctx, pitch, x, y) {
      const h = (SIDE_SPRITE_SIZE - 1) / 2;
      ctx.drawImage(sideFrame(pitchFrameIndex(pitch)), Math.floor(x) - h, Math.floor(y) - h);
    },
    drawWreck(ctx, x, y) {
      const h = (WRECK_SIZE - 1) / 2;
      ctx.drawImage(wreckFrame(), Math.floor(x) - h, Math.floor(y) - h);
    },
    warm() {
      for (let i = 0; i < TOP_FRAMES; i++) topFrame(i);
      for (let i = 0; i < PITCH_FRAMES; i++) sideFrame(i);
      wreckFrame();
    },
  };
}
