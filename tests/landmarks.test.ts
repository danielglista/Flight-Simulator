import { describe, expect, it } from 'vitest';
import mapUrl from '../public/maps/mid-atlantic.bin?inline';
import landmarksJson from '../data/map/landmarks.json';
import { LANDMARK_COLORS } from '../src/config/palette';
import { sweepContact } from '../src/sim/contact';
import { terrainAhead } from '../src/sim/flight/terrain';
import { createGrid, groundAt, heightAt, type WorldGrid } from '../src/sim/world/grid';
import { parseMap, type LandmarkSolid } from '../src/sim/world/mapFile';
import { midAtlanticGrid } from '../src/sim/world/midAtlantic';
import { createObstacles, landmarkCircle, solidBox, solidCorners, solidTopAt } from '../src/sim/world/obstacles';
import { buildLandmarks, landmarkClear } from '../tools/map/landmarks';
import { validateLandmarks } from '../tools/map/validate';

const file = validateLandmarks(landmarksJson, ['dc', 'phl-city']);
const scale = { altitude: 5, geoDistance: 25 };

describe('landmark data', () => {
  it('names only materials that have a color', () => {
    for (const l of file.landmarks) for (const part of [...l.solids, ...l.decor]) expect(LANDMARK_COLORS[part.material], part.material).toBeDefined();
  });
  it('is refused with an overhang, an unknown city or an odd line, naming the entry', () => {
    const [l] = landmarksJson.landmarks;
    const bad = (patch: object) => () => validateLandmarks({ footprintScale: 2.5, landmarks: [{ ...l, ...patch }] }, ['dc']);
    expect(bad({ solids: [{ ...l!.solids[0], topW: 20 }] })).toThrow(/washington-monument.*topW/);
    expect(bad({ cityId: 'x' })).toThrow(/unknown city/);
    expect(bad({ decor: [{ kind: 'line', width: 5, material: 'path', points: [0, 0, 1] }] })).toThrow(/points/);
  });
  it('is converted about its warped center: plan by the footprint scale, height by the building one', () => {
    const [m] = buildLandmarks(file, () => ({ x: 1000, y: 2000 }), 3);
    expect(m!.solids[0]!.width).toBeCloseTo(16.8 / 2.5, 2);
    expect(m!.solids[2]!.top).toBeCloseTo(169.3 / 3, 2);
    expect(m!.solids[3]!.x).toBeCloseTo(1000 + 12 / 2.5, 2);
    expect(m!.posts!.radius).toBeCloseTo(38 / 2.5, 2);
    const clear = landmarkClear(file, [m!]);
    expect(clear(1000, 2030)).toBe(true);
    expect(clear(1000, 2033)).toBe(false);
  });
});

// A shaft 10 wide narrowing to 6 at 40, with a pyramid to 50.
const shaft: LandmarkSolid = { x: 100, y: 100, width: 10, depth: 10, topWidth: 6, topDepth: 6, bottom: 0, top: 40, material: 'marble-upper' };
const tip: LandmarkSolid = { ...shaft, width: 6, depth: 6, topWidth: 0, topDepth: 0, bottom: 40, top: 50 };
const grid: WorldGrid = { ...createGrid(40, 40, 10), landmarks: [{ id: 't', x: 100, y: 100, solids: [shaft, tip], decor: [] }] };
const at = createObstacles(grid, scale);

describe('a landmark as a thing to hit', () => {
  it('slopes where it narrows and is nothing outside', () => {
    expect(solidTopAt(shaft, 100, 100)).toBe(40);
    expect(solidTopAt(shaft, 104, 100)).toBeCloseTo(20, 6);
    expect(solidTopAt(shaft, 105.1, 100)).toBeNaN();
    expect(at(100, 100)).toBeCloseTo(50, 6);
    expect(at(101.5, 100)).toBeCloseTo(45, 6);
    expect(at(104, 100)).toBeCloseTo(20, 6);
    expect(at(120, 100)).toBeNaN();
  });
  it('is hit head on, even fast, and missed beside and above', () => {
    const flat = (): number => 0;
    const pass = (x: number, z: number) => sweepContact(flat, { x, y: 60, z }, { x, y: 140, z }, at);
    expect(pass(100, 30)?.building).toBe(true);
    expect(pass(100, 30)!.y).toBeCloseTo(96.5, 1);
    expect(pass(106, 30)).toBeNull();
    expect(pass(100, 50.2)).toBeNull();
  });
  it('sets off the terrain warning', () => {
    const craft = { x: 100, y: 0, z: 30, heading: 0, speed: 90, pathAngle: 0, onGround: false, gear: 0 };
    expect(terrainAhead(craft, () => 0, false, at)).toBe(true);
    expect(terrainAhead({ ...craft, x: 130 }, () => 0, false, at)).toBe(false);
  });
});

