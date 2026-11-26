import { SCALES } from '../src/config/scales';
import { advance, applyCommands, type SimWorld } from '../src/sim/step';
import { initialState, type Craft, type SimState } from '../src/sim/state';
import { groundKindAt } from '../src/sim/world/groundKind';
import { heightAt, worldHeight, worldWidth } from '../src/sim/world/grid';
import { withAirports } from '../src/sim/world/placeAirports';
import { runwayStart } from '../src/sim/world/starts';
import { buildTestAirport } from '../src/sim/world/testAirport';
import { buildTestMap } from '../src/sim/world/testMap';

/** A craft at rest in the air, for tests that need a whole one. */
export function craft(patch: Partial<Craft> = {}): Craft {
  return { x: 0, y: 0, z: 0, heading: 0, speed: 0, pathAngle: 0, pitch: 0, pitchRate: 0, pitchHold: 0, bank: 0, rollRate: 0, lever: 0, spool: 0, onGround: false, gearDown: false, gear: 0, flapLever: 0, flaps: 0, ...patch };
}

/** The real test map with its airport, as the sim sees it. */
export function realWorld() {
  const grid = withAirports(buildTestMap(), [buildTestAirport()]);
  const world: SimWorld = {
    width: worldWidth(grid),
    height: worldHeight(grid),
    heightAt: (x, y) => heightAt(grid, SCALES, x, y),
    altitudeScale: SCALES.altitude,
    groundKind: (x, y) => groundKindAt(grid, x, y),
  };
  const runway = grid.airports[0]!.runways[0]!;
  return { grid, world, runway };
}

/** Standing at the runway start, engine idle. */
export function runwayState(): { state: SimState; world: SimWorld } {
  const { world, runway } = realWorld();
  return { state: initialState(runwayStart(runway, world.heightAt)), world };
}

type Keys = { throttle?: -1 | 0 | 1; pitch?: -1 | 0 | 1; turn?: -1 | 0 | 1 };

/** Runs `pilot` (keys for this state) and one step, `n` times. */
export function fly(s: SimState, world: SimWorld, n: number, pilot: (s: SimState) => Keys = () => ({})): SimState {
  for (let i = 0; i < n; i++) {
    const k = pilot(s);
    s = applyCommands(
      s,
      [
        { kind: 'throttle', value: k.throttle ?? 0 },
        { kind: 'pitch', value: k.pitch ?? 0 },
        { kind: 'turn', value: k.turn ?? 0 },
      ],
      world,
    );
    s = advance(s, world);
  }
  return s;
}
