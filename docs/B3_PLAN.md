# B3 Implementation Plan: Simple climb and descent

**Status:** Built, not committed. Automated checks pass; manual checks mostly not run (see §14).
**Milestone (ARCHITECTURE.md §14):** "Plane can fly over a mountain and crash into it."
**Starting state:** B2 is built but **not committed**. 146 tests and typecheck pass. The plane holds a constant 220 world m, above all terrain. B2's real-frame timing and most of its manual checks are still owed.

All numbers are provisional. "m" means world meters unless it says real.

## 1. Scope

**In:** W/S keys, a climb angle, terrain collision, a crashed state, a minimal restart, vertical follow in the side view, a tilted side sprite, tests.

**Out:**

| Left out | Where it belongs |
|---|---|
| Speed, altitude and V/S readouts; live tuning | B4 |
| Speed lost in a climb or gained in a dive; weight | C1 |
| Angle of attack, stall, pitch separate from path | C2 |
| Landing: every touch is a crash, runways included | C5 |
| Polished crash and restart | C5 |
| Terrain warning | D3 |
| Automatic zoom, explosion art, sound | E, H |

## 2. Behavior

| Input | Effect |
|---|---|
| Hold **S** / **W** | Climb / descend: the path tilts toward +15 / -15 degrees |
| Release | Path settles back to level |
| Fly into ground or water | Plane stops where it hit; `CRASHED` banner names what it hit |
| **Enter**, after a crash | Restart at the start position; no effect otherwise |
| Click top view | Places the plane, lifted if needed so that it is not inside a hill |
| Click or side-view drag, after a crash | Ignored |

- The throttle still sets airspeed, and climbing does not change it. At speed 0 the plane hangs in the air. This is accepted until phase C.
- The start heading (45 degrees) points straight at the 181 m peak, 1,689 m away. The start altitude drops from 220 to **100 m**, so doing nothing hits the mountain after about 19 s, and a few seconds of S clears it. The milestone is the first thing a player meets.

## 3. Motion

```ts
interface Craft {
  ...
  readonly pathAngle: number; // radians, positive = climbing. B3: the nose points along it
}
interface Controls { readonly turn: Axis; readonly throttle: Axis; readonly pitch: Axis } // +1 = nose up
interface Crash { readonly tick: number; readonly speed: number; readonly pathAngle: number } // at impact
interface SimState { ...; readonly crash: Crash | null }
```

Each step, in order:

```text
speed      as now
heading    as now
pathAngle  moves toward pitch * 15 deg, by at most 20 deg/s, landing exactly on the target
x, y       += speed * cos(pathAngle) * dt, along the heading; clamped to the map as now
z          += speed * sin(pathAngle) * dt
```

| Constant (`config/motion.ts`) | Value | Why |
|---|---|---|
| `PATH_MAX_DEG` | 15 | At 60 m/s climbs 15.5 m/s: 100 to 200 m in about 7 s. Steeper than the average 10 degree slope up to the peak |
| `PATH_RATE_DEG_S` | 20 | Level to full in 0.75 s |
| `START_Z` | 100 | §2 |
| `CEILING_Z` | 600 | 6,000 real m. Keeps terrain in view at the three farther side zooms |
| `PLACE_CLEARANCE` | 20 | Least height above ground after a click |
| `SWEEP_M` | 0.5 | §4 |

- **Why an angle rather than a vertical speed:** it is the `g` in ARCHITECTURE.md §6, so C1 changes what drives it instead of replacing it. It also gives the sprite its tilt.
- At the ceiling, `z` stops and a positive `pathAngle` becomes 0, so the sprite does not show a climb that is not happening.
- `interpolate` blends `pathAngle` linearly; it never wraps.
- Altitude is 1:10 and airspeed is 1:1, so displayed altitude will move 10 times faster than V/S suggests. That is the open question in GAME_DESIGN.md §4.1, for B4 and D2.

## 4. Collision and crash

**The world reaches the simulation as one query.** `SimBounds` becomes `SimWorld`, so tests can use flat or invented ground:

```ts
interface SimWorld {
  readonly width: number;
  readonly height: number;
  heightAt(x: number, y: number): number; // top surface: water or ground, world m
}
```

