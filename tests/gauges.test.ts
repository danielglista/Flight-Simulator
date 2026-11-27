import { describe, expect, it } from 'vitest';
import { ASI_TABLE } from '../src/config/display';
import { FONT_3X5, FONT_3X5_SIZE, FONT_5X7, FONT_5X7_SIZE } from '../src/config/pixelFont';
import { SCALES } from '../src/config/scales';
import { DEFAULT_TUNING } from '../src/config/motion';
import { altimeterHands, quantizeDeg, tableAngle } from '../src/views/gauges/dial';
import { hasGlyph, linePixels, textPixels, textRuns, textWidth } from '../src/views/gauges/pixels';
import { buildPanelState, cachedStallSpeed, samePanelState } from '../src/views/panelState';
import { levelStallSpeed } from '../src/sim/flight/vspeeds';
import { altimeterVerticalSpeedFpm, displayedAltitudeFt, metersPerSecondToKnots, verticalSpeedFpm } from '../src/sim/units';
import { horizonColumns, horizonOffsetPx, pathMarkerOffsetPx } from '../src/views/gauges/horizon';
import { speedMarks } from '../src/views/gauges/airspeed';
import { powerAngle, powerLabels, sectorRuns } from '../src/views/gauges/power';
import { powerPct } from '../src/views/format';
import { compassAngle } from '../src/views/gauges/hsi';
import { vsiAngle } from '../src/views/gauges/vsi';
import { turnNeeded } from '../src/views/headingBug';
import { formatVerticalSpeed } from '../src/views/format';
import { readoutSentence, readoutText } from '../src/views/instruments';
import { craft } from './helpers';
import { AUTOPILOT_OFF, type Autopilot } from '../src/sim/state';
import { densityRatio } from '../src/sim/flight/forces';
import { apNoticeText, apSentence } from '../src/views/autopilotText';

const input = { stall: 'none', braking: false, gearWarn: false, crashed: false } as const;
const DEG = Math.PI / 180;

describe('dial tables', () => {
  it('hits every breakpoint, interpolates, and pegs at both ends', () => {
    for (const [kt, deg] of ASI_TABLE) expect(tableAngle(ASI_TABLE, kt)).toBeCloseTo(deg, 9);
    expect(tableAngle(ASI_TABLE, 30)).toBeCloseTo(15, 9);
    expect(tableAngle(ASI_TABLE, 150)).toBeCloseTo(30 + (90 / 180) * 210, 9);
    expect(tableAngle(ASI_TABLE, -5)).toBe(0);
    expect(tableAngle(ASI_TABLE, 583)).toBe(320);
  });

  it('never goes backwards from 0 to 600 kt', () => {
    let last = -1;
    for (let kt = 0; kt <= 600; kt += 0.5) {
      const a = tableAngle(ASI_TABLE, kt);
      expect(a).toBeGreaterThanOrEqual(last);
      last = a;
    }
  });
});

describe('altimeter hands', () => {
  it('long hand turns per 1,000 ft and short per 10,000 ft', () => {
    expect(altimeterHands(0)).toEqual({ longDeg: 0, shortDeg: 0 });
    expect(altimeterHands(250).longDeg).toBeCloseTo(90, 9);
    expect(altimeterHands(999).longDeg).toBeCloseTo(359.64, 9);
    expect(altimeterHands(1000).longDeg).toBe(0);
    expect(altimeterHands(9990).shortDeg).toBeCloseTo(359.64, 9);
    expect(altimeterHands(19690)).toMatchObject({ longDeg: expect.closeTo(248.4, 6), shortDeg: expect.closeTo(348.84, 6) });
    expect(altimeterHands(-250).longDeg).toBeCloseTo(270, 9);
  });
});

