import { describe, expect, it } from 'vitest';
// The built map, inlined: tests have no file access.
import mapUrl from '../public/maps/mid-atlantic.bin?inline';
import { DEFAULT_TUNING } from '../src/config/motion';
import type { Command } from '../src/sim/commands';
import { stallState } from '../src/sim/flight/aero';
import { landed } from '../src/sim/flight/ground';
import { trimAt } from '../src/sim/flight/trim';
import { vSpeeds } from '../src/sim/flight/vspeeds';
import { initialState, type SimState } from '../src/sim/state';
import { advance, applyCommands, type SimWorld } from '../src/sim/step';
import { runwayFrame } from '../src/sim/world/airport';
import { airportAt, groundAt, heightAt, runwayAt, surfaceAt, waterLevelAt, worldHeight, worldWidth } from '../src/sim/world/grid';
import { groundKindAt } from '../src/sim/world/groundKind';
import { parseMap } from '../src/sim/world/mapFile';
import { createObstacles } from '../src/sim/world/obstacles';
import { midAtlanticDef, midAtlanticGrid } from '../src/sim/world/midAtlantic';
import { pickStart, startList } from '../src/sim/world/startList';
import { Terrain } from '../src/sim/world/terrain';

const bytes = Uint8Array.from(atob(mapUrl.slice(mapUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));
const map = parseMap(bytes.buffer);
const grid = midAtlanticGrid(map);
const scale = { altitude: map.altitudeScale, geoDistance: map.geoDistance };
const world: SimWorld = {
  width: worldWidth(grid),
  height: worldHeight(grid),
  heightAt: (x, y) => heightAt(grid, scale, x, y),
  altitudeScale: scale.altitude,
  groundKind: (x, y) => groundKindAt(grid, x, y),
  obstacleAt: createObstacles(grid, scale),
};
const [dca, phl] = grid.airports as [(typeof grid.airports)[number], (typeof grid.airports)[number]];
const starts = startList(grid.airports, world.heightAt, scale.altitude, DEFAULT_TUNING);
const DEG = Math.PI / 180;

describe('the built Mid-Atlantic map', () => {
  it('has solid buildings (E5.6)', () => {
    const hit = world.obstacleAt!;
    const first = grid.buildings![0]!;
    expect(hit(first.x, first.y)).toBeCloseTo(groundAt(grid, scale, first.x, first.y) + first.height, 6);
  });
  it('has buildings in both cities, dry, off the airports, with Philadelphia far taller (E5.3)', () => {
    const buildings = grid.buildings ?? [];
    const near = (x: number, y: number) => buildings.filter((b) => Math.abs(b.x - x) < 1000 && Math.abs(b.y - y) < 750);
    const dcCore = near(4723, 7057);
    const phlCore = near(11194, 11778);
    expect(dcCore.length).toBeGreaterThan(500);
    expect(phlCore.length).toBeGreaterThan(500);
    // East of the Potomac, DC's limit: 140 ft real is about 14 world m. Rosslyn and Crystal City, west of it, go higher.
    const tallest = (list: typeof buildings) => Math.max(...list.map((b) => b.height));
    expect(tallest(dcCore.filter((b) => b.x > 4450))).toBeLessThanOrEqual(14);
    expect(tallest(buildings.filter((b) => b.x > 3800 && b.x < 4100 && b.y > 7000 && b.y < 7350))).toBeGreaterThan(25); // Rosslyn
    expect(tallest(buildings.filter((b) => b.x > 4150 && b.x < 4430 && b.y > 5550 && b.y < 6400))).toBeGreaterThan(25); // Crystal City
    expect(Math.max(...phlCore.map((b) => b.height))).toBeGreaterThan(60);
    const wet = buildings.filter((b) => !Number.isNaN(waterLevelAt(grid, scale, b.x, b.y)));
    expect(wet).toEqual([]);
    expect(buildings.filter((b) => airportAt(grid, b.x, b.y))).toEqual([]);
  });
  it('has highways with bridges, none of them across an airport runway (E5.2)', () => {
    const roads = grid.roads ?? [];
    expect(roads.some((r) => r.kind === 'major' && !r.bridge)).toBe(true);
    expect(roads.some((r) => r.bridge)).toBe(true);
    for (const r of roads) {
      for (let i = 0; i < r.points.length; i += 2) {
        const hit = runwayAt(grid, r.points[i]!, r.points[i + 1]!);
        expect(hit).toBeNull();
      }
    }
  });
  it('has city districts around both city centers, and none under the airports (E5)', () => {
    // City centers, world m, at the scales in data/map/scales.json.
    expect(surfaceAt(grid, 4723, 7057)).toBe(Terrain.park); // the Mall
    expect(surfaceAt(grid, 4723, 7200)).toBe(Terrain.downtown);
    expect(surfaceAt(grid, 11194, 11778)).toBe(Terrain.downtown);
    const districts: number[] = [Terrain.downtown, Terrain.residential, Terrain.suburb, Terrain.industrial, Terrain.park];
    for (const a of grid.airports) {
      const rw = a.runways[0]!;
      for (let t = 0; t <= 1; t += 0.05) expect(districts).not.toContain(surfaceAt(grid, rw.a.x + (rw.b.x - rw.a.x) * t, rw.a.y + (rw.b.y - rw.a.y) * t));
    }
  });
  it('has DCA and PHL at their real runway names, lengths at 1:2', () => {
    expect(grid.airports.map((a) => a.ident)).toEqual(['DCA', 'PHL']);
    expect(dca.runways[0]!.names).toEqual(['01', '19']);
    expect(phl.runways[0]!.names).toEqual(['09R', '27L']);
    expect(dca.runways[0]!.length).toBeCloseTo(2185 / 2, 3);
    expect(phl.runways[0]!.length).toBeCloseTo(1600, 3);
    expect(scale).toEqual({ altitude: 5, geoDistance: 25 });
  });
  it('is flat, dry, paved runway from end to end, with grass past each end', () => {
    for (const a of grid.airports) {
      const rw = a.runways[0]!;
      const ux = (rw.b.x - rw.a.x) / rw.length;
      const uy = (rw.b.y - rw.a.y) / rw.length;
      for (let s = -40; s <= rw.length + 40; s += 7) {
        const x = rw.a.x + ux * s;
        const y = rw.a.y + uy * s;
        expect(world.heightAt(x, y)).toBeCloseTo(a.fieldElevationM / scale.altitude, 9);
        expect(groundKindAt(grid, x, y)).toBe(s >= 0 && s <= rw.length ? 'paved' : 'grass');
      }
      expect(runwayAt(grid, (rw.a.x + rw.b.x) / 2, (rw.a.y + rw.b.y) / 2)?.airport.ident).toBe(a.ident);
    }
  });
  it('lets the map show through inside an airport boundary: the Potomac runs past DCA', () => {
    const rw = dca.runways[0]!;
    const my = (rw.a.y + rw.b.y) / 2;
    let wet = 0;
    for (let x = (rw.a.x + rw.b.x) / 2; x < dca.maxX + 150; x += 5) {
      if (!Number.isNaN(waterLevelAt(grid, scale, x, my))) {
        wet++;
        expect(airportAt(grid, x, my)).toBeNull();
        expect(surfaceAt(grid, x, my)).toBe(Terrain.seabed);
        expect(groundKindAt(grid, x, my)).toBe('rough');
      }
    }
    expect(wet).toBeGreaterThan(10);
  });
  it('has no step in height where a patch meets the base grid', () => {
    for (const p of grid.patches ?? []) {
      const w = p.grid.cols * p.grid.cellSize;
      const h = p.grid.rows * p.grid.cellSize;
      for (let k = 0; k <= 20; k++) {
        for (const [x, y, dx, dy] of [
          [p.x, p.y + (h * k) / 20, 0.01, 0],
          [p.x + w, p.y + (h * k) / 20, 0.01, 0],
          [p.x + (w * k) / 20, p.y, 0, 0.01],
          [p.x + (w * k) / 20, p.y + h, 0, 0.01],
        ] as const) {
          // Ground only: water is per cell, so its edge may step, and the bed under a river bank with it.
          const bank = [-20, -10, 0, 10, 20].some((i) => [-20, -10, 0, 10, 20].some((j) => !Number.isNaN(waterLevelAt(grid, scale, x + i, y + j))));
          if (bank) continue;
          const bed = (px: number, py: number) => groundAt({ ...grid, airports: [] }, scale, px, py);
          expect(Math.abs(bed(x - dx, y - dy) - bed(x + dx, y + dy))).toBeLessThan(0.5);
        }
      }
    }
  });
  it('refuses an airport it has no layout for', () => {
    expect(() => midAtlanticDef({ ...map.airports[0]!, id: 'XYZ' })).toThrow(/XYZ/);
  });
  it('offers a runway and a final start on each airport, and picks by name', () => {
    expect(starts.map((s) => s.label)).toEqual(['DCA runway', 'DCA final', 'PHL runway', 'PHL final', 'Air']);
    expect(pickStart(starts, null, null)?.label).toBe('DCA runway');
    expect(pickStart(starts, 'final', 'phl')?.label).toBe('PHL final');
    expect(pickStart(starts, 'air', null)?.label).toBe('Air');
    expect(pickStart(starts, 'nonsense', 'ZZZ')?.label).toBe('DCA runway');
  });
  it('flies each final approach clear of the ground down to the aim point', () => {
    for (const s of starts.filter((q) => q.kind === 'final')) {
      const rw = grid.airports.find((a) => a.ident === s.airport)!.runways[0]!;
      const ux = (rw.b.x - rw.a.x) / rw.length;
      const uy = (rw.b.y - rw.a.y) / rw.length;
      const aimZ = world.heightAt(rw.a.x + ux * 150, rw.a.y + uy * 150);
      for (let d = 1550; d >= 20; d -= 10) {
        const x = rw.a.x + ux * (150 - d);
        const y = rw.a.y + uy * (150 - d);
        expect(world.heightAt(x, y)).toBeLessThan(aimZ + d * Math.tan(3 * DEG));
      }
    }
  });
});

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
type Phase = 'roll' | 'climb' | 'cruise' | 'final' | 'rollout';

/** A scripted pilot, keys only (as in circuit.test.ts): off DCA, direct to a fix on PHL's final, and down. */
function createPilot() {
  const from = dca.runways[0]!;
  const to = phl.runways[0]!;
  const frameOf = (rw: typeof from) => {
    const ux = (rw.b.x - rw.a.x) / rw.length;
    const uy = (rw.b.y - rw.a.y) / rw.length;
    return {
      frame: (x: number, y: number) => ({ s: (x - rw.a.x) * ux + (y - rw.a.y) * uy, c: -(x - rw.a.x) * uy + (y - rw.a.y) * ux }),
      at: (s: number, c: number) => ({ x: rw.a.x + ux * s - uy * c, y: rw.a.y + uy * s + ux * c }),
    };
  };
  const dep = frameOf(from);
  const arr = frameOf(to);
  const field = phl.fieldElevationM / scale.altitude;
  const FIX_M = 2800;
  const fix = arr.at(-FIX_M, 0);
  const CRUISE_Z = field + 150;
  let phase: Phase = 'roll';
  let gearRaised = false;

  function step(s: SimState): Command[] {
    const cr = s.craft;
    const loaded = { ...s.tuning, massT: s.tuning.massT / Math.cos(cr.bank) };
    const agl = cr.z - world.heightAt(cr.x, cr.y);
    const bearing = (p: { x: number; y: number }): number => wrap(Math.atan2(p.x - cr.x, p.y - cr.y) - cr.heading);
    const out: Command[] = [];
    let throttleTo = 0.5;
    let pathTarget = 0;
    let turnErr = 0;
    let pitchKey: -1 | 0 | 1 | null = null;
    let brake = false;
    let gearCounts = 0;

    if (phase === 'roll') {
      throttleTo = 1;
      turnErr = bearing(dep.at(dep.frame(cr.x, cr.y).s + 250, 0));
      pitchKey = cr.speed >= vSpeeds(s.tuning).vr && cr.pitch < 9 * DEG ? 1 : 0;
      if (!cr.onGround) phase = 'climb';
    } else if (phase === 'climb') {
      throttleTo = 0.9;
      pathTarget = 6 * DEG;
      gearCounts = s.tuning.gearDragCounts * cr.gear;
      turnErr = bearing(dep.at(dep.frame(cr.x, cr.y).s + 300, 0));
      if (!gearRaised && agl > 8 && cr.pathAngle > 0) {
        out.push({ kind: 'gear' });
        gearRaised = true;
      }
      if (cr.z >= CRUISE_Z * 0.6) phase = 'cruise';
    } else if (phase === 'cruise') {
      const left = Math.hypot(fix.x - cr.x, fix.y - cr.y);
      turnErr = bearing(fix);
      const want = left < 1500 ? field + 130 : CRUISE_Z;
      pathTarget = clamp((want - cr.z) * 0.01, -3 * DEG, 4 * DEG);
      const speed = left < 2000 ? 80 : 110;
      throttleTo = clamp(trimAt(speed, pathTarget, cr.z, scale.altitude, loaded).lever + 0.04 * (speed - cr.speed), 0.05, 1);
      if (left < 1500 && !cr.gearDown) out.push({ kind: 'gear' });
      if (left < 700) phase = 'final';
    }
    if (phase === 'final') {
      const f = arr.frame(cr.x, cr.y);
      gearCounts = s.tuning.gearDragCounts;
      const lateral = clamp(f.c, -400, 400);
      turnErr = bearing(arr.at(f.s + 150 + Math.abs(lateral) * 0.5, 0));
      const want = field + Math.max(0, (150 - f.s) * Math.tan(3 * DEG));
      pathTarget = clamp(-3 * DEG + (want - cr.z) * 0.003, -4.5 * DEG, -1.5 * DEG);
      throttleTo = clamp(trimAt(72, pathTarget, cr.z, scale.altitude, loaded, gearCounts).lever + 0.05 * (72 - cr.speed), 0, 1);
      if (agl < 14 && f.s > -100) {
        pathTarget = -(0.3 + (clamp(agl, 0, 14) / 14) * 2.2) * DEG;
        if (agl < 10) throttleTo = 0;
      }
      if (cr.onGround) phase = 'rollout';
    }
    if (phase === 'rollout') {
      throttleTo = 0;
      brake = true;
      turnErr = bearing(arr.at(arr.frame(cr.x, cr.y).s + 150, 0));
      pitchKey = cr.pitch > 1 * DEG ? -1 : 0;
    }

    const desiredBank = clamp(turnErr * 1.5, -35 * DEG, 35 * DEG);
    let turn: -1 | 0 | 1 = 0;
    if (cr.onGround) turn = turnErr > 0.7 * DEG ? 1 : turnErr < -0.7 * DEG ? -1 : 0;
    else turn = cr.bank < desiredBank - 2 * DEG ? 1 : cr.bank > desiredBank + 2 * DEG ? -1 : 0;
    let pitch: -1 | 0 | 1 = 0;
    if (pitchKey !== null) pitch = pitchKey;
    else {
      const target = trimAt(Math.max(cr.speed, 40), pathTarget, cr.z, scale.altitude, loaded, gearCounts).pitch;
      const predicted = cr.pitch + cr.pitchRate * 0.4;
      pitch = predicted < target - 0.3 * DEG ? 1 : predicted > target + 0.3 * DEG ? -1 : 0;
    }
    const throttle: -1 | 0 | 1 = cr.lever < throttleTo - 0.02 ? 1 : cr.lever > throttleTo + 0.02 ? -1 : 0;
    out.push({ kind: 'turn', value: turn }, { kind: 'pitch', value: pitch }, { kind: 'throttle', value: throttle }, { kind: 'brake', value: brake });
    return out;
  }
  return { step, get phase() { return phase; }, arrival: arr, runway: to };
}

describe('DCA to PHL', () => {
  it('takes off from DCA 01, flies to PHL, lands on 09R and stops on the runway', () => {
    const pilot = createPilot();
    let s = initialState(pickStart(starts, 'runway', 'DCA')!.spec);
    let stalled = false;
    let steps = 0;
    for (; steps < 60 * 400 && !s.crash && !landed(s); steps++) {
      s = applyCommands(s, pilot.step(s), world);
      s = advance(s, world);
      if (stallState(s.craft, s.tuning) === 'stalled') stalled = true;
    }
    expect(s.crash, `crash ${JSON.stringify(s.crash)} phase ${pilot.phase} at ${steps / 60}s, ${s.craft.x}, ${s.craft.y}`).toBeNull();
    expect(stalled).toBe(false);
    expect(landed(s), `phase ${pilot.phase} at ${steps / 60}s`).toBe(true);
    const end = runwayFrame(pilot.runway, s.craft.x, s.craft.y);
    expect(end.along).toBeGreaterThan(0);
    expect(end.along).toBeLessThan(pilot.runway.length);
    expect(Math.abs(end.across)).toBeLessThan(pilot.runway.width / 2);
    console.log(`DCA to PHL: ${(steps / 60).toFixed(0)} s brakes-off to stop, touchdown sink ${s.touchdown!.sink.toFixed(1)} m/s, ${runwayFrame(pilot.runway, s.touchdown!.x, s.touchdown!.y).along.toFixed(0)} m past the threshold`);
  }, 60000);
});