`main.ts` builds it from the grid's `heightAt`, the function both views already use. `LoopOptions.bounds` becomes `world`.

**Contact** is `z <= heightAt(x, y)` at the plane's exact position, not the drawn sprite. The path is checked along its length, in a new pure file `sim/contact.ts`:

1. Split the step's 3D movement, after map clamping, into pieces of at most 0.5 m (at most 5 at top speed).
2. At the first piece whose end touches, bisect 8 times for the contact point.
3. The craft stops there with `z = heightAt` and `speed = 0`; `crash` is set.

Measured on the test map, including the airport:

| Check | Result |
|---|---|
| Steepest ground | 14.2 m rise in 2.5 m (one top-speed step), at the northeast coastal cliff |
| Terrain standing above a straight 2.5 m step | Up to 2.4 m, so checking only the end of a step could clip a ridge unseen |
| Water edge | Jumps up to 0.8 m, as water is flat per cell |
| Map edge | Height 0 everywhere, so clamping cannot push the plane into a hill |
| Cost of `heightAt` | About 55 ns: under 1 microsecond per step |

**While crashed:** `advance` still counts ticks, but the craft does not move. Axis commands are still stored, and `place` and `rotate` are ignored.

**Restart** is a new command, `{ kind: 'restart' }`, ignored unless crashed. It resets the craft and clears `crash`, but **keeps `controls` and `tick`**. `keyState` reports only changes, so clearing the controls would make a key held through the restart go dead. The tick must not go backward, for replay.

**Place** sets `z = max(z, heightAt + PLACE_CLEARANCE)`.

## 5. Input

- `keyState`: new `pitch` channel, W = -1 and S = +1, with the same latch and opposite-key rules. Add it to the `sample` list and to `emitted`.
- `keyboard.ts`: an `Enter` action beside P and C, and generalize the two hard-coded codes to a lookup. Enter must be ignored when the event target is a **button**, or pressing it on a focused Resume button would do both.
- Enter sends `restart` running or paused; it does not unpause.
- Enter is proposed because GAME_DESIGN.md gives R to flaps. Text fields are already excluded, so it does not clash with the terminal later.

## 6. Side view: vertical follow

Sea level is now at a fixed row, so above about 390 m at the closest zoom the plane would leave the top. The view scrolls upward only when needed:

```ts
// sideCamera.ts, pure
followRow(view)            // round(0.4 * height): row 144 of 360
baseHeight(view, zoom, z)  // world m shown at the sea row; 0 at low altitude
heightToY(view, zoom, h, base)
planeRow(view, zoom, z)    // the sprite's pixel row
```

- Below `followRow` nothing scrolls: low flying looks as it does now. Scrolling starts at 420 m (three farther zooms) or 210 m (closest).
- **No easing,** as in B2. `base` depends only on altitude and zoom.
- **`base` is a whole number of pixels:** `k = max(0, ceil(z / mpp - (seaRow - followRow)))`, `base = k * mpp`. All terrain layers then scroll together with no shimmer.
- `planeRow` returns exactly `followRow` while scrolling rather than flooring a computed value, so rounding error cannot make the plane flicker between two rows.
- `base` is a **required** argument of `heightToY`, so the compiler finds every caller: profiles, snow line, runway posts, scale, plumb line and plane.
- Things that assume sea level is visible must be skipped off screen: the sea line, runway posts and names, and scale ticks below the panel. The plumb line runs to the readout bar when the ground is out of view.
- At the closest zoom above about 400 m no ground is visible. Zoom out; automatic zoom comes later.

## 7. Sprites and messages

**Side sprite:** 13 frames, -15 to +15 degrees in 2.5 degree steps, at true pitch at every zoom (GAME_DESIGN.md §3 and ARCHITECTURE.md §8). `rasterize` turns clockwise, so nose up is a **negative** angle; a test guards this. The 45 px frame already fits every rotation (the farthest point is 20 px from center). `SideView` gains `warm()`, since it holds its own sprite cache.

**Wreck:** a small polygon marker replaces the plane in both views, the same in every direction.

