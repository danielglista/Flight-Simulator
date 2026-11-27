import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../src/config/motion';
import { SCALES } from '../src/config/scales';
import { DAY_STEPS, SUN_START_TIME } from '../src/config/sun';
import { initialState } from '../src/sim/state';
import { CLOCK_LEFT, clockMinutes, clockText, sunSpot } from '../src/views/gauges/clock';
import { hasGlyph } from '../src/views/gauges/pixels';
import { lampRect, MODE_LAMPS } from '../src/views/gauges/lights';
import { buildPanelState, samePanelState } from '../src/views/panelState';

const MINUTE = 60 * 60;

describe('clock', () => {
  it('reads 06:00 at sunrise, one minute per real second, to just before 18:00', () => {
    expect(clockText(clockMinutes(0))).toBe('06:00');
    expect(clockText(clockMinutes(59))).toBe('06:00');
    expect(clockText(clockMinutes(60))).toBe('06:01');
    expect(clockText(clockMinutes(SUN_START_TIME))).toBe('09:00');
    expect(clockText(clockMinutes(6 * MINUTE))).toBe('12:00');
    expect(clockText(clockMinutes(DAY_STEPS - 1))).toBe('17:59');
  });

  it('moves the sun from left to right, highest at noon', () => {
    const [rise, noon, set] = [sunSpot(360), sunSpot(720), sunSpot(1080)];
    expect(rise[0]).toBeLessThan(noon[0]);
    expect(noon[0]).toBeLessThan(set[0]);
    expect(noon[1]).toBeLessThan(rise[1]);
    expect(set[1]).toBe(rise[1]);
  });

  it('has a glyph for every character it writes', () => {
    for (const ch of '0123456789:') expect(hasGlyph(ch)).toBe(true);
  });

  it('sits right of the last lamp', () => {
    const [x, , w] = lampRect(Math.max(...MODE_LAMPS.map((l) => l.index)));
    expect(x + w).toBeLessThan(CLOCK_LEFT);
  });

  it('redraws the panel when the minute changes, not within it', () => {
    const { craft } = initialState();
    const state = (timeOfDay: number) => buildPanelState(craft, SCALES, DEFAULT_TUNING, { stall: 'none', braking: false, gearWarn: false, crashed: false, timeOfDay });
    expect(samePanelState(state(600), state(659))).toBe(true);
    expect(samePanelState(state(600), state(660))).toBe(false);
  });
});
