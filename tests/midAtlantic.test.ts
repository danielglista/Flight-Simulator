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
import { buildAirport, OFF_AIRPORT, runwayFrame, type Runway } from '../src/sim/world/airport';
import { airportAt, groundAt, heightAt, runwayAt, surfaceAt, waterLevelAt, worldHeight, worldWidth } from '../src/sim/world/grid';
import { groundKindAt } from '../src/sim/world/groundKind';
import { parseMap } from '../src/sim/world/mapFile';
import { createObstacles } from '../src/sim/world/obstacles';
import { midAtlanticDef, midAtlanticGrid } from '../src/sim/world/midAtlantic';
import { pickStart, startList } from '../src/sim/world/startList';
import { finalStart, runwayStart } from '../src/sim/world/starts';
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
    for (const rw of grid.airports.flatMap((a) => a.runways)) {
      for (let t = 0; t <= 1; t += 0.05) expect(districts).not.toContain(surfaceAt(grid, rw.a.x + (rw.b.x - rw.a.x) * t, rw.a.y + (rw.b.y - rw.a.y) * t));
    }
  });
  it('has DCA and PHL at their real runway names, lengths at 1:2', () => {
    expect(phl.runways.map((r) => r.names)).toEqual([['09R', '27L'], ['09L', '27R']]);
    expect(phl.runways[1]!.length).toBeCloseTo(2896 / 2, 3);
    expect(grid.airports.map((a) => a.ident)).toEqual(['DCA', 'PHL']);
    expect(dca.runways[0]!.names).toEqual(['01', '19']);
    expect(phl.runways[0]!.names).toEqual(['09R', '27L']);
    expect(dca.runways[0]!.length).toBeCloseTo(2185 / 2, 3);
    expect(phl.runways[0]!.length).toBeCloseTo(3658 / 2, 3);
    expect(scale).toEqual({ altitude: 5, geoDistance: 25 });
  });
  it('is flat, dry, paved runway from end to end, with grass past each end', () => {
    for (const [a, rw] of grid.airports.flatMap((a) => a.runways.map((rw) => [a, rw] as const))) {
      // World m of grass past each end: PHL's ground (E7.5) stops about 25 past its runways.
      const past = a.ident === 'PHL' ? 20 : 40;
      const ux = (rw.b.x - rw.a.x) / rw.length;
      const uy = (rw.b.y - rw.a.y) / rw.length;
      for (let s = -past; s <= rw.length + past; s += 7) {
        const x = rw.a.x + ux * s;
        const y = rw.a.y + uy * s;
        expect(world.heightAt(x, y)).toBeCloseTo(a.fieldElevationM / scale.altitude, 9);
        // A taxiway into a runway end reaches half its width (9 world m) past it.
        if (s >= 0 && s <= rw.length) expect(groundKindAt(grid, x, y)).toBe('paved');
        else if (s < -10 || s > rw.length + 10) expect(groundKindAt(grid, x, y)).toBe('grass');
        else expect(groundKindAt(grid, x, y)).not.toBe('rough');
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
    expect(() => midAtlanticDef({ ...map.airports[0]!, id: 'XYZ' }, 3)).toThrow(/XYZ/);
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
function createPilot(to = phl.runways[0]!, first: Phase = 'roll') {
  const from = dca.runways[0]!;
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
  let phase: Phase = first;
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

/** The same runway used the other way. */
const reversed = (rw: Runway): Runway => ({ ...rw, a: rw.b, b: rw.a, names: [rw.names[1], rw.names[0]], heading: (rw.heading + Math.PI) % (2 * Math.PI) });

describe('both PHL runways, both ways (E7.7)', () => {
  const ends = phl.runways.flatMap((rw) => [rw, reversed(rw)]).map((rw) => [rw.names[0], rw] as const);

  it.each(ends)('takes off from %s before the far end', (_, rw) => {
    let s = initialState(runwayStart(rw, world.heightAt));
    for (let i = 0; i < 60 * 60 && !s.crash && s.craft.onGround; i++) {
      const rotate = s.craft.speed >= vSpeeds(s.tuning).vr && s.craft.pitch < 9 * DEG;
      s = applyCommands(s, [{ kind: 'throttle', value: 1 }, { kind: 'pitch', value: rotate ? 1 : 0 }], world);
      s = advance(s, world);
    }
    expect(s.crash).toBeNull();
    expect(s.craft.onGround).toBe(false);
    expect(runwayFrame(rw, s.craft.x, s.craft.y).along).toBeLessThan(rw.length);
  });

  it.each(ends)('lands from the final for %s and stops on it', (_, rw) => {
    const pilot = createPilot(rw, 'final');
    // Flaps up: the scripted pilot trims for a clean wing.
    let s = initialState({ ...finalStart(rw, world.heightAt, scale.altitude, DEFAULT_TUNING), flapLever: 0 });
    for (let i = 0; i < 60 * 120 && !s.crash && !landed(s); i++) {
      s = applyCommands(s, pilot.step(s), world);
      s = advance(s, world);
    }
    expect(s.crash).toBeNull();
    const f = runwayFrame(rw, s.craft.x, s.craft.y);
    expect(landed(s), `${pilot.phase} along ${f.along} across ${f.across} z ${s.craft.z} speed ${s.craft.speed} ground ${s.craft.onGround} td ${JSON.stringify(s.touchdown)}`).toBe(true);
    expect(runwayAt(grid, s.craft.x, s.craft.y)?.runway.names.slice().sort()).toEqual(rw.names.slice().sort());
  });
});

describe('taxiways, aprons and gates (E7.8)', () => {
  const paved = (x: number, y: number): boolean => groundKindAt(grid, x, y) === 'paved';

  it('has 17 gates at DCA and 22 at PHL, each named once', () => {
    for (const [a, count] of [[dca, 17], [phl, 22]] as const) {
      expect(a.gates).toHaveLength(count);
      expect(new Set(a.gates!.map((g) => g.name)).size).toBe(count);
    }
  });

  it('keeps every taxiway, lead-in and stand on pavement', () => {
    for (const a of grid.airports) {
      for (const line of [...a.taxiways!, ...a.gates!.map((g) => g.leadIn)]) {
        for (let i = 1; i < line.length; i++) {
          const p = line[i - 1]!;
          const q = line[i]!;
          for (let k = 0; k <= 1; k += 0.05) {
            const x = p.x + (q.x - p.x) * k;
            const y = p.y + (q.y - p.y) * k;
            expect(paved(x, y), `${a.ident} ${x.toFixed(0)},${y.toFixed(0)}`).toBe(true);
          }
        }
      }
    }
  });

  it('paves nothing off the airport ground the map made', () => {
    for (const a of map.airports) {
      const def = midAtlanticDef(a, map.buildingHeightScale);
      const built = buildAirport(def);
      const bare = buildAirport({ ...def, taxiways: [], paving: [] });
      const off = built.surface.filter((code, i) => code !== bare.surface[i] && bare.surface[i] === OFF_AIRPORT);
      expect(off.length, a.id).toBe(0);
    }
  });

  it('connects every gate to every runway end along pavement, round the buildings', () => {
    const clear = (x: number, y: number): boolean => paved(x, y) && Number.isNaN(world.obstacleAt!(x, y));
    for (const a of grid.airports) {
      const step = a.cellSize;
      const key = (c: number, r: number): string => `${c},${r}`;
      const cell = (p: { x: number; y: number }) => [Math.floor((p.x - a.minX) / step), Math.floor((p.y - a.minY) / step)] as const;
      const seen = new Set<string>([key(...cell(a.runways[0]!.a))]);
      const queue = [cell(a.runways[0]!.a)];
      for (let i = 0; i < queue.length; i++) {
        const [c, r] = queue[i]!;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const next = [c + dc, r + dr] as const;
          if (seen.has(key(...next)) || !clear(a.minX + (next[0] + 0.5) * step, a.minY + (next[1] + 0.5) * step)) continue;
          seen.add(key(...next));
          queue.push(next);
        }
      }
      for (const g of a.gates!) expect(seen.has(key(...cell(g.stand))), `${a.ident} gate ${g.name}`).toBe(true);
      for (const rw of a.runways) for (const end of [rw.a, rw.b]) expect(seen.has(key(...cell(end))), `${a.ident} ${rw.names.join('/')}`).toBe(true);
    }
  });

  it('has a hold-short bar on every way onto a runway, 35 world m from its center line', () => {
    expect(dca.holdShort).toHaveLength(7);
    for (const a of grid.airports) {
      expect(a.holdShort!.length).toBeGreaterThan(0);
      for (const [p, q] of a.holdShort!) {
        const x = (p.x + q.x) / 2;
        const y = (p.y + q.y) / 2;
        const nearest = Math.min(...a.runways.map((rw) => Math.abs(runwayFrame(rw, x, y).across)));
        expect(nearest).toBeCloseTo(35, 3);
      }
    }
  });
});

describe('airport buildings (E7.9)', () => {
  const solids = grid.airports.flatMap((a) => a.structures!.solids.map((s) => [a, s] as const));
  const corners = (s: (typeof solids)[number][1]): (readonly [number, number])[] =>
    s.points ? s.points.flatMap((v, i) => (i % 2 === 0 ? [[v, s.points![i + 1]!] as const] : [])) : [[s.x - s.width / 2, s.y], [s.x + s.width / 2, s.y], [s.x, s.y - s.width / 2], [s.x, s.y + s.width / 2]];

  it('stands every building on its airport ground, off the runways', () => {
    for (const [a, s] of solids) {
      for (const [x, y] of corners(s)) {
        expect(airportAt(grid, x, y)?.ident, `${a.ident} ${s.material} ${x.toFixed(0)},${y.toFixed(0)}`).toBe(a.ident);
        expect(runwayAt(grid, x, y)).toBeNull();
      }
    }
  });

  it('has the heights of §11.6, scaled like city buildings', () => {
    for (const a of grid.airports) {
      const tallest = Math.max(...a.structures!.solids.map((s) => s.top));
      expect(tallest).toBeCloseTo(45 / 3, 6);
    }
  });

  it('keeps clear of taxiways, lead-ins and stands', () => {
    const hit = world.obstacleAt!;
    for (const a of grid.airports) {
      const check = (line: readonly { x: number; y: number }[], room: number): void => {
        for (let i = 1; i < line.length; i++) {
          const p = line[i - 1]!;
          const q = line[i]!;
          for (let k = 0; k <= 1; k += 0.02) {
            const x = p.x + (q.x - p.x) * k;
            const y = p.y + (q.y - p.y) * k;
            for (let turn = 0; turn < 8; turn++) {
              const angle = (turn * Math.PI) / 4;
              expect(hit(x + Math.cos(angle) * room, y + Math.sin(angle) * room), `${a.ident} ${x.toFixed(0)},${y.toFixed(0)}`).toBeNaN();
            }
          }
        }
      };
      for (const line of a.taxiways!) check(line, 9);
      for (const g of a.gates!) check(g.leadIn, 5);
    }
  });

  it('crashes a plane that taxis into a terminal', () => {
    const gate = dca.gates!.find((g) => g.name === 'B1')!;
    // From the stand, straight on into the pier.
    let s = initialState({ ...runwayStart(dca.runways[0]!, world.heightAt), x: gate.stand.x, y: gate.stand.y, heading: gate.heading });
    for (let i = 0; i < 60 * 30 && !s.crash; i++) {
      s = applyCommands(s, [{ kind: 'throttle', value: s.craft.lever < 0.5 ? 1 : 0 }], world);
      s = advance(s, world);
    }
    expect(s.crash?.cause).toBe('building');
    expect(Math.hypot(s.craft.x - gate.stand.x, s.craft.y - gate.stand.y)).toBeLessThan(12);
  });

  it('parks cars and freighters on the ground, not solid', () => {
    expect(dca.structures!.decor.filter((d) => d.detail).length).toBeGreaterThan(200);
    expect(phl.structures!.decor.filter((d) => d.material === 'freighter')).toHaveLength(4);
  });
});
