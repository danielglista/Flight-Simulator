# C3E Implementation Plan: Depth cues in the side view (parallax, slope shading, lane bands, foreground)

**Status:** Steps 1 to 4 and 6 built (slope shading, parallax, lane bands, foreground). Step 5 (checkpoint) skipped by choice; step 7 (tuning and write-up) open.
**Milestone (ARCHITECTURE.md §14):** a view-only addition between C3 and C4, like C3C and C3D (its top-view counterpart). The ID is provisional; rename it if you prefer another slot. No `sim/` change.
**Starting state:** `views/sideView.ts` draws the sky bands, then three hazy background terrain profiles, then the main profile, then runway posts, the altitude scale, the plumb line, the plane and the labels. Each profile is one `sliceAlong` (one terrain sample per pixel column, 640 columns). The background profiles are the same slice moved left of the heading by `LAYER_OFFSETS` (250, 600, 1200 m), with `LAYER_HAZE` (0.3, 0.5, 0.7); the viewer is on the right of the heading looking left, so "behind" is left and "in front" is right (`views/sideCamera.ts`). Every profile uses the same horizontal scale, so all of them scroll at the same speed. The main profile is the collision lane; the plane is drawn over it. A profile body is flat color under a 4 px surface skin.

All numbers are provisional. "m" means world meters unless it says real (real = world x `SCALES.altitude`, 10).

The idea numbers (1 to 6) are those of the brainstorm: 1 parallax, 2 slope shading, 3 foreground layer, 4 lane bands ("thickness"), 5 clouds, 6 small polish. Build order is 1, 2, 4, 3. Clouds (5) and polish (6) are out of scope here.

## 1. Why

The side view already has a good depth cue (hazy layers behind the plane), but it is static: every layer slides at the same speed, so it reads as stacked cutouts, not as distance. Terrain is flat-colored, so a mountain looks like a paper shape. Each layer is one razor-thin line of terrain, so a ridge a few meters off the sampled line is missed and peaks pop in and out. Nothing is ever in front of the plane, so you can never fly behind a ridge. The wish: **more depth and mass in the side view, without losing the plane or the terrain you can collide with.**

## 2. Scope

**In:**