describe('quantize and redraw', () => {
  it('snaps to half a degree', () => {
    expect(quantizeDeg(10.2)).toBe(10);
    expect(quantizeDeg(10.3)).toBe(10.5);
    expect(quantizeDeg(-0.1)).toBe(0);
  });

  const tuning = DEFAULT_TUNING;
  const flying = craft({ z: 1000, speed: 80, bank: 0.1 });

  it('equal for a change under the step, different above it', () => {
    const a = buildPanelState(flying, SCALES, tuning, input);
    expect(samePanelState(a, buildPanelState({ ...flying, speed: 80.001 }, SCALES, tuning, input))).toBe(true);
    expect(samePanelState(a, buildPanelState({ ...flying, speed: 85 }, SCALES, tuning, input))).toBe(false);
    expect(samePanelState(a, buildPanelState({ ...flying, z: 1100 }, SCALES, tuning, input))).toBe(false);
  });

  it('gives equal states for a parked plane', () => {
    const parked = craft({ onGround: true, gearDown: true, gear: 1 });
    const first = buildPanelState(parked, SCALES, tuning, input);
    for (let i = 0; i < 60; i++) expect(samePanelState(first, buildPanelState(parked, SCALES, tuning, input))).toBe(true);
  });
});

describe('stall arc', () => {
  const tuning = DEFAULT_TUNING;
  it('matches levelStallSpeed for flaps and bank', () => {
    for (const [flaps, bankDeg] of [[0, 0], [0.5, 0], [1, 0], [0, 30]] as const) {
      const c = craft({ z: 1000, speed: 100, flaps, bank: bankDeg * DEG });
      const s = buildPanelState(c, SCALES, tuning, input);
      const kt = metersPerSecondToKnots(levelStallSpeed(tuning, bankDeg * DEG, flaps));
      expect(s.stallRedKt).toBe(Math.round(kt / 2) * 2);
      expect(s.stallAmberKt).toBe(Math.round((kt * 1.2) / 2) * 2);
    }
  });

  it('is bigger with more bank and smaller with flaps', () => {
    const at = (flaps: number, bank: number) => buildPanelState(craft({ z: 1000, speed: 100, flaps, bank: bank * DEG }), SCALES, tuning, input).stallRedKt;
    expect(at(0, 30)).toBeGreaterThan(at(0, 0));
    expect(at(1, 0)).toBeLessThan(at(0, 0));
  });

  it('misses the cache when any key changes', () => {
    const base = cachedStallSpeed(tuning, 0, 0);
    expect(cachedStallSpeed({ ...tuning, massT: tuning.massT + 5 }, 0, 0)).toBeGreaterThan(base);
    expect(cachedStallSpeed({ ...tuning, stallDeg: tuning.stallDeg + 2 }, 0, 0)).not.toBe(base);
    expect(cachedStallSpeed(tuning, 0, 1)).not.toBe(base);
    expect(cachedStallSpeed(tuning, 40 * DEG, 0)).toBeGreaterThan(base);
    expect(cachedStallSpeed(tuning, 0, 0)).toBe(base);
  });

  it('is hidden after a crash and at rest on the ground', () => {
    expect(buildPanelState(craft({ z: 1000, speed: 100 }), SCALES, tuning, { ...input, crashed: true }).stallRedKt).toBe(0);
    expect(buildPanelState(craft({ onGround: true, speed: 5 }), SCALES, tuning, input).stallRedKt).toBe(0);
    expect(buildPanelState(craft({ onGround: true, speed: 60 }), SCALES, tuning, input).stallRedKt).toBeGreaterThan(0);
  });
});

describe('pixel line', () => {
  const octants: [number, number][] = [[10, 0], [10, 4], [10, 10], [4, 10], [0, 10], [-4, 10], [-10, 10], [-10, 4], [-10, 0], [-10, -4], [-10, -10], [-4, -10], [0, -10], [4, -10], [10, -10], [10, -4]];
  it('has both endpoints and no gaps in every direction', () => {
    for (const [dx, dy] of octants) {
      const px = linePixels(5, 5, 5 + dx, 5 + dy);
      expect(px[0]).toEqual([5, 5]);
      expect(px[px.length - 1]).toEqual([5 + dx, 5 + dy]);
      for (let i = 1; i < px.length; i++) {
        expect(Math.abs(px[i]![0] - px[i - 1]![0])).toBeLessThanOrEqual(1);
        expect(Math.abs(px[i]![1] - px[i - 1]![1])).toBeLessThanOrEqual(1);
      }
      expect(px.length).toBe(Math.max(Math.abs(dx), Math.abs(dy)) + 1);
    }
  });

  it('is one pixel for a point', () => {
    expect(linePixels(3, 3, 3, 3)).toEqual([[3, 3]]);
  });
});

