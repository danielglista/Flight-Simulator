# D Implementation Plan: Cockpit (D1 to D4)

**Status:** D1 to D4 built (V/S decision, by-eye flights and the focused-window timing check still owed).
**Milestones (ARCHITECTURE.md §14):** D1 "Needles follow the plane." D2 "Plane can be flown mainly by instruments." D3 "All controls are visible on the panel." D4 "Holds heading and altitude only when stable."
**Starting state:** end of C6, C4 to C6 uncommitted in the working tree. Altitude scale 5 (D4B).
**Replaces:** [D4A_PLAN.md](D4A_PLAN.md), which predates D4B and C4 to C6. §7.1 lists what changed and why.

One plan, **four gates**: each step is playable alone and must pass its tests (§11) before the next starts. One commit each, if commits are asked for.

All numbers are provisional. "m" is world meters unless it says real. "ft" of altitude is displayed feet. Figures marked *(prototyped)* come from a throwaway copy of the sim with §7's control law added, run over flat ground. Scripted only: feel is untested.

**Before D1:** commit C4 to C6, so D starts from a clean diff. Flying C4 to C6 by hand (CURRENT.md, "Checks still owed") is also best done first: D2 and D4 are judged by flying, and a bad C6 tuning would look like a bad instrument.

## 1. Scope

| Step | In |
|---|---|
| D1 | Panel grid (4 x 2 cells), gauge helpers, pixel font, airspeed and altimeter dials. Other cells keep text |
| D2 | Artificial horizon, compass, vertical speed, bugs on the gauges, the V/S scale decision |
| D3 | Throttle/engine, flap, gear and brake indicators, warning lights, terrain warning, instrument draw timing. Last text cells go |
| D4 | `stability`, autopilot (heading + altitude), autothrottle with a speed bug, AP indicators |

| Out | Where it belongs |
|---|---|
| Final cockpit art, panel image, palette | H1, H2. D draws plain faces in code; H2 replaces the faces, not the needles |
| Sound for warnings and disconnect | H3 |
| Traffic light; waypoint distance | G2; E3 |
| Flight checklist | F3 |
| Co-pilot assist while typing | F6; reuses D4's `stability` |
| Overspeed warning | Not planned: the sim has no overspeed damage or limit, so a light would mean nothing |
| Speed brake | Left out for good (ARCHITECTURE §15 "decide C6": ground spoilers are automatic; no air brake was needed) |
| V/S hold, approach, takeoff or ground modes; clickable gauges | Not planned now |
| Slip ball | Not planned: turns are always coordinated |

## 2. Panel layout

The canvas is 320 x 160 internal at 1280 x 720 (2x) and 1920 x 1080 (3x), and **larger in other windows** (`app/panels.ts` grows it to fill the panel). So lay out a fixed 320 x 160 block, centered, and fill the rest with the panel color.

Eight 80 x 80 cells. Every dial has radius 36, center at the cell center.

```text
+---------+---------+---------+---------+
|  SPD    | HORIZON |  ALT    |  V/S    |   D1: SPD, ALT
|  dial   |         |  dial   |  dial   |   D2: HORIZON, V/S, HDG
+---------+---------+---------+---------+   D3: POWER, CONFIG, LIGHTS
| POWER   | HDG     | CONFIG  | LIGHTS  |
| THR ENG | compass | FLP GEAR| STALL.. |
+---------+---------+---------+---------+
```

Until a cell gets its gauge it shows the same text as today, regrouped: `V/S`; `HDG`; `THR` + `ENG`; `FLP` + `GEAR` + `BRK`; the warning. `PIT` + `BNK` go in the horizon cell and stay there as small numbers after D2.

**Pixel look.** Canvas text and lines are anti-aliased, which blurs at 2x. So:

- Needles, ticks and ladder lines are drawn pixel by pixel (Bresenham) with `fillRect`, never `stroke`.
- Filled shapes (sky/ground) are drawn as one `fillRect` per column.
- Text on gauges uses a small bitmap font (5 x 7, plus 3 x 5 for dial numbers): digits, A to Z, and `+ - . , % / >`. Data in `config/pixelFont.ts`. Only the instruments panel uses it.
- Static faces (ring, ticks, numbers, colored arcs) are drawn once to an offscreen canvas per dial. Only the moving parts redraw.

**When to redraw.** `render()` reads page layout, so today the panel redraws only when a string changes. Keep the rule: build a `PanelState` of already-quantized values and skip if equal. Needles quantize to 0.5 deg of dial angle, pitch and bank to 0.5 deg, digits as displayed. In practice it redraws most frames in a maneuver and none when parked.

