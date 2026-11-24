# B1 Implementation Plan: Fixed-step loop and keyboard input

**Status:** PLAN, for review. Nothing built.
**Milestone (ARCHITECTURE.md §14):** "A dot moves and turns; pausing works."
**Starting state:** A4 is committed (`555d0b8`). 100 tests pass. Views draw only on demand, and the probe is a variable in `main.ts` that pointer handlers edit directly.

All numbers are provisional.

## 1. Scope

B1 turns the probe into a simulated dot. It sets the pattern later steps reuse: commands in, fixed steps, snapshots out.

**In:** simulation state and step function, commands, fixed-step loop with catch-up limit and interpolation, keyboard input, pause (key and loss of focus), existing pointer controls rerouted through commands, frame timing check, tests.

**Out:**

| Left out | Where it belongs |
|---|---|
| Follow camera, plane sprite | B2 (until then the dot can leave the view; drag the map to find it) |
| Altitude, climbing, crashing, W/S keys | B3 |
| Speed readout, debug panel, frame-time display | B4 |
| Thrust, drag, banking | C1-C3 |
| Restart | C5 |
| Seeded random streams | G6-G8, with the first thing that needs them |
| Replay recording and export | B4 or later; B1 only keeps it possible |
| Terminal focus (Tab/Esc) and co-pilot | F1, F6 |
| Rebindable keys, gamepad | Later |

## 2. Behavior

| Input | Effect |
|---|---|
| A / D | Turn left / right at 30 deg/s while held; both together cancel |
| E / Q | Speed up / down at 40 m/s² while held, 0-150 m/s; speed stays when released |
| P | Pause / resume |
| Click top view | Place the dot (as now, paused or running) |
| Drag side view | Turn the dot (as now, paused or running) |

- The dot starts at (2560, 2560), heading 045, at 60 m/s. At that speed it turns in a circle of about 115 m radius and crosses the 5,120 m map in about 85 s.
- At the map edge, each coordinate is clamped separately, so the dot slides along the edge.
- A/D/E/Q are the keys in GAME_DESIGN.md §5.3. **P is new** and needs adding there.

## 3. Simulation

```ts
// src/sim/state.ts - no browser, no view imports
interface Craft {
  readonly x: number; readonly y: number; // WORLD m
  readonly heading: number;               // radians clockwise from north, 0..2pi
  readonly speed: number;                 // m/s
}
interface Controls { readonly turn: Axis; readonly throttle: Axis }  // Axis = -1 | 0 | 1
interface SimState { readonly tick: number; readonly craft: Craft; readonly controls: Controls }

// src/sim/commands.ts
type Command =
  | { kind: 'turn'; value: Axis }
  | { kind: 'throttle'; value: Axis }
  | { kind: 'place'; x: number; y: number }  // pointer, test tool
  | { kind: 'rotate'; by: number };          // pointer, test tool

// src/sim/step.ts
applyCommands(state, commands, bounds): SimState  // tick and time do not change
advance(state, bounds): SimState                  // exactly one 1/60 s step
```

- **Two functions, not one.** Each step is `applyCommands` then `advance`, as in ARCHITECTURE.md §4. Keeping them apart lets a click move the dot while paused without time passing.
- `advance` updates speed, then heading, then position using the new heading. It always uses the constant `STEP_S = 1 / 60`; it takes no `dt`.
- Both are pure and return new objects. State is small, so allocation is not a concern.
- Non-finite values in a command are ignored, so NaN cannot enter the state.
- `interpolate(prev, next, alpha)` lives in `src/sim/interpolate.ts`. Heading takes the short way through north.
- `wrapHeading` moves from `views/probe.ts` to `src/sim/angles.ts`, because `sim/` may not import views.

**Replay later:** a command belongs to the tick at which it is applied, before that tick advances. Initial state plus `(tick, command)` pairs reproduces a run. A test proves this now.

## 4. Loop

`src/app/stepper.ts` is pure arithmetic and `src/app/loop.ts` connects it to the browser.

```text
each animation frame:
  if paused: do nothing
  steps, alpha = stepper(elapsed)
  if steps > 0: queue keyboard changes
  for each step:
    state = applyCommands(state, queued)    // first step takes the whole queue
    prev  = state
    state = advance(state)
  draw both views from interpolate(prev, state, alpha)
```

