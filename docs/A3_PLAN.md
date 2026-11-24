# A3 Implementation Plan: Side view of the same grid

**Status:** BUILT (2026-11-23). Results in §13.
**Milestone (ARCHITECTURE.md §14):** "Turning a test heading changes the terrain slice."
**Starting state:** A2 is committed (`0c048b2`). The top view draws, pans and zooms. The side panel still shows the A1 placeholder. There is no plane, loop or keyboard input.

All numbers are provisional.

## 1. Scope

**In:** `sliceAlong`, a test probe (position and heading) standing in for the plane, side-view drawing, mouse control of the probe, the slice line in the top view, side zoom with vertical exaggeration, a readout linked to the top view, and tests.

**Out:**

| Left out | Where it belongs |
|---|---|
| Runway and airport in the slice | A4 |
| Keyboard turning, game loop | B1 |
| Plane sprite, pitch, follow camera, vertical follow | B2 |
| Smoothing of fast heading changes | B2, when the plane turns continuously |
| Automatic zoom by flight phase | After B2 |
| Parallax sky, clouds, objects in a corridor, traffic | G and H; nothing to show yet |
| Zoom beyond 10 m per pixel | E2; it needs several cells per column |

## 2. Test probe

```ts
// src/views/probe.ts - temporary; the player aircraft replaces it in B2
interface Probe { x: number; y: number; heading: number }  // world meters; radians clockwise from north
```

- **Heading:** 0 is north, pi/2 is east. Direction is `(sin h, cos h)`, **not** `(cos h, sin h)`. Kept in [0, 2 pi).
- **Label:** three digits in degrees, with north shown as `360` (`formatHeading`). 359.7 rounds to `360`.
- **Position** is clamped inside the map.
- **Start:** (2560, 2560), heading 045. That points along the ridge to the peak, about 1,690 m ahead.
- It is separate from the map camera. Wheel zoom at the cursor moves the camera center, so tying the slice to it would make the terrain jump whenever the map zooms.

## 3. Slice query

```ts
// src/sim/world/slice.ts
interface Slice {
  readonly heightWorldM: Float32Array;
  readonly surface: Uint8Array;
}
function sliceAlong(grid, scale, origin, heading, length, samples): Slice
```

- Sample `i` is at distance `i * length / (samples - 1)` from the origin, both ends included. One sample returns the origin.
- It **calls `heightAt` and `surfaceAt`** and never reads the arrays. A4's airport overlay will change those two functions, and the slice will then follow automatically.
- Outside the map it gives sea at 0, as those functions already do.
- The caller moves the origin backward to include terrain behind the probe, so the signature matches ARCHITECTURE.md §7.

## 4. Side view

### 4.1 Projection (`sideCamera.ts`, pure)

| Zoom (m/px, horizontal) | Vertical m/px | Exaggeration | Peak (182 world m) | View, 640 x 400 px |
|---|---|---|---|---|
| 10 | 2.5 | 4x | 73 px | 6,400 x 1,000 m |
| **5 (start)** | 2.5 | 2x | 73 px | 3,200 x 1,000 m |
| 2.5 | 2.5 | 1x | 73 px | 1,600 x 1,000 m |
| 1.25 | 1.25 | 1x | 145 px | 800 x 500 m |

- The two closest levels have equal scales, as §8 of the architecture requires for the flare. Without exaggeration at 10 m/px, the highest peak would be only 18 px tall.
- 1,000 world m is 10,000 real m (about FL330), so cruise already fits with no vertical scrolling. At 1.25 m/px B2 adds vertical follow.
- **One sample per pixel column.** No level skips a cell, so features do not flicker.
- **Horizontal:** the probe is a quarter of the way across; distance ahead increases to the right.
- **Vertical:** sea level is at a fixed row, 48 px above the bottom (room for the readout), and up is a smaller screen y. This is the only place the vertical flip happens.
- Functions: `sideMetersPerPixel`, `distanceToX`, `xToDistance`, `heightToY`, and `sliceWindow(probe, view, zoom)`, which returns the arguments for `sliceAlong`.

### 4.2 Drawing (`sideView.ts`)

