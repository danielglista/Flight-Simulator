import { MAX_STEPS_PER_FRAME, STEP_S } from '../config/motion';

export interface Stepper {
  /** Elapsed real seconds since the last call. Returns whole steps to run and the leftover fraction. */
  advance(elapsedS: number): { steps: number; alpha: number };
  reset(): void;
}

export function createStepper(): Stepper {
  let acc = 0;
  return {
    advance(elapsedS) {
      acc += Number.isFinite(elapsedS) && elapsedS > 0 ? elapsedS : 0;
      let steps = Math.floor(acc / STEP_S + 1e-9);
      acc -= steps * STEP_S;
      if (acc < 0) acc = 0;
      if (steps > MAX_STEPS_PER_FRAME) steps = MAX_STEPS_PER_FRAME;
      return { steps, alpha: Math.min(1, acc / STEP_S) };
    },
    reset() {
      acc = 0;
    },
  };
}