`readoutText` and `readoutSentence` stay as they are (pure, tested) and keep feeding the screen-reader line. D3 and D4 add fields to them. Gauges read the craft, not the strings.

## 3. D1: airspeed and altimeter

Dial angles are clockwise from straight up. A dial is a pure function from a value to an angle, with a needle at the end.

**Airspeed** (indicated kt, what `SPD` shows), a piecewise-linear table, so the range flown every day has the most room:

| kt | 0 | 60 | 240 | 400 |
|---|---|---|---|---|
| deg | 0 | 30 | 240 | 320 |

- Pegged at 320 deg above 400 kt; the digits in the window keep counting.
- **Red arc** from 0 to the stall speed now (`levelStallSpeed` with current mass, bank, flaps), **amber** to 1.2 times that. It moves with flaps and bank, so the needle touching red means a stall in this configuration. About 118 kt clean, 103 kt full flaps. Hidden after a crash and at rest on the ground below 30 kt.
- `levelStallSpeed` scans the polar on each call. Keep the last result, keyed on `(massT, stallDeg, flapLiftPct, flaps, bank rounded to 1 deg)`.

**Altimeter** (displayed ft): long hand 1,000 ft per turn, short hand 10,000 ft per turn, digits in a window to 10 ft. The top of the map is about 19,690 ft, so the short hand passes zero once; the digits settle it. At 90 m/s a 3 deg path turns the long hand about 4.6 times a minute.

**Interpolation:** hands read the interpolated snapshot, so nothing wraps wrongly: hand angles come from `z` each frame and are not themselves blended.

## 4. D2: horizon, compass, vertical speed

**Artificial horizon** (76 x 76 window): 1.5 px per degree of pitch, so about +/-25 deg is visible; pitch is limited to 30 by the sim, and the horizon pegs with 4 px of sky or ground always left so you can see which way is up.
- Ladder at every 5 deg (short) and 10 deg (long, numbered). Fixed yellow wings and a center dot.
- Bank scale at the top: marks at 0, 10, 20, 30, 45, 60; a pointer. The horizon turns opposite to the bank, like a real one: in a right bank its right end is higher on screen. §11 pins the sign.
- A small green circle at `pathAngle - pitch` is the flight-path marker: where the plane is going. Circle on the horizon = level flight. It is hidden on the ground and after a crash.

**Compass:** heading-up card, ticks every 10 deg, `N E S W` and 3, 6, 12 ... every 30, fixed lubber line, digits (`090`) below. Heading bug as a cyan marker on the rim.

