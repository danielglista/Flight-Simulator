# B4 Implementation Plan: Basic readouts and debug panel

**Status:** Built. Automated checks pass; the manual checks in a full-size window are mostly not done (§13).
**Milestone (ARCHITECTURE.md §14):** "Speed, altitude and heading show; tuning changes live."
**Starting state:** B3 is committed (`30a741e`). 191 tests and typecheck pass. The instruments panel still shows the A1 placeholder. B2's real-frame timing and most of B3's manual checks are still owed.

All numbers are provisional. "m" means world meters unless it says real.

## 1. Scope

**In:** four text readouts in the instruments panel, a debug panel with live tuning, flight state and frame timing, a `tune` command, crash banner altitude in feet, tests.

**Out:**

| Left out | Where it belongs |
|---|---|
| Gauges, needles, horizon | D1, D2 |
| Throttle, flap and gear indicators; warnings | D3 |
| Pitch and bank readouts (the nose follows the path and there is no bank yet) | C2, C3 |
| Live scale sliders | E1, E4 (§4) |
| Force vectors, stability state | C, D4 |
| ATC state, conflicts, weather override, jump-to-phase, replay export | With the systems they show |
| Saving tuned values | H5 |

## 2. Behavior

**Readouts,** always visible, in a 2 x 2 block:

| Readout | Source | Format | At the start |
|---|---|---|---|
| `SPD` | `speed` | knots, whole | `117` kt |
| `ALT` | `z` x altitude scale | displayed feet, nearest 10, thousands comma | `3,280` ft |
| `HDG` | `heading` | existing `formatHeading` | `045` |
| `V/S` | `speed * sin(pathAngle)`, **unscaled** | ft/min, nearest 50, signed | `0` fpm |

- Values come from the interpolated snapshot, so they match the two views.
- `V/S` is included because B3 assigned it here. At 60 m/s and 15 degrees it reads `+3,050` while `ALT` rises 509 ft per second, ten times what `V/S` implies. That is the mismatch in GAME_DESIGN.md §4.1; B4 makes it visible, and D2 decides it.
- After a crash `SPD` and `V/S` read 0 and `ALT` is the ground.

**Debug panel,** hidden at first:

| Input | Effect |
|---|---|
| **Backquote** (key left of 1) | Show / hide the panel, running or paused |
| Drag a slider | The value changes at once, running or paused |
| **Reset** | Every tuned value returns to its default |

- The panel covers the **comms terminal**, which is unused until F1. Both views and the readouts stay visible while tuning.
- **Using a slider must not stop flight keys.** See §5.
- Tuned values survive a crash and restart. A page reload resets them.

## 3. Readouts

**Units** live in a new pure file, `sim/units.ts`, because ATC inside `sim/` will need them too (ARCHITECTURE.md §5). The names say which kind of value each returns:

```ts
metersPerSecondToKnots(v)
displayedAltitudeFt(worldZ, scale)   // world m -> real m -> ft
verticalSpeedFpm(craft)              // unscaled world ft/min
```

**Text** is made in `views/format.ts`: `formatSpeed`, `formatAltitude`, `formatVerticalSpeed`. A value that rounds to zero is always `0`, never `-0` or `+0`.

**Drawing** is a new `views/instruments.ts`, replacing the placeholder through the existing `initPanels` hook:

- Lay out from the actual canvas size, at least 320 x 160, centering the block. The canvas grows with its panel.
- Numbers are right-aligned in fixed cells so they do not shift as digits change.
- `readoutText(craft, scale)` is pure and returns the four strings. `main.ts` renders the panel **only when they change**, because `render()` reads page layout. Resizing redraws through the existing observer.
- A visually hidden line carries the same values for screen readers (ARCHITECTURE.md §8), updated at most 4 times a second and **not** a live region, so it does not talk constantly.

**Crash banner:** it now shows feet through `formatAltitude` (`CRASHED: mountain, 3,670 ft - Enter to restart`). Otherwise it and `ALT` would give different numbers for the same height. The views' map readouts and scale ticks stay in meters as developer information.

## 4. Live tuning

**Tuning is simulation state, changed by a command.** Commands remain the only way in, so a replay reproduces a tuned run. A mutable global config would break that and leak between tests.