describe('pixel font', () => {
  it('every glyph has the right size', () => {
    for (const [glyphs, size] of [[FONT_5X7, FONT_5X7_SIZE], [FONT_3X5, FONT_3X5_SIZE]] as const) {
      for (const [ch, g] of Object.entries(glyphs)) {
        const rows = g.split('/');
        expect(rows.length, ch).toBe(size.height);
        for (const r of rows) expect(r, ch).toMatch(new RegExp(`^[#.]{${size.width}}$`));
      }
    }
  });

  it('covers every character the panel prints', () => {
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-.,%/> ') expect(hasGlyph(ch), ch).toBe(true);
    for (const ch of '0123456789. ABCDEFGHIJKLMNOPQRSTUVWXYZ') expect(hasGlyph(ch, '3x5'), ch).toBe(true);
  });

  it('measures and places text', () => {
    expect(textWidth('')).toBe(0);
    expect(textWidth('AB')).toBe(11);
    expect(textPixels('-').every(([, y]) => y === 3)).toBe(true);
    for (const t of ['A', 'B8%', '12:30 ,+']) expect(textRuns(t).reduce((n, r) => n + r[2], 0)).toBe(textPixels(t).length);
  });
});

describe('horizon', () => {
  const sky = (cols: ReturnType<typeof horizonColumns>) => cols.reduce((n, c) => n + (c.split - c.top), 0);
  const ground = (cols: ReturnType<typeof horizonColumns>) => cols.reduce((n, c) => n + (c.bottom - c.split + 1), 0);

  it('level splits the window in the middle', () => {
    for (const c of horizonColumns(0, 0)) expect(c.split).toBe(0);
  });

  it('nose up puts more sky, nose down more ground', () => {
    expect(sky(horizonColumns(10, 0))).toBeGreaterThan(ground(horizonColumns(10, 0)));
    expect(ground(horizonColumns(-10, 0))).toBeGreaterThan(sky(horizonColumns(-10, 0)));
  });

  it('a right bank puts the horizon right end higher on screen (smaller row)', () => {
    const cols = horizonColumns(0, 20);
    const at = (dx: number) => cols.find((c) => c.dx === dx)!.split;
    expect(at(20)).toBeLessThan(at(-20));
    const left = horizonColumns(0, -20);
    expect(left.find((c) => c.dx === 20)!.split).toBeGreaterThan(left.find((c) => c.dx === -20)!.split);
  });

  it('keeps both colors at 30 deg nose up and 60 deg bank, and at the pitch limits', () => {
    for (const [p, b] of [[30, 60], [30, -60], [-30, 60], [30, 0], [-30, 0]] as const) {
      const cols = horizonColumns(p, b);
      expect(sky(cols), `${p},${b}`).toBeGreaterThan(0);
      expect(ground(cols), `${p},${b}`).toBeGreaterThan(0);
    }
    expect(horizonOffsetPx(90)).toBe(30);
    expect(horizonOffsetPx(-90)).toBe(-30);
  });

  it('the path marker is on the horizon line when the path is level', () => {
    for (const pitch of [-10, 0, 5, 12]) expect(pathMarkerOffsetPx(pitch, 0)).toBeCloseTo(horizonOffsetPx(pitch), 9);
    expect(pathMarkerOffsetPx(5, 5)).toBe(0);
    expect(pathMarkerOffsetPx(0, 5)).toBeLessThan(0);
  });
});

describe('compass', () => {
  it('heading 090 puts E on top, and 359 and 001 are 2 deg apart', () => {
    expect(compassAngle(90, 90)).toBe(0);
    expect(compassAngle(0, 90)).toBe(-90);
    expect(compassAngle(1, 359) - compassAngle(359, 359)).toBe(2);
    expect(compassAngle(359, 1)).toBe(-2);
  });

  it('a bug to the right of the heading is on the right side', () => {
    expect(compassAngle(120, 90)).toBeGreaterThan(0);
    expect(compassAngle(60, 90)).toBeLessThan(0);
    expect(compassAngle(120, 90)).toBe(turnNeeded(90, 120));
  });
});

