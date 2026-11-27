import type { Size } from '../config/display';
import type { Autopilot } from '../sim/state';
import { lampRect, MODE_LAMPS } from '../views/gauges/lights';
import { lightsOrigin } from '../views/instruments';

export type ApModeName = (typeof MODE_LAMPS)[number]['mode'];

export interface ApLampsOptions {
  /** The instruments canvas and its internal size. */
  readonly canvas: HTMLCanvasElement;
  size(): Size;
  autopilot(): Pick<Autopilot, ApModeName>;
  onToggle(mode: ApModeName): void;
}

export interface ApLamps {
  /** Lays the buttons over the lamps again and shows which modes are on. */
  place(): void;
}

/** The HDG, ALT and SPD lamps as real buttons, each switching its own autopilot mode. */
export function createApLamps(o: ApLampsOptions): ApLamps {
  const buttons = MODE_LAMPS.map(({ mode, index, name }) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'ap-lamp';
    el.title = name;
    el.setAttribute('aria-label', name);
    el.addEventListener('click', (e) => {
      o.onToggle(mode);
      // `detail` is 0 for a keyboard click; after a mouse click leave nothing focused, so the flight keys are untouched.
      if (e.detail !== 0) el.blur();
    });
    o.canvas.parentElement?.append(el);
    return { el, mode, index };
  });

  const place = (): void => {
    const size = o.size();
    const scale = o.canvas.clientWidth / size.width;
    const [ox, oy] = lightsOrigin(size);
    const ap = o.autopilot();
    for (const { el, mode, index } of buttons) {
      const [x, y, w, h] = lampRect(index);
      el.style.left = `${o.canvas.offsetLeft + (ox + x) * scale}px`;
      el.style.top = `${o.canvas.offsetTop + (oy + y) * scale}px`;
      el.style.width = `${w * scale}px`;
      el.style.height = `${h * scale}px`;
      el.setAttribute('aria-pressed', String(ap[mode]));
    }
  };

  window.addEventListener('resize', place);
  place();
  return { place };
}
