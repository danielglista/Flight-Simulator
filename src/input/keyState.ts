import type { Command } from '../sim/commands';
import type { Axis } from '../sim/state';

export interface KeyEventLike {
  readonly code: string;
  readonly repeat?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
  /** True when the event came from a text field or other editable element. */
  readonly editable?: boolean;
}

type Channel = 'turn' | 'throttle' | 'pitch';

/** Physical key positions (event.code). */
const BINDINGS: Readonly<Record<string, { channel: Channel; sign: 1 | -1 }>> = {
  KeyA: { channel: 'turn', sign: -1 },
  KeyD: { channel: 'turn', sign: 1 },
  KeyE: { channel: 'throttle', sign: 1 },
  KeyQ: { channel: 'throttle', sign: -1 },
  // Stick style: pull back (S) to climb.
  KeyW: { channel: 'pitch', sign: -1 },
  KeyS: { channel: 'pitch', sign: 1 },
};

export interface KeyState {
  keyDown(e: KeyEventLike): void;
  keyUp(e: KeyEventLike): void;
  /** Commands for axes that changed since the last sample, then one `level` if Space was pressed. */
  sample(): Command[];
  /** Forgets held and latched keys. Axes that were non-zero emit 0 on the next sample. */
  clear(): void;
}

export function createKeyState(): KeyState {
  const held = new Set<string>();
  const latched = new Set<string>();
  const emitted: Record<Channel, Axis> = { turn: 0, throttle: 0, pitch: 0 };
  // Space asks for wings level once per press, even for a tap shorter than a sample.
  let levelAsked = false;

  const axis = (channel: Channel): Axis => {
    let sum = 0;
    for (const [code, b] of Object.entries(BINDINGS)) {
      if (b.channel === channel && (held.has(code) || latched.has(code))) sum += b.sign;
    }
    return sum as Axis;
  };

  return {
    keyDown(e) {
      if (e.repeat || e.editable || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.code === 'Space') {
        levelAsked = true;
        return;
      }
      if (!(e.code in BINDINGS)) return;
      held.add(e.code);
      latched.add(e.code);
    },
    keyUp(e) {
      held.delete(e.code);
      // macOS drops other keyups while Meta is held, so releasing it forgets everything.
      if (e.code === 'MetaLeft' || e.code === 'MetaRight') held.clear();
    },
    sample() {
      const out: Command[] = [];
      for (const channel of ['turn', 'throttle', 'pitch'] as const) {
        const v = axis(channel);
        if (v !== emitted[channel]) {
          emitted[channel] = v;
          out.push({ kind: channel, value: v });
        }
      }
      latched.clear();
      if (levelAsked) out.push({ kind: 'level' });
      levelAsked = false;
      return out;
    },
    clear() {
      held.clear();
      latched.clear();
      levelAsked = false;
    },
  };
}