describe('vertical speed', () => {
  const craftAt = craft({ z: 1000, speed: 69, pathAngle: -3 * DEG });

  it('the needle points at 9 o clock at zero, up for a climb, down for a descent, pegged beyond', () => {
    expect(vsiAngle(0, 'world')).toBe(270);
    expect(vsiAngle(1000, 'world')).toBe(330);
    expect(vsiAngle(-1000, 'world')).toBe(210);
    expect(vsiAngle(2000, 'world')).toBe(20);
    expect(vsiAngle(99999, 'world')).toBe(70);
    expect(vsiAngle(-99999, 'world')).toBe(110);
  });

  it('altimeter mode shows the world rate times the altitude scale, as the altimeter changes', () => {
    const world = verticalSpeedFpm(craftAt);
    const alt = altimeterVerticalSpeedFpm(craftAt, SCALES);
    expect(alt).toBeCloseTo(world * SCALES.altitude, 6);
    const dt = 1 / 60;
    const after = { ...craftAt, z: craftAt.z + craftAt.speed * Math.sin(craftAt.pathAngle) * dt };
    const measured = ((displayedAltitudeFt(after.z, SCALES) - displayedAltitudeFt(craftAt.z, SCALES)) / dt) * 60;
    expect(alt).toBeCloseTo(measured, 3);
    expect(vsiAngle(alt, 'altimeter')).toBeCloseTo(vsiAngle(world, 'world'), 6);
  });

  it('both modes feed the readout and the panel', () => {
    expect(readoutText(craftAt, SCALES, 'none', false, false, 'world').vs).toBe(formatVerticalSpeed(verticalSpeedFpm(craftAt)));
    expect(readoutText(craftAt, SCALES, 'none', false, false, 'altimeter').vs).toBe(formatVerticalSpeed(altimeterVerticalSpeedFpm(craftAt, SCALES)));
    const a = buildPanelState(craftAt, SCALES, DEFAULT_TUNING, { ...input, vsMode: 'world' });
    expect(samePanelState(a, buildPanelState(craftAt, SCALES, DEFAULT_TUNING, { ...input, vsMode: 'altimeter' }))).toBe(false);
  });
});

describe('bugs on the panel', () => {
  const flying = craft({ z: 1000, speed: 80, heading: 90 * DEG });
  const ft = displayedAltitudeFt(1000, SCALES);

  it('the altitude bug shows only within 500 ft, at its hundreds', () => {
    const near = buildPanelState(flying, SCALES, DEFAULT_TUNING, { ...input, altBugFt: Math.round(ft / 100) * 100 + 300 });
    expect(near.altBugDeg).not.toBeNull();
    expect(buildPanelState(flying, SCALES, DEFAULT_TUNING, { ...input, altBugFt: ft + 600 }).altBugDeg).toBeNull();
    expect(buildPanelState(flying, SCALES, DEFAULT_TUNING, { ...input, altBugFt: null }).altBugDeg).toBeNull();
    expect(buildPanelState(flying, SCALES, DEFAULT_TUNING, { ...input, altBugFt: Math.floor(ft / 1000) * 1000 + 300 }).altBugDeg).toBeCloseTo(108, 6);
  });

  it('the heading bug and the path marker follow the inputs', () => {
    expect(buildPanelState(flying, SCALES, DEFAULT_TUNING, { ...input, headingBugDeg: 120 }).headingBug).toBe(120);
    expect(buildPanelState(flying, SCALES, DEFAULT_TUNING, input).headingBug).toBeNull();
    expect(buildPanelState(flying, SCALES, DEFAULT_TUNING, input).headingDeg).toBe(90);
    expect(buildPanelState(flying, SCALES, DEFAULT_TUNING, input).fpmDeg).toBe(0);
    expect(buildPanelState({ ...flying, onGround: true }, SCALES, DEFAULT_TUNING, input).fpmDeg).toBeNull();
    expect(buildPanelState(flying, SCALES, DEFAULT_TUNING, { ...input, crashed: true }).fpmDeg).toBeNull();
  });
});