1. **Parallax:** each background layer scrolls slower the farther it is; the main profile is unchanged.
2. **Slope shading:** terrain columns are lit or shaded by the local slope (light from the upper left, matching the top view's northwest light).
3. **Lane bands:** each background layer draws the upper envelope (highest point) over a band of parallel lanes, not one line.
4. **Foreground layer:** one dark, subdued profile on the viewer's side of the track, scrolling faster than the main profile, drawn over the plane, with a faint plane outline on top so the plane is never lost.
- On/off switches in `config/display.ts` for each effect, so you can compare by eye.
- Layer constants move from `sideCamera.ts` into `config/` (AGENTS.md: tunables live there).
- Tests for every pure function, and a CURRENT.md update.

**Out:**

| Left out | Where it belongs |
|---|---|
| Clouds with parallax in the side view | Own step after this; needs a decision on overlap with the weather milestone (`sim/weather/`) |
| Vertical parallax (far layers shift less when you climb), fade-to-sky near the base of far layers | Polish, after tuning here |
| Trees or grass marks on the foreground, ground props | C3C covers top-view props; side-view props later |
| Blur or depth of field on far layers | Not planned: expensive on canvas, little gain over haze |
| Collision with the foreground or any non-main lane | Not planned: only the main profile is the collision truth |
| Changing what the cursor readout, runway posts or plumb line show | They stay on the main profile |

## 3. Behavior

| Effect | What you see |
|---|---|
| Parallax | Flying forward, the far ridge drifts slowly, the near ones faster, the main terrain at flight speed. Far mountains look narrower and steeper (horizontally compressed). |
| Slope shading | Slopes facing the light are lighter, slopes facing away darker, flat ground unchanged. Peaks read as solid. |
| Lane bands | A background ridge is a real skyline: it no longer pops in and out between frames, and its silhouette is the highest point of the band. |
| Foreground | A dark silhouette of the terrain just to the viewer's side. When a hill beside the track rises above the plane, the plane passes behind it and shows only as a faint outline. At low altitude over flat land it is a thin dark strip at the bottom. |

The crash banner, wreck sprite, runway posts, altitude scale, plumb line, labels and readout bar stay on top of everything, except that the foreground draws over the plane, the plumb line and the path line (their ghost is redrawn on top, §4.4).

## 4. Model

### 4.1 Layer table

Replace `LAYER_OFFSETS` and `LAYER_HAZE` with one table in `config/display.ts` (farthest first):

```text
interface SideLayer {
  nearM:  number   distance from the track, left of heading (negative: right, toward the viewer)
  farM:   number   far edge of the band; the layer samples `lanes` lines between near and far
  lanes:  number   sample lines in the band (1 = a single slice, as today)
  k:      number   horizontal parallax factor (1 = same as the main profile)
  haze:   number   0 clear .. 1 sky
}
```

Start values:

| Layer | Band (near to far, m) | Lanes | k | Haze |
|---|---|---|---|---|
| far 2 | 900 to 1500 | 4 | 0.5 | 0.7 |
| far 1 | 450 to 750 | 4 | 0.7 | 0.5 |
| far 0 | 200 to 350 | 3 | 0.85 | 0.3 |
| main | 0 | 1 | 1.0 | 0 |
| foreground | -250 to -120 | 3 | 1.3 | n/a (§4.4) |

The farther bands are wider because the same lateral error matters less at distance. A layer with `lanes = 1` and `k = 1` is exactly today's behavior; the tests lean on that.

### 4.2 Parallax

The plane column is the fixed point. Layer `k` uses meters per pixel `mpp / k`:

```text
mppLayer = sideMetersPerPixel(zoom) / k
start    = (0 - planeColumn) * mppLayer         (distance of the first sample from the plane)
length   = (width - 1) * mppLayer
```

`sliceWindow(craft, view, zoom, k = 1)` gets the factor; origin, heading and sample count follow from it. At `k = 1` the result is identical to today's. A feature at world distance `d` ahead is at column `planeColumn + d / mppLayer`, so it moves `k` times as fast as the main terrain. Terrain under the plane's column is still the true terrain of that lane.

- The layer still samples real terrain (nothing is faked), only at a different scale, so terrain beside the track stays recognizable from the top view. It just is not at the same horizontal position as in the main profile.
- Heights are not scaled. Far peaks look steeper because the horizontal axis is compressed; accepted.
- Zoom changes still jump layers by a fixed factor, as the main profile does.

### 4.3 Lane bands

For a layer with `lanes = n` between `nearM` and `farM`, take `n` slices at evenly spaced offsets (`shiftLeft(w, offset)`) and merge them with a pure function `envelope(slices)`: for each column, pick the lane with the highest `heightWorldM` and copy that lane's `ground`, `water` and `surface` for that column. Color, snow, water, skin then follow from the winning lane, so a snowy peak in a rear lane shows as snowy. Cost: `lanes` slices instead of one, about 3 to 4 times the sampling for a background layer. At 640 columns that is a few thousand `heightAt` calls per layer, which is small; measure it (§7).

### 4.4 Foreground

- Same lane merge as 4.3, offsets to the right (negative `shiftLeft`), `k > 1`.
- Drawn **after** the plane, plumb line and path line, **before** labels and the readout. It is not drawn into the cursor readout.
- Colors: the normal surface and body colors mixed toward a dark `FOREGROUND_TINT` (palette) by `FOREGROUND_DARKEN`, then drawn at `FOREGROUND_ALPHA` (about 0.85). Dark and slightly translucent so it reads as near and out of focus, and so the main terrain's silhouette is still dimly visible through it.
- **Plane ghost:** after the foreground, the plane sprite is drawn again at `GHOST_ALPHA` (about 0.35) and the path line too, so the plane is never lost. Only needed when the foreground overlaps the plane; drawing it always is simpler and fine, but check by eye that it does not make the plane look doubled when nothing covers it. If it does, only draw it where the foreground profile is above the plane sprite's rows (a check on the foreground slice around `planeColumn`).
- Fallback if it is still too cluttered: `FOREGROUND_MAX_RISE_PX` (off by default) caps how high the foreground may reach above the sea row, flattening tall peaks into a ridge.

### 4.5 Slope shading

For each column `x`, with `yTop(x)` the screen row of the surface (the bed, or the water surface when wet):

```text
slopePx = (yTop(x-1) - yTop(x+1)) / 2     positive when the ground rises to the right (faces the light at the left)
shade   = 1 + SLOPE_SHADE * clamp(slopePx / SLOPE_SATURATE_PX, -1, 1)
```

The skin, the snow band and the upper body get `shade` as the existing `k` multiplier on `rgb(..)`. The deeper body gets a weaker version, `SLOPE_SHADE_BODY` times as strong, so the silhouette edge is brighter or darker but the interior is calmer. Water is not shaded (its surface is flat). A pure `slopeShade(prevY, nextY)` function returns the factor. The light direction is fixed to the left of the screen because the side view always faces the heading; it does not depend on the compass.

### 4.6 Draw order

Sky, far layers (far 2, far 1, far 0), main profile, runway posts, altitude scale, plumb line, plane, **foreground**, plane ghost, labels, readout. Each layer is drawn with the same `drawProfile` (renamed to draw any merged `Slice`), taking its own haze and window, plus `slopeShade`.

### 4.7 Values

All in `config/display.ts` unless noted; colors in `config/palette.ts`.

| Constant | Start | Note |
|---|---|---|
| `SIDE_LAYERS` | table in §4.1 | Replaces `LAYER_OFFSETS` and `LAYER_HAZE` in `sideCamera.ts` |
| `SLOPE_SHADE`, `SLOPE_SATURATE_PX`, `SLOPE_SHADE_BODY` | 0.25, 3, 0.4 | Skin and snow, slope at which shading saturates, body strength |
| `FOREGROUND_ALPHA`, `FOREGROUND_DARKEN` | 0.85, 0.55 | Darkening is a mix toward `FOREGROUND_TINT` |
| `GHOST_ALPHA` | 0.35 | Plane and path line redraw |
| `FOREGROUND_MAX_RISE_PX` | off (`Infinity`) | Fallback only |
| `SIDE_FX` | all true | `{ parallax, laneBands, slopeShade, foreground }` switches |
| `FOREGROUND_TINT` | dark blue-grey | In `palette.ts` |

## 5. Files

| File | Change |
|---|---|
| `src/config/display.ts`, `palette.ts` | constants and colors (§4.7); `SIDE_LAYERS`; `SIDE_FX` |
| `src/views/sideCamera.ts` | `sliceWindow(..., k)`; remove `LAYER_OFFSETS` and `LAYER_HAZE` (moved); keep `shiftLeft` |
| `src/views/sideLayers.ts` | new, pure: `laneOffsets(layer)` and `envelope(slices)`; `slopeShade(prevY, nextY)` |
| `src/views/sideView.ts` | `drawProfile` takes a merged slice, a tint/alpha and shading; layer loop from `SIDE_LAYERS`; foreground and ghost; draw order §4.6 |
| `src/app/debugPanel.ts`, `src/main.ts` | a way to toggle the foreground at run time (checkbox or an unused key; decide in step 5); confirm nothing else needed |
| `tests/sideCamera.test.ts`, `tests/sideLayers.test.ts` | see §7 |
| `docs/CURRENT.md`, `docs/ARCHITECTURE.md` | present behavior; the §14 line; fix the §3 side view sentence ("Parallax sky sits behind it") to say what is actually drawn |

## 6. Steps

1. **Constants and pure pieces.** `SIDE_LAYERS`, `SIDE_FX`, `sliceWindow(k)`, `laneOffsets`, `envelope`, `slopeShade`, with tests first. Existing side view looks the same (single lane, k = 1, shading off).
2. **Idea 2, slope shading.** Smallest and independent. Check by eye on a peak, a valley and a coast; tune `SLOPE_SHADE`.
3. **Idea 1, parallax.** Move the three background layers onto `SIDE_LAYERS` with their `k`. Check by eye while flying and at all four zoom levels: smooth drift, no jitter or shimmer in the far layers (they sample at fractional world positions that change every frame).
4. **Idea 4, lane bands.** Switch the layers to `lanes > 1`. Check by eye that peaks no longer pop in and out; check frame time.
5. **Checkpoint.** Fly ideas 1, 2 and 4 together. Keep, retune or drop each; record in Results.
6. **Idea 3, foreground.** Foreground slice, tint and alpha, draw after the plane, plane ghost, run-time toggle. Fly over flat land, along a ridge and through a pass. Tune `FOREGROUND_ALPHA`, the band and `k`; use the fallback cap only if needed.
7. **Tune and write up.** Retune by flying; update CURRENT.md, ARCHITECTURE.md and this plan's Results.

## 7. Verification

**Tests** (headless):

- `sliceWindow`: `k = 1` equals today's window exactly; `k = 0.5` doubles meters per pixel (length and sample spacing); the sample at `planeColumn` is at the plane's own position for every `k`; sample count is always `view.width`.
- `laneOffsets`: one lane returns the near edge; `n` lanes are evenly spaced from near to far, inclusive; negative (foreground) offsets work.
- `envelope`: one slice returns equal data; per column, the result height is the maximum across slices; ground, water and surface come from the winning slice; ties are stable; slices of different lengths are rejected or the shortest is used (decide, test the choice).
- `slopeShade`: 1 on flat ground; above 1 when the ground rises to the right; below 1 when it falls; saturates at `1 +/- SLOPE_SHADE`; symmetric.
- Existing tests (`sideCamera`, `sim`) still pass unchanged.

**By eye** (dev server, full-size window; type checks cannot tell you this works):

- Far layers drift slower than near ones, with no seams or flicker; the main profile is unchanged.
- Slope shading shows relief without making the sea or flat land look striped.
- Bands remove the pop-in of peaks; background silhouettes look like skylines, not noise.
- Foreground: reads as near and soft; the plane stays findable (ghost) when covered; low flight over flat land is not cluttered; the readout bar, scale and labels stay readable.
- All four zoom levels, climbing and descending (the view scrolls), banked turns (heading changes, so lanes sweep over new terrain), and the crash view.
- Frame time in the debug panel before and after (§9).

## 8. Decisions

| Decision | Choice | Why |
|---|---|---|
| Parallax method | Per-layer meters per pixel, anchored at the plane's column | The layer still samples real terrain; no faked scroll offsets that drift out of sync with the heading |
| Layer silhouette | Upper envelope over a band of lanes | It is what a real 3D range looks like from the side, and it stops pop-in |
| Foreground look | Dark, 85% alpha, plus a plane ghost | Gives "flying behind a ridge" without hiding the plane or the collision terrain |
| Foreground collision | None; only the main profile counts | Keeps the sim's truth in one lane |
| Shading light | Fixed to the left of the screen | The view always faces the heading; matches the top view's northwest light in feel |
| Switches | One `SIDE_FX` object | Compare by eye and cheap rollback per effect |
| Order | 2, 1, 4, then 3 | Cheap certain wins first; the foreground is the one that can clutter, so it comes last and can be toggled |

## 9. Risks

- **Foreground hides the plane or the ground you need.** The main mitigation is the dark translucent look plus the ghost; the fallbacks are the rise cap and the run-time toggle. This is the part most likely to need several tuning rounds.
- **Shimmer in far layers.** They sample at fractional world positions that change every frame, and with `k < 1` many meters map to one pixel, so a thin ridge could flicker. Lane bands (envelope) should reduce it; if not, snap the layer origin to a multiple of its sample spacing along the heading.
- **Far peaks look too steep.** Horizontal compression with unchanged heights. If it looks wrong, raise the far `k` values toward 1 before dropping the effect.
- **Frame cost.** More slices (about 3x for background layers) and one more profile. Measure before and after in the debug panel; reduce lanes if needed. Profiles already do up to 4 `fillRect` per column.
- **Layers no longer line up with the top view.** A far ridge is not drawn at its true distance ahead. Accepted for decoration; note it in CURRENT.md. The cursor readout stays on the main profile.
- **Slope shading and the existing snow and water paths.** Shade must not create stripes where the surface code changes between cells; apply it from the height profile only, not from the surface type.
- **Overlap with later milestones.** Side-view props (trees, buildings) and clouds will need to know about `SIDE_LAYERS`. Keep layer knowledge in one table so they can follow it.

## 10. Done when

- `npm run typecheck` and `npm test` pass.
- In a manual flight, the side view shows parallax between layers, relief on slopes, stable background skylines and a foreground that can hide the plane behind a ridge without losing it.
- Each effect can be turned off with one constant, and the foreground can be toggled at run time.
- No change to the main profile, collision, the readout, runway posts or the altitude scale.
- CURRENT.md describes the effects, their constants and the "layers are not at their true distance" note.

## 11. Results

**Steps 1 and 2:**

- Built `SIDE_LAYERS`, `SIDE_FOREGROUND`, `SIDE_FX`, `SLOPE_*`, `FOREGROUND_*`, `GHOST_ALPHA` (`config/display.ts`), `FOREGROUND_TINT` (`palette.ts`); `sliceWindow(..., k)`; new `views/sideLayers.ts` (`laneOffsets`, `envelope`, `slopeShade`); tests in `tests/sideLayers.test.ts`. `LAYER_OFFSETS` and `LAYER_HAZE` are gone.
- `drawProfile` now takes a `Slice`; `layerSlice` builds each background layer from `SIDE_LAYERS` honoring `SIDE_FX.parallax` and `laneBands` (both off for now, so steps 3 and 4 are mostly flipping a switch and tuning by eye).
- Deviation from "looks the same": with lanes off a layer samples its table `nearM` (200, 450, 900 m), not the old 250, 600, 1200 m, so the background ridges sit a little closer to the track.
- Slope shading: skin and snow get the full factor, the body `SLOPE_SHADE_BODY` of it; water unshaded. `rgb()` now clamps at 255 (shade above 1 would overflow the cache key).
- Step 3: `SIDE_FX.parallax` is now `true` (k = 0.5, 0.7, 0.85 for the far layers). Still single-lane. Checked only with two screenshots 5 s apart (ridge drifts, no console errors); shimmer in the far layers, all four zoom levels and banked turns are NOT yet checked by eye. If far ridges flicker, snap the layer origin to its sample spacing or turn on lane bands (step 4).
- Checked (steps 1 and 2): typecheck and all tests pass; page loads with no console errors and relief shows on the peak in a small paused screenshot. Not yet tuned by flying (all zoom levels, coast, valley).
- Step 4: `SIDE_FX.laneBands` is now `true`. Added, at the user's request, a visual-only **main band** (`MAIN_BAND`, `SIDE_FX.mainBand`, +/- 30 m, 5 lanes, haze 0.15) drawn behind the exact main profile, so a ridge beside the track shows above it. It needs `laneBands` on. The exact main profile is still the collision truth. Checked: typecheck and tests pass, page renders with no console errors. Not yet checked: pop-in while flying, frame time in the debug panel, all zoom levels. Whether the main band's 15% haze makes the beside-track ridge look like a different layer is for you to judge by eye.
- Main band removed after trying it: too subtle, and the user disliked the look. `MAIN_BAND` and `SIDE_FX.mainBand` are gone; the main profile is the exact line only. Parallax kept despite one mountain appearing in several layers (accepted trade-off); lane bands kept on.
- Step 6: foreground built. `drawForeground` draws the dark profile on an offscreen canvas and blends it once at `FOREGROUND_ALPHA`; `foregroundCoversPlane` decides when to draw the ghost (plane and path line at `GHOST_ALPHA`) so the plane is not doubled when nothing covers it. `FOREGROUND_MAX_RISE_PX` is wired (off). Run-time toggle is a checkbox in the debug panel (`SIDE_FX.foreground`). Checked: typecheck and tests pass, no console errors, a dark strip shows at low altitude. NOT checked: a ridge actually covering the plane (ghost), clutter over flat land and passes, zoom levels, frame time. Tune `FOREGROUND_*`, the band and k by flying.
- Foreground shelved for now: `SIDE_FX.foreground` is `false` by default (promising, not ready). Turn it on with the debug panel checkbox or the constant.
