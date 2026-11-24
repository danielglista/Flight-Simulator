import { DEFAULT_TUNING, TUNING_RANGES, type Tuning } from '../config/motion';
import type { ScaleConfig } from '../config/scales';
import { FRAME_SAMPLES } from '../config/display';
import type { Loop } from './loop';
import type { FrameStats, Summary } from './frameStats';

export interface TimingStats {
  readonly interval: FrameStats;
  readonly top: FrameStats;
  readonly side: FrameStats;
  readonly total: FrameStats;
}

export interface DebugPanel {
  readonly visible: boolean;
  /** Shows or hides. Hiding drops focus from anything inside. */
  toggle(): void;
  /** Rewrites all text and slider positions now. Does nothing while hidden. */
  refresh(): void;
}

export interface DebugOptions {
  readonly loop: Loop;
  readonly scales: ScaleConfig;
  readonly timing: TimingStats;
  /** Top surface height at a world point, world m. */
  heightAt(x: number, y: number): number;
}

const DEG = 180 / Math.PI;
const KEYS = Object.keys(TUNING_RANGES) as (keyof Tuning)[];
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const ms = (v: number): string => v.toFixed(1).padStart(5);
const row = (label: string, s: Summary, f: (n: number) => string): string =>
  `${label.padEnd(15)}${f(s.median)} ${f(s.p95)} ${f(s.worst)}`;

export function createDebugPanel(o: DebugOptions): DebugPanel | null {
  const root = document.getElementById('debug-panel');
  if (!root) return null;
  const { loop, scales, timing } = o;

  const sliders = new Map<keyof Tuning, { input: HTMLInputElement; value: HTMLElement }>();
  const tuningBox = el('section', 'debug-group');
  tuningBox.append(el('h3', undefined, 'TUNING'));
  for (const key of KEYS) {
    const r = TUNING_RANGES[key];
    const line = el('label', 'debug-slider');
    const name = el('span', 'debug-name', r.label);
    const input = el('input');
    input.type = 'range';
    input.min = String(r.min);
    input.max = String(r.max);
    input.step = String(r.step);
    input.value = String(DEFAULT_TUNING[key]);
    const value = el('span', 'debug-value');
    const def = el('span', 'debug-default', `def ${DEFAULT_TUNING[key]}`);
    input.addEventListener('input', () => {
      loop.send({ kind: 'tune', key, value: Number(input.value) });
      refresh();
    });
    line.append(name, input, value, def);
    tuningBox.append(line);
    sliders.set(key, { input, value });
  }
  const reset = el('button', undefined, 'Reset');
  reset.type = 'button';
  reset.addEventListener('click', () => {
    for (const key of KEYS) loop.send({ kind: 'tune', key, value: DEFAULT_TUNING[key] });
    reset.blur();
    refresh();
  });
  tuningBox.append(reset);

  const flight = el('pre', 'debug-text');
  const scalesText = el('pre', 'debug-text');
  const timingText = el('pre', 'debug-text');
  const clear = el('button', undefined, 'Clear timing');
  clear.type = 'button';
  clear.addEventListener('click', () => {
    for (const s of [timing.interval, timing.top, timing.side, timing.total]) s.clear();
    clear.blur();
    refresh();
  });
  const group = (title: string, ...kids: HTMLElement[]): HTMLElement => {
    const g = el('section', 'debug-group');
    g.append(el('h3', undefined, title), ...kids);
    return g;
  };
  root.append(tuningBox, group('FLIGHT', flight), group('SCALES', scalesText), group('FRAME TIMING (ms)', timingText, clear));

  function refresh(): void {
    if (root!.hidden) return;
    const s = loop.state;
    for (const key of KEYS) {
      const sl = sliders.get(key);
      if (!sl) continue;
      const v = String(s.tuning[key]);
      if (sl.input.value !== v) sl.input.value = v;
      sl.value.textContent = `${v} ${TUNING_RANGES[key].unit}`;
    }
    const c = s.craft;
    const above = c.z - o.heightAt(c.x, c.y);
    const lines = [
      `tick      ${s.tick}`,
      `x, y, z   ${c.x.toFixed(1)}, ${c.y.toFixed(1)}, ${c.z.toFixed(1)} m (world)`,
      `AGL       ${above.toFixed(1)} m world, ${(above * scales.altitude).toFixed(0)} m real`,
      `path      ${(c.pathAngle * DEG).toFixed(1)} deg`,
      `speed     ${c.speed.toFixed(1)} m/s`,
      `controls  turn ${s.controls.turn}, throttle ${s.controls.throttle}, pitch ${s.controls.pitch}`,
    ];
    if (s.crash) {
      lines.push(`impact    ${s.crash.speed.toFixed(1)} m/s at ${(s.crash.pathAngle * DEG).toFixed(1)} deg`);
    }
    flight.textContent = lines.join('\n');
    scalesText.textContent = `altitude  ${scales.altitude} real m per world m\nairport   ${scales.airport} real m per world m`;
    timingText.textContent = [
      `samples   ${timing.interval.summary().n} / ${FRAME_SAMPLES}`,
      `${''.padEnd(15)}${'med'.padStart(5)} ${'p95'.padStart(5)} ${'worst'.padStart(5)}`,
      row('frame interval', timing.interval.summary(), ms),
      row('top draw', timing.top.summary(), ms),
      row('side draw', timing.side.summary(), ms),
      row('total draw', timing.total.summary(), ms),
    ].join('\n');
  }

  return {
    get visible() {
      return !root.hidden;
    },
    toggle() {
      root.hidden = !root.hidden;
      if (root.hidden) {
        const a = document.activeElement;
        if (a instanceof HTMLElement && root.contains(a)) a.blur();
      } else {
        refresh();
      }
    },
    refresh,
  };
}
