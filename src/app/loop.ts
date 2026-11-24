import type { Command } from '../sim/commands';
import { interpolate } from '../sim/interpolate';
import { initialState, type Craft, type SimState } from '../sim/state';
import { advance, applyCommands, type SimBounds } from '../sim/step';
import { createStepper } from './stepper';

export interface LoopOptions {
  readonly bounds: SimBounds;
  /** Draws both views now, from `snapshot()`. */
  draw(): void;
  /** Schedules a draw on the next frame (used while paused). */
  requestDraw(): void;
  /** Keyboard changes since the last sample. */
  sampleKeys(): Command[];
  clearKeys(): void;
  startPaused?: boolean;
}

export interface Loop {
  /** Runs one animation frame at time `nowMs`. Public so tests can drive it. */
  frame(nowMs: number): void;
  /** Starts the browser animation-frame loop. */
  start(): void;
  /** Commands from pointers or tools. Applied at once when paused, otherwise at the next step. */
  send(command: Command): void;
  pause(): void;
  resume(): void;
  toggle(): void;
  readonly paused: boolean;
  /** The craft as drawn: interpolated between the last two steps. */
  snapshot(): Craft;
  readonly state: SimState;
  onPausedChange: ((paused: boolean) => void) | null;
}

export function createLoop(o: LoopOptions): Loop {
  const stepper = createStepper();
  let state = initialState();
  let prev = state;
  let alpha = 0;
  let queue: Command[] = [];
  let paused = o.startPaused ?? false;
  let last: number | null = null;

  const loop: Loop = {
    frame(nowMs) {
      if (paused) return;
      if (last === null) {
        last = nowMs;
        o.draw();
        return;
      }
      const elapsed = Math.max(0, (nowMs - last) / 1000);
      last = nowMs;
      const { steps, alpha: a } = stepper.advance(elapsed);
      alpha = a;
      // Sampled only on frames that step, so a press and its release cannot be queued together.
      if (steps > 0) queue.push(...o.sampleKeys());
      for (let i = 0; i < steps; i++) {
        if (queue.length > 0) {
          state = applyCommands(state, queue, o.bounds);
          queue = [];
        }
        // Taken after commands, so a click never streaks the dot across the map.
        prev = state;
        state = advance(state, o.bounds);
      }
      o.draw();
    },
    start() {
      const tick = (t: number): void => {
        loop.frame(t);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    send(command) {
      if (paused) {
        state = applyCommands(state, [command], o.bounds);
        prev = state;
        alpha = 0;
        o.requestDraw();
      } else {
        queue.push(command);
      }
    },
    pause() {
      if (paused) return;
      paused = true;
      last = null;
      stepper.reset();
      queue = [];
      o.clearKeys();
      // Draw exactly the state, not a point between two steps.
      prev = state;
      alpha = 0;
      loop.onPausedChange?.(true);
      o.requestDraw();
    },
    resume() {
      if (!paused) return;
      paused = false;
      last = null;
      stepper.reset();
      o.clearKeys();
      loop.onPausedChange?.(false);
    },
    toggle() {
      if (paused) loop.resume();
      else loop.pause();
    },
    get paused() {
      return paused;
    },
    snapshot() {
      return interpolate(prev.craft, state.craft, alpha);
    },
    get state() {
      return state;
    },
    onPausedChange: null,
  };
  return loop;
}