1. **Sky:** four flat bands.
2. **Ground, per column:** surface color for the top 4 px, then a darker body to the bottom. Water is a flat blue column. Colors come from `TERRAIN_COLORS`, so both views match; there is no hillshade or contour here.
3. **Altitude scale** on the left edge: a tick every 1,000 **real** m, plus a faint sea-level line.
4. **Probe marker:** a vertical dashed line and a small down-pointing triangle above the ground. It is clearly not a plane.
5. **Labels:** heading (`HDG 045`), a horizontal scale bar in world meters, and the exaggeration (`vert x2`), always shown so steepness is not misread.

Share `drawText` and the scale bar with the top view by moving them to `views/overlay.ts`.

### 4.3 Top-view additions

- A probe dot, a solid line forward and a dim line behind, **covering exactly what the side view shows** at its current size and zoom, with an end tick and an arrow.
- While the pointer is over the side view, a dot at the matching point on that line.

This is the check that both views agree.

## 5. Input

| Where | Action | Effect |
|---|---|---|
| Side view | Drag left / right | Turn: 0.5 degrees per internal pixel; right drag turns right |
| Side view | Wheel | Side zoom, accumulated as in A2 |
| Side view | Hover | Readout and matching dot in the top view |
| Top view | **Click** (moved under 4 internal px) | Moves the probe there |
| Top view | Drag, wheel | Unchanged |

- Panning must not start until the 4 px threshold is passed, so a click never nudges the map. `pointercancel` and lost capture must not count as a click.
- Side zoom is fixed on the probe, not the cursor.
- Move the CSS-to-internal conversion and wheel accumulation out of `mapPointer.ts` into `input/pointer.ts`, used by both. No keys: W/A/S/D belong to B1.

**Readout** (bottom of the side view): `+1690 m world  snow  1816 m real / 182 m world`. Distances are world meters; displayed distance arrives in E1.

## 6. Wiring

- `main.ts` holds `camera`, `cursor`, `probe`, `sideZoom` and `sideCursor`. A probe, side-zoom or side-cursor change calls `requestDraw()` on **both** panels.
- **A resize** changes the visible slice length too. The top view reads the side panel's current size when drawing, and a side-panel size change must redraw the top view. Both panels resize together, but their order is not guaranteed, so `drawSide` requests a top redraw only when its size differs from the last one; this cannot loop.
- The first draws run inside `initPanels`, before its return value exists, so draw functions must not use `panels` unguarded on the first call. Keep the side size in its own variable.
- **Side internal size becomes 640 x 360** in `config/display.ts`, as A2 did for the top view. Text was unreadable at 320 x 200, and the same size makes one pixel mean the same in both panels. Instruments stay as they are.

## 7. Files

| File | Change | Purpose |
|---|---|---|
| `src/sim/world/slice.ts` | new | `sliceAlong` |
| `src/views/probe.ts` | new | Probe, turning, clamping, `formatHeading` |
| `src/views/sideCamera.ts` | new | Pure projection |
| `src/views/sideView.ts` | new | Side drawing |
| `src/views/overlay.ts` | new | Shared text and scale bar |
| `src/views/topView.ts` | edit | Slice line and dots; use `overlay.ts` |
| `src/input/pointer.ts` | new | Shared pointer and wheel helpers |
| `src/input/sidePointer.ts` | new | Turn, zoom, hover |
| `src/input/mapPointer.ts` | edit | Click, threshold, shared helpers |
| `src/config/display.ts`, `src/config/palette.ts` | edit | Side size; sky and marker colors |
| `src/main.ts`, `src/styles.css` | edit | Wiring; side cursor, `touch-action` |
| `tests/` | new | `slice`, `probe`, `sideCamera` |

No new dependencies.

## 8. Steps

Each step leaves the page working.

1. **`sliceAlong`** with tests.
2. **Probe and side projection** with tests.
3. **First side drawing:** fixed probe and heading, side canvas at 640 x 360. The ridge and peak appear.
4. **Slice line in the top view,** including the resize redraw.
5. **Turn by dragging; click to place.** This meets the milestone.
6. **Side zoom, altitude scale, labels.**
7. **Linked hover and readout.**
8. **Verify (§9), then update documents:** results here, ARCHITECTURE.md §15 (internal resolution) and §16 (still names A2 as next; change to A4). Also repair the broken section signs in A2_PLAN.md.

## 9. Verification

**Automated**

