/** The sun as the drawing code needs it (E8). Views take it as an argument; only `main.ts` picks which one. */
export interface Sun {
  /** Radians clockwise from north, toward the sun. */
  readonly azimuth: number;
  /** Shadow length per meter of height. */
  readonly shadowPerM: number;
  /** 0..1: how much face shading shows. (E8.2 fades the shadows by it too.) */
  readonly strength: number;
}

/** E8.1: a fixed sun in the southwest, so shadows fall northeast. */
export const FIXED_SUN: Sun = { azimuth: (225 * Math.PI) / 180, shadowPerM: 0.5, strength: 1 };

/** How a face's brightness goes with the angle between its outward normal and the sun: `base + amp * cos`. */
export interface FaceShading {
  readonly base: number;
  readonly amp: number;
}

/** Flat walls and slopes. */
export const FLAT_SHADING: FaceShading = { base: 0.9, amp: 0.25 };
/** Round walls and domes seen from the side. */
export const ROUND_SHADING: FaceShading = { base: 0.92, amp: 0.2 };
/** Brightness of the half of a pitched roof that faces away from the sun. */
export const ROOF_AWAY_LIGHT = 0.72;
