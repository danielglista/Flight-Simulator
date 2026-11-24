# B2 Implementation Plan: Plane sprite in both views, with a follow camera

**Status:** BUILT. Results in §14.
**Milestone (ARCHITECTURE.md §14):** "Both views agree on position and heading."
**Starting state:** B1 is committed (`3a38757`). 126 tests and typecheck pass. The top view draws a dot and arrow under a fixed camera; the side view already scrolls with the craft but marks it with a triangle above the ground.

All numbers are provisional.

## 1. Scope

**In:** plane sprite in both views, follow camera in the top view with free look and recenter, a constant altitude so the side view has somewhere to draw the plane, one name for the craft across views, frame timing at full size, tests.

**Out:**

| Left out | Where it belongs |
|---|---|
| Climb and descent, W/S keys, terrain collision | B3 |
| Vertical follow in the side view | B3, when altitude can change |
| Speed and altitude readouts, frame-time display | B4 |
| Pitch and bank in the sprites | C2, C3 (the sprite code leaves room, §4) |
| Heading-up map, automatic zoom by phase | E or later |
| Flaps and gear on the sprite, shadow, final art | C6, H |
| Traffic sprites | G1 |

## 2. Behavior

| Input | Effect |
|---|---|
| (default) | Top view keeps the plane at its center, north up |
| Drag top view | Free look: the map pans and stays where you put it |
| **C** | Follow again; works paused or running |
| Wheel, following | Zooms about the plane; keeps following |
| Wheel, free look | Zooms at the cursor, as now |
| Click top view | Places the plane, as now; if following, the map jumps to it |
| Drag side view | Turns the plane, as now |

- In free look, the top view shows `FREE LOOK - C to follow` along its top edge. If the plane is off screen, a yellow arrow at the panel edge points to it.
- The camera has no lag or easing: the plane is locked to one pixel. Lag would make the two views disagree during turns.
- **C is new** and needs adding to GAME_DESIGN.md §5.3.

## 3. Altitude

The side view cannot place a plane without an altitude, and B3 makes altitude move. B2 therefore adds the field and holds it constant.

```ts
interface Craft {
  ...
  readonly z: number; // WORLD m above sea level; B3 changes it
}
```

- `START_Z = 220` world m (2,200 real m). The test map's highest point is 181.6 world m, so the plane clears everything and no collision rule is needed yet.
- It fits the side view at all four zooms: 88 px above the sea line at the three farther levels, 176 px at the closest, out of 312 px available at the minimum height.
- `advance`, `place` and `rotate` leave `z` alone. `interpolate` blends it.

## 4. Sprites

Sprites are drawn from small polygons in code rather than image files, so there is nothing to load and every heading can be rasterized cleanly. Rotating a small bitmap would tear its wings.

```ts
// src/config/planeShape.ts: polygons in sprite pixels, listed back to front
interface ShapePart { readonly color: Rgb; readonly points: readonly (readonly [number, number])[] }
PLANE_TOP: readonly ShapePart[]   // x = right, y = forward
PLANE_SIDE: readonly ShapePart[]  // x = forward, y = up

// src/views/sprite.ts
rasterize(parts, angle, size): Uint8ClampedArray  // pure RGBA, size x size, testable headless
frameIndex(heading): number                       // nearest of 72
```

| | Top | Side |
|---|---|---|
| Size | 25 x 25 px (odd, so it has a center pixel) | about 41 x 15 px in a 45 x 45 frame |
| Frames | 72, every 5 degrees (at most 2.5 off) | 1, level |
| Anchor | Center pixel = craft position | Center pixel = craft position and `z` |
| Facing | Heading | Always right |

- **Hard edges:** each pixel is tested at its center, with no smoothing, then given a 1 px dark outline so it reads on any terrain.
- **Asymmetric on purpose:** nose and tail clearly differ, and the left and right wingtips carry red and green lights. A mirrored or reversed sprite is then obvious and testable.
- Frames become offscreen canvases the first time each is used and are then cached: 72 x 2.5 KB, about 180 KB.
- `rasterize` takes any angle, so the side sprite can gain pitch frames in C2 without redesign.
- **Not to scale,** as in GAME_DESIGN.md §4.1: the same pixel size at every zoom. At the closest zoom the top sprite spans about 31 world m. The exact position is the center pixel; B3's collision test uses the position, not the drawing.

## 5. Follow camera

`src/views/followCamera.ts` is pure:

```ts
interface FollowCamera { readonly following: boolean; readonly free: Camera } // free.zoom is the zoom in both modes

cameraFor(f, craft): Camera               // following: craft x, y; otherwise f.free
panned(f, craft, dx, dy, bounds): FollowCamera     // starts free look from what is on screen
zoomed(f, craft, view, cursor, steps, bounds): FollowCamera
recentered(f): FollowCamera
```

- `main.ts` holds one `FollowCamera` and works out the camera at each draw from the same `loop.snapshot()` the plane is drawn from. No camera state lives in the simulation, so replay is unaffected.
- Pointer handlers call `cameraFor` with the current snapshot, so a click converts to the world point that was on screen.
- `mapPointer` currently reports both panning and zooming through `setCamera`. They need different results now, so it gets `onPan(dx, dy)` and `onZoom(cursor, steps)` and stops doing camera arithmetic.
- At the map edge the plane stays centered and the outside is drawn as sea, as now.
- Zooming, panning and C redraw on demand while paused, as B1 does.

