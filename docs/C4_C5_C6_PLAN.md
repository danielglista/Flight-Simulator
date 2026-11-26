# C4 + C5 + C6 Implementation Plan: Takeoff, landing, flaps, gear and brakes

**Status:** C4 built (see §15). **C4B built (§16)**: takeoff HUD mode, V-speeds, landing gear, ground zoom. It came from feedback after flying C4, and pulled gear forward from C6 and the close side zoom from C5. **C5 built (§17).** **C6 built (§18).**
**Milestones (ARCHITECTURE.md §14):** C4 "Plane can leave the runway." C5 "A full circuit can be flown." C6 "Flaps, gear and brakes change how takeoff and landing feel."
**Starting state:** C3 to C3E committed (`024b36b`), 355 tests. D4A (altitude hold) is planned, not built, and not needed here.

One plan because all three share one ground model. They are still **three gates**: each is playable alone, and each must pass its tests (§10) before the next starts. One commit each, if commits are asked for.

All numbers are provisional. "m" means world meters unless it says real. Figures marked *(prototyped)* come from a throwaway script of §4 to §6 over flat ground, in still air, not from game code. Scripted controls flew it; nobody has, so feel is untested.

## 1. Scope

| C4 | C5 | C6 |
|---|---|---|
| Ground state, ground kinds (paved, grass, rough) | Touchdown check: survive or crash, with a cause | Flaps: three positions, lift, drag, stall shift |
| Ground roll: thrust, drag, rolling friction, steering | **Brakes (pulled forward from C6)**, automatic spoilers | Gear: up / down, drag, gear-up crash |
| Rotation and liftoff | Landing result and restart after it | Readouts, warnings and sprites for both |
| Start on the runway; other starts from the debug panel | Final-approach start; closer side zoom; height readout | Tune takeoff, landing and brake values |
| Plane drawn standing on its wheels | Crash causes in the banner | |

Why brakes move: with friction and drag alone, a plane landing at 66 m/s rolls over 3 km *(prototyped)*. The runway is 1,050 m, so C5's circuit cannot end without brakes. C6 still tunes them.

**Out:**

| Left out | Where it belongs |
|---|---|
| Taxi routes, gates, hold-short, runway occupancy | G3 to G5 |
| Crosswind, crab, wet braking | G6, G7 |
| Co-pilot or autopilot on the ground | F6, D4. If D4A is built later it must refuse on the ground |
| Grades and debrief (only raw landing numbers here) | H4 |
| Drawn levers, flap and gear indicators, warning lights, brake gauge | D3 |
| Automatic zoom by phase | A two-level ground/air gate is C4B (§16). Continuous or finer phase zoom is later; GAME_DESIGN.md §3.1 |
| Overspeed warning, flap damage, tire or brake heat, tail-strike damage, reverse thrust, ground effect, bounce physics, gear failure | Not planned now |
| Ditching, off-airport landings, buildings as obstacles | Not planned; still crashes |
| Glide slope guidance (PAPI, glide path line) | Decide after C5 is flown (§12) |

## 2. Behavior

| Input | Today | C4 | C5 | C6 |
|---|---|---|---|---|
| A / D on the ground | n/a | Steer | Same | Same |
| S / W on the ground | n/a | Raise / lower the nose once fast enough | Same | Same |
| Space, in the air | Wings level | Same | Same | Same |
| **Space, on the ground** | n/a | Nothing | **Brakes while held** | Same |
| F / R | n/a | n/a | n/a | Flaps one step out / in |
| G | n/a | n/a | n/a | Gear up / down (refused on the ground) |
| Enter | Restart after a crash | Same | Also after landing and stopping | Same |

**Page load changes in C4:** the plane stands on runway 07, 40 m past the threshold, engine idle. Today's air start stays available (§7.4).

Expected flights *(prototyped)*:

| Flight | Result |
|---|---|
| C4: full power, rotate at 62 m/s toward 10 deg | Lifts off at 68 m/s after 415 m; 15 m up at 765 m, 18 s |
| C4: full power, S held from the start | Lifts off at 64 m/s after 375 m, 12 s; keeps flying, does not stall in the next 10 s |
| C4: full power, never rotate | Never leaves the ground; runs off the end |
| C5: clean, 3 deg approach at 78 m/s, no flare | Touches at 4.2 m/s (hard, survives); rolls 665 m braking |
| C5: same, flare from 6 m | 2.6 m/s at 71 m/s; rolls 550 m. Floats 350 m past the aim point |
| C6: takeoff with flaps 1 / 2, rotate at 58 | Lifts off at 63 / 62 m/s; 15 m up at 645 / 580 m (clean: 770) |
| C6: full flaps, 69 m/s, no flare | 2.9 m/s; rolls 540 m |
| C6: same, flare from 6 m | 2.2 m/s at 64 m/s; rolls 450 m, floats about 195 m |
| C6: clean landing | Still possible, but uses nearly all of the runway |

The takeoff and landing rows were all run with C6's gear drag, so C4 and C5 will accelerate and float slightly more.

A single S press as the flare works over a wide band: with full flaps, 0.5 s of S started anywhere from 4 to 12 m up gives 1.4 to 3.3 m/s; 0.8 s at 8 m balloons, then drops at 5.4 m/s (crash). *(prototyped, idle at the flare)*

## 3. State and world

### 3.1 Ground kinds

```ts
export type GroundKind = 'paved' | 'grass' | 'rough';
interface SimWorld { ...; groundKind(x: number, y: number): GroundKind }
```

- New `sim/world/groundKind.ts`: `groundKindAt(grid, x, y)`. `paved` is runway, taxiway or apron; `grass` is any other surface **inside an airport where the ground is flat** (`blendWeight` is 1); everything else, water included, is `rough`.
- `paved` requires the flat area too, so paving never sits on a slope.
- `rough` always means a crash, rolling or touching down. That keeps every present crash on invented ground, and means the ground model never needs slopes: wheels only ever roll on flat ground.
- Required, not optional, so a world cannot forget it. Seven test files build a `SimWorld`; they add `groundKind: () => 'rough'`, which is today's behavior.
- Past the end of runway 07 there are about 76 m of flat grass, then the blend band. Going further is the overrun crash GAME_DESIGN.md §2 asks for.

### 3.2 Craft and SimState

| Field | Step | Meaning |
|---|---|---|
| `craft.onGround: boolean` | C4 | Wheels on the ground. `z` is then exactly `heightAt` |
| `controls.brake: boolean` | C5 | Space held |
| `touchdown: Touchdown \| null` | C5 | The last touchdown |
| `liftoffTick: number \| null` | C5 | For joining a skip with the touchdown before it |
| `crash.cause: CrashCause` | C5 | Why |
| `craft.flapLever: 0 \| 1 \| 2`, `craft.flaps: 0..1` | C6 | Chosen step, and actual position |
| `craft.gearDown: boolean`, `craft.gear: 0..1` | C4B | Chosen, and actual position (1 is down and locked) |
| `start: StartSpec` | C4 | Where `restart` goes (§7.4) |