describe('takeoff cues on the panel (D5A)', () => {
  const rolling = craft({ onGround: true, speed: 40 });
  const state = (patch: Partial<Parameters<typeof buildPanelState>[3]> = {}) => buildPanelState(rolling, SCALES, DEFAULT_TUNING, { ...input, ...patch });
  const marks = (ias: number) => speedMarks({ v1: 55, vr: 63, v2: 72 }, ias);

  it('are empty unless given, and a change redraws the panel', () => {
    expect(state()).toMatchObject({ speedMarks: [], callout: null, gearPrompt: false });
    const a = state({ speedMarks: marks(40) });
    expect(samePanelState(a, state({ speedMarks: marks(40) }))).toBe(true);
    expect(samePanelState(a, state())).toBe(false);
    expect(samePanelState(a, state({ speedMarks: marks(60) }))).toBe(false);
    expect(samePanelState(a, state({ speedMarks: marks(40), callout: 'V1' }))).toBe(false);
    expect(samePanelState(state({ callout: 'POSITIVE RATE' }), state({ callout: 'POSITIVE RATE', gearPrompt: true }))).toBe(false);
  });
});

describe('power dial (D5B)', () => {
  it('reads 20 at idle and 100 at full, clamped', () => {
    expect(powerPct(0)).toBe(20);
    expect(powerPct(0.5)).toBe(60);
    expect(powerPct(1)).toBe(100);
    expect(powerPct(-0.1)).toBe(20);
    expect(powerPct(1.1)).toBe(100);
  });

  it('turns three quarters of a circle from 6 o clock', () => {
    expect(powerAngle(0)).toBe(180);
    expect(powerAngle(20)).toBe(234);
    expect(powerAngle(100)).toBe(450);
  });

  it('fills the sector from the scale start to the engine with no holes', () => {
    const area = (pct: number) => sectorRuns(20, 180, powerAngle(pct)).reduce((n, r) => n + r[2], 0);
    expect(area(100)).toBeGreaterThan(Math.PI * 400 * 0.72);
    expect(area(100)).toBeLessThan(Math.PI * 400 * 0.78);
    expect(area(60)).toBeGreaterThan(area(20));
    // At 100 the lower right quarter stays empty and the other three are solid.
    const set = new Set(sectorRuns(20, 180, 450).flatMap(([x, y, w]) => Array.from({ length: w }, (_, i) => `${x + i},${y}`)));
    expect(set.has('8,8')).toBe(false);
    for (const p of ['-8,8', '-8,-8', '8,-8', '0,-10']) expect(set.has(p), p).toBe(true);
  });

  it('says IDLE at the minimum', () => {
    expect(powerLabels(20, 20)).toEqual({ engine: 'IDLE', lever: null });
    expect(powerLabels(20, 54)).toEqual({ engine: '54', lever: 'IDLE' });
    expect(powerLabels(70, 20)).toEqual({ engine: 'IDLE', lever: 'THR 70' });
    expect(powerLabels(70, 54)).toEqual({ engine: '54', lever: 'THR 70' });
    expect(readoutSentence(readoutText(craft({ lever: 0, spool: 0 }), SCALES))).toContain('throttle idle, engine idle');
  });

  it('the screen-reader sentence uses the same numbers', () => {
    expect(readoutSentence(readoutText(craft({ lever: 0, spool: 0.5 }), SCALES))).toContain('throttle idle, engine 60 percent');
  });
});