- **Catch-up limit:** at most 5 steps per frame. Further whole steps are dropped; the fraction of a step is kept, so motion stays smooth.
- **Negative elapsed time** counts as 0. The first frame after starting or resuming sets the clock and runs no steps, so time spent paused is never simulated.
- **`prev` is taken after commands.** Otherwise a click would draw the dot streaking across the map for one frame.
- **Input is sampled only on frames that run a step.** On a 144 Hz display many frames run none; sampling there could queue a press and its release together, and a quick tap would do nothing.
- Commands from a click or drag while paused are applied at once, set `prev = state`, and request a redraw.

**Drawing**
- The loop must draw *now*. `requestDraw()` inside an animation frame waits for the next one, adding a frame of lag. `PanelHandle` gains `render()`, which draws immediately and cancels a pending request, so a mouse move does not cause a second draw.
- While paused, on-demand `requestDraw()` works as it does today.
- The instruments placeholder is not redrawn each frame.
- The first draws happen inside `initPanels`, so the state must exist before it is called.

## 5. Keyboard

`src/input/keyState.ts` holds the logic; `src/input/keyboard.ts` adds the window listeners.

- **Bindings** use `event.code` (physical position), so they work on other layouts.
- **Latch:** a key pressed and released between samples still counts for one sample.
- `sample()` returns commands only for axes that changed.
- Auto-repeat is ignored. Keydown with Ctrl, Alt or Meta is ignored, so browser shortcuts keep working. Keyup is always honored, and releasing Meta clears all keys, because macOS drops other keyups while it is held.
- Keydown in a text field or other editable element is ignored, ready for the terminal.
- `clear()` forgets held and latched keys. If an axis was non-zero, the next `sample()` emits 0 for it.

## 6. Pause

| Event | Result |
|---|---|
| P | Toggles |
| Window blur, or tab hidden | Pauses |
| Focus returns | **Stays paused** until P or the Resume button |
| Page opens without focus | Starts paused |

- Pausing clears held keys. A key held through resume does nothing until pressed again.
- A small banner shows `PAUSED - P to resume` with a Resume button. It is positioned over the page, takes no layout space (panel sizes are exact, see `styles.css`), and leaves the views usable.
- The button drops focus after use, so Space, later the brake, cannot press it again.
- Opening developer tools or clicking another window pauses. That is intended.

## 7. Views

Both views already take a `Probe` of `{x, y, heading}`. The interpolated `Craft` has the same fields, so **no view drawing changes**. The top view draws the existing dot and arrow; the side view's slice follows.

`Probe` stays as the view-facing type until B2. `START_PROBE`, `turnBy` and `moveProbe` are deleted; their behavior moves into `sim/`.

## 8. Files

| File | Change | Purpose |
|---|---|---|
| `src/sim/state.ts`, `commands.ts`, `step.ts`, `interpolate.ts`, `angles.ts` | new | §3 |
| `src/config/motion.ts` | new | Rates, limits and start values in §2 (C1 replaces most) |
| `src/app/stepper.ts` | new | Accumulator, catch-up limit, alpha |
| `src/app/loop.ts` | new | Animation frame, state, queue, pause |
| `src/app/pause.ts` | new | Focus events, banner |
| `src/input/keyState.ts`, `keyboard.ts` | new | §5 |
| `src/app/panels.ts` | edit | `render()` on the handle |
| `src/views/probe.ts` | edit | Keep the type, `formatHeading`, `DEGREES_PER_PIXEL` |
| `src/main.ts` | edit | Use the loop; pointers send commands |
| `index.html`, `src/styles.css` | edit | Banner |
| `tests/` | new, edit | §10 |

No new dependencies.

## 9. Steps

Each step leaves the page working.

1. **Simulation core:** state, commands, step, interpolation, angles, with tests. Nothing visible changes.
2. **Pointers through commands:** `main.ts` holds a `SimState`; click and drag use `applyCommands`. Behaves as before.
3. **Stepper and loop,** with `render()`. The dot moves by itself at 60 m/s.
4. **Keyboard.** The dot turns and changes speed.
5. **Pause:** P, focus, banner.
6. **Measure and verify (§10), then update documents:** results here; GAME_DESIGN.md §5.3 (P); ARCHITECTURE.md §16 (next is B2).

## 10. Verification

**Automated**