### Pixel alignment

Terrain is drawn from a rounded origin, so it moves in whole pixels. B1 §12 flagged that a moving camera might show jitter. The rules:

1. The plane's pixel is `floor` of its screen position. When following, that position is exactly the view center, so the plane never moves, at odd and even panel sizes.
2. The slice line, corridor and off-screen arrow start from that same pixel.
3. Terrain and airports keep their shared rounded origin. They can differ from the plane by at most 1 px, which is 1.25 world m at the closest zoom.

Diagonal flight will step x and y on different frames. That is normal for pixel art, and is judged in the manual check, not engineered around.

## 6. Views

**One type.** `views/probe.ts` says its `Probe` lasts "until B2". Views now take `Craft`, and `probe.ts` is deleted: `formatHeading` moves to `views/format.ts`, and `DEGREES_PER_PIXEL` to `input/sidePointer.ts`. `probeColumn` becomes `planeColumn`, and `SideLink.probe` becomes `craft`.

**Top view order:** terrain, airports, slice corridor and line, plane, overlays. The sprite replaces the dot and arrow. The line starts at the plane, at the exact heading, so a wrong rotation shows at once.

**Side view:**
- The sprite replaces the triangle, at `planeColumn` and `heightToY(z)`.
- The dashed line through the full height becomes a faint dashed plumb line from the plane to the ground, showing height above terrain.
- Draw order: sky, terrain, runway posts, scale, plumb line, plane, labels.
- Columns sample the slice at the plane's own column with distance 0, so the ground under the sprite is the ground under the plane in the top view.

**Haze layers while turning:** ARCHITECTURE.md §8 asks for smoothed heading changes so terrain does not flicker. Smoothing delays the side view behind the true heading, which contradicts this milestone. Look at it at 30 deg/s first; if it flickers, smooth only the haze layers and never the main profile.

## 7. Performance

B1 left one thing unresolved: side view p95 spikes of 15 to 25 ms when `render()` is called back to back. The follow camera also means new terrain enters while flying.

Measured now in Node, as a guide: coloring one chunk takes about 10 ms, and baking the airport at the closest zoom about 17 ms. Either could drop a frame when first seen.

- Build all chunks at full detail and all airport patches at startup, about 80 ms here. Draw code stays the same; `TopView` and `AirportLayer` gain a `warm()` method. E2's larger map needs a different approach, such as building nearby chunks a few at a time.
- Measure both views over 300 **real animation frames** in a full-size window, following, at each zoom, in straight flight and in a turn. Target: both under 8 ms. Record median and p95 here.
- Over target: skip haze columns first (every second column), then cache the profile. This is also the "measure in B2" check for Canvas 2D in ARCHITECTURE.md §15.

## 8. Files

| File | Change | Purpose |
|---|---|---|
| `src/sim/state.ts`, `interpolate.ts`, `step.ts` | edit | `z` |
| `src/config/motion.ts` | edit | `START_Z` |
| `src/config/planeShape.ts` | new | Polygons |
| `src/views/sprite.ts` | new | Rasterize, frame index, cache, draw |
| `src/views/followCamera.ts` | new | §5 |
| `src/views/edgeArrow.ts` | new | Where the off-screen arrow goes (pure) |
| `src/views/format.ts` | new | `formatHeading` |
| `src/views/probe.ts` | delete | |
| `src/views/topView.ts`, `sideView.ts`, `sideCamera.ts`, `airportLayer.ts` | edit | §6, `warm()` |
| `src/input/mapPointer.ts`, `sidePointer.ts` | edit | `onPan`, `onZoom`; constant moves |
| `src/input/keyboard.ts` | edit | Takes `{ KeyP, KeyC }` actions instead of one `onPause` |
| `src/main.ts` | edit | Follow camera, wiring |
| `tests/` | new, edit | §10 |

No new dependencies.

## 9. Steps

Each step leaves the page working.

1. **Rename** `Probe` to `Craft` and delete `probe.ts`. No visible change.
2. **Altitude:** `z` in the state, with tests. No visible change.
3. **Sprite core:** shapes, `rasterize`, frames, with tests.
4. **Sprites in both views.** The plane replaces the dot and the triangle.
5. **Follow camera:** pure functions and tests, `mapPointer` split, C key, banner text, edge arrow.
6. **Warm-up and timing** (§7).
7. **Verify (§10), then update documents:** results here; GAME_DESIGN.md §5.3 (C); ARCHITECTURE.md §15 (Canvas performance) and §16 (next is B3).

## 10. Verification

**Automated**