| Area | Tests |
|---|---|
| Slice | Headings 0, 90, 180, 270 hit the expected cells on an asymmetric grid (catches sin/cos and mirror mistakes); both ends exact; every sample equals `heightAt` and `surfaceAt` at its point; reversed heading from the far end gives the reversed slice; off-map is water at 0; 1 sample works; no NaN |
| Test map | From the start probe at 045 the highest sample is the peak, near 1,690 m; due south the slice reaches the level area and reads a constant 3 world m; due west it reaches the sea |
| Probe | Turning wraps both ways through north; labels 360, 045, 359.7 -> 360; position clamps |
| Side camera | Distance/x round trip at every zoom; probe at a quarter; higher is up; sea row fixed; exaggeration values; window covers the view with one sample per column |

Existing tests, boundaries, typecheck and build must also pass.

**Manual, in the browser pane**
- Turn through 360 degrees: the profile changes continuously and repeats at the same heading.
- Over the peak, lake, town and coast, hover in the side view: the dot in the top view sits on the same feature, and both readouts agree.
- Turning right sweeps the line **clockwise** on the map.
- Clicking places the probe without moving the map; dragging pans without moving the probe.
- Panning or zooming the map leaves the side view unchanged.
- Resizing the window keeps the line the right length.
- Crisp at DPR 1, 1.25 and 1.5; no console errors.
- Side redraw under 4 ms, as an early indication only.
- Also the A2 checks still open: seams while dragging, and DPR 1 and 1.5.

## 10. Decisions

**Recommended defaults; say so if you want any changed:**

1. **Separate probe,** placed by clicking, rather than the map center.
2. **Turn by dragging the side view,** rather than temporary keys that B1 would have to replace.
3. **Side canvas 640 x 360,** rather than 320 x 200.
4. **Vertical exaggeration 4x / 2x / 1x / 1x** by zoom level.
5. **Independent zoom** for the two views. Linking them can be tried in B2.
6. **Probe at a quarter** of the width, so most of the view is ahead.

## 11. Risks

| Risk | Response |
|---|---|
| Heading mirrored or rotated | Cardinal tests on an asymmetric grid; linked dot shows errors at once |
| Terrain flickers while turning | One sample per column; judge in step 5, smoothing is planned for B2 |
| Exaggeration mistaken for real slope | Label always visible; equal scales at close zoom |
| Banks of the lake and river slope inside blue cells | Height is interpolated but surface is nearest cell; accept, half a cell at most |
| Top and side views fall out of step | Line and slice both come from `sliceWindow` |
| Probe code outlives its use | Kept in one file, replaced by the snapshot in B2 |

## 12. Done when

Turning the test heading changes the terrain slice, the line in the top view matches what the side view shows, and typecheck, tests and build pass.

**Next:** A4, one airport overlay with an angled runway, which appears in the slice through `heightAt` and `surfaceAt`.

## 13. Results (2026-11-23)

- All steps built. Typecheck, 52 tests and the build pass.
- **Browser pane checks done (1280 x 720):** the ridge and peak appear in the slice at 045; dragging right turned the heading 045 to 125 and swept the line clockwise on the map; hovering the side view put a dot on the line in the top view with matching readout; clicking the top view moved the probe without moving the map; side wheel zoom changed the label to `vert x1`; no console errors.
- **Not yet checked by eye:** a full 360 degree turn, hover over the lake, town and coast, window resize, DPR 1 / 1.25 / 1.5, and the A2 seam checks. Draw time was only roughly sampled (well under 4 ms) and is not a real measurement.
- Side internal size is 640 x 360 (`config/display.ts`). Moved `drawText` and the scale bar to `views/overlay.ts`, and pointer helpers to `input/pointer.ts`.
- Altitude ticks are every 1,000 real m and crowd the left edge at the farthest zoom; may need thinning.

## 14. Changes after review (2026-11-23)

- **Water at its own height:** rivers and lakes are drawn at their stored ground height (2 px surface, deep-blue body), not flat at sea level.
- **Body color is not the surface color:** a 4 px surface layer sits over a rock, soil, sand or paved body, so snow is a thin cap over rock.
- **Side silhouettes:** three extra slices (250, 600 and 1,200 world m) to the LEFT of the heading are drawn behind the main profile, with more haze the farther they are (`LAYER_OFFSETS`, `LAYER_HAZE` in `sideCamera.ts`). The viewer is taken to be on the right looking left. Terrain to the right is not drawn, because it would hide the profile. The top view shades this corridor.
- **Altitude ticks** now read `100 m (1k real)`: world meters like the horizontal scale bar, with real altitude beside it.
- **Known map-data oddity:** a river can sit a little above the ground beside it where the river level (running minimum) is higher than a local dip. This is in `testMap.ts`, not the drawing.
- Motion parallax, haze tuning and the sky are left for B2 and later.