**Banner:** HTML, like the pause banner: `CRASHED: mountain, 1,120 m - Enter to restart`, with `role="status"`. The name comes from `surfaceName` at the craft's position, or `water` when wet, and the height is real meters. Both banners go in one fixed container so that they stack when paused and crashed.

Views receive `crashed: boolean`. The simulation stores no text.

## 8. Files

| File | Change | Purpose |
|---|---|---|
| `src/sim/state.ts`, `commands.ts`, `interpolate.ts`, `step.ts` | edit | §3, §4 |
| `src/sim/contact.ts` | new | Swept contact test (pure) |
| `src/config/motion.ts` | edit | Constants |
| `src/config/planeShape.ts` | edit | Wreck polygons, pitch frame count |
| `src/input/keyState.ts`, `keyboard.ts` | edit | §5 |
| `src/views/sideCamera.ts`, `sideView.ts` | edit | §6 |
| `src/views/sprite.ts`, `topView.ts` | edit | Pitch frames, wreck |
| `src/app/loop.ts` | edit | `bounds` becomes `world` |
| `src/app/crashBanner.ts` | new | Banner text and visibility |
| `index.html`, `src/styles.css` | edit | Banner container |
| `src/main.ts` | edit | Wiring |
| `tests/` | new, edit | §10 |

No new dependencies.

## 9. Steps

Commit B2 first, so B3 is a clean diff. Each step leaves the page working.

1. **`SimWorld`** in place of `SimBounds`, through the loop and tests. No visible change.
2. **Climb:** `pathAngle`, pitch axis, W/S, ceiling, with tests. Still starts at 220 m; the plane can pass through terrain.
3. **Vertical follow** in the side view, with tests.
4. **Pitch frames** for the side sprite.
5. **Contact, crash and restart** in the simulation, with tests. Includes place clearance.
6. **Wreck, banner, Enter;** then `START_Z` drops to 100.
7. **Verify (§10), then update documents:** results here; GAME_DESIGN.md §5.3 (Enter); ARCHITECTURE.md §14 (C5: restart began in B3) and §16 (next is B4).

## 10. Verification

**Automated**

| Area | Tests |
|---|---|
| Climb | S raises `z` and W lowers it; angle stops at exactly +/-15 and settles to exactly 0; 60 steps at full climb at 60 m/s rise 60 x sin 15 and advance 60 x cos 15; level flight keeps `z` exactly; speed is unchanged by climbing; speed 0 does not climb |
| Ceiling | `z` never exceeds it; angle is 0 there; descent works from it |
| Contact | Flat ground, slope, cliff, and a 1 m wide wall at 150 m/s are all hit; contact is within 0.01 m of the analytic point on flat ground and a slope; a path 0.1 m above flat ground is clear; a steep dive at speed is caught; starting below ground crashes at once |
| Real map | No input from the start: crashes on the mountain. Scripted climb: passes the peak without crashing. Descending onto the runway, lake and sea: crashes at each |
| Invariant | 10,000 steps of scripted inputs on the real map, with restarts: no NaN, and `z >= heightAt` after every step |
| Crash | Craft stays put and ticks continue; place and rotate ignored; `interpolate` never draws past the contact point |
| Restart | Ignored unless crashed; restores the start; keeps tick and controls; a key held through it still works; no drawn streak from wreck to start |
| Place | On the peak from 100 m: lifted to peak + 20. On low ground: `z` unchanged |
| Keys | W and S cancel; latch; clear emits zero; Enter ignored on a button and in a text field, and once per press |
| Side camera | `base` is 0 up to the threshold; `planeRow` is constant over every altitude from threshold to ceiling, at every zoom, odd and even heights; heights move in whole pixels; no jump at the threshold |
| Sprite | Nose is above the tail at +15 and below at -15; level frame is unchanged from B2; nothing touches the frame edge; the wreck is non-empty |
| Agreement | B2's tests pass in climbs and descents |
| Determinism | B1's frame-rate test, with pitch and a crash and restart in the script |

B2's two altitude tests (`z` never changes; `START_Z` clears the map) contradict B3 and are **replaced**: place and rotate leave `z` alone when clear of the ground, and `START_Z` is above the start ground and below the peak.