describe('the Washington Monument on the built map', () => {
  const bytes = Uint8Array.from(atob(mapUrl.slice(mapUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  const map = parseMap(bytes.buffer);
  const built = midAtlanticGrid(map);
  it('stands at the DC center, about 56 m tall, with no ordinary building on its grounds', () => {
    const m = built.landmarks!.find((l) => l.id === 'washington-monument')!;
    expect(Math.abs(m.x - 4723)).toBeLessThan(2);
    expect(Math.abs(m.y - 7057)).toBeLessThan(2);
    const ground = groundAt(built, scale, m.x, m.y);
    expect(createObstacles(built, scale)(m.x, m.y)).toBeCloseTo(ground + 169.3 / 3, 1);
    expect(built.buildings!.filter((b) => Math.hypot(b.x - m.x, b.y - m.y) < 32)).toEqual([]);
  });
});

describe('round solids and the Capitol', () => {
  const drum: LandmarkSolid = { x: 0, y: 0, width: 10, depth: 10, topWidth: 6, topDepth: 6, bottom: 10, top: 20, material: 'capitol-dome', shape: 'drum' };
  const dome: LandmarkSolid = { ...drum, topWidth: 0, topDepth: 0, shape: 'dome' };
  it('is round in plan, tapered as a drum and curved as a dome', () => {
    expect(solidTopAt(drum, 4, 4)).toBeNaN(); // inside the square, outside the circle
    expect(solidTopAt(drum, 0, 2)).toBe(20);
    expect(solidTopAt(drum, 4, 0)).toBeCloseTo(15, 6);
    expect(solidTopAt(dome, 0, 0)).toBe(20);
    expect(solidTopAt(dome, 3, 0)).toBeCloseTo(18, 6);
    expect(solidTopAt(dome, 5.1, 0)).toBeNaN();
  });
  it('is refused when a round solid is not round', () => {
    const [l] = landmarksJson.landmarks;
    const bad = { ...l!, solids: [{ ...l!.solids[0]!, shape: 'dome', d: 16 }] };
    expect(() => validateLandmarks({ footprintScale: 2.5, landmarks: [bad] }, ['dc'])).toThrow(/round/);
  });
  it('stands on the built map with the statue about 29 m up and no ordinary building around it', () => {
    const bytes = Uint8Array.from(atob(mapUrl.slice(mapUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));
    const built = midAtlanticGrid(parseMap(bytes.buffer));
    const c = built.landmarks!.find((l) => l.id === 'us-capitol')!;
    expect(createObstacles(built, scale)(c.x, c.y)).toBeCloseTo(groundAt(built, scale, c.x, c.y) + 88 / 3, 1);
    expect(built.buildings!.filter((b) => Math.hypot(b.x - c.x, b.y - c.y) < 68)).toEqual([]);
  });
});

describe('prisms, the Lincoln Memorial and the Pentagon', () => {
  // A triangle, counterclockwise.
  const wedge: LandmarkSolid = { x: 5, y: 5, width: 10, depth: 10, topWidth: 10, topDepth: 10, bottom: 0, top: 8, material: 'pentagon-stone', shape: 'prism', points: [0, 0, 10, 0, 0, 10] };
  it('is flat topped inside its outline and nothing outside', () => {
    expect(solidTopAt(wedge, 2, 2)).toBe(8);
    expect(solidTopAt(wedge, 8, 8)).toBeNaN();
    expect(solidTopAt(wedge, -1, 5)).toBeNaN();
  });
  it('is refused clockwise, and boxed from its corners', () => {
    const of = (points: number[]) => () => validateLandmarks({ footprintScale: 2.5, landmarks: [{ ...landmarksJson.landmarks[0]!, solids: [{ shape: 'prism', points, bottom: 0, top: 5, material: 'path' }] }] }, ['dc']);
    expect(of([0, 0, 0, 10, 10, 0])).toThrow(/counterclockwise/);
    expect(of([0, 0, 10, 0, 0, 20])().landmarks[0]!.solids[0]).toMatchObject({ x: 5, y: 10, w: 10, d: 20 });
  });
  const bytes = Uint8Array.from(atob(mapUrl.slice(mapUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  const built = midAtlanticGrid(parseMap(bytes.buffer));
  const hit = createObstacles(built, scale);
  const named = (id: string) => built.landmarks!.find((l) => l.id === id)!;
  it('has an open courtyard in the Pentagon and walls about 8 m up around it', () => {
    const p = named('pentagon');
    expect(hit(p.x, p.y)).toBeNaN();
    // South of the center, the outer ring: 0.92 of the way to a corner that points nearly south.
    const a = (171 * Math.PI) / 180;
    const d = (239 * 0.92) / 2.5;
    expect(hit(p.x + Math.sin(a) * d, p.y + Math.cos(a) * d)).toBeCloseTo(groundAt(built, scale, p.x, p.y) + 23.5 / 3, 1);
  });
  it('has the Lincoln Memorial about 10 m tall, with clear air over the pool', () => {
    const l = named('lincoln-memorial');
    expect(hit(l.x, l.y)).toBeCloseTo(groundAt(built, scale, l.x, l.y) + 10, 1);
    expect(hit(l.x + 150, l.y)).toBeNaN();
  });
});

describe('turned solids', () => {
  const bar: LandmarkSolid = { x: 0, y: 0, width: 20, depth: 4, topWidth: 20, topDepth: 4, bottom: 0, top: 5, material: 'path', turn: 90 };
  it('has its width running round clockwise from east', () => {
    expect(solidTopAt(bar, 0, 9)).toBe(5);
    expect(solidTopAt(bar, 9, 0)).toBeNaN();
    const [sw] = solidCorners({ x: 0, y: 0, turn: 90 }, 20, 4);
    expect(sw[0]).toBeCloseTo(-2, 6);
    expect(sw[1]).toBeCloseTo(10, 6);
  });
  it('turns a whole landmark, its offsets and wires with it', () => {
    const [l] = landmarksJson.landmarks;
    const spec = validateLandmarks({ footprintScale: 2, landmarks: [{ ...l, turn: 90, solids: [{ ...l!.solids[0]!, x: 10, y: 0 }], wires: [{ material: 'path', points: [0, 20, 6, 0, 0, 0] }] }] }, ['dc']);
    const [m] = buildLandmarks(spec, () => ({ x: 100, y: 100 }), 3);
    expect(m!.solids[0]).toMatchObject({ x: 100, y: 95, turn: 90 });
    expect(m!.wires![0]!.points).toEqual([110, 100, 2, 100, 100, 0]);
  });
});

describe('the Philadelphia landmarks', () => {
  const bytes = Uint8Array.from(atob(mapUrl.slice(mapUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  const built = midAtlanticGrid(parseMap(bytes.buffer));
  const hit = createObstacles(built, scale);
  const named = (id: string) => built.landmarks!.find((l) => l.id === id)!;
  const bridge = named('ben-franklin-bridge');
  const water = heightAt(built, scale, bridge.x, bridge.y);
  // Along the deck (azimuth 102.8) and across it.
  const a = (102.8 * Math.PI) / 180;
  const onDeck = (s: number, t = 0) => ({ x: bridge.x + Math.sin(a) * s - Math.cos(a) * t, y: bridge.y + Math.cos(a) * s + Math.sin(a) * t });
  const across = (s: number, z: number) => sweepContact((x, y) => heightAt(built, scale, x, y), { ...onDeck(s, -40), z: water + z }, { ...onDeck(s, 40), z: water + z }, hit);

  it('lets a plane under the bridge deck, and stops one at the deck or a tower', () => {
    for (const s of [-45, 0, 30, 45]) {
      expect(across(s, 7)).toBeNull();
      expect(across(s, 13.5)).toBeNull();
      expect(across(s, 15)?.building).toBe(true);
    }
    expect(across(62, 7)?.building).toBe(true);
    expect(across(0, 45)).toBeNull();
    // Without a height, as when placing the plane, the deck counts.
    const mid = onDeck(10);
    expect(hit(mid.x, mid.y)).toBeCloseTo(water + 17, 1);
    expect(hit(mid.x, mid.y, water + 5)).toBeNaN();
  });
  it('gives no terrain warning from a deck overhead', () => {
    const craft = { ...onDeck(0, -60), z: 12, heading: (12.8 * Math.PI) / 180, speed: 40, pathAngle: 0, onGround: false, gear: 0 };
    expect(terrainAhead({ ...craft, z: water + 12 }, () => water - 100, false, hit)).toBe(false);
    expect(terrainAhead({ ...craft, z: water + 15 }, () => water - 100, false, hit)).toBe(true);
  });
  it('has the bridge over the river, along the highway, with its middle over water', () => {
    expect(water).toBeGreaterThan(groundAt(built, scale, bridge.x, bridge.y));
    for (const r of built.roads!.filter((r) => r.bridge)) {
      const [x, y] = [r.points[0]!, r.points[1]!];
      if (Math.hypot(x - bridge.x, y - bridge.y) < 100) expect(Math.abs((x - bridge.x) * Math.cos(a) - (y - bridge.y) * Math.sin(a))).toBeLessThan(2);
    }
  });
  it('has City Hall with an open courtyard and its statue about 56 m up', () => {
    const c = named('city-hall');
    const ground = groundAt(built, scale, c.x, c.y);
    expect(hit(c.x, c.y)).toBeNaN();
    const t = (9 * Math.PI) / 180;
    expect(hit(c.x + (Math.sin(t) * 48) / 2.5, c.y + (Math.cos(t) * 48) / 2.5)).toBeCloseTo(ground + 167 / 3, 1);
  });
  it('has the Art Museum on a hill about 5 m up, its roof ridge about 17', () => {
    const m = named('art-museum');
    const ground = groundAt(built, scale, m.x, m.y);
    const t = (-46 * Math.PI) / 180;
    // In the landmark's own frame, real m: the open forecourt, then the middle of the temple front's roof.
    const at = (px: number, py: number): number => hit(m.x + (px * Math.cos(t) + py * Math.sin(t)) / 2.5, m.y + (-px * Math.sin(t) + py * Math.cos(t)) / 2.5);
    expect(at(30, -50)).toBeCloseTo(ground + 15.3 / 3, 1);
    expect(at(0, 31)).toBeCloseTo(ground + 50 / 3, 1);
    expect(at(0, -90)).toBeGreaterThan(ground);
    expect(at(0, -90)).toBeLessThan(ground + 5);
  });
  it('has the three skyscrapers at a third of their real heights', () => {
    for (const [id, real] of [['one-liberty-place', 288], ['two-liberty-place', 258], ['comcast-technology-center', 342]] as const) {
      const l = named(id);
      expect(Math.max(...l.solids.map((s) => s.top)), id).toBeCloseTo(real / 3, 1);
    }
  });
  it('keeps ordinary buildings off them all, and those on land dry and clear of highways', () => {
    // Faults are gathered and checked once: an expect per corner and building is too slow.
    const faults: string[] = [];
    for (const id of ['city-hall', 'art-museum', 'ben-franklin-bridge', 'one-liberty-place', 'two-liberty-place', 'comcast-technology-center']) {
      const l = named(id);
      const near = built.buildings!.filter((b) => Math.hypot(b.x - l.x, b.y - l.y) < 300);
      for (const s of l.solids) {
        for (const [x, y] of [...solidCorners(s, s.width, s.depth), [s.x, s.y] as const]) {
          const over = near.some((b) => {
            const t = (b.angle * Math.PI) / 180;
            const [dx, dy] = [x - b.x, y - b.y];
            return Math.abs(dx * Math.sin(t) + dy * Math.cos(t)) < b.width / 2 && Math.abs(dx * Math.cos(t) - dy * Math.sin(t)) < b.depth / 2;
          });
          if (over) faults.push(`${id}: a building at ${x},${y}`);
          if (id === 'ben-franklin-bridge') continue;
          if (heightAt(built, scale, x, y) !== groundAt(built, scale, x, y)) faults.push(`${id}: water at ${x},${y}`);
          for (const r of built.roads!) {
            for (let i = 0; i + 3 < r.points.length; i += 2) {
              const [ax, ay, bx, by] = [r.points[i]!, r.points[i + 1]!, r.points[i + 2]!, r.points[i + 3]!];
              const f = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1)));
              if (Math.hypot(x - ax - (bx - ax) * f, y - ay - (by - ay) * f) <= 8) faults.push(`${id}: a road at ${x},${y}`);
            }
          }
        }
      }
    }
    expect(faults).toEqual([]);
  });
});

describe('the boxes that let far landmarks be skipped', () => {
  const bytes = Uint8Array.from(atob(mapUrl.slice(mapUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  const built = midAtlanticGrid(parseMap(bytes.buffer));
  it('hold every point where a solid has a surface, and every corner within the landmark circle', () => {
    const faults: string[] = [];
    for (const l of built.landmarks!) {
      const c = landmarkCircle(l);
      for (const s of l.solids) {
        const b = solidBox(s);
        for (const [x, y] of [[b.minX, b.minY], [b.maxX, b.maxY]]) if (Math.hypot(x! - c.x, y! - c.y) > c.radius + 0.1) faults.push(`${l.id}: outside the circle`);
        // Just outside the box there is nothing of this solid.
        for (let i = 0; i <= 8; i++) {
          const x = b.minX + ((b.maxX - b.minX) * i) / 8;
          const y = b.minY + ((b.maxY - b.minY) * i) / 8;
          for (const [px, py] of [[x, b.minY - 0.01], [x, b.maxY + 0.01], [b.minX - 0.01, y], [b.maxX + 0.01, y]]) if (solidTopAt(s, px!, py!) >= 0) faults.push(`${l.id}: a solid outside its box`);
        }
      }
    }
    expect(faults).toEqual([]);
  });
});