| Area | Tests |
|---|---|
| State | `z` is unchanged by 1,000 steps and by place and rotate; interpolation blends it; `START_Z` is above every point of the test map |
| Sprite | Heading 0, 90, 180, 270 puts the nose up, right, down, left; the red light is on the left and green on the right at each; center pixel is filled in every frame; nothing touches the frame edge at any of the 72; side sprite's nose is on the right |
| Frame index | 0 and 360 match; 357.5 and above wraps to frame 0; worst error over all headings is 2.5 degrees |
| Follow | Following puts the craft at the exact view center, at every zoom and at odd and even sizes; its pixel does not change over 600 steps of turning flight; zoom keeps following and does not move the plane |
| Free look | Pan starts from the on-screen camera without a jump; the plane moving does not move the camera; C returns; free-look zoom keeps the point under the cursor fixed; zoom survives both switches |
| Agreement | For many positions and headings, the world point of the side view's plane column equals the craft position, and a point d ahead in the side window maps to the top view's slice line at d |
| Edge arrow | Null when on screen; right edge for a plane due east, and the other three; always inside the panel |
| Boundaries | Existing `sim/` rules still pass |

Existing tests that name the probe are renamed, not weakened. All tests, typecheck and build must pass.

**Manual, in a full-size window** (the B1 browser pane was too small and slow, so these cover B1's gaps too)
- Fly straight and in turns at every top zoom: the plane stays still, the ground moves smoothly, the runway does not shimmer against the terrain.
- Turn through all headings: the nose follows the slice line.
- Fly along and then across the runway: it passes under the plane in both views at the same moment.
- Fly over the peak: it passes under the plane in both views, with the plane above it.
- Pan away, let the plane leave the screen, check the arrow, press C. Repeat while paused.
- Click to place while following and in free look, running and paused.
- Fly into each map edge and corner: no console errors.
- Hold a turn: judge side view flicker (§6).
- Panel sizes are as before at 1280 x 720 and 1920 x 1080.

If no full-size window is available to the builder, these are reported as **not checked**, with a short list for the user to run.

## 11. Decisions

**Recommended defaults; say so if you want any changed:**

1. **Constant altitude of 220 world m,** so B3 only has to make it move. The alternative, hugging the ground at a fixed clearance, would look like terrain following and be thrown away.
2. **Follow is locked, with no easing,** so the views always agree.
3. **Free look stays until C.** Returning on its own after a few seconds would take the map away while it is being read.
4. **C for follow:** unassigned, and next to the flight keys.
5. **Polygon sprites in code,** replaced by painted art in H2.
6. **72 heading frames,** rather than 16 or 32 as in many 16-bit games. Fewer look more authentic, but 11 degrees off the slice line would look like a bug. H1 can revisit this.
7. **Same sprite size at every zoom.**
8. **Keep click-to-place and drag-to-turn** until B4, as agreed in B1.

## 12. Risks

| Risk | Response |
|---|---|
| Plane shimmers by a pixel | Alignment rules in §5; a test over 600 steps at odd and even sizes |
| Side view misses 8 ms | §7 order of fallbacks |
| Side terrain flickers in turns | §6: smooth only the haze layers |
| Sprite hides the runway at the closest zoom | Acceptable now; H1 sets final sizes |
| Pan and click use different cameras | Both go through `cameraFor`; tests |
| Rename hides a behavior change | Done alone, as step 1, with tests unchanged except for names |

## 13. Done when

The plane is drawn in both views from one snapshot, the top view follows it and can be panned away and recentered, agreement tests pass, frame times are recorded, and typecheck, tests and build pass.

**Next:** B3, simple climb and descent.

## 14. Results

Built as planned in steps 1 to 6. 146 tests, typecheck and build pass.

**Differences from the plan**
- `zoomed` takes the `craft` argument as planned but ignores it, since free-look zoom needs only the cursor.
- `warm()` builds all three terrain detail tiers and the airport patches for zoom levels 2 to 5, and also the 72 sprite frames.
- The side view's plumb line stops at the readout bar so it does not draw over the text.

**Timing: not valid, still owed.** No full-size window was available. In the 800 x 450 browser pane I drew both views 300 times in a loop (not real animation frames), at each top zoom, straight and turning, with synthetic plane positions. Internal canvas size is fixed at 640 x 360, so the draw work should not depend on window size, but the plan's rule was real frames.
- Top view: median 0.1 ms. This only times the call, not the GPU work, so it proves nothing.
- Side view: median 2.2 to 4.9 ms; p95 7.8 to 16.7 ms straight, 11.6 to 32.5 ms turning. The target was both under 8 ms, so the p95 spikes from B1 are **not resolved**.
- Startup `warm()` took about 490 ms in this pane (80 ms in Node), which is noticeable at load.
- I did not apply the §7 fallbacks (skip haze columns, cache the profile) without a real-frame measurement.

**Manual checks**: only these were done, in the small pane: page loads with no console errors; plane drawn in both views; drag to free look, C to follow (paused). **Not checked:** everything else in §10 Manual, including flicker in turns, edge flight, runway and peak crossing, edge arrow, click-to-place in free look, and 1280 x 720 / 1920 x 1080 panel sizes.

**For you to run** (full-size window, `npm run dev`): fly straight and turning at each zoom and watch for plane shimmer; pass over the runway and peak and see that both views agree; pan away until the arrow shows, then press C; hold a turn and watch the side view for flicker; open the console and fly into each corner.
