import { DEFAULT_TUNING, TUNING_RANGES, type Tuning } from '../config/motion';
import type { ScaleConfig } from '../config/scales';
import { GRAVITY, RHO0, WING_AREA } from '../config/flight';
import { FRAME_SAMPLES } from '../config/display';
import { aeroAt, stallState } from '../sim/flight/aero';
import { indicatedSpeed } from '../sim/units';
import { forcesOn } from '../sim/flight/forces';
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

/** Indicated stall speed in level flight at this bank: the 1 g speed at peak Cl, over the square root of cos(bank). */
function levelStall(t: Tuning, bank: number): number {
  let clMax = 0;
  for (let a = 0; a <= t.stallDeg; a += 0.25) clMax = Math.max(clMax, aeroAt((a * Math.PI) / 180, (t.stallDeg * Math.PI) / 180, t).cl);
  return Math.sqrt((2 * t.massT * 1000 * GRAVITY) / (RHO0 * WING_AREA * clMax * Math.max(Math.cos(bank), 0.2)));
}

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
    const f = forcesOn(c, s.tuning, scales.altitude);
    const kn = (n: number): string => (n / 1000).toFixed(1);
    const lines = [
      `tick      ${s.tick}`,
      `x, y, z   ${c.x.toFixed(1)}, ${c.y.toFixed(1)}, ${c.z.toFixed(1)} m (world)`,
      `AGL       ${above.toFixed(1)} m world, ${(above * scales.altitude).toFixed(0)} m real`,
      `pitch     ${(c.pitch * DEG).toFixed(1)} deg, path ${(c.pathAngle * DEG).toFixed(1)} deg, AoA ${(f.alpha * DEG).toFixed(1)} deg`,
      `bank      ${(c.bank * DEG).toFixed(1)} deg, turn ${(f.dHeadingDt * DEG).toFixed(1)} deg/s, level stall ${levelStall(s.tuning, c.bank).toFixed(1)} m/s indicated`,
      `stall     ${s.crash ? "none" : stallState(c, s.tuning)}, separation ${f.separation.toFixed(2)}`,
      `lift      ${kn(f.lift)} kN, load factor ${f.loadFactor.toFixed(2)} g`,
      `speed     ${c.speed.toFixed(1)} m/s true, ${indicatedSpeed(c, scales).toFixed(1)} m/s indicated`,
      `lever     ${(c.lever * 100).toFixed(0)}%, engine ${(c.spool * 100).toFixed(0)}%`,
      `thrust    ${kn(f.thrust)} kN, drag ${kn(f.drag)} kN, weight ${kn(f.weight)} kN`,
      `dV/dt     ${f.dVdt.toFixed(2)} m/s per s, density ${f.sigma.toFixed(3)}`,
      `energy    ${(c.z + (c.speed * c.speed) / (2 * GRAVITY)).toFixed(1)} m (z + V2/2g)`,
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