```ts
// config/motion.ts
interface Tuning {
  readonly turnRateDegS: number;
  readonly speedRate: number;
  readonly speedMax: number;
  readonly pathMaxDeg: number;
  readonly pathRateDegS: number;
}
const DEFAULT_TUNING: Tuning
const TUNING_RANGES: Record<keyof Tuning, { label, unit, min, max, step }>

// sim/state.ts
interface SimState { ...; readonly tuning: Tuning }

// sim/commands.ts
| { kind: 'tune'; key: keyof Tuning; value: number }
```

| Value | Replaces | Default | Range | Step |
|---|---|---|---|---|
| `turnRateDegS` | `TURN_RATE_DEG_S` | 30 | 5 to 120 | 5 |
| `speedRate` | `SPEED_RATE` | 40 | 5 to 100 | 5 |
| `speedMax` | `SPEED_MAX` | 150 | 50 to 300 | 10 |
| `pathMaxDeg` | `PATH_MAX_DEG` | 15 | 5 to 30 | 1 |
| `pathRateDegS` | `PATH_RATE_DEG_S` | 20 | 5 to 90 | 5 |

- The old constants are removed, so there is one source. With default tuning, results are identical to B3.
- **Validation:** an unknown key or a non-finite value is ignored; a finite value is clamped to its range. Allowed while crashed.
- **Restart keeps tuning,** as it keeps controls and tick. `place` and `rotate` do not touch it.
- Lowering `speedMax` below the current speed cuts it on the next step. Lowering `pathMaxDeg` lets the angle move to the new limit at the normal rate.
- **`loop.send` applies `tune` at once, even while running,** instead of queueing it. Pause drops the queue, so a queued change could be lost while its slider showed the new value. Tuning acts only in `advance`, so this equals applying it at the start of the next step. Other commands queue as now.
- **Pitch sprite:** frames stop at 15 degrees, so a 30 degree path would be drawn wrong. `PITCH_MAX_DEG` becomes 30 and the frame count 25, derived from the step. The 45 px frame already fits every rotation.

**Why no scale sliders yet.** ARCHITECTURE.md §12 says "live scale and tuning sliders", but scales are baked in three places today: airport layouts (`buildAirport`), cached map chunk shading (`colorChunk`) and the side view's snow line. Changing altitude scale live would also move the ground under the plane. E1 reworks scales and E4 tunes them, so the slider belongs there. The panel shows both current scales as text.

## 5. Input

- `keyboard.ts`: add `Backquote` to `KeyActions` and `actionFor`, and replace the repeated three-code comparison with one lookup.
- **`isEditable` currently counts every `INPUT`,** including a range slider. After touching a slider, all flight keys and P would be dead until the player clicked elsewhere. It becomes true only for controls that take typed text: text-like inputs, `TEXTAREA`, `SELECT` and `contenteditable`. `range`, `button` and `checkbox` inputs are not editable.
- The rule moves to a pure `isTextEntry({ tagName, type, isContentEditable })` so it can be tested without a DOM.
- A focused slider keeps its own arrow keys; no flight key uses them. Any future arrow-key binding must check this.
- Reset drops focus after a click, as Resume does. Enter on it is already ignored by the restart rule.
- Hiding the panel drops focus from anything inside it.

## 6. Debug panel

HTML in `#panel-terminal`, absolutely positioned over it, so panel sizes do not change. It scrolls inside itself if short. `.debug[hidden]` needs an explicit `display: none`, as the banners do.

| Group | Contents |
|---|---|
| Tuning | One labelled range input per entry in `TUNING_RANGES`, with value, unit and default; Reset |
| Flight | Tick, x/y/z, height above ground (world and real m), path angle, speed in m/s, the three control axes, impact speed and angle after a crash |
| Scales | `altitude` and `airport`, read-only |
| Frame timing | See below |

- Sliders are generated from `TUNING_RANGES`, so a C1 value needs only a config entry. Build once with `createElement` and `textContent`.
- **Values are read back from `loop.state.tuning`,** never kept as a second copy. `send` applies `tune` at once, so the sync cannot pull a slider back during a drag.
- Text refreshes at 4 Hz while running and at once on a slider change or a paused redraw. A hidden panel does no work.
- **Draw both canvases first, then write panel text.** Writing first would force a layout when `render()` reads `clientWidth`, which would distort the timing it reports.