```ts
interface Touchdown { tick; x; y; heading; sink; speed; bank; pitch; kind }   // sink m/s, positive down
type CrashCause = 'terrain' | 'hard' | 'bank' | 'nose' | 'tail' | 'overrun' | 'gear'; // 'gear' from C5 (gear state is C4B)
```

- Interpolation: numbers as now; `onGround`, `flapLever`, `gearDown` take the newer step's value.
- `heading` is also the direction of travel on the ground. No skids.
- Spoilers need no state; they follow from `onGround` and the lever (§5.2).

## 4. Ground roll (C4), new `sim/flight/ground.ts`, pure

`advance` runs either the air step (unchanged) or the ground step, chosen by `craft.onGround`. Engine and lever are shared and come first.

### 4.1 Forces along the runway

```text
L, D    from aero at alpha = pitch (path is 0)
N       = max(0, m*G - L*lift - T*sin(pitch))          lift = 1 in C4, see 5.2
accel   = (groundMult * T*cos(pitch) - D) / m
friction= mu * N / m          mu: paved ROLL_MU, grass GRASS_MU, plus brakes (C5)
speed   = max(0, speed + accel*dt), then friction removes at most what is left, so a stopped plane stays stopped
position= along heading, at the average speed; z = heightAt(x, y)
```

- `groundMult` (1.5) multiplies thrust only while on the ground: GAME_DESIGN.md's ground acceleration allowance. It deliberately adds energy, so energy tests stay airborne.
- On the ground speed runs 0 to `SPEED_CAP`. `SPEED_FLOOR` stays an airborne rule; liftoff cannot happen anywhere near 20 m/s.
- After moving: `rough` underneath is a crash, cause `overrun`. Map edges clamp as now.

### 4.2 Steering

```text
rate     = key * min(V / STEER_RADIUS, STEER_MAX, STEER_LATERAL / V)
heading += rate * dt
```

Zero at rest, tight when taxiing (15 m radius, at most 20 deg/s), 2.9 deg/s at 60 m/s, so the runway (22.5 m wide) can be held with taps. Grass steers the same.

### 4.3 Nose and bank

```text
Ve     = V * sqrt(sigma)
auth   = clamp((Ve - 35) / 20, 0, 1)
pitch rate follows key * pitchRateDegS * auth through PITCH_LAG
pitch -= (1 - auth) * NOSE_FALL * dt              the nose comes down as the tail loses bite
pitch held to 0 .. TAIL_LIMIT (11 deg); from above it eases down at NOSE_FALL_MAX, never snaps
bank   eases to 0 (0.3 s); rollRate = 0; wings level cleared; turn help not applied
```

As in the air, a released nose stays where it is while there is authority. The tail limit is a stop, not a strike. It sits below the stall (13.9 deg lift peak), so a full pull cannot stall the plane on the runway.

### 4.4 Liftoff

When `L*lift + T*sin(pitch) > LIFTOFF_MARGIN * m*G` (1.01): `onGround` false, `pathAngle` 0, `z` raised by `LIFTOFF_CLEAR` (0.05 m), `liftoffTick` set. The gap exists because `sweepContact` counts touching as contact and the next step would otherwise land at once. Not scripted: too little speed or pitch simply does not fly, and the plane can be held down.

In C4 there is no survivable landing yet: **any** contact from the air is still a crash, except that contact within 1 s of liftoff settles back onto wheels if the ground is not rough. C5 replaces that exception.

## 5. Touchdown and stopping (C5)

### 5.1 The check

`sweepContact` finds the contact point as now. `touchdownCheck` (pure, in `ground.ts`) then returns a cause, or null for a landing. Checked in this order:

| Cause | Crash when | Why this value |
|---|---|---|
| `terrain` | ground is `rough` | Off the airport, or water |
| `gear` | gear not fully down (state from C4B) | A belly landing |
| `hard` | sink > `touchdownSinkMs` (5) | An unflared 3 deg approach clean is 4.2, so it just survives |
| `bank` | bank over 15 deg | Wingtip |
| `nose` | pitch under -3 deg | Nose wheel first |
| `tail` | pitch over 16 deg | Above the stall attitude, so only a stalled drop |

A landing on grass inside the flat area is allowed; it is reported as off the runway. Otherwise: `onGround` true, `z` on the ground, `speed *= cos(path)`, `pathAngle` 0, pitch and heading kept, `touchdown` recorded. There is no bounce. Dropping the path to 0 also drops the angle of attack, which takes most of the lift off.

**Skips:** if the plane lifts off and touches again within 5 s, the new record keeps the larger of the two sinks, so a skip cannot hide a hard arrival.

### 5.2 Brakes and spoilers

- **Brakes:** while Space is held, add `brakeMu` (0.40 paved; grass uses `GRASS_BRAKE_MU` 0.20). They push only with the weight on the wheels, `N`.
- **Spoilers, automatic:** on the ground with the lever at or below 10%, lift is multiplied by `SPOILER_LIFT` (0.3) and drag gains `SPOILER_CD` (0.06). No key, no state.

Spoilers are in the plan because the prototype needed them twice. Without them a good flare lands with more lift than weight and flies off again, and full flaps make the braking distance **longer** (66 m/s: 650 m against 535 m clean) because lift unloads the wheels. With them it is 475 m either way. Power above 10% stows them, so touch-and-go works and landing with power on skips: an understandable mistake with an understandable fix.

### 5.3 After landing

- `landed(state)`: a touchdown, on the ground, speed under 0.5 m/s, not crashed.
- Banner, not red: `LANDED: runway 07 TST, 380 ft/min, 210 m past threshold, 3 m left - Enter to restart`. Off the runway: `LANDED: grass, off runway, ...`. Runway, distance and offset come from `runwayAt` and `runwayFrame` in the view, from the touchdown's `x`, `y` and `heading` (which end was used). World meters; no grade.
- It disappears when the plane rolls above 2 m/s. Throttle up to fly again, or press Enter.
- The crash banner gains the cause: `CRASHED: runway 07 TST, hard landing 1,240 ft/min - Enter to restart`; `terrain` reads as today. `Crash` gains `sink` for this.
- `restart` is accepted when crashed **or landed**, never in flight.

### 5.4 Seeing the flare

- **Side zoom (moved to C4B, §16.4, which also adds it to the top view):** append a level of 0.5 m per pixel (equal horizontal and vertical) to `SIDE_ZOOM_LEVELS`. At today's closest, 1.25, a 6 m flare is 5 pixels. The default does not change; the player zooms by wheel.
- **Height readout:** text by the plumb line, `AGL 120 ft`, in displayed feet like `ALT`, shown under 60 m (2,000 ft). A pure formatter and a `heightAboveGround` helper. Note displayed feet run 10 times world feet: a 6 m flare starts at `AGL 200 ft`. Sink in the banner is unscaled, like `V/S`.