describe('selected approach on the panel (D5D)', () => {
  const air = craft({ z: 200, speed: 80 });
  const approach = { ident: 'PHL', name: '09R', courseDeg: 80.2, deviation: 0.5, bearingDeg: 75.1, glide: -1, distanceM: 3240 };
  const state = (a: typeof approach | null) => buildPanelState(air, SCALES, DEFAULT_TUNING, { ...input, approach: a });

  it('is in dial pixels, null with no runway, and redraws on a change', () => {
    expect(state(null).hsi).toBeNull();
    expect(state(approach).hsi).toEqual({ courseDeg: 80, bearingDeg: 75, barPx: 6, glidePx: -14, ident: 'PHL', name: '09R', distance: '3.2' });
    expect(samePanelState(state(approach), state({ ...approach, distanceM: 3201 }))).toBe(true);
    expect(samePanelState(state(approach), state({ ...approach, deviation: 0.6 }))).toBe(false);
    expect(samePanelState(state(approach), state(null))).toBe(false);
    expect(samePanelState(state(approach), state({ ...approach, ident: 'DCA' }))).toBe(false);
  });
});

describe('lamps and controls', () => {
  const air = craft({ z: 1000, speed: 80 });
  const state = (c: typeof air, patch: Partial<Parameters<typeof buildPanelState>[3]> = {}) => buildPanelState(c, SCALES, DEFAULT_TUNING, { ...input, ...patch });

  it('STALL and GEAR light together; TERR is its own lamp', () => {
    const s = state(air, { stall: 'warning', gearWarn: true, terr: true });
    expect(s.lights).toMatchObject({ stall: 'warning', gear: true, terr: true });
    expect(s.text.warn).toBe('STALL');
    expect(state(air, { stall: 'stalled' }).lights.stall).toBe('stalled');
    expect(state(air).lights).toMatchObject({ stall: 'off', gear: false, terr: false });
  });

  it('every warning lamp is dark after a crash', () => {
    expect(state(air, { crashed: true, stall: 'stalled', gearWarn: true, terr: true }).lights).toMatchObject({ stall: 'off', gear: false, terr: false });
  });

  it('the readout names TERR between STALL and GEAR, and the sentence says so', () => {
    expect(readoutText(air, SCALES, 'none', false, true, 'world', true).warn).toBe('TERR');
    expect(readoutText(air, SCALES, 'warning', false, true, 'world', true).warn).toBe('STALL');
    expect(readoutText(air, SCALES, 'none', false, true, 'world', false).warn).toBe('GEAR');
    expect(readoutSentence(readoutText(air, SCALES, 'none', false, false, 'world', true))).toContain('terrain warning');
  });

  it('brake and spoiler lamps follow the brakeText conditions: on the ground only', () => {
    const roll = craft({ onGround: true, speed: 30, lever: 0 });
    expect(state(roll, { braking: true }).config).toMatchObject({ brake: true, spoilers: true });
    expect(state({ ...roll, lever: 1 }, { braking: false }).config).toMatchObject({ brake: false, spoilers: false });
    expect(state({ ...roll, speed: 0.5 }).config.spoilers).toBe(false);
    expect(state(air, { braking: true }).config).toMatchObject({ brake: false, spoilers: false });
    expect(state(roll, { braking: true }).text.brk).toBe('ON SPL');
  });

  it('the power, flap and gear state reach the panel and redraw it', () => {
    const a = state(craft({ lever: 0.5, spool: 0.4, flapLever: 1, flaps: 0.2, gear: 1, gearDown: true }));
    expect(a).toMatchObject({ leverPct: 60, enginePct: 52, config: { flapLever: 1, flaps: 0.2, gear: 1, gearLever: true } });
    expect(samePanelState(a, state(craft({ lever: 0.5, spool: 0.4, flapLever: 1, flaps: 0.2, gear: 1, gearDown: true })))).toBe(true);
    expect(samePanelState(a, state(craft({ lever: 0.5, spool: 0.4, flapLever: 2, flaps: 0.2, gear: 1, gearDown: true })))).toBe(false);
    expect(samePanelState(a, state(craft({ lever: 0.5, spool: 0.4, flapLever: 1, flaps: 0.2, gear: 0.5, gearDown: true })))).toBe(false);
  });
});