**Frame timing** covers the last 300 real frames and keeps recording while the panel is hidden:

| Measure | Meaning |
|---|---|
| Frame interval: median, p95, worst | Smoothness; includes work the draw calls only start |
| Top draw, side draw, total draw: median, p95 | CPU time in each draw call, against the 8 ms target |

- `LoopOptions` gains `onFrame?(elapsedS)`, called on running frames after the first, so a pause gap is never counted. `performance.now()` stays in `main.ts`.
- `app/frameStats.ts` is a pure fixed-size ring with `push`, `summary` and `clear`. Summaries are computed only on a refresh of a visible panel, and sort a copy.
- The panel says `n / 300` until full, and offers **Clear timing** so one maneuver can be measured alone.

## 7. Files

| File | Change | Purpose |
|---|---|---|
| `src/config/motion.ts` | edit | `Tuning`, defaults, ranges |
| `src/config/planeShape.ts` | edit | 25 pitch frames |
| `src/config/display.ts`, `palette.ts` | edit | Refresh rate, sample count, readout colors |
| `src/sim/state.ts`, `commands.ts`, `step.ts` | edit | §4 |
| `src/sim/units.ts` | new | Conversions (pure) |
| `src/views/format.ts` | edit | Number text |
| `src/views/instruments.ts` | new | Readout text (pure) and drawing |
| `src/app/frameStats.ts` | new | Timing ring (pure) |
| `src/app/debugPanel.ts` | new | Panel elements and refresh |
| `src/app/loop.ts` | edit | `tune` at once; `onFrame` |
| `src/app/crashBanner.ts` | edit | Feet |
| `src/input/keyboard.ts` | edit | §5 |
| `index.html`, `src/styles.css` | edit | Panel container, hidden readout line |
| `src/main.ts` | edit | Wiring, timing, conditional instrument render |
| `tests/` | new, edit | §9 |

No new dependencies.

## 8. Steps

Each step leaves the page working.

1. **Frame timing and panel shell:** `frameStats`, `onFrame`, Backquote, `isTextEntry`, the timing group. This comes first so the owed B2 measurement can be made **before** B4 adds drawing. If side draw p95 is over 8 ms in a full-size window, report it and agree on B2_PLAN.md §7's fallbacks separately; do not fold them into B4.
2. **Units, formats and readouts,** with tests; feet in the crash banner.
3. **Tuning in the simulation:** state, command, constants replaced, `send` rule, with tests. No visible change.
4. **Pitch frames** to 30 degrees.
5. **Sliders, Reset, flight and scale groups.**
6. **Verify (§9), then update documents:** results here; CURRENT.md; ARCHITECTURE.md §12 (scale sliders in E), §15 (Canvas performance row) and §16 (next is C1); GAME_DESIGN.md §5.3 (Backquote); AGENTS.md (milestone phase, tuning row).

## 9. Verification

**Automated**

| Area | Tests |
|---|---|
| Units | 60 m/s is 116.63 kt; 100 m at scale 10 is 3,280.8 ft; 60 m/s at 15 degrees is 3,056.9 ft/min; altitude scale changes altitude but not V/S |
| Formats | Rounding, commas, signs; small negatives give `0`; ceiling reads `19,690` |
| Readouts | Start state gives `117`, `3,280`, `045`, `0`; the same text for a change too small to show; crash gives zero speed and V/S |
| Tune | Each key changes its effect; unknown key and NaN/Infinity ignored; clamped at both ends; same state object when nothing changes; works while crashed |
| Tune and motion | Lower `speedMax` cuts speed; lower `pathMaxDeg` settles without overshoot; angle reaches exactly the tuned limit |
| Restart | Keeps tuning; `initialState` has the defaults |
| Loop | Tune while running shows in `state` before the next frame; survives an immediate pause; does not move the plane or tick; works while paused; `onFrame` skips the first frame and the first after resume |
| Invariant | B3's 10,000-step run with tuning at every maximum, and with changes mid-run: no NaN, `z >= heightAt`, under the ceiling |
| Determinism | B1's frame-rate test with tune commands at fixed ticks |
| Defaults | Existing motion tests pass unchanged; every default is inside its range and lands on a step |
| Keys | Backquote once per press, ignored in text fields; `isTextEntry` false for range, button and checkbox, true for text, missing type, textarea and select |
| Frame stats | Median, p95 and worst on known data; wraps at 300; empty and single sample |
| Sprite | 25 frames; level frame unchanged; nothing touches the edge at 30 degrees (replaces the 13-frame test) |
| Banner | Feet, and equal to `formatAltitude` for the same `z` |

