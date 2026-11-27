import type { Tuning } from '../config/motion';
import type { Axis, StartSpec } from './state';

export type Command =
  | { readonly kind: 'turn'; readonly value: Axis }
  | { readonly kind: 'throttle'; readonly value: Axis }
  | { readonly kind: 'pitch'; readonly value: Axis }
  /** Wings level: roll to zero bank and stop. A non-zero `turn` cancels it. */
  | { readonly kind: 'level' }
  /** Gear lever: toggles up/down. Refused on the ground and after a crash. */
  | { readonly kind: 'gear' }
  /** Flap lever one step out (+1) or in (-1), clamped to 0..2. Allowed on the ground; ignored after a crash and for any other value. */
  | { readonly kind: 'flaps'; readonly by: 1 | -1 }
  /** Wheel brakes while held (Space). Bad values are ignored. Acts only on the ground. */
  | { readonly kind: 'brake'; readonly value: boolean }
  /** All three modes on (D4): holds the present heading, altitude and speed. Needs `stability`; otherwise it is refused with a notice. */
  | { readonly kind: 'autopilot'; readonly on: true }
  /** Every mode off. */
  | { readonly kind: 'autopilot'; readonly on: false }
  /** One mode alone, holding the present value. Heading and altitude need `stability` and their keys released; speed needs the air and no crash. */
  | { readonly kind: 'apMode'; readonly mode: 'hdg' | 'alt' | 'spd'; readonly on: boolean }
  /** Moves a target of a mode that is on: heading (radians, wrapped), `z` (world m, kept 0..the ceiling), `ias` (m/s, kept 30..150). Non-finite values are ignored. */
  | { readonly kind: 'apTarget'; readonly heading?: number; readonly z?: number; readonly ias?: number }
  /** Back to the start (`state.start`). Ignored unless crashed or landed and stopped. Keeps tick and controls. */
  | { readonly kind: 'restart' }
  /** Debug panel and tests: restart from this spec now, and remember it for `restart`. Ignored if any number is not finite; the position is clamped to the map. */
  | { readonly kind: 'start'; readonly spec: StartSpec }
  /** Pointer and test tool. Always ends in the air. */
  | { readonly kind: 'place'; readonly x: number; readonly y: number }
  /** Pointer and test tool. Radians, positive = right. */
  | { readonly kind: 'rotate'; readonly by: number }
  /** Debug panel. Unknown keys and non-finite values are ignored; others are clamped to their range. Allowed while crashed. */
  | { readonly kind: 'tune'; readonly key: keyof Tuning; readonly value: number };