## 6. Flaps and gear (C6)

### 6.1 Flaps

`wingAt(flaps, tuning)` returns `{ cl0, stallRad, cd0 }`; every caller of `aeroAt`, `liftAngle` and `stallState` (forces, ceiling, debug panel's level stall) uses it. This is the parameter hook C2 left.

| Step | Position | Level stall, indicated *(prototyped)* |
|---|---|---|
| 0 up | 0 | 60.6 m/s (118 kt) |
| 1 takeoff | 0.5 | 56.5 m/s (110 kt) |
| 2 landing | 1 | 53.1 m/s (103 kt) |

```text
cl0      = CL0 + flaps * flapLift (0.60)
stall    = stallDeg - flaps * FLAP_STALL_DEG (1.5)
cd0      = cd0 + flaps * flapDrag (0.0500) + gear * gearDrag (0.0200)
flaps moves toward its step at 1 / FLAP_TIME_S (6 s full travel)
in the air:  pitch -= FLAP_COMP (0.8) * change in cl0 / CL_ALPHA
```

**Nose compensation is needed.** The nose holds its attitude, so without it, extending full flaps at 75 to 90 m/s climbs 55 to 65 m in 12 s: over 1,800 ft on `ALT`. At 0.8 it is 3 to 4 m; at 1.0 it sinks about 10 *(prototyped)*. Same idea as turn help: fed in as the flaps move, so there is still one pitch value. Retracting at 69 m/s sinks 12 m, a fair price for a hasty go-around.

There is no flap speed limit or damage; load peaked at 1.2 g at 120 m/s *without* compensation.

### 6.2 Gear

**Built in C4B (§16.3).** The touchdown crash is checked from C5; the warning and the `GEAR` readout row stay in C6.

`gear` moves at 1 / `GEAR_TIME_S` (3 s). G toggles, refused on the ground. Anything under fully down at touchdown is a crash. A plane that lifts off and settles back with the gear moving also crashes; that is the lesson about pulling the gear too early.

Full flaps and gear still climb at 14 deg on full power at 70 m/s, so a go-around always works *(prototyped)*.

### 6.3 Readouts and sprites

- Readouts become 3 columns by 4 rows (row height 44 to 38 px): `SPD ALT V/S / HDG PIT BNK / THR ENG BRK / FLP GEAR` and the warning cell. `FLP` is `UP`, `1`, `2`, with `>` while moving; `GEAR` is `UP`, `DN`, `--` while moving; `BRK` is `ON` or blank, with `SPL` when spoilers are out (they are C5; the row is added in C5 with `FLP` and `GEAR` blank).
- `GEAR` warning, amber, when airborne, under 60 m above ground, below 85 m/s indicated, gear not down, and descending. Stall wins the cell.
- Side sprite: wheels when gear is past half, a lowered flap per step. Three flap shapes and two gear states over 25 pitch frames, 150 small canvases, built at warm-up. Top sprite unchanged.

## 7. Other changes

### 7.1 Order in `advance`

Crash early return -> flaps, gear (C6) -> lever and engine -> **ground step** or **air step** -> air contact (touchdown check) -> liftoff. `tick` as now. Split the air body into `stepAir` in `sim/flight/air.ts` in step 1 with no behavior change, so the ground step does not turn `step.ts` into one long function.

### 7.2 Existing commands and helpers on the ground

| Item | Rule |
|---|---|
| `place` | Always ends airborne, 20 m up as now. From the ground it also sets the air start's speed, pitch, lever and engine; otherwise the plane would fall at walking speed |
| `rotate` | Works, turns the plane where it stands |
| `level` | Ignored on the ground |
| Stall state | Always `none` on the ground |
| Soft ceiling, turn help | Air only |
| Turn line in the top view | Uses the ground steering rate; hidden below 5 m/s, where its 10 s is meaningless |
| Altitude bug, heading bug | Start at the air start's altitude and the runway heading |

### 7.3 Keys

- Space does two things at once: on press it asks for `level` (as now), and while held it sends `brake` true, then false. The sim uses whichever applies, so the key layer does not need to know if the plane is on the ground. Space held through touchdown starts braking, which is fine.
- F, R and G are one press, one command, in `keyState` beside Space, so a pause clears them. `brake` is released by `clear()` like the axes.
- Commands: `brake {value}`, `flaps {by: 1 | -1}`, `gear`. Bad values are ignored, as today.
- `restart` gets no new arguments.

### 7.4 Starts

`StartSpec` is plain data: position, heading, speed, path, pitch, lever, engine, `onGround`, and from C6 flaps and gear. `initialState(start = AIR_START)` keeps today's start as the default, so the existing tests do not move. `restart` uses `state.start`. A new `start` command takes a spec (finite checks, position clamped), and restarts from it at any time; debug panel only.

| Start | Where |
|---|---|
| Runway (page default, from C4) | Runway 07, 40 m in, at rest, idle |
| Air | Today's start |
| Final (C5) | 1,400 m before the 07 threshold on the center line, 3 deg path aimed 150 m past it, trimmed; 78 m/s clean, from C6 69 m/s with full flaps and gear down |

`sim/world/starts.ts` builds the runway and final starts from a `Runway`. Trim comes from a small `trimAt(speed, path, config, ...)` in `sim/flight/trim.ts`, not literals. Debug panel buttons: Runway, Air, Final.

### 7.5 Drawing a plane on its wheels

`z` is the wheels' height, but the sprite is centered on it, so a parked plane would be half buried. A constant lift would make the sprite disagree with the altitude bug line by 570 displayed feet at the default zoom. Instead the lift fades with height:

```text
offset = WHEEL_PX (7) * max(0, 1 - aglPx / 40)
```

Full on the ground, none above 40 px. Always rising with height (factor 0.825), so the flare still reads. Pure helper in `sideCamera.ts`; the wreck uses no offset. The plumb line and path line start from the drawn row.

## 8. Values

**Constants, `config/flight.ts`**

| Constant | Value | Step | | Constant | Value | Step |
|---|---|---|---|---|---|---|
| `ROLL_MU` | 0.02 | C4 | | `TD_BANK_DEG` | 15 | C5 |
| `GRASS_MU` | 0.12 | C4 | | `TD_PITCH_MIN_DEG`, `TD_PITCH_MAX_DEG` | -3, 16 | C5 |
| `STEER_RADIUS` | 15 m | C4 | | `SKIP_S` | 5 | C5 |
| `STEER_MAX_DEG` | 20 deg/s | C4 | | `GRASS_BRAKE_MU` | 0.20 | C5 |
| `STEER_LATERAL` | 3 m/s2 | C4 | | `SPOILER_LEVER`, `SPOILER_LIFT`, `SPOILER_CD` | 0.1, 0.3, 0.06 | C5 |
| `GROUND_AUTH_ZERO`, `_FULL` | 35, 55 m/s | C4 | | `LANDED_SPEED`, banner hide | 0.5, 2 m/s | C5 |
| `NOSE_FALL_DEG`, `NOSE_FALL_MAX_DEG` | 6, 10 deg/s | C4 | | `FLAP_STALL_DEG` | 1.5 | C6 |
| `TAIL_LIMIT_DEG` | 11 | C4 | | `FLAP_COMP` | 0.8 | C6 |
| `GROUND_BANK_TAU` | 0.3 s | C4 | | `FLAP_TIME_S` (C6), `GEAR_TIME_S` (C4B) | 6, 3 | C6 |
| `LIFTOFF_MARGIN`, `LIFTOFF_CLEAR` | 1.01, 0.05 m | C4 | | `GEAR_WARN_AGL`, `GEAR_WARN_IAS` | 60 m, 85 m/s | C6 |

Display values (`WHEEL_PX` 7, 40 px fade, AGL limit 60 m) go in `config/display.ts`; colors in `palette.ts`.

**Sliders, `config/motion.ts`**

| Key | Default | Range | Step | Since |
|---|---|---|---|---|
| `groundMult` | 1.5 | 1 to 3 | 0.1 | C4 |
| `brakePct` (mu x 100) | 40 | 5 to 80 | 5 | C5 |
| `touchdownSinkMs` | 5 | 1 to 10 | 0.5 | C5 |
| `flapLiftPct` (dCl x 100) | 60 | 0 to 120 | 5 | C6 |
| `flapDragCounts` | 500 | 0 to 1500 | 50 | C6 |
| `gearDragCounts` | 200 | 0 to 1000 | 50 | C4B |

**The clean plane is unchanged in the air.** `cd0` 700 stays the clean value, so the air start's trim and all C1 to C3 flights hold. From C4 until C6 the plane flies without gear drag.

## 9. Files

| File | C4 | C5 | C6 |
|---|---|---|---|
| `sim/flight/air.ts` (new) | Air step moved from `step.ts` | | Flap compensation |
| `sim/flight/ground.ts` (new) | Roll, steering, nose, liftoff | `touchdownCheck`, brakes, spoilers | Gear cause |
| `sim/flight/config.ts` (new) | | | `wingAt`, flap and gear motion |
| `sim/flight/trim.ts` (new) | | `trimAt` | Configured trim |
| `sim/world/groundKind.ts`, `starts.ts` (new) | both (`starts`: runway) | final start | |
| `sim/state.ts`, `interpolate.ts`, `commands.ts`, `step.ts` | `onGround`, `start` | `brake`, `touchdown`, cause, restart rule | `flaps`, `gear` |
| `sim/flight/aero.ts`, `forces.ts`, `attitude.ts` | | | Take `wingAt` values |
| `config/flight.ts`, `motion.ts`, `display.ts`, `palette.ts` | §8 | §8 | §8 |
| `input/keyState.ts`, `keyboard.ts` | | `brake` | F, R, G |
| `views/sideCamera.ts`, `sideView.ts` | Wheel offset | Zoom level, AGL | |
| `views/instruments.ts`, `format.ts` | | 3 x 4, `BRK` | `FLP`, `GEAR`, warning |
| `views/sprite.ts`, `config/planeShape.ts` | Wheels, always shown | | Flap and gear variants |
| `views/turnLine.ts` or `main.ts` | Ground turn rate | | |
| `app/crashBanner.ts` | | Cause; landing message | |
| `app/debugPanel.ts` | Ground lines, start buttons | Touchdown, brake lines, Final | Flaps, gear lines |
| `app/loop.ts` | Accepts a start | | |
| `main.ts` | `groundKind`, runway start | Pass touchdown | |
| tests | `ground`, `groundKind`, `starts` | `touchdown`, `trim`, `circuit` | `config` |

No new dependencies.

## 10. Steps

Each step leaves the page working and tests passing.

**C4**
1. Move the air step to `air.ts`; add a `craft()` test helper and replace craft literals. No behavior change; all 355 tests pass untouched except for literals.
2. `groundKindAt` and `SimWorld.groundKind`. Nothing uses it.
3. `onGround` in state and interpolation; `StartSpec`, `start` command, `initialState(start)`.
4. Ground step: roll, steering, nose. Runway start reachable from a test only.
5. Liftoff, settle-back, `rough` overrun.
6. Wheel offset and wheels on the sprite; turn line; debug lines and buttons; make the runway the page start.
7. Fly the C4 rows of §2. **Gate: passes, and the plane leaves the runway by hand.** Update CURRENT.md.

**C5**
8. `touchdownCheck`, `touchdown`, crash cause. Remove C4's settle-back exception; a settle-back is now simply a touchdown. Includes the `gear` cause.
9. Brakes and spoilers; Space; `BRK` cell and the 3 x 4 layout. V1 (accelerate-stop, §16.2) joins the takeoff strip.
10. Banner, `landed`, restart rule.
11. `trimAt`, Final start, AGL text (the close zoom level is C4B).
12. Scripted circuit test (§11). Fly it. **Gate: passes, and a full circuit has been flown by hand.** Update CURRENT.md.

**C6**
13. `wingAt` threaded through with flaps fixed at 0 and gear drag at 0. No behavior change: a test compares a 60 s run bit for bit with one recorded before.
14. Flaps: commands, motion, compensation, keys, `FLP`.
15. Gear warning and the `GEAR` row in the 3 x 4 layout. Gear itself is C4B and its crash cause is C5. The Final start gets gear down.
16. Sprites. Tune takeoff, landing and brake values together by flying.
17. Documents: Results here; CURRENT.md; ARCHITECTURE.md §6 (ground model, flaps, spoilers), §15 (speed brake: "left out" still holds for a player control; ground spoilers are automatic) and §16; GAME_DESIGN.md §5.2 (touchdown limits, spoilers, flap compensation, ground multiplier; its turn multiplier and "settles to level" rows are already out of date) and §5.3 (Space: brakes on the ground, wings level in the air); AGENTS.md phase line.

## 11. Verification

**C4 tests**

| Area | Tests |
|---|---|
| Ground kinds | Runway, taxiway, apron paved; airport grass; blend band, outside, lake and sea rough; each on the real test map |
| At rest | Idle for 60 s: no movement, z exactly on the ground. Steering and S at rest do nothing |
| Roll | Hand-worked first-second acceleration; `groundMult` scales thrust only; friction never reverses motion; grass slows more than paving |
| Steering | D right, A left, mirrored exactly; rate at 5, 20 and 60 m/s; radius 15 m when slow |
| Nose | No rise below 35 m/s; holds when released at 70; falls when slow; never over 11 deg; from 14 eases, under 0.2 deg per step |
| Liftoff | Rotated: 350 to 480 m and 62 to 72 m/s. Not rotated: never by 120 m/s. Held S from rest: flies and is not stalled 10 s later. Heavier lifts off later |
| Liftoff step | z rises without a jump over 0.1 m; no flicker (at most one change of `onGround` in a normal takeoff) |
| Overrun | Full power, no rotation: crash, cause `overrun` (from C5; a crash in C4), past the end and not before |
| Commands | `place` from rest is flying and not stalled; `level` ignored; `start` with NaN ignored; `restart` returns to `state.start` |
| Existing | Air start: 60 s hands off unchanged. All crash tests pass with `rough` |

**C5 tests**

| Area | Tests |
|---|---|
| Check | Each cause just inside and just outside its limit; order when several apply; a slope or lake is `terrain` whatever the attitude |
| Landing | Speed, path, z and recorded values after contact; pitch and heading kept; finite |
| Stick | Scripted flared landing at idle: `onGround` stays true until stopped. With 60% power it may lift off again, and the second record keeps the larger sink |
| Stopping | From 66 m/s braking: 420 to 530 m, flap setting irrelevant to 5% (C6). No brakes: not stopped in 1,000 m. Braking with spoilers stowed takes longer |
| Landed | Banner state only after a touchdown and a stop, so not at the runway start; Enter works then, and not in flight |
| Text | Banner from either runway end; left and right of center; grass; each cause |
| Trim | `trimAt` gives zero force residual; the Final start holds speed within 1 m/s and path within 0.3 deg for 10 s |
| Keys | Space gives `level` once and `brake` true then false; a pause releases the brake |
| View | Wheel offset 7 at 0, 0 from 40 px, drawn height always increasing; zoom list clamps |
| **Circuit** | Scripted pilot on the real map: takeoff 07, climb to z 100, left circuit 1,500 m wide, land 07, stop on the runway. No crash, never stalled, under 6 minutes of sim time. Ground under that track is at most 17 m *(checked on the map)*; keep the west turn within about 1,000 m of the threshold, as the map edge is near |

**C6 tests**

| Area | Tests |
|---|---|
| No change | Flaps 0, gear up equals the recorded C5 run exactly |
| Stall speed | 60 to 62, 56 to 58, 52 to 54 m/s for the three steps; warning before stalled in each; stall margin of `liftAngle` follows the flaps |
| Compensation | Full flaps at 75 and 90 m/s: height change under 10 m and load under 1.3 g in 12 s. Out and back in restores pitch within 0.3 deg. None on the ground |
| Drag | Gear and flaps each raise drag by the stated counts; level lever needed rises |
| Feel, as numbers | 15 m height reached sooner with flaps 1 than clean, and sooner with 2 than 1; touchdown roll shorter at the full-flap approach speed than clean |
| Gear | 3 s travel; refused on the ground; touchdown at 0.99 crashes with cause `gear`; warning conditions each way |
| Commands | Flap step clamps at 0 and 2; bad values ignored; restart resets to the start's configuration |

**All:** the 10,000-step invariant runs gain ground starts, random brake, flap and gear input and every slider at both ends: finite, never below the ground, `onGround` implies `z == heightAt` and not rough, speed within limits, pitch on the ground 0 to 16 deg. Frame-rate determinism across a takeoff and a landing. Interpolation of the new fields. `tests/boundaries.test.ts` still holds.

Helpers for flying scripts stay in `tests/`. Do not loosen an existing test to make it pass; the only expected changes are craft and world literals, the two crash-message strings, the zoom count, readout layout, and restart-only-when-crashed.

**Manual, in the browser** (held keys need a person or a scripted key driver; earlier steps found the browser tool cannot hold them):
- Every §2 row. Can the center line be held with taps? Is rotation readable in the side view?
- Parked plane stands on the runway, in both views, at every side zoom; no jump at liftoff or touchdown.
- Land from the Final start five times from cold. GAME_DESIGN.md wants success within five tries.
- A full circuit. Where is the runway hard to find?
- Each crash cause, with the banner stacked on pause. Enter on a focused button.
- Space in the air, on the ground, and held through touchdown.
- Flaps and gear: can you feel each, without looking at the numbers?
- 3 x 4 readouts legible at 1280 x 720; no console errors.

Anything not run is reported as **not checked**. The flights owed from C1 to C3E (CURRENT.md) can be done in the same session.

## 12. Decisions

**Recommended defaults; say so if you want any changed:**

1. **Space brakes on the ground and levels wings in the air.** GAME_DESIGN.md gives Space to brakes; C3B gave it to wings level. The two never apply together, so one key serves both. *Alternative:* brakes on B.
2. **Page starts on the runway.** The air and final starts move to debug buttons. *Most visible change.*
3. **Brakes in C5** (§1), tuned in C6.
4. **Automatic ground spoilers** (§5.2), instead of a bounce model or a spoiler key.
5. **Forgiving touchdown:** 5 m/s (about 980 ft/min), so an unflared approach is a hard landing, not a wreck. The slider goes down to 1.
6. **Grass inside the airport is survivable, anything else is not.** An overrun past about 76 m of grass is a crash.
7. **Flap nose compensation at 0.8.**
8. **Gear and flaps have no speed limits or damage.** Overspeed belongs with D3's warnings.
9. **Landing numbers only, no grade.** H4 grades.
10. **No approach guidance yet.** If the owed flights show that a 3 deg path cannot be judged from the side view, add a thin dashed glide line there, before C6.

## 13. Risks

| Risk | Response |
|---|---|
| The flare is too hard by keyboard: 0.5 s of S is right and 0.8 s at 8 m balloons into a crash | Final start for practice, closer zoom, AGL; then lower `pitchRateDegS` near the ground or add ground effect, but only if flying shows it |
| `ALT` runs 10 times world height, so the last 10 m pass as 330 displayed feet in about 3 s | AGL text and zoom; the scale question is E4's |
| Runway is 22.5 m wide and the heading-up map turns under the player | Taps at 2.9 deg/s; add a steering lag if it feels twitchy |
| Clean landings (C5 alone) use most of the runway | Expected, and C6 fixes it; the slider for brakes covers the gap |
| Circuit space: the map edge is near the west end and hills lie north | Track checked (§11). A 1,900 m wide circuit passes 70 m ground and leaves the map at the west end; do not plan for it |
| `onGround` flicker between steps near liftoff | 1% margin, 0.05 m gap, test for one change |
| Moving the air step and threading `wingAt` are large edits | Steps 1 and 13 change no behavior and have exact-equality tests |
| Space semantics confuse | Banner hints are out; CURRENT.md's table; revisit at the C5 gate |
| Skip with power on looks like a bug | Spoilers at idle; `SPL` in `BRK` shows why |

## 14. Done when

**C4:** from a page load, full power and a pull at the right speed lift the plane off runway 07; too slow or no pull does not; steering holds the runway; leaving the airfield crashes.

**C4B:** on the runway the HUD shows a takeoff strip with VR and V2 computed from the plane's weight (V1 from C5), and no altitude or heading bug; the gear can be raised in the air and lowered again; the ground zoom is close enough to see the runway and returns to the player's own zoom after liftoff.

**C5:** a full circuit can be flown by hand from the runway back to it and braked to a stop; hard, banked, nose-first, tail-first and off-field arrivals crash and say why; Enter restarts at once after either; landing numbers show.

**C6:** flaps and gear measurably and noticeably change takeoff distance, stall speed, approach speed and stopping; landing gear-up crashes; the clean plane in the air flies exactly as before.

All: sliders work live, documents are updated, typecheck, tests and build pass, and unrun manual checks are listed as such.

**Next:** D1, or D4A if it is still wanted early.

## 15. Results

### C4 (built)

Steps 1 to 6 done; step 7's tests pass (393, was 355), typecheck and build pass. **Flown by script only; not flown by hand.**

Numbers from the new tests (real map, scripted keys): rotate at 62 m/s at full power lifts off 350 to 480 m down the runway at 62 to 72 m/s and is over 15 m up inside 25 s; without rotation it never leaves the ground and runs off the end (a crash); S held from rest flies and is not stalled 10 s later; a heavier plane lifts off later.

Differences from the plan:

- `liftoffTick` is in `SimState` now (the plan listed it for C5), because the settle-back rule needs it.
- A settle-back keeps the pitch clamped to 0 to 16 deg (`TD_PITCH_MAX_DEG`); the ground nose then eases down from above 11.
- `StartSpec` also carries `z` and `spool` (the runway start's `z` comes from the world). `craftAt` snaps an on-ground start to the ground and keeps an air start at least 1 m above it.
- `stepEngine` (lever and engine) lives in `flight/forces.ts`, shared by both steps; no `flight/engine.ts`.
- The crash record has no `cause` yet (C5), so overrun is only a crash.
- No `craft()` literal sweep was needed: tests mostly spread `initialState().craft`. `tests/helpers.ts` has `craft()`, `realWorld()`, `runwayState()` and `fly()`. Existing tests changed only for the `groundKind` world field, the `onGround` craft literals, and a finite-number check that now skips the boolean.
- Steering: the plan's table says 2.9 deg/s at 60 m/s and at most 20 deg/s; at 20 m/s the lateral limit already gives 8.6 deg/s, so the 20 deg/s cap only binds between about 5 and 9 m/s.

Not checked: a held-key takeoff by hand, feel of the steering with taps, rotation in the side view at each zoom, liftoff and overrun live.

## 16. C4B: takeoff UI, V-speeds, gear, ground zoom

**Status:** built (Results below); checked by tests only, not flown by hand. Feedback after flying C4. It runs between the C4 and C5 gates: playable alone, tests pass before C5 starts. Numbers are provisional.

### 16.1 Scope

| In | Out (where it belongs) |
|---|---|
| Takeoff HUD mode: altitude and heading bugs hidden, takeoff strip shown | Approach HUD mode (C5) |
| VR and V2 from weight and the wing; V1 joins in C5 | Engine failure, rejected-takeoff drill, wet runway, headwind, slope, flap-based V-speeds (the formulas take them later; flaps are C6) |
| Call-outs as text: V1, ROTATE, V2, POSITIVE RATE | Spoken call-outs (audio milestone) |
| Gear: `G`, motion, drag, readout, two sprite states | Gear warning (C6); crash on a gear-up landing (C5 touchdown check) |
| Close zoom level in both views; ground/air zoom gate | Continuous altitude zoom; zoom by phase beyond two levels |

### 16.2 Takeoff mode and V-speeds

**Mode.** A pure view helper, no stored phase: takeoff mode when `onGround`, or airborne under `TAKEOFF_HUD_AGL_M` (150 m) with the gear not up (`gear > 0.05`). While it holds, the altitude and heading bugs are not drawn (their values are kept) and the takeoff strip is drawn. The gear is the signal, so the strip stays through the initial climb and ends when the player raises the gear or climbs past 150 m. A cruising plane that lowers its gear above 150 m does not enter it. C5 replaces the low-gear-down case with a real approach mode.

**V-speeds.** New `sim/flight/vspeeds.ts`, pure, reading the same aero and mass the sim uses, so a number cannot disagree with how the plane flies:

```text
Vs  = sqrt(2 m G / (RHO0 * S * CLmax))     indicated, the same stall speed the debug panel's level stall already shows
VR  = VR_MULT * Vs                         1.05
V2  = V2_MULT * Vs                         1.2   (1.2 is the real rule of thumb for V2 over Vs)
V1  = highest v with  d_accel(v) + d_stop(v) <= paved runway left,  capped at VR      (C5)
```

- Weight is `tuning` mass, so the mass slider moves them. Flaps enter through `wingAt` in C6 with no change to the formulas. Wet runway and headwind later change `d_stop`, `d_accel` and the ground speed to airspeed offset, so V1 is where they will show.
- **V1 is accelerate-stop, not a table value.** There is no engine failure, so a textbook V1 would decide nothing. It exists once brakes do (C5, step 9): the same ground-step functions are marched in 1 m/s speed steps, full power out and brakes with spoilers back. It uses the runway left from where the roll starts. Until then the strip shows `V1 --`.
- **Calibrate the multipliers against the C4 prototype**: rotating at 62 m/s against a 60.6 m/s stall lifts off at 68. 1.05 gives 63.6, near it. Adjust by flying; do not copy the textbook values blindly.
- **When computed:** live while on the ground below 2 m/s (so the slider or a restart updates them), frozen at the start of the roll, cleared when takeoff mode ends. They are airspeeds, shown in the displayed units like `SPD`.
- **Strip:** `V1 121  VR 63  V2 73` (knots displayed), the next speed to be reached highlighted, plus runway remaining in meters (from `runwayAt`). **Call-outs**, shown for 2 s each, once per takeoff: `V1` crossing V1, `ROTATE` crossing VR, `POSITIVE RATE` when airborne, 5 m up and path angle above 0, `V2` crossing V2 in the air. The call-out state lives in the view layer, from sim state; the sim emits nothing.

### 16.3 Gear

The §6.2 design, pulled forward and cut down:

- State `gearDown`, `gear` (§3.2); command `gear` toggles, **refused on the ground**; `G` key, one press one command, in `keyState` beside Space, cleared by a pause (so F, R and the brake in C5 and C6 slot in beside it).
- `gear` moves at 1 / `GEAR_TIME_S` (3 s); drag adds `gear * gearDrag` (200 counts) to `cd0`, a new `gearDragCounts` slider. The clean air value stays 700, so the air start's trim and every C1 to C3 flight still hold.
- Starts: runway, and (C5) Final, begin gear down; the air start begins gear up, so the 60 s hands-off test is unchanged. Restart goes to `state.start`'s gear.
- Contact with the gear not fully down is a crash in C4B, including a settle-back after liftoff. It reports as `terrain` until C5 adds the `gear` cause and its banner text.
- Readout: a `GEAR` cell (`UP`, `DN`, `--` while moving) in the current readout grid; the 3 x 4 layout rework stays in C5 step 9.
- Sprite: wheels are drawn when `gear` is past half, so 2 gear states over the 25 pitch frames. C6 multiplies these by 3 flap shapes (150 canvases total, as planned).
- The takeoff prototypes in §2 already included gear drag, so C4's numbers should move toward them, not away. If the existing C4 tests (350 to 480 m, 62 to 72 m/s) fall outside, report it; do not loosen them.

### 16.4 Zoom gate

- **Close level:** append 0.5 m per pixel to `ZOOM_LEVELS` (top) and `SIDE_ZOOM_LEVELS`. A 22.5 m runway is 45 px wide at that scale (4 px at today's default). C5 §5.4's side-zoom level is this one.
- **Memory per phase:** each view keeps a ground zoom and an air zoom. The wheel edits whichever phase is current, so nothing is ever overwritten or reset. Defaults: ground = the close level, air = today's default (top 5 m/px, side 5 m/px). Page start is on the runway, so it opens close.
- **Gate:** a pure helper, `views/zoomGate.ts`: ground zoom while on the ground or under 20 m AGL; air zoom above 40 m AGL; between them it keeps its last state (hysteresis, so it cannot flicker near one height). C5 reuses the same gate for the flare.
- **Easing:** the shown zoom eases toward the target in log space, time constant 0.8 s, so liftoff does not jump. The zoom is camera state in `main.ts`, not sim state.
- The wheel offset fade (§7.5) is in pixels, so it follows the zoom; during an ease the 7 px offset fades with it. Check that nothing visibly pops.
- `airportLayer` prebuilds patches for zoom indexes 2 and up; the new level adds a build at warm-up. Keep the warm-up inside its current budget or build the extra level lazily.

### 16.5 Constants and files

| Constant | Value |
|---|---|
| `VR_MULT`, `V2_MULT` | 1.05, 1.2 |
| `VSPEED_FREEZE_MS` (speed below which they update) | 2 m/s |
| `TAKEOFF_HUD_AGL_M`, gear-up threshold | 150 m, 0.05 |
| `GEAR_TIME_S`, `gearDragCounts` | 3 s, 200 |
| `GROUND_ZOOM_ENTER_AGL`, `_EXIT_AGL`, `ZOOM_EASE_S` | 20 m, 40 m, 0.8 s |
| Call-out hold time | 2 s |

| File | Change |
|---|---|
| `sim/flight/vspeeds.ts` (new) | VR, V2; V1 in C5 |
| `sim/state.ts`, `interpolate.ts`, `commands.ts`, `step.ts`, `flight/forces.ts` | Gear state, command, motion, drag |
| `config/flight.ts`, `motion.ts`, `display.ts` | Constants and slider above |
| `input/keyState.ts`, `keyboard.ts` | `G` |
| `views/takeoffStrip.ts` (new), `instruments.ts`, the bug-drawing code in `views/` | Mode, strip, call-outs, hiding bugs (locate at the step) |
| `views/zoomGate.ts` (new), `camera.ts`, `sideCamera.ts`, `airportLayer.ts`, `main.ts` | Close level, gate, per-phase memory |
| `views/sprite.ts`, `config/planeShape.ts` | Gear states |
| `app/debugPanel.ts` | Gear and V-speed lines |
| tests | `vspeeds`, `gear`, `zoomGate`, `takeoffStrip` |

### 16.6 Steps

1. Zoom: close level in both views, `zoomGate`, per-phase memory, easing. Fly the ground and liftoff view.
2. Takeoff mode: the pure predicate, hide the bugs, an empty strip placeholder.
3. Gear: state, command, key, motion, drag, readout, sprites, starts. Runway start gear down; air start gear up.
4. V-speeds: `vspeeds.ts`, the strip, call-outs. **Gate**: the tests below pass and a takeoff has been flown by hand with the strip. Update CURRENT.md and this section's Results.

### 16.7 Tests

| Area | Tests |
|---|---|
| V-speeds | Hand-worked Vs, VR, V2 for the default mass; scale with the square root of mass; unchanged by position; a heavier plane gives higher values; VR above the stall; finite for any slider value; `V1` absent before C5 |
| Calibration | Rotating at the computed VR at full power lifts off inside 350 to 480 m (the C4 band) |
| Takeoff mode | On at the runway start; off at the air start; on while climbing with gear down under 150 m; off with gear up; off above 150 m; gear lowered at 1,000 m does not turn it on |
| Call-outs | Each fires once per takeoff, in order, and not before the speed is reached; reset on restart |
| Gear | 3 s travel; refused on the ground; drag raises by the stated counts only while down (so the air start is bit for bit unchanged); contact with gear up crashes; interpolation of the new fields; invariants with random gear input |
| Zoom | Gate states and hysteresis at 19, 30 and 41 m; no flicker on a noisy height; easing is monotonic and never overshoots; wheel edits only the current phase; clamps with the new level |
| Existing | C4 tests still pass without loosening; the 60 s hands-off air-start run is unchanged |

**Manual:** the close zoom shows the runway and the rotation; does the zoom ease read well at liftoff and does the strip stay out of the way; is gear-up at positive rate the natural moment; V1, VR and V2 feel plausible at default mass and at both ends of the mass slider. Anything not run is reported as **not checked**.

### 16.8 Decisions

**Recommended defaults; say so if you want any changed:**

1. **Takeoff mode follows the sim state**, with no stored phase. The gear is part of the signal.
2. **V1 is accelerate-stop and arrives with C5's brakes.** The strip shows `V1 --` before that.
3. **Multipliers 1.05 and 1.2**, calibrated by flying.
4. **A zoom gate with a memory per phase**, in preference to continuous altitude zoom, so that pitch and flight path stay readable.
5. **Gear crash reuses `terrain` until C5.** The cause is added with the other causes.
6. **No gear speed limit or gear-up-on-the-ground rules beyond the refusal**; the warning is C6.

### 16.9 Risks

| Risk | Response |
|---|---|
| Gear drag shifts C4 takeoff distances | Prototypes already include it; tests re-run; report, do not loosen |
| Zoom easing makes the wheel offset visibly pop | Check at step 1; tune the ease or offset fade if so |
| Extra zoom level costs warm-up time in `airportLayer` | Build lazily or measure first |
| Call-outs clutter the pause banner and crash banner | Own corner; check stacked with both |
| V-speeds feel wrong against the sim | Multipliers are constants; tune them by flying, never by editing the formula |

### Results

All four steps done: 434 tests (was 393), typecheck and build pass. New tests are in `tests/c4b.test.ts`. **Not flown by hand**: the Browser pane was hidden, so the loop did not run. Seen live: the parked start at the close zoom with the strip and `GEAR DN`, and a clean console.

Numbers: Vs 60.6 m/s indicated at default mass; VR 63.6, V2 72.7. Rotating at the computed VR at full power lifts off inside the C4 band (350 to 480 m), and the existing C4 tests passed unchanged with gear drag on (the runway start now has the gear down).

Differences from the plan:

- **Readout:** there was no free cell in the 3 x 3 grid, so the grid is already 3 x 4 (cell height 38) with `GEAR` alone in the last row. C5 step 9 adds `BRK` and the rest to it.
- **Gear snap:** `stepGear` snaps to the end within 1e-9; 180 steps of 1/180 otherwise left 0.9999999999999974, which would have counted as "not locked" at 3 s.
- **Fractional zoom:** the camera zoom index may be fractional while easing (`interpolateLevels`, log scale); whole numbers give exactly the level. The eased value is `main.ts` state. `airportLayer` bakes at the nearest level and stretches.
- The level-stall helper moved from the debug panel to `flight/vspeeds.ts` (`levelStallSpeed`), which the panel now uses.
- `place` from the ground also retracts the gear (it applies the air start's configuration).
- Call-outs: V1 is skipped while there is no V1; `ROTATE` fires on speed alone (on the ground or just after liftoff). The strip also shows `RWY n m` remaining.
- The 0.5 m patch bake takes about 250 ms in `warm()`, kept in the warm-up; the `bakePatch` test at that level needed a longer timeout.

Not checked: everything in the Manual list above (held-key takeoff with the strip, the ease at liftoff, wheel offset popping, call-out timing, gear-up moment, both ends of the mass slider, call-outs stacked with the pause and crash banners).

## 17. C5 Results

Steps 8 to 12 done. 464 tests (was 434), typecheck and build pass. New tests: `tests/c5.test.ts`, `tests/circuit.test.ts`. **Not flown by hand**: the scripted circuit passes, but no person has held the keys. Seen live: the page loads, the `BRK` cell shows, console clean (the pane was unfocused, so the loop was paused).

Numbers from the tests: braked from 66 m/s on a long paved flat the plane stops in 350 to 550 m, and unbraked rolls over 1,000 m; braking with power on (spoilers stowed) takes longer. The scripted pilot (keys only, `trimAt` for pitch and lever) flew takeoff 07, a left circuit, final, a 1.9 m/s touchdown on the center line and a braked stop on the runway, inside 6 minutes and never stalled.

Differences from the plan:

- **Circuit shape:** a turn at 23 deg of bank has a 1,000 m radius at 80 m/s, so a 1,500 m wide circuit needs about 35 deg. Base and final sit 1,300 m before the threshold (x is about 140 m from the map edge there).
- **`Crash` has `cause` and `sink`; `Controls` has `brake`**: test literals changed for both. The C4 settle-back tests became touchdown tests (a soft touch lands; a hard one crashes with `hard`).
- **Space tests changed:** a press now sends `brake` as well as `level`; a tap brakes for one sample.
- **`liftoffTick` is kept at touchdown** (the skip rule needs it).
- **BRK cell:** `ON`, `SPL` while rolling (spoilers are out at idle at rest, so they are not shown then), or `ON SPL`.
- **Grass brake mu** scales with `brakePct` (0.20 at the default) instead of a fixed 0.20.
- **V1** uses sea-level density and a full-power engine from rest, so it is slightly optimistic. Its runway remaining is measured from where the roll starts.
- **Tail test:** a stall drops the nose before contact, so the integration test for `tail` touches a hair above the ground; `touchdownCheck` itself is tested at every limit.
- **Final start** is built at page load with the default tuning; a changed slider leaves it slightly off trim.
- The close side zoom came with C4B; the `AGL` text is `formatAgl` in `format.ts`, drawn by the side view's plumb line.

Not checked: the manual list in section 11 (held-key landings from the Final start, the flare by keys, five cold landings, the circuit by hand, each crash banner stacked with pause, Space held through touchdown, Enter on a focused button, readouts at 1280 x 720). Whether a 3 deg path can be judged from the side view is still open (decision 10).

**After flying C5 (feedback):** the map was too small for a proper final, and there was nothing to line up on. Done, and these answer decision 10:

- **Sea pad:** 256 cells (2,560 m; first 128, then doubled on request) of open sea on every side (no new terrain). All island coordinates moved 2,560 m east and north; tests that hard-code positions were shifted by `TEST_MAP_OFFSET_M`.
- **Approach guidance** (`views/approach.ts`, section above in CURRENT.md): center line in the top view, 3 deg glide line and `LOC / HDG / GS` text in the side view; the bugs hide. Tested in `tests/c5.test.ts`. Seen live from the Final start (paused); not flown.
- Slow tests (`circuit`, the 10,000-step real-map run, the each-cause landing test) have longer timeouts, as they timed out under the parallel full run.
- Not built: the edge arrow for an off-screen runway (the top view's follow camera and the center line cover it for now).

## 18. C6 Results

Steps 13 to 17 done. 487 tests (was 464), typecheck and build pass. New tests: `tests/c6.test.ts`. **Not flown by hand.** Seen live: the page loads with `FLP UP` and `GEAR DN`, console clean (the loop was paused).

Numbers from the tests: level stall 60 to 62 / 56 to 58 / 52 to 54 m/s for flaps up / 1 / 2; full flaps at 75 and 90 m/s change height under 10 m and load stays under 1.3 g in 12 s; 15 m is reached sooner with flaps 1 than clean, and sooner with 2 than 1 (rotate at 58); braked stopping from 66 m/s differs by under 5% across flap settings; a clean 3,600-step flight is bit for bit the same with any flap sliders.

Differences from the plan:

- **`wingAt(flaps, gear, tuning)`** also folds in gear drag, so callers pass `wing.cl0`, `wing.stallRad` and `wing.extraCd0Counts` to the unchanged `aeroAt`. It lives in `flight/wing.ts` (with `stepFlaps`), not `flight/config.ts`. `liftAngle`, `stallState`, `clMax`, `levelStallSpeed`, `vSpeeds` and `trimAt` take an optional flaps argument.
- **`StartSpec.flapLever`** is required; a bad value makes `start` ignored. The Final start is 69 m/s with full flaps and gear down (`FINAL_SPEED` 78 to 69), trimmed by `trimAt` with flaps.
- **Warning cell moved** to the last row (it sat over `BRK` before). `FLP` and `GEAR` are the last row's cells.
- **Flap sprites:** the plan's 150 canvases are built (25 pitch x 2 gear x 3 flap), flap shape chosen from the actual position (`flapStepOf`), so it animates through the steps.
- The V-speed strip uses the current flaps (live at rest, frozen in the roll).
- No takeoff or landing tuning was done by flying; the values are as planned.

Not checked: everything in the Manual list of section 11 that involves flaps or the gear warning, and the flap sprite shapes by eye.
