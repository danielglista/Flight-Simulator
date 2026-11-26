import { DEFAULT_TUNING, TUNING_RANGES, type Tuning } from '../config/motion';
import type { ScaleConfig } from '../config/scales';
import { GRAVITY } from '../config/flight';
import { FRAME_SAMPLES, SIDE_FX, VS_MODE } from '../config/display';
import { stallState } from '../sim/flight/aero';
import { levelStallSpeed, vSpeeds } from '../sim/flight/vspeeds';
import { spoilersOut } from '../sim/flight/ground';
import { indicatedSpeed } from '../sim/units';
import { forcesOn } from '../sim/flight/forces';
import type { StartSpec } from '../sim/state';
import type { Loop } from './loop';
import type { FrameStats, Summary } from './frameStats';

export interface TimingStats {
  readonly interval: FrameStats;
  readonly top: FrameStats;
  readonly side: FrameStats;
  readonly instruments: FrameStats;
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
  /** What the wheels would roll on at a world point. */
  groundKind(x: number, y: number): string;
  /** Called after a display setting changes, so a paused panel can redraw. */
  readonly onDisplayChange?: () => void;
  /** Starts the buttons restart from. */
  readonly starts: readonly { readonly label: string; readonly spec: StartSpec }[];
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

  const fgLine = el('label', 'debug-slider');
  const fgBox = el('input');
  fgBox.type = 'checkbox';
  fgBox.checked = SIDE_FX.foreground;
  fgBox.addEventListener('change', () => {
    SIDE_FX.foreground = fgBox.checked;
    fgBox.blur();
  });
  fgLine.append(el('span', 'debug-name', 'Side foreground'), fgBox);

  const vsLine = el('label', 'debug-slider');
  const vsBox = el('input');
  vsBox.type = 'checkbox';
  vsBox.checked = VS_MODE.mode === 'altimeter';
  vsBox.addEventListener('change', () => {
    VS_MODE.mode = vsBox.checked ? 'altimeter' : 'world';
    vsBox.blur();
    o.onDisplayChange?.();
  });
  vsLine.append(el('span', 'debug-name', 'V/S = altimeter rate'), vsBox);

  const startsBox = el('div');
  for (const { label, spec } of o.starts) {
    const b = el('button', undefined, label);
    b.type = 'button';
    b.addEventListener('click', () => {
      loop.send({ kind: 'start', spec });
      b.blur();
      refresh();
    });
    startsBox.append(b);
  }
  const flight = el('pre', 'debug-text');
  const scalesText = el('pre', 'debug-text');
  const timingText = el('pre', 'debug-text');
  const clear = el('button', undefined, 'Clear timing');
  clear.type = 'button';
  clear.addEventListener('click', () => {
    for (const s of [timing.interval, timing.top, timing.side, timing.instruments, timing.total]) s.clear();
    clear.blur();
    refresh();
  });
  const group = (title: string, ...kids: HTMLElement[]): HTMLElement => {
    const g = el('section', 'debug-group');
    g.append(el('h3', undefined, title), ...kids);
    return g;
  };
  root.append(tuningBox, group('SIDE VIEW', fgLine), group('INSTRUMENTS', vsLine), group('START', startsBox), group('FLIGHT', flight), group('SCALES', scalesText), group('FRAME TIMING (ms)', timingText, clear));

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
      `ground    ${c.onGround ? 'on the ground, ' + o.groundKind(c.x, c.y) : 'airborne'}, ground thrust x${s.tuning.groundMult}`,
      `bank      ${(c.bank * DEG).toFixed(1)} deg, roll rate ${(c.rollRate * DEG).toFixed(1)} deg/s, turn ${(f.dHeadingDt * DEG).toFixed(1)} deg/s, level stall ${levelStallSpeed(s.tuning, c.bank, c.flaps).toFixed(1)} m/s indicated`,
      `flaps     lever ${c.flapLever}, position ${c.flaps.toFixed(2)}`,
      `gear      ${c.gearDown ? 'down' : 'up'} lever, position ${c.gear.toFixed(2)}`,
      `V-speeds  VR ${vSpeeds(s.tuning).vr.toFixed(1)}, V2 ${vSpeeds(s.tuning).v2.toFixed(1)} m/s indicated , V1 ${vSpeeds(s.tuning, 1000).v1?.toFixed(0) ?? '--'} m/s for 1,000 m of runway`,
      `stall     ${s.crash ? "none" : stallState(c, s.tuning)}, separation ${f.separation.toFixed(2)}`,
      `lift      ${kn(f.lift)} kN, load factor ${f.loadFactor.toFixed(2)} g`,
      `speed     ${c.speed.toFixed(1)} m/s true, ${indicatedSpeed(c, scales).toFixed(1)} m/s indicated`,
      `lever     ${(c.lever * 100).toFixed(0)}%, engine ${(c.spool * 100).toFixed(0)}%`,
      `thrust    ${kn(f.thrust)} kN, drag ${kn(f.drag)} kN, weight ${kn(f.weight)} kN`,
      `dV/dt     ${f.dVdt.toFixed(2)} m/s per s, density ${f.sigma.toFixed(3)}`,
      `energy    ${(c.z + (c.speed * c.speed) / (2 * GRAVITY)).toFixed(1)} m (z + V2/2g)`,
      `brakes    ${s.controls.brake ? 'held' : 'off'}${c.onGround ? (spoilersOut(c.lever) ? ', spoilers out' : '') : ''}, limit ${s.tuning.touchdownSinkMs.toFixed(1)} m/s sink`,
      `touchdown ${s.touchdown ? `${s.touchdown.sink.toFixed(1)} m/s sink, ${s.touchdown.speed.toFixed(1)} m/s, bank ${(s.touchdown.bank * DEG).toFixed(1)} deg, pitch ${(s.touchdown.pitch * DEG).toFixed(1)} deg, ${s.touchdown.kind}` : 'none'}`,
      `autopilot ${s.autopilot.on ? 'HDG+ALT on' : 'off'}, speed hold ${s.autopilot.spd ? 'on' : 'off'}; targets ${((s.autopilot.headingTarget * 180) / Math.PI).toFixed(0)} deg, ${(s.autopilot.targetZ).toFixed(0)} m z, ${s.autopilot.targetIas.toFixed(1)} m/s ias`,
      `stability ${s.stableTicks} settled steps${s.autopilot.notice ? `, last notice ${s.autopilot.notice.kind} ${s.autopilot.notice.reason} at tick ${s.autopilot.notice.tick}` : ''}`,
      `controls  turn ${s.controls.turn}, throttle ${s.controls.throttle}, pitch ${s.controls.pitch}, wings level ${s.controls.level ? 'on' : 'off'}`,
    ];
    if (s.crash) {
      lines.push(`impact    ${s.crash.speed.toFixed(1)} m/s at ${(s.crash.pathAngle * DEG).toFixed(1)} deg, ${s.crash.cause}, sink ${s.crash.sink.toFixed(1)} m/s`);
    }
    flight.textContent = lines.join('\n');
    scalesText.textContent = `altitude  ${scales.altitude} real m per world m\ndistance  ${scales.geoDistance} real m per world m`;
    timingText.textContent = [
      `samples   ${timing.interval.summary().n} / ${FRAME_SAMPLES}`,
      `${''.padEnd(15)}${'med'.padStart(5)} ${'p95'.padStart(5)} ${'worst'.padStart(5)}`,
      row('frame interval', timing.interval.summary(), ms),
      row('top draw', timing.top.summary(), ms),
      row('side draw', timing.side.summary(), ms),
      row('instruments', timing.instruments.summary(), ms),
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