describe('autopilot on the panel (D4)', () => {
  const air = craft({ z: 200, speed: 90, heading: 90 * DEG });
  const ft = displayedAltitudeFt(200, SCALES);
  const ias0 = 90 * Math.sqrt(densityRatio(200, SCALES.altitude));
  const ap = (patch: Partial<Autopilot> = {}): Autopilot => ({ hdg: true, alt: true, spd: true, headingTarget: 90 * DEG, targetZ: 200, targetIas: ias0, notice: null, ...patch });
  const lights = (a: Autopilot, c = air) => buildPanelState(c, SCALES, DEFAULT_TUNING, { ...input, autopilot: a }).lights;

  it('all four lamps are dark with the autopilot off', () => {
    expect(lights(AUTOPILOT_OFF)).toMatchObject({ ap: false, hdg: 'off', alt: 'off', spd: 'off' });
  });

  it('AP lamp green; HDG and ALT amber while capturing, green inside their margins', () => {
    expect(lights(ap())).toMatchObject({ ap: true, hdg: 'green', alt: 'green' });
    expect(lights(ap({ headingTarget: 100 * DEG }))).toMatchObject({ hdg: 'amber' });
    expect(lights(ap({ targetZ: 230 }))).toMatchObject({ alt: 'amber' });
    expect(lights(ap({ targetZ: 200 + 10 / (SCALES.altitude * 3.2808) }))).toMatchObject({ alt: 'green' });
    expect(ft).toBeGreaterThan(0);
  });

  it('SPD is green within 2 kt, amber otherwise and while the stall floor overrides the target', () => {
    expect(lights(ap())).toMatchObject({ spd: 'green' });
    expect(lights(ap({ targetIas: ias0 + 5 }))).toMatchObject({ spd: 'amber' }); // 5 m/s is about 10 kt
    expect(lights(ap({ targetIas: 30 }))).toMatchObject({ spd: 'amber' });
    expect(lights(ap({ hdg: false, alt: false }))).toMatchObject({ ap: true, hdg: 'off', alt: 'off', spd: 'green' });
  });

  it('the speed bug shows only while speed hold is on, and everything is dark after a crash', () => {
    expect(buildPanelState(air, SCALES, DEFAULT_TUNING, { ...input, autopilot: ap() }).spdBugDeg).not.toBeNull();
    expect(buildPanelState(air, SCALES, DEFAULT_TUNING, { ...input, autopilot: ap({ spd: false }) }).spdBugDeg).toBeNull();
    const crashed = buildPanelState(air, SCALES, DEFAULT_TUNING, { ...input, crashed: true, autopilot: ap() });
    expect(crashed.spdBugDeg).toBeNull();
    expect(crashed.lights).toMatchObject({ ap: false, hdg: 'off', alt: 'off', spd: 'off' });
  });

  it('a lamp change redraws the panel', () => {
    expect(samePanelState(buildPanelState(air, SCALES, DEFAULT_TUNING, { ...input, autopilot: ap() }), buildPanelState(air, SCALES, DEFAULT_TUNING, { ...input, autopilot: ap({ headingTarget: 120 * DEG }) }))).toBe(false);
  });
});

describe('autopilot notices', () => {
  const notice = (kind: 'refused' | 'dropped', reason: 'BANK' | 'TERRAIN' | 'controls') => ({ tick: 100, kind, reason });
  it('read as AP REFUSED or AP OFF with the reason, for two seconds', () => {
    expect(apNoticeText(notice('refused', 'BANK'), 100)).toEqual({ kind: 'refused', text: 'AP REFUSED: BANK' });
    expect(apNoticeText(notice('dropped', 'TERRAIN'), 150)).toEqual({ kind: 'dropped', text: 'AP OFF: TERRAIN' });
    expect(apNoticeText(notice('refused', 'controls'), 119)?.text).toBe('AP REFUSED: KEYS');
    expect(apNoticeText(notice('refused', 'BANK'), 220)).toBeNull();
    expect(apNoticeText(null, 0)).toBeNull();
  });
  it('the screen-reader sentence names the state and the notice', () => {
    expect(apSentence(AUTOPILOT_OFF, 0)).toBe('');
    expect(apSentence({ ...AUTOPILOT_OFF, hdg: true, alt: true, spd: true }, 0)).toBe(', heading hold on, altitude hold on, speed hold on');
    expect(apSentence({ ...AUTOPILOT_OFF, notice: notice('dropped', 'TERRAIN') }, 110)).toBe(', autopilot off: terrain');
  });
});