| Area | Tests |
|---|---|
| Step | 60 steps at 60 m/s move 60 m; headings 0, 90, 180, 270 move north, east, south, west; D increases heading; 12 s of turn returns to the start heading; speed stops at both limits; clamps at each edge and corner; no NaN after 10,000 steps of varied commands |
| Commands | `applyCommands` never changes the tick; place clamps; rotate wraps both ways through north; non-finite values ignored |
| Interpolation | Ends exact; midpoint; 359 to 001 passes through 360, not 180 |
| Stepper | 10 s at 30, 60 and 144 Hz gives 600 steps, within 1; a 2 s frame gives 5 steps and a fraction below 1; negative and zero elapsed give 0 |
| Determinism | The same `(tick, command)` list gives identical state under 30, 60, 144 Hz and irregular frames |
| Loop | With a fake frame clock: no steps while paused; no jump on resume; place while paused moves the dot and not the tick; a placed dot never appears between the old and new positions; a tap shorter than one step still turns |
| Keys | Opposites cancel and recover; latch lasts one sample; repeat, modifiers and text fields ignored; keyup with a modifier honored; clear emits zeros |
| Boundaries | `sim/` also may not use `performance`, `requestAnimationFrame`, `setTimeout`, `Date` or `Math.random` |

The probe tests for wrapping and clamping move to the new sim tests. All other existing tests, typecheck and build must pass.

**Manual, in the browser pane**
- The dot moves in the arrow's direction and the side slice scrolls with it; A turns left on screen, D right.
- Motion is smooth, without jumps, at every top-view zoom.
- Fly off the map in each direction: the dot slides along the edge with no console errors.
- Hold D and switch window: the game pauses and, after P, the dot is not still turning.
- Leave it hidden for a minute and resume: the dot has not moved.
- While paused: click to place, drag to turn, pan, zoom and hover all work.
- Map drag and zoom still work while running. Ctrl+R, Ctrl+wheel and F12 work.
- Panel sizes are the same as before at 1280 x 720 and 1920 x 1080.
- **Timing:** time `render()` for each view over 300 frames at every zoom, and record the results. Target: both under 8 ms. This is temporary code, removed afterward.

## 11. Decisions

**Recommended defaults; say so if you want any changed:**

1. **P pauses,** because Esc is already assigned to leaving the terminal and Space to brakes.
2. **Stay paused when focus returns,** so the plane never flies before the player is ready.
3. **E/Q change speed directly** until C1 adds throttle.
4. **Keep click-to-place and drag-to-turn** as test tools, rather than removing them now. They get in the way of nothing and are useful until B4.
5. **No follow camera in B1.** B2 owns it.
6. **Clamp at the map edge,** rather than wrapping or letting the dot leave.
7. **Keys send -1, 0 or 1,** and the simulation applies rates. C3's damping then needs no input changes.

## 12. Risks

| Risk | Response |
|---|---|
| Side view too slow to redraw every frame: it samples four profiles per column, and A4 did not time it | Measure in step 3, before building on it. Over 8 ms, cache color strings and reduce the haze layers first; note the rest for B2 |
| Dot jitters against the ground: terrain is drawn from a rounded origin, the dot is not | The camera is still in B1, so it should not show; check again in B2 |
| Keys stick after losing focus | Clear on pause; test; manual check |
| Quick taps lost at high refresh rates | Latch, and sampling only on stepping frames |
| Focus rules make automated browser checks flaky (a hidden pane has no animation frames) | Loop tests use a fake clock; show the pane for manual checks |
| Two copies of the state drift apart | The loop owns the only copy; `main.ts` reads snapshots and sends commands |

## 13. Done when

The dot moves and turns from the keyboard in both views, pausing works by key and by loss of focus, frame times are recorded, and typecheck, tests and build pass.

**Next:** B2, plane sprite in both views with a follow camera.

## 14. Results

**Built as planned.** 126 tests, typecheck and build pass. P added to GAME_DESIGN.md §5.3.

**Checked in the browser pane:** P toggles and the banner follows; the page starts paused when unfocused; blur pauses; Resume works and drops focus; no console errors. The pane is far below 1280 x 720 and ran about 1 to 3 animation frames per second, so smooth motion, edge sliding and panel sizes were **not** checked there. They rest on the unit tests and still need a look in a full-size window.

**Timing** (`render()` called directly, 100 to 300 calls per setting, top zoom 0, 2 and 5, all four side zooms):

| View | Median | Notes |
|---|---|---|
| Top | under 1 ms | all zooms |
| Side, before change | mean 14 to 23 ms | spikes to 400 ms |
| Side, after caching color strings | median about 1.7 ms | p95 15 to 25 ms |

The p95 spikes appear when `render()` is called back to back without animation frames, and were not tied to a zoom level. They need re-checking at full size with real frames (B4's frame-time display).

**Change outside plan:** `sideView.ts` now caches color strings (the first step in the §12 risk response).
