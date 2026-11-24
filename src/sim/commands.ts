import type { Axis } from './state';

export type Command =
  | { readonly kind: 'turn'; readonly value: Axis }
  | { readonly kind: 'throttle'; readonly value: Axis }
  | { readonly kind: 'pitch'; readonly value: Axis }
  /** Back to the start position. Ignored unless crashed. Keeps tick and controls. */
  | { readonly kind: 'restart' }
  /** Pointer and test tool. */
  | { readonly kind: 'place'; readonly x: number; readonly y: number }
  /** Pointer and test tool. Radians, positive = right. */
  | { readonly kind: 'rotate'; readonly by: number };