All tests, typecheck and build must pass.

**Manual, in a full-size window**
- Do nothing: hits the mountain in both views at the same place. Restart with Enter.
- Climb over the peak: the sprite clears the drawn snow line, and the plumb line shortens over the top.
- Climb to the ceiling and descend at each side zoom: no jump where scrolling starts, no shimmer, scale labels stay correct.
- Crash into the sea, lake, runway and cliff: correct banner text.
- Crash, pause, restart; pause, crash banner and pause banner both readable.
- Hold D through a restart: still turning.
- Judge: does 15 degrees at 20 deg/s feel right? Does settling to level feel right?

B2's owed checks (§14 there) use the same window and are best run together: plane shimmer, side view flicker in turns, and 300 real-frame timings. B3 adds little drawing, so a missed 8 ms target is a B2 problem, but it should be known **before** B4 adds more. Anything not run is reported as **not checked**.

## 11. Decisions

**Recommended defaults; say so if you want any changed:**

1. **Path settles to level on release.** Matches GAME_DESIGN.md §5.2. The alternative, holding the angle, suits long climbs but is easy to forget; C2 revisits it.
2. **S climbs, W descends** (stick style), as in GAME_DESIGN.md §5.3.
3. **Start at 100 m, aimed at the mountain,** so the milestone needs no setup.
4. **Minimal restart now, on Enter.** C5 owns restart, but without one every crash needs a page reload, which also loses zoom.
5. **Every contact is a crash,** including a gentle touch on a runway, until C4 and C5.
6. **Crash point is the plane's center,** so the sprite's belly dips about 4 px into the ground. Gear height comes in C4.
7. **Ceiling of 600 m.** The real one comes from thrust and density in C.
8. **No altitude number until B4.** The scale ticks and plumb line are enough to judge clearance.

## 12. Risks

| Risk | Response |
|---|---|
| Thin terrain missed between checks | 0.5 m sweep; wall and ridge tests; whole-run invariant |
| Pitch sign reversed somewhere (key, motion, sprite) | One convention, positive = up; a test at each layer |
| Side view shimmers while scrolling | Whole-pixel `base` and fixed `planeRow`; tests |
| A hazy hill beside the path looks like the one ahead | Only the solid profile collides; note any confusion in the manual check |
| Held keys go dead after restart | Controls kept; test |
| Throwaway work before C | `pathAngle`, contact, crash and follow all survive; only the rule driving the angle is replaced |

## 13. Done when

W and S climb and descend, the plane can fly over the mountain or crash into it, both views agree on where, Enter restarts, the invariant test passes on the real map, and typecheck, tests and build pass.

**Next:** B4, basic readouts and debug panel.

## 14. Results

**Built as planned,** with these differences:
- `Enter` filtering is a pure `actionFor` in `input/keyboard.ts`, so it can be tested without a DOM.
- The wreck is a rasterized sprite (`WRECK` in `planeShape.ts`) drawn by `PlaneSprites.drawWreck`, not a canvas polygon.
- `SideLink` (top view) gained `crashed`; `SideView.draw` gained a `crashed` argument and `warm()`.
- B2 was not committed first, since no commit was asked for.

**Automated:** typecheck, 191 tests and build pass. New tests cover climb, ceiling, contact (flat, slope, cliff, 1 m wall at 150 m/s, below-ground start), the real map (mountain crash, climb over, runway/lake/sea), the 10,000-step invariant with restarts, restart and held keys through the loop, place, W/S keys, Enter filtering, side camera follow, pitch frames, the wreck, banner text, and frame-rate determinism with a crash and restart.

**Checked by drawing in the browser pane:** side view at +15 and -15 degrees, scrolling at 300 and 550 m, plumb line, wreck on the peak. The pane was hidden, so animation frames ran at about 1 fps.

**Not checked (needs a full-size visible window):** real-time feel of 15 degrees at 20 deg/s and of settling; both views agreeing on the crash point live; banner stacking with pause; Enter on a focused Resume button; shimmer while scrolling; B2's owed checks and 300 real-frame timings.
