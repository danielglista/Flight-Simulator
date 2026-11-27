import { describe, expect, it } from 'vitest';
import { PANEL_H, PANEL_W } from '../src/config/display';
import { lampRect, MODE_LAMPS } from '../src/views/gauges/lights';
import { lightsOrigin, panelOrigin } from '../src/views/instruments';

describe('clickable autopilot lamps', () => {
  it('puts HDG, ALT and SPD in that order, side by side inside the panel', () => {
    const size = { width: PANEL_W + 20, height: PANEL_H + 10 };
    const { left, top } = panelOrigin(size);
    const [ox, oy] = lightsOrigin(size);
    expect(MODE_LAMPS.map((l) => l.mode)).toEqual(['hdg', 'alt', 'spd']);
    let edge = ox;
    for (const { index } of MODE_LAMPS) {
      const [x, y, w, h] = lampRect(index);
      expect(ox + x).toBeGreaterThanOrEqual(edge);
      edge = ox + x + w;
      expect(oy + y + h).toBeLessThanOrEqual(top + PANEL_H);
    }
    expect(edge).toBeLessThanOrEqual(left + PANEL_W);
  });
});
