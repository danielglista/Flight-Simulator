import type { Rgb } from './palette';

/** One filled polygon of the plane, in sprite pixels measured from the center pixel. */
export interface ShapePart {
  readonly color: Rgb;
  readonly points: readonly (readonly [number, number])[];
}

export const BODY: Rgb = [232, 236, 240];
export const WING: Rgb = [178, 186, 200];
export const CANOPY: Rgb = [38, 72, 118];
/** Orange tail: the tail end of both sprites. */
export const FIN: Rgb = [232, 138, 36];
/** Left wingtip is red, right is green, as on a real aircraft. */
export const LIGHT_LEFT: Rgb = [236, 36, 36];
export const LIGHT_RIGHT: Rgb = [36, 220, 72];
export const OUTLINE: Rgb = [8, 10, 18];

/** Top view: x = right of the nose, y = forward. Listed back to front. Every point is within 10.1 px of the center. */
export const PLANE_TOP: readonly ShapePart[] = [
  { color: WING, points: [[-4.5, -9], [-1, -6], [1, -6], [4.5, -9], [4.5, -7], [-4.5, -7]] },
  { color: WING, points: [[-1.5, 3], [-10, -1], [-10, -4], [-1.5, -3], [1.5, -3], [10, -4], [10, -1], [1.5, 3]] },
  { color: BODY, points: [[0, 10], [1.8, 6], [1.8, -7], [0, -9], [-1.8, -7], [-1.8, 6]] },
  { color: FIN, points: [[-1.8, -4], [1.8, -4], [1.8, -8], [-1.8, -8]] },
  { color: CANOPY, points: [[-1, 6], [1, 6], [1, 3], [-1, 3]] },
  { color: LIGHT_LEFT, points: [[-10, -1], [-8, -1.5], [-8, -3.5], [-10, -4]] },
  { color: LIGHT_RIGHT, points: [[10, -1], [8, -1.5], [8, -3.5], [10, -4]] },
];

/** Side view: x = forward (right on screen), y = up. Nose on the right, tail fin on the left. */
export const PLANE_SIDE: readonly ShapePart[] = [
  {
    color: BODY,
    points: [[20, 0.5], [17, 3], [8, 4], [-14, 3], [-20, 1], [-20, -1.5], [-12, -3.5], [8, -3.5], [17, -2]],
  },
  { color: WING, points: [[4, -1], [-6, -1], [-9, -3], [0, -3]] },
  { color: FIN, points: [[-20, 1], [-18, 8], [-13, 8], [-9, 3]] },
  { color: CANOPY, points: [[12, 2.5], [9, 4], [5, 4], [5, 2.5]] },
];

export const TOP_SPRITE_SIZE = 25;
export const SIDE_SPRITE_SIZE = 45;
/** Number of rotated top-view frames: one per 5 degrees. */
export const TOP_FRAMES = 72;
/** Side view pitch frames: -15 to +15 degrees in 2.5 degree steps (13 frames). */
export const PITCH_STEP_DEG = 2.5;
export const PITCH_MAX_DEG = 15;
export const PITCH_FRAMES = 13;

/** Wreck marker, same in every direction: x right, y up, within 8 px of the center. */
export const WRECK_SIZE = 25;
export const WRECK: readonly ShapePart[] = [
  { color: [58, 52, 48], points: [[-8, -3], [-5, 4], [-1, 2], [2, 7], [5, 1], [8, 3], [6, -4], [1, -7], [-4, -6]] },
  { color: [232, 138, 36], points: [[-4, -2], [-2, 3], [1, 0], [3, 4], [4, -2], [0, -4]] },
  { color: [236, 220, 120], points: [[-1, -1], [0, 2], [2, -1]] },
];