## 15. Second review round (2026-11-23)

- **Snow cap:** snow columns are filled with snow down to the snow line (`SNOW_LINE_M`, now exported from `testMap.ts`), so a peak is a solid white triangle; rock shows below it. Temporary: the view imports the constant from the test map until the map carries its own.
- **River above its banks, two causes:**
  1. **Map data:** the river level was the running minimum of the path centers only, so it could sit on a ridge above the land beside it. It now uses the lowest land within 4 cells (`RIVER_BANK_CELLS`) as its level. A test checks that no water cell is higher than a neighbouring land cell.
  2. **`heightAt` blending:** it interpolated water with the banks, which tilted a river on a slope and raised its edge by up to 8 world m. **Water is now flat at its own cell level**, and land beside it still blends toward it. This changes `heightAt` itself, so flight, collision and the runway overlay see the same flat water. The two old grid tests used an all-water grid by accident; they now use land.

## 16. Water as its own layer (2026-11-23)

Water is no longer a terrain code that fills the whole column. See ARCHITECTURE.md §7.1.

- **Grid:** `elevation` is now the solid ground (negative below sea level); a new `water` array holds inland water depth (real m). Code 0 is renamed `Terrain.seabed` (what the ground is made of under open water). Open sea is implied by ground below sea level, with its surface at 0.
- **Accessors:** `groundAt` (bed), `waterLevelAt` (flat per cell, NaN where dry), `heightAt` (whatever is on top, never below the bed). The flat-water special case added in §15 is gone; flat water is now the model.
- **Slice:** carries `groundWorldM` and `waterWorldM` as well as `heightWorldM`.
- **Test map:** lake with its bed deepest in the middle (4 to 30 m real) and a flat surface at 25 m; river with a 5 m deep bed; sea floor deepening 7 m per cell from the coast, capped at 300 m (a chamfer distance transform). Lake and river beds are ordinary grass or forest ground.
- **Top view:** water is colored by depth (light blue shallow to dark blue deep), so the shelf, lake bed and river show. No hillshade or contours on water; sea floor counts as sea level for shading, so coasts are not cliffs.
- **Side view:** the bed is drawn as ground, with a blue band over it up to the surface. Readouts say `water N m deep over <ground>`.
- **Scale note:** at 1:10 altitude, a 30 m real lake is 3 world m, so it is only a few pixels deep even at the closest zoom. The 300 m shelf is about 24 px.
- 62 tests pass. Verified in the browser: the lake and river are shown on the map, and the side view shows deep water over a sloping seabed off the coast.

## 17. Smooth body color (2026-11-23)

The vertical stripes in the side view came from coloring the body under the surface by terrain code, which flips cell by cell (forest, grass, mountain, road, river). The body now depends only on the height of the bed: soil to rock between 250 and 750 m real, and darker sea floor below sea level, both smooth (`bodyColor` in `sideView.ts`). The thin surface layer still shows the real surface type, so a speckled top edge is expected where the surface really changes.

## 18. Water depth exaggeration in the side view (2026-11-23)

At the 1:10 altitude scale a 5 m real river is 0.5 world m, under one pixel. The side view now draws water depth larger than true, below the surface only; surface heights, readouts and flight are unchanged.

- Shallow water is drawn about 4x deeper (`WATER_EXAGGERATION`), levelling off at 12 world m (`WATER_VISUAL_MAX_M`) so the deep sea still fits under the view. The mapping `visualWaterDepth` always increases, so shelves still slope the right way.
- Water is drawn at least 3 px deep (`WATER_MIN_PX`).
- The label reads `vert x1  water depth x4`. The readout still shows the true depth.
- Measured in the browser: the 30 m lake crossed near its middle is about 7 px deep (about 2 px without it). 64 tests pass.

Raised after review: exaggeration 4x to **10x**, cap 12 to 16 world m, minimum 3 to 5 px. Shallow water color changed from sky-like blue to teal (`WATER_SHALLOW`), because it was nearly the same as the lowest sky band, and a bright line now marks the surface. This also tints rivers and lakes teal in the top view. The label reads `water depth x10`.