Typecheck, all tests and build must pass.

**Manual, in a full-size visible window**
- Readouts follow a climb, turn and throttle change, and stay steady in level flight. Readable at 1280 x 720 and 1920 x 1080.
- Compare `ALT` at a crash with the banner; compare `HDG` with the side view.
- Drag each slider in flight and feel it at once; then fly with W/A/S/D and pause with P **without clicking elsewhere**.
- Tune while paused, resume, crash, restart: values kept. Reset restores all.
- Set `pathMaxDeg` to 30: the sprite's tilt matches its path.
- Show and hide the panel: the views do not resize or jump; no console errors.
- Judge the `V/S` against `ALT` mismatch, the 15 degree climb and the settle rate (B3's owed feel checks), and note preferred values.
- 300 real frames, straight and turning, at each top and side zoom, with the debug panel hidden and shown.
- B2 and B3's other owed checks use the same window and are best run together.

Anything not run is reported as **not checked**.

## 10. Decisions

**Recommended defaults; say so if you want any changed:**

1. **Include V/S** beside the three required readouts.
2. **Knots and feet for the pilot, meters for developer text.** The crash banner moves to feet.
3. **Readouts on the canvas,** since D1 replaces them there.
4. **Tuning in `SimState`, changed by command.** It costs a field on the state but keeps replay true.
5. **Five sliders,** the values that shape how flying feels now. Ceiling, start position and camera values stay constants.
6. **No scale sliders until E.**
7. **Backquote** toggles the panel. It is free in GAME_DESIGN.md §5.3 and needs no modifier.
8. **Panel over the terminal.** F1 must move it.
9. **Debug panel ships in all builds** for now. Hiding it from a public build is an H5 question.

**Existing mismatch, not changed here:** ARCHITECTURE.md §15 gives the instruments 320 x 200, while `config/display.ts` uses 320 x 160. The code fits the panel; the document should be corrected in step 6.

## 11. Risks

| Risk | Response |
|---|---|
| Sliders steal flight keys | `isTextEntry`, with tests and a manual check |
| Slider and simulation disagree | One copy in `SimState`; applied at once; read back |
| Panel work spoils the timing it shows | Writes after draws, 4 Hz, nothing while hidden; measure both ways |
| Draw time looks good because the GPU work is later | Frame interval reported beside it |
| Units mixed up | Named conversions, numbers checked by test |
| Values tuned by feel are lost | Default shown beside each; write good ones into `config/motion.ts` |
| Throwaway work before C and D | Units, formats, `tune`, frame stats and the panel survive; readout layout and some tuned values are replaced |

## 12. Done when

Speed, altitude, heading and V/S show and match both views, the sliders change flight at once while the keys still work, restart keeps the tuning, frame timing is readable, and typecheck, tests and build pass.

**Next:** C1, thrust, drag and weight.

## 13. Results

Built as planned. Typecheck, 222 tests and build pass.

**Deviations**
- Slider label `Climb rate of change` became `Path rate`.
- Debug text refreshes on a timer while running and by a one-shot frame callback while paused, written after the canvases.

**Checked** (built-in browser pane, dev server, no console errors): the four readouts show `117`, `3,280`, `045`, `0` at the start; Backquote opens the debug panel; a slider change reached `loop.state.tuning` and the panel read it back; the panel layout fits at an emulated 1280 x 720; the screen reader line updates.

**Not checked**
- Frame timing in a full-size visible window. The pane is small and does not run in real focus, so its figures (side draw median about 10 ms) are not trustworthy. B2's fallbacks (B2_PLAN.md §7) are not triggered or ruled out.
- Flight keys after touching a slider, in a real keyboard session (covered only by `isTextEntry` tests).
- The sprite at a 30 degree path, crash and restart with tuned values, readability at 1920 x 1080, and the feel checks (V/S against ALT, 15 degree climb, settle rate).
- B2 and B3's other owed live checks.