**Vertical speed:** needle points left (9 o'clock) at 0, up for climb. Angles: 0 at 0, +/-60 at 1,000, +/-110 at 2,000, +/-160 at 4,000 ft/min, pegged beyond. Digits below.

**Bugs on gauges:** altitude bug as a cyan mark on the altimeter rim (its hundreds), shown only within 500 ft of it, since the rim repeats every 1,000 ft. Both follow the existing rule: hidden in takeoff mode, approach mode and after a crash. So `main.ts` passes `bugDeg` and `altBugFt`, or null.

**Decision due here: V/S scale.** `V/S` is unscaled, so the altimeter moves 5 times as fast as V/S says. Build both behind one switch:

| Mode | Shows | 3 deg at 69 m/s | Dial range |
|---|---|---|---|
| `world` (default) | Today's value | -710 ft/min | +/-4,000 |
| `altimeter` | Actual rate of the altimeter | -3,555 ft/min | +/-20,000 |

`VS_MODE` in `config/display.ts`, with a debug-panel checkbox to flip it live. It affects the gauge and the readout only; touchdown sink in the banner stays world ft/min. **Recommendation: keep `world`** because landing and climb numbers stay familiar and ATC (F) will speak in altitudes, not rates; the altitude tape already shows the trend. Flip it only if the D2 flights show leveling off is misjudged because of it. Record the answer in GAME_DESIGN §4.1 and ARCHITECTURE §15, then delete the losing mode and the checkbox.

## 5. D3: controls and warning lights

| Cell | Content |
|---|---|
| POWER | Two vertical bars: lever (a handle that slides) and engine (a filled bar), 0 to 100%, with digits. The gap between them shows spool lag. D4 adds the `SPD` mode mark |
| CONFIG | Flaps: a lever with notches UP, 1, 2 and a bar for the actual position. Gear: a lamp, green `DN`, amber while moving, dark when up; small lever mark for the chosen position. `BRK` and `SPL` lamps, on the ground only, same conditions as `brakeText` |
| LIGHTS | 2 columns of lamps, dark when off, label always readable: `STALL` (amber warning, red stalled), `GEAR` (amber), `TERR` (red), `AP`, `HDG`, `ALT`, `SPD` (the last four wired in D4, dark in D3). One cell is left for `TRFC` (G2), not drawn |

Every lamp has its own place, so the "stall wins the cell" rule goes: `STALL` and `GEAR` can both be lit. `readoutText.warn` keeps its priority for the sentence, with `TERR` between `STALL` and `GEAR`. Crashed: all warning lamps dark. No flashing (H can add it); color and position carry the meaning, and the label text means color is never the only cue.

**Terrain warning**, new pure `terrainAhead(craft, heightAt)` in `sim/flight/terrain.ts`: project straight along the current velocity for `TERR_LOOK_S` (8 s) in steps of `TERR_STEP_M` (30 m); warn if any point is within `TERR_CLEAR_M` (10 m) of the ground. Off on the ground, after a crash, and while configured for takeoff or landing (gear not up and under 150 m above ground, the same test as `takeoffMode`). It is straight-line on purpose: in a turn it can warn late or falsely. At most about 80 `heightAt` calls at the speed cap, 24 at 90 m/s. It lives in `sim/` because D4's `stability` uses it.

**Performance check owed since B2.** Add an `instruments` row to the debug panel's frame timing. In a full-size visible window, over 300 frames of a 30 deg banked climb: total draw p95 under 8 ms (ARCHITECTURE §13). Instruments alone should be under 1 ms. If it is not: confirm faces are cached, then coarsen the quantizing.

## 6. D4: what the player gets

| Input | Effect |
|---|---|
| `Z` | Autopilot on: holds the **heading bug and the altitude bug** and turns speed hold on. Again: all off |
| `X` | Speed hold on / off by itself. The target is the indicated speed when it goes on |
| `[ ]`, `- =` while AP is on | Move the bugs; the plane follows |
| `,` / `.` | Speed target down / up 5 kt (Shift: 1 kt); only while speed hold is on |
| A, D, S, W or Space | Autopilot off at once (heading and altitude together). Speed hold stays on. The nose and bank stay where they are |
| Q / E | Speed hold off; the autopilot stays on |
| Danger (§7.4), crash, restart, start, place, pointer rotate | All off |

Pressing `Z` flies to the bugs, it does not freeze the present heading and altitude. That is what ATC work needs ("left 290, climb FL120"): set the bug, the plane goes. The cost is that a forgotten bug makes the plane turn, so the bug is always visible on the gauges, rings and tape when the AP can be on (§7.4 refuses it in the modes that hide bugs).

Not stable: `Z` does nothing but show `AP REFUSED: BANK` (the reason) for 2 s. Dropped by danger: `AP OFF: TERRAIN`, 2 s, red. Both appear in the side view's call-out place and in the screen-reader line.

Lamps: `AP` lit green while on; `HDG` / `ALT` amber while capturing, green inside 2 deg / 20 ft; `SPD` likewise within 2 kt, and amber while the stall floor (§7.3) overrides the target. A cyan speed bug on the airspeed dial. The side view's altitude bug line becomes solid while the AP is on.

## 7. D4: model

### 7.1 What changed from D4A

| D4A said | Now | Why |
|---|---|---|
| Only `stepPitch`'s key type changes | The AP must **bypass the pitch key ramp** | D4B's hold ramp gives a fresh key 12% authority and resets on every reversal. Fed through it, captures overshoot 45 to 180 ft *(prototyped)*; bypassed, 0 to 13 ft |
| Trim needs no integrator | Needs a **thrust term** in the lift budget | Without it the plane holds 15 to 23 ft off and never enters the 10 ft band *(prototyped)*; with it, 0 |
| Stall margin ramps climb from 1.35 to 1.2 Vs | Ramp 1.2 to 1.1 Vs, plus a **speed floor of 1.25 Vs** | With speed hold on target near 1.2 Vs, D4A's margin forbids the climb forever: at 75 m/s it stayed 1,000 ft low *(prototyped)* |
| Altitude only | Heading too, one `Z` | D4 proper; GAME_DESIGN §5.3 |
| S/W drops ALT only | Any stick key drops HDG and ALT | One mode to understand, not two |
| No speed bug; small gate; terrain not considered | Speed bug; `stability`; drops on `TERR` | The D1 to D3 panel can show them |
| Scale 10; no ground, flaps or gear | Scale 5, flap-aware, refused on the ground and low with gear | Built since |

### 7.2 State and commands

```ts
// SimState
autopilot: {
  on: boolean; spd: boolean;
  headingTarget: number;  // rad
  targetZ: number;        // world m
  targetIas: number;      // m/s
  notice: { tick: number; kind: 'refused' | 'dropped'; reason: StabilityReason | 'controls' } | null;
}
stableTicks: number;      // consecutive steps with stability().stable
```

| Command | Effect |
|---|---|
| `{kind:'autopilot', on:true, heading, z}` | Needs finite values; gated by §7.4. Turns `spd` on if it was off |
| `{kind:'autopilot', on:false}` | `on` and `spd` both off |
| `{kind:'autothrottle', on}` | `spd` only. On needs airborne and not crashed; records the current IAS |
| `{kind:'apTarget', heading?, z?, ias?}` | Each finite value is wrapped (heading) or clamped (`z` to 0..`CEILING_Z`, `ias` to 30..150 m/s). Ignored for a mode that is off |

- Override lives in `applyCommands`: a non-zero `turn` or `pitch`, or `level`, clears `on`; a non-zero `throttle` clears `spd`. Player override sets no notice.
- `applyCommands` ends with an identity check to return the same state: **add `autopilot` and `stableTicks` to it**, or commands that change only the autopilot are lost.
- Bugs stay view state. The loop drops queued commands on pause, so do not rely on one message per key press: each drawn frame `main.ts` compares the bugs with the sim's targets and sends `apTarget` if they differ while `on`. While paused it applies at once.
- Speed target: `,` / `.` send `apTarget` with `ias`, computed from the sim's `targetIas`.

### 7.3 Control law, new `sim/flight/autopilot.ts`, pure

`autopilotOutput(craft, ap, tuning, altitudeScale) -> { pitch: number|null, roll: number|null, throttle: number|null }`, each -1..1, null = use the keys.

```text
Vs   = levelStallSpeed(tuning, bank, flaps)         ias = indicatedSpeed(craft)
speedErr = max(targetIas, 1.25*Vs) - ias            (when spd; the floor)

ALT  up   = 5 deg * clamp((ias - 1.1*Vs) / (0.1*Vs), 0, 1)      down = 4 deg
     if spd and lever at 1 and speedErr > 0:  up   *= clamp(1 - (speedErr-1)/4, 0, 1)
     if spd and lever at 0 and speedErr < 0:  down *= clamp(1 - (-speedErr-1)/4, 0.1, 1)
     path = clamp(asin(clamp((targetZ - z) / 6s / speed, -1, 1)), -down, up)
     n    = (cos(pathAngle) - T*sin(alpha)/(m*G)) / max(cos(bank), 0.5)
     nose = path + min(liftAngle(n, speed, sigma, tuning, flaps), stallDeg - 4 deg)
     pitch = clamp((nose - pitch) / 3 deg, -1, 1)
HDG  bankWanted = clamp(1.5 * headingError, -25, 25 deg)         (shortest way; 180 = right)
     roll = clamp((bankWanted - bank) * 1.0 / rollRate, -1, 1)
SPD  throttle = clamp(0.08*speedErr - 0.5*d(ias)/dt, -1, 1)
```

- `d(ias)/dt` is `(along - G*sin(pathAngle)) * sqrt(sigma)` from `forcesOn`.
- `pitch` is a share of `pitchRateDegS`, `roll` of `rollRateDegS`, `throttle` of the lever rate, so the AP has no more authority than the keys. Load, stall and nose limits still apply.
- **`stepPitch`** gains `direct: number | null`. When set it replaces `key * pitchRamp(hold)`, the fade uses its sign, and `hold` returns 0. **`stepBank`** `key` becomes `number` (it already scales a rate); `level` is always false while the AP is on. `stepEngine` already takes a number. `Controls` is never written by the AP.
- No integrator. Add one only if a test shows a steady error.
- The soft ceiling and turn help stay as they are; the AP corrects for them.

Expected *(prototyped, default tuning unless stated)*:

| Case | Within 10 ft (or 1 deg) after | Overshoot | Speed error |
|---|---|---|---|
| +300 / +1,000 / +5,000 ft | 15 / 20 / 49 s | 0 | under 1.2 m/s |
| Heading 90 / 170 deg | 26 / 45 s | 0; altitude moves 0.2 ft | 0.1 m/s |
| 30 deg + 500 ft together | 13 s / 17 s | 0 | 0.8 m/s |
| 12 t and 40 t, +1,000 ft, 60 deg | 24 / 22 s | 0 / 13 ft | 1.8 m/s |
| Start at 1.18 Vs, +1,000 ft, 90 deg | 21 s | 0 | speeds up to the floor; no stall warning |
| Full flaps 69 m/s, -500 ft | 17 s | 2 ft | 1 m/s |
| Retract full flaps at 75 m/s | 13 s | 59 ft up | 1.1 m/s below |
| 40 kN thrust, +5,000 ft | 140 s | 2 ft | 4.2 m/s |
| Speed hold off, +5,000 ft, fixed lever | Levels 1,200 ft short at 1.11 Vs | n/a | No stall warning |

Known limits, accepted: `spoolTauS` at 5 s makes the lever hunt slowly; `rollRateDegS` 90 with `turnMult` 4 overshoots the heading 3 deg. Both are slider extremes.

### 7.4 Stability, new `sim/flight/stability.ts`, pure

Two thresholds, so the AP cannot flicker at an edge. `stability(state, world) -> { stable, danger, reason }`:

| Reason | Not stable (refuse) | Danger (drop) |
|---|---|---|
| `GROUND` | On the ground, or crashed | On the ground, or crashed |
| `LOW` | Under 45 m above ground, or gear not up under 150 m | Under 30 m, or gear not up under 150 m |
| `BANK` | Over 30 deg | Over 45 |
| `PITCH` | Over +/-15 deg | Over +/-25 |
| `STALL` | Any stall state | Any stall state |
| `SLOW` | Under 1.15 Vs | Under 1.05 Vs |
| `TERRAIN` | `terrainAhead` | `terrainAhead` |

- First matching row is the reason. Engage also needs `stableTicks >= 30` (0.5 s; otherwise the reason is `UNSETTLED`) and no flight key held (`controls`).
- `advance` computes it once per step, before the flight step, and updates `stableTicks`; on danger it clears `on` and `spd` and writes the notice. Crash, restart, start and place clear everything and set `stableTicks` to 0.
- The gear rule means the AP lets go at 150 m on approach: landings are flown by hand. 150 m equals `TAKEOFF_HUD_AGL_M`; a test keeps them equal, because it is also what guarantees the bugs are visible. Compare gear with `GEAR_UP_AT`, as `takeoffMode` does.
- The AP's own limits (25 deg bank, 5 deg path) sit inside "stable", so it never drops itself. **Exception to check:** turning when already slow. Bank raises Vs; the prototype's lowest was 1.11 Vs against a drop at 1.05.
- Terrain: the AP flies the bug into a hill until `TERR`, then hands over with about 8 s left. No avoidance.

## 8. Values

| Constant | Start | File |
|---|---|---|
| `ASI_TABLE`, `VSI_TABLE`, `HORIZON_PX_PER_DEG`, `PANEL_CELL`, `DIAL_R`, `NEEDLE_QUANT_DEG`, `VS_MODE` | §2 to §4 | `config/display.ts` |
| `SPD_BUG_STEP_KT`, `SPD_BUG_FINE_KT`, `AP_NOTICE_S`, `AP_CAPTURE_FT`, `AP_CAPTURE_DEG`, `AP_CAPTURE_KT` | 5, 1, 2, 20, 2, 2 | `config/display.ts` |
| `TERR_LOOK_S`, `TERR_STEP_M`, `TERR_CLEAR_M` | 8, 30, 10 | `config/flight.ts` |
| `ALT_TAU_S`, `AP_UP_DEG`, `AP_DOWN_DEG`, `AP_PITCH_GAIN_DEG` | 6, 5, 4, 3 | `config/flight.ts` |
| `AP_HDG_GAIN`, `AP_BANK_DEG`, `AP_ROLL_GAIN` | 1.5, 25, 1.0 | `config/flight.ts` |
| `AP_SPD_GAIN`, `AP_SPD_DAMP`, `AP_FLOOR_MULT`, `AP_CLIMB_FADE` | 0.08, 0.5, 1.25, [1.1, 1.2] | `config/flight.ts` |
| Stability thresholds, `STABLE_TICKS` | §7.4, 30 | `config/flight.ts` |
| Gauge, lamp and AP colors | placeholders | `config/palette.ts` |

None become `Tuning` sliders: tune them in the file first, and add a slider only if flying shows one is needed often.

## 9. Files

| Step | New | Changed |
|---|---|---|
| D1 | `config/pixelFont.ts`, `views/gauges/pixels.ts` (line, text), `views/gauges/dial.ts` (angle tables, quantize, face cache), `views/gauges/airspeed.ts`, `views/gauges/altimeter.ts`, `views/panelState.ts` | `views/instruments.ts` (grid, text cells; keeps `readoutText` and the rest), `main.ts`, `config/display.ts`, `config/palette.ts` |
| D2 | `views/gauges/horizon.ts`, `compass.ts`, `vsi.ts` | `panelState.ts`, `instruments.ts`, `sim/units.ts` (second V/S function), `main.ts`, `app/debugPanel.ts` (V/S checkbox) |
| D3 | `sim/flight/terrain.ts`, `views/gauges/power.ts`, `gearFlaps.ts`, `lights.ts` | `instruments.ts` (last text cells removed), `panelState.ts`, `main.ts`, `debugPanel.ts` (timing row) |
| D4 | `sim/flight/autopilot.ts`, `sim/flight/stability.ts` | `sim/state.ts`, `commands.ts`, `step.ts`, `flight/air.ts`, `flight/attitude.ts`, `input/keyboard.ts` (`KeyZ`, `KeyX`, `Comma`, `Period`), `main.ts`, `views/sideView.ts`, `lights.ts`, `airspeed.ts`, `instruments.ts` (sentence), `debugPanel.ts` (AP rows) |

Tests: `tests/gauges.test.ts` (D1 to D3), `tests/terrainAhead.test.ts`, `tests/stability.test.ts`, `tests/autopilot.test.ts`. Adding fields to `SimState` changes test literals; put defaults in `initialState` and `tests/helpers.ts`.

Docs at each step: `CURRENT.md`, this file's Status and Results, `AGENTS.md`'s "next is" line. At the end: GAME_DESIGN §5.3 (keys) and §4.1, ARCHITECTURE §6.1, §15 (V/S scale, speed brake, canvas performance) and §16.

## 10. Steps

**D1**
1. Pixel line, bitmap font and dial math, tests first.
2. Grid with every cell as text. Look: nothing lost against today's twelve readouts at 1280 x 720.
3. `PanelState` and skip-redraw; airspeed dial; altimeter. **Gate D1.**

**D2**
4. Horizon. Fly it; the sign of bank and pitch is the thing to get right.
5. Compass and bug; vertical speed in both modes; altitude bug mark.
6. V/S decision flights, then remove the loser. **Gate D2.**

**D3**
7. POWER and CONFIG cells.
8. `terrainAhead` with tests; LIGHTS cell; readout sentence.
9. Timing row and the performance check. Delete the text-cell code. **Gate D3.**

**D4**
10. `stability` and `stableTicks`, tests first. Behavior unchanged.
11. State, commands, override and drop rules, with output not yet wired.
12. `stepPitch.direct`, `stepBank` number, `autopilotOutput`: ALT, then HDG, then SPD, each with its closed-loop test before the next.
13. Keys, bug sync, lamps, speed bug, notices, debug rows. **Gate D4.**
14. Docs (§9).

## 11. Verification

`npm run typecheck`, `npm test` and `npm run build` at every gate. The 487 existing tests pass unchanged except where a literal needs a new field.

**D1 to D3 tests (headless, pure functions)**
- Dial tables: every breakpoint, between them, pegging at both ends, non-decreasing over 0 to 600 kt. Altimeter hands at 0, 250, 999, 1,000, 9,990, 19,690 ft.
- Quantize: equal `PanelState` for a change under the step, different above; parked plane gives equal states for 60 steps.
- Pixel line: both endpoints, all octants, no gaps. Font: every character used by the panel has a glyph of the right size.
- Horizon: zero pitch and bank splits the window in the middle; **nose up puts more sky; right bank puts the horizon's right end higher on screen**; 30 deg nose up and 60 deg bank still leave both colors. Flight-path marker on the horizon line when the path is level.
- Compass: at heading 090 `E` is on top; 359 and 001 are 2 deg apart. Bug side matches `turnNeeded`.
- V/S: both modes; `altimeter` equals `world` x altitude scale and the actual change in displayed feet over one step.
- Stall arc: matches `levelStallSpeed` for flaps 0, 1, 2 and 30 deg of bank; the cache misses when any key changes.
- Lamps: `STALL` and `GEAR` lit together; all dark when crashed; `brakeText` conditions kept.
- `terrainAhead`: level toward a cliff at 7 s and at 9 s; climbing over it; diving at flat ground; level over water never; off with gear down low, on the ground, crashed. Air start, hands off: warns before the crash on the peak.

**D4 tests**
- `stability`: each row on both sides of both thresholds; row order; constant equality with `TAKEOFF_HUD_AGL_M`.
- Commands: engage refused for each reason with that notice; refused with a key held, non-finite targets, `stableTicks` 29; accepted at 30. Override table of §6, one test per row. `apTarget` clamping, wrapping, and ignored when off. A command changing only the autopilot is not lost.
- `stepPitch` with `direct: null` and `stepBank` with an axis key are bit for bit today's results; a 3,600-step flight with the AP never on is unchanged.
- **Closed loop** through the real `advance`: every row of §7.3's table, to its settle time +25% and overshoot +10 ft (13 ft case: 25 ft). Altitude then stays within 10 ft for 60 s; never `warning`; lever travel over the last 30 s under 1%.
- Danger drops: terrain ahead, gear lowered under 150 m, a tuning change that makes it slow. The player can fly on from the drop without an input.
- Never self-drops: 10 simulated minutes of random (seeded) bug moves at sea, with no `dropped` notice.
- Bug sync: a bug moved and then paused in the same frame still reaches the sim.
- Determinism: the same commands twice give identical states.

**By eye** (dev server, focused full-size window, then 1280 x 720; console clean)

| Gate | Check |
|---|---|
| D1 | Needles crisp, smooth and not shimmering; digits readable at 2x; stall arc moves with F and with bank |
| D2 | Cover both world views with a window: hold 3,000 ft +/-200, turn to a bug +/-5 deg, climb 1,000 ft and level off, recover from a 45 deg bank. Do the level-off five times in each V/S mode and note the misses |
| D3 | Every control (throttle, flaps, gear, brakes, spoilers) can be read from the panel without the numbers; `TERR` in time to pull up toward the peak; a normal approach shows no false warnings; performance figures |
| D4 | `Z` from level flight: no visible jump. +500 and -500 ft, a 90 deg turn, both at once. Override by each key. Refusals and drop are understood without reading docs. Lever still in a minute of cruise. 60 s hands off with attention on the debug panel (another window would pause the game) |

Say plainly in Results which of these were not done. Blur pauses the loop, so they need a person or a focused pane.

## 12. Decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | One plan | Four gates | Same panel, same files; each still playable alone |
| 2 | Grid | 4 x 2 cells of 80 px | Exactly 320 x 160; a cell changes from text to gauge without moving the others |
| 3 | Drawing | Pixel lines and bitmap font, faces cached | Keeps the 16-bit look at 2x; H2 can swap faces only |
| 4 | Airspeed scale | Piecewise linear | Flying happens at 60 to 240 kt; the sim allows 583 |
| 5 | Stall arc | Live, from the sim's polar | Cannot disagree with how the plane flies |
| 6 | V/S | Both built, `world` recommended, decided by flying | ARCHITECTURE §15 says D2 decides |
| 7 | Lights | One place each, no flashing | Two warnings at once must both show |
| 8 | Overspeed light | None | Nothing behind it |
| 9 | `Z` target | The bugs, not the present state | One targeting UI, works with ATC |
| 10 | Speed hold | Comes on with `Z` | Holding altitude on a fixed lever ends at 1.1 Vs |
| 11 | AP input | Same rates as the keys, ramp bypassed | Prototype: the ramp alone causes 45 to 180 ft of overshoot |
| 12 | Danger | Lets go and says why | GAME_DESIGN §5.4: no rescue |
| 13 | Gate shape | Two thresholds and 0.5 s | No flicker; F6 needs the same function |

## 13. Risks

- **C6 is unflown.** If its values change, stall arcs follow by themselves, but D4's closed-loop numbers may move. Retune in step 12, not before.
- **80 px dials may be too small at 1280 x 720** (160 screen px). Step 2 and 3 show this early. Fallback: drop the V/S dial to a narrow strip and give its width to the horizon.
- **Altimeter too fast to read** in steep climbs. The tape and digits help; if not enough, drop the short hand and make the long hand 10,000 ft per turn, with the digits carrying the rest.
- **Needle redraw cost** replaces "redraw on string change". Measured in step 9.
- **Prototype is not the game:** flat ground, no commands, no drops. Step 12's tests are the real check; differences go in Results.
- **The forgotten bug:** pressing `Z` with a stale bug turns the plane. If it annoys in flight, set the bugs to the present state on `Z` when both are more than 90 deg / 3,000 ft away.
- **Terrain false alarms** in turns near hills would drop the AP. If so, follow the turn (the top view's turn line has the math) or shorten the look-ahead.

## 14. Done when

- **D1:** airspeed and altitude needles follow the plane; no readout was lost.
- **D2:** the D2 by-eye flights succeed with the world views covered; V/S mode decided and the other removed.
- **D3:** every control and warning is on the panel, no text cells remain, performance recorded.
- **D4:** holds and captures heading and altitude as §7.3; refuses or lets go in every §7.4 case, with a reason shown; manual flight is unchanged with the AP off.
- All: typecheck, tests and build pass; CURRENT.md is right; unchecked items are listed there.

## 15. Results

**D1** (typecheck, 502 tests and build pass; the sim-heavy tests can time out at 5 s when the whole suite runs under CPU load, and pass alone).
- Built: pixel font and line, dial tables, face cache, `PanelState` with skip-redraw, grid with text cells, airspeed (live stall arc) and altimeter dials.
- Looked at in the browser pane: layout and static faces at rest, console clean. **Not done:** needle motion in flight (the pane barely ran the sim), shimmer at 2x, the stall arc moving with flaps and bank by eye, 1280 x 720 legibility.
- Deviation: text cells use the 5 x 7 pixel font too, not canvas text.

**D2** (typecheck, 514 tests and build pass).
- Built: horizon, compass with heading bug, vertical speed dial in both modes behind `VS_MODE` with a debug checkbox, altitude bug on the altimeter, `altimeterVerticalSpeedFpm` in `sim/units.ts`.
- Looked at from the air start in the browser pane: all gauges draw, console clean. **Not done:** the D2 by-eye flights (3,000 ft hold, bug turn, level-offs in each V/S mode), so **the V/S mode is not decided** and neither mode has been deleted; sign of bank and pitch confirmed only by tests, not by flying.
- Deviation: horizon disc is radius 34 with the numbers under it, instead of a 76 px window; the bank pointer moves the way the plane banks.

**D3** (typecheck, 526 tests and build pass).
- Built: POWER, CONFIG and LIGHTS cells, `terrainAhead` with tests (including an air start hands off on the real map), readout warn order and sentence, `instruments` timing row, text cells deleted.
- Looked at in the browser pane from the final-approach start: all cells draw, console clean.
- **Performance check not done as specified.** Measured in the hidden pane with a script (300 states of a banked, climbing, turning craft, build plus `drawPanel`): median about 1 ms, but the tail was erratic (p95 4 to 9 ms, worst over 100 ms), which the throttled pane makes untrustworthy. The target (instruments under 1 ms, total draw p95 under 8 ms in a focused full-size window) still needs a person, using the new `instruments` row. Before this, text was one rectangle per pixel; it is now runs, and the stall arc repaints in 2 kt steps.
- **Not done:** `TERR` in time toward the peak by flying, no false warnings on a normal approach, reading every control without the numbers.
- Deviation: the CONFIG cell's gear and flap layout was set by eye on a 80 px cell and may need adjusting after a look at 1280 x 720.

**D4** (typecheck, 580 tests and build pass).
- Built: `stability` and `stableTicks`; `autopilot`, `autothrottle`, `apTarget` commands with override, let-go and reset rules; `stepPitch.direct`, `stepBank` number key; `autopilotOutput` (ALT, HDG, SPD exactly as 7.3); keys Z, X, comma, period; bug sync; lamps, speed bug, notices, solid altitude bug line, debug rows.
- Closed loop through the real `advance` on flat ground: all 11 rows of 7.3 pass at settle time +25% and overshoot +10 ft (the 7.3 figures were reproduced almost exactly: 15, 20, 26, 45, 17 s for the first rows with 0 overshoot), plus the start at 1.18 Vs. Altitude then stays within 10 ft for 60 s, the lever moves under 1%, no stall warning; 10 simulated minutes of seeded bug moves never drop it; two runs are identical; with the AP never on, 3,600 steps equal the plain air step.
- Deviations: (1) the 40 t row starts at 110 m/s, not at the default air-start speed, because 40 t at 90 m/s is below the 1.15 Vs engage limit (it is correctly refused: SLOW); (2) the 1.18 Vs row is started trimmed (nose set for level flight at that speed). Engaged from an untrimmed, descending start at about 1.2 Vs it lets go (STALL) within 2 s, which is the intended safe behavior. (3) `stability` returns a second field `dangerReason`.
- **Not done:** any flying by hand or with the AP in a live window (the browser pane pauses the sim, so only the refusal notice and the panel were seen); the by-eye D4 checks (no visible jump on Z, 90 deg turn, override by each key, lever still for a minute, 60 s hands off); the real-map terrain behavior with hills (tests use a flat map and a cliff); feel and tuning.
