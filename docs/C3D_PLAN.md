# C3D Implementation Plan: Depth cues in the top view (shadow, haze, size, parallax, clouds)

**Status:** Steps 1 to 4 built (shadow, haze, plane size; shared pieces and tests). Step 6 spike run and reverted: idea 5 (banded parallax, step 7) shelved for now. Step 8 clouds built (one change from §4.6: cloud shadow alpha also follows the altitude ramp). Not done: tuning (step 9).
**Milestone (ARCHITECTURE.md §14):** a view-only addition between C3 and C4, like C3C. The ID is provisional; rename it if you prefer another slot. No `sim/` change.
**Starting state:** C3B is built (uncommitted work in the tree). The top view draws cached terrain chunks (`views/topView.ts`, `views/terrainColors.ts`) at fixed zoom levels, rotated about the view center so the plane's heading points up, then airports (`views/airportLayer.ts`), the turn line and a plane sprite (`views/sprite.ts`) drawn at the view center. Hillshade light comes from the northwest (`LIGHT` in `terrainColors.ts`). `Craft.z` is world meters; `CEILING_Z` is 600.

All numbers are provisional. "m" means world meters unless it says real (real = world x `SCALES.altitude`, 10).

The idea numbers (1 to 5) are those of the brainstorm: 1 shadow, 2 altitude haze, 3 plane size by altitude, 4 clouds, 5 banded terrain parallax. Build order is 1, 2, 3, 5, 4, because clouds reuse the layer scaling from 5.

## 1. Why

The top view is flat. Climbing or descending changes nothing on screen except the readouts, so there is no sense of height, of "I am low", or of terrain rising toward the plane. Contours and slope shading give relief, but only as paint. The wish: **make altitude readable at a glance and give the map some depth, without giving up top-down precision** (distances, scale bar, cursor picking, runway work in C4).

## 2. Scope

**In:**

1. **Plane shadow** on the ground, offset by height above ground (AGL), merging with the plane at touchdown.
2. **Altitude haze:** a pale translucent veil over the terrain that thickens as you climb.
3. **Plane size by altitude:** the top sprite pre-rendered at a few sizes, bigger when higher.
4. **Clouds:** a sparse cloud layer above the terrain with its own parallax, and soft cloud shadows on the ground.
5. **Banded terrain parallax:** terrain split into elevation bands, each drawn slightly scaled about the plane, so high ground leans outward and flattens as you climb.
- One shared camera model (§4.1) so all five agree.
- Each effect has an on/off constant in `config/display.ts`, so you can compare by eye.
- Tests for every pure function, and a CURRENT.md update.

**Out:**

| Left out | Where it belongs |
|---|---|
| Isometric or tilted top view | Not planned: it breaks cursor picking, the scale bar and runway alignment, and duplicates the side view |
| Continuous zoom with altitude | Not planned: fights the six fixed zoom levels and the cached chunks |
| Wind-driven cloud drift, weather, visibility limits | Weather milestone (`sim/weather/`); clouds here are static and purely visual |
| Terrain casting shadows, shadows draped over slopes | Not planned |
| Side view changes | D-series, if wanted |
| Ground props (trees, buildings) | C3C. See the ordering risk in §9 |

## 3. Behavior

| Effect | Low and slow | High |
|---|---|---|
| Shadow | Tucked under the plane; at touchdown it overlaps the sprite | Drifts away from the plane toward the southeast (the light is northwest, rotating with the map), fades out above `SHADOW_FADE_HIGH_M` AGL |
| Haze | None | Terrain washed out by up to `HAZE_MAX` |
| Plane size | Base size (`TOP_SPRITE_SIZE`) | Up to about 1.4 times larger, in 4 steps |
| Banded parallax | High ground leans outward from the plane, clearly | Lean shrinks toward zero |
| Clouds | Faint, so they never hide the ground near an airport | Stronger, drifting past faster than the ground (parallax); cloud shadows on the ground |

A crashed plane draws the wreck and no shadow. Free look: shadow, haze, clouds and parallax still use the camera center as the scaling origin, which is the plane only while following. Out of follow mode the layers still look right (they are scaled about the view center, as a camera over the map would see them); only the shadow stays tied to the plane's own pixel.

## 4. Model

### 4.1 One camera model

A virtual camera hangs `DEPTH_CAMERA_M` (D, 1500 m) above the plane. A thing at height `h` is drawn scaled about the view center, relative to something at sea level, by

```text
heightScale(h, z) = (z + D) / (z + D - h)         h, z in world meters, always > 1 for h > 0
```

- The sea-level layer has scale exactly 1, so the scale bar, cursor picking and the base map stay exact.
- Terrain at height `h`: `heightScale(h, z)`. At z = 0 a 100 m (1000 m real) peak is 1.07, so 21 px of lean at 300 px from the center. As z rises the factor falls toward 1.
- The plane itself is at `h = z`: `1 + z/D`, which is 1.4 at the ceiling.
- Clouds at `CLOUD_BASE_M`: same formula.
- D is the one knob that sets how strong everything is. All of it is exaggerated on purpose.

### 4.2 Shadow

```text
agl           = craft.z - heightAt(grid, scale, x, y)      (water surface counts as ground)
offsetPx      = min(SHADOW_MAX_PX, SHADOW_PX_PER_M * agl)
direction     = world (+1 east, -1 north) normalized, i.e. away from the NW light,
                rotated into the screen frame by the camera rotation
alpha         = SHADOW_ALPHA * (1 - smoothstep(SHADOW_FADE_LOW_M, SHADOW_FADE_HIGH_M, agl))
```

The shadow is the plane silhouette (same frame, black, outline included) drawn at the plane pixel plus the offset, before the plane. Shadow size stays at scale 1 while the plane grows, so height reads twice (separation and size).

### 4.3 Haze

`alpha = HAZE_MAX * smoothstep(0, CEILING_Z, craft.z)` of `HAZE_COLOR`, filled over the terrain after the terrain layers and before airports and clouds. Airports stay crisp on purpose (they are what you are looking for).

### 4.4 Plane size tiers

`PLANE_SIZE_TIERS = 4`. Tier `i` is rendered for altitude `i/(tiers-1) * CEILING_Z` at scale `1 + z/D`, with odd sprite sizes so the center pixel stays on the plane origin. `rasterize` takes shape parts in sprite pixels, so a tier is `rasterize(scaleParts(PLANE_TOP, k), angle, size)`. The tier is picked from `craft.z` with a little hysteresis so it does not flicker at a boundary. 72 frames x 4 tiers is cached lazily and built in `warm()`.

### 4.5 Banded terrain

- `PARALLAX_BANDS_M` (real meters): `[100, 250, 450, 700]`, converted to world meters by `/ scale.altitude`. Band 0 is the whole chunk as today. Band `k >= 1` is the same colored chunk with alpha 0 where the cell's land elevation is under the band's lower edge.
- RGB under alpha 0 keeps the true color, so `reduce2x` (zoom tiers 1 and 2) averages edges into a soft edge instead of a dark one.
- Per frame, for each band low to high: `ctx.save`, scale by `heightScale(bandHeight, z)` about the view center (inside the rotated frame, so it is rotation-proof), draw the visible chunks of that band, `ctx.restore`. Band height is the band's lower edge.
- Chunks with no cell above a band skip it (no canvas built, nothing drawn).
- **Airports** sit on terrain at some elevation; their overlay must use the same scale as that elevation's band or they slide off their ground. `airportLayer.draw` is called once for all airports today; it needs a per-airport scale step (§5).
- Water cells use the land elevation of their cell (a lake on a plateau rides the raised band).

### 4.6 Clouds

- A seamless tile (`CLOUD_TILE_PX` square, covering `CLOUD_TILE_M` of world) from seeded value noise, posterized to 3 levels so it matches the pixel look. Built once from `CLOUD_SEED`; no `Math.random`.
- Drawn in world coordinates, tiled, scaled by `heightScale(CLOUD_BASE_M, z)` about the view center, after airports.
- Alpha: `CLOUD_ALPHA_LOW` when the plane is under the cloud base, rising to `CLOUD_ALPHA_HIGH` above it (smoothstep), so low flight and landing keep a clear ground.
- Cloud shadows: the same tile, dark, at scale 1, shifted in the shadow direction by `CLOUD_BASE_M * CLOUD_SHADOW_SKEW`, drawn after airports and under the plane shadow.
- Static for now: they sit in the world and only move with the camera.

### 4.7 Values

All in `config/display.ts` unless noted; colors in `config/palette.ts`.

| Constant | Start | Note |
|---|---|---|
| `DEPTH_CAMERA_M` | 1500 | Strength of everything in §4.1. Tune first |
| `SHADOW_PX_PER_M`, `SHADOW_MAX_PX` | 0.4, 40 | Pixels of offset per meter AGL, and its cap |
| `SHADOW_ALPHA`, `SHADOW_FADE_LOW_M`, `SHADOW_FADE_HIGH_M` | 0.35, 100, 250 | |
| `HAZE_MAX` | 0.35 | Color in palette |
| `PLANE_SIZE_TIERS` | 4 | |
| `PARALLAX_BANDS_M` | 100, 250, 450, 700 (real) | Check against the test map's actual range first |
| `CLOUD_BASE_M`, `CLOUD_TILE_M`, `CLOUD_TILE_PX`, `CLOUD_SEED` | 250, 3000, 256, a fixed number | |
| `CLOUD_ALPHA_LOW`, `CLOUD_ALPHA_HIGH`, `CLOUD_SHADOW_ALPHA`, `CLOUD_SHADOW_SKEW` | 0.25, 0.6, 0.22, 0.3 | |
| `DEPTH_FX` | all true | `{ shadow, haze, planeSize, parallax, clouds }` switches |

## 5. Files

| File | Change |
|---|---|
| `src/config/display.ts`, `palette.ts` | constants and colors (§4.7) |
| `src/views/depth.ts` | new, pure: `heightScale`, `shadowOffsetPx`, `shadowAlpha`, `hazeAlpha`, `planeSizeTier`, `cloudAlpha`, `agl` helper (shared with C3C's `detail` if both exist) |
| `src/views/cloudTile.ts` | new, pure: seeded seamless noise tile (alpha bytes) |
| `src/views/terrainBands.ts` | new, pure: band index per cell for a chunk, and `maskBand(colorData, bands, k)` |
| `src/views/sprite.ts` | `scaleParts`; size tiers in the frame cache; `silhouette(data)` and `drawTopShadow`; `drawTop` takes a tier |
| `src/views/terrainColors.ts` | expose per-cell land elevation for bands (or return it alongside `colorChunk`) |
| `src/views/airportLayer.ts` | per-airport scale about the view center, by the airport's elevation |
| `src/views/topView.ts` | draw order in §6; band layers in `drawTerrain`; haze; clouds; shadow; tier pick |
| `src/main.ts` | nothing expected (the top view already gets `craft`); confirm |
| `tests/depth.test.ts`, `tests/cloudTile.test.ts`, `tests/terrainBands.test.ts`, `tests/sprite.test.ts` | see §7 |
| `docs/CURRENT.md`, `docs/ARCHITECTURE.md` | present behavior, one line in §14 |

**Draw order** (inside the rotated frame unless noted): sea fill, band layers low to high, haze, airports (per-airport scale), cloud shadows, clouds. Then outside the frame: plane shadow, turn line, plane (tier sprite), overlays.

## 6. Steps

1. **Shared pieces.** Constants, `depth.ts` and its tests, `DEPTH_FX` switches. Tests first.
2. **Idea 1, shadow.** `silhouette`, `drawTopShadow`, offset, fade, crash case. Check by eye: taxi/low pass, climb, turn (the shadow swings with the map).
3. **Idea 2, haze.** One overlay. Check by eye at a few altitudes and both extremes of zoom.
4. **Idea 3, plane size.** `scaleParts`, tiers, hysteresis, `warm()`. Check by eye that the sprite stays centered under the turn line origin and the heading bug ring.
5. **Checkpoint.** Fly ideas 1 to 3 together. Keep, retune or drop each before going on. Record in Results.
6. **Idea 5 spike (gate).** On one chunk only: build one raised band, scale it, and look at it at all six zooms while climbing, descending and turning. Question: is the scaled raised layer acceptable (nearest sampling, stable pixel pattern), or does it shimmer or tear? If not acceptable, drop idea 5, say so in Results, and continue with idea 4 using the same scale formula for clouds only.
7. **Idea 5, full.** Bands for all chunks (lazy, skip empty), tiers 1 and 2 via `reduce2x`, airport per-elevation scale, `warm()`. Check frame time with the debug panel.
8. **Idea 4, clouds.** `cloudTile`, cloud layer, cloud shadows, alpha ramp. Check low-altitude landing view stays clear.
9. **Tune and write up.** Retune `DEPTH_CAMERA_M` and alphas by flying; update CURRENT.md, ARCHITECTURE.md and this plan's Results.

## 7. Verification

**Tests** (headless):

- `heightScale`: 1 at `h = 0`; grows with `h`; tends to 1 as `z` grows; never infinite for any `h` up to the band maximum.
- `shadowOffsetPx`: zero at zero AGL; capped at `SHADOW_MAX_PX`; with rotation 0 the shadow is right and down; with rotation 90 degrees (east up) it is up and right; length is rotation-invariant.
- `shadowAlpha`: full below `SHADOW_FADE_LOW_M`, zero above `SHADOW_FADE_HIGH_M`, monotone between.
- `hazeAlpha`: 0 at z = 0, `HAZE_MAX` at the ceiling, monotone.
- `planeSizeTier`: covers 0 to `PLANE_SIZE_TIERS - 1`, monotone in altitude, hysteresis does not flip on a boundary wobble.
- `scaleParts` and sprite tiers: tier 0 is byte-identical to today's frame; larger tiers have odd sizes; the center pixel stays on the origin; `silhouette` keeps the alpha mask and zeroes color.
- `cloudTile`: same seed gives identical bytes; different seeds differ; left and right edges (and top and bottom) match so it tiles; coverage is within a set range.
- `terrainBands`: band index is monotone in elevation; `maskBand` zeroes alpha under the band, keeps RGB everywhere, and layer 0 equals the source.
- Existing tests (`sprite`, `terrainColors`, `camera`) still pass unchanged.

**By eye** (dev server, full-size window; type checks cannot tell you this works):

- Shadow under the plane at low altitude, separating on climb, fading out high, none on a crash.
- Haze reads as "far away", not as a dirty screen; airports stay readable.
- Plane steps between sizes without a visible pop that distracts, and stays centered.
- Banded terrain: ridges lean outward and settle as you climb; no seams at chunk borders; no gaps or flicker at the band edges; airports on raised ground stay on their ground; coasts and the hover readout still agree with what is drawn.
- Clouds: parallax against the ground; ground stays clear when low; no console errors.
- All six zoom levels, rotation while turning, and free look.
- Frame time in the debug panel before and after (§9).

## 8. Decisions

| Decision | Choice | Why |
|---|---|---|
| Parallax method | Scale raised bands about the view center | One formula is perspective-correct and rotation-proof; sea level stays at scale 1 so the scale bar and picking stay exact |
| Shadow altitude | AGL, not MSL | Over a hill the shadow slides toward the plane, which is the cue that matters for landing |
| Shadow direction | Opposite the hillshade light (NW light, SE shadow) | The terrain's own light already says so |
| Plane size | Pre-rendered tiers, not smooth scaling | Pixel art; in-between scales look uneven |
| Airports | Own scale per airport, haze skips them | Must stay aligned with their ground and stay readable |
| Clouds | Static, under the plane, faint when low | Weather and wind are a later milestone; the ground must stay clear for landing |
| Order | 1, 2, 3, then 5 (spike first), then 4 | Cheap certain wins first; 5 is the risky one; clouds reuse its scaling |
| Switches | One `DEPTH_FX` object | Compare by eye and cheap rollback per effect |

## 9. Risks

- **Scaled pixel art may shimmer or tear (idea 5).** Scaling a cached canvas with nearest sampling gives uneven pixel widths. The hypothesis is that the pattern is stable because it is anchored to the layer's rounded origin and the factor is near 1, so only a half-pixel step jitter remains. The step 6 spike tests this; the plan has an explicit exit.
- **Memory (idea 5).** Up to 5 layers per chunk. Build lazily, skip empty layers and chunks, and measure the heap before and after.
- **Frame cost.** More `drawImage` calls (layers x visible chunks, plus clouds). Watch frame time on the debug panel; reduce bands or skip clouds below a zoom if needed.
- **Conflict with C3C ground props.** Props are drawn on base terrain; on a raised band they would lag the lean. If C3C is built first, props must be drawn per band like airports; if this is built first, C3C must follow the same rule. Decide the order before starting step 7.
- **Cursor picking on raised bands.** Hover reports the base position; a raised band's pixels sit a few pixels off. Accepted for now; note it in CURRENT.md.
- **Baked hillshade light rotates with the map.** Slope shading is cached north-up, so the apparent light direction turns with the heading, and hills can read as hollows at some headings. Not fixed here; idea 5's lean helps relief read the right way. Note it, do not scope it.
- **Clouds hiding things.** Alpha ramp and a low cap keep airports and the plane visible; check at 600 m and on final approach.
- **Strength by eye.** Real perspective would be nearly invisible; `DEPTH_CAMERA_M` exaggerates on purpose. If it feels like a gimmick, raise D before dropping an effect.

## 10. Done when

- `npm run typecheck` and `npm test` pass.
- In a manual flight, altitude is readable from the top view alone (shadow separation, size and haze), and high ground visibly leans and settles with altitude (or idea 5's drop is recorded with the reason).
- Each effect can be turned off with one constant.
- No change to the scale bar, picking or the six zoom levels.
- CURRENT.md describes the effects, their constants and the picking note.

## 11. Results

**Steps 1 to 4 (built):**

- `config/display.ts`: depth constants and `DEPTH_FX` (only `shadow`, `haze`, `planeSize` exist so far; add `parallax`, `clouds` with their steps). `HAZE_COLOR` in `palette.ts`. New `views/depth.ts` with its tests; `sprite.ts` gained `scaleParts`, `tierSpriteSize`, `tierScale`, `silhouette`, size tiers in `drawTop` and `drawTopShadow`; `topView.ts` draws haze (after terrain, before airports), shadow (before turn line) and the tiered sprite.
- Tier sprite sizes are 25, 29, 33, 35 px. Tier 0 is byte-identical to the old frame (tested).
- Typecheck and 323 tests pass. Seen once in the browser pane (paused, about 100 m world altitude): shadow offset southeast of the plane, light haze, no console errors. Not yet flown through climbs, turns, crash, free look or all zoom levels, so the by-eye checks in §7 and the step 5 checkpoint remain.

**Step 6, idea 5 spike (done):**

- **Outcome: idea 5 (banded parallax) shelved, spike code reverted, to revisit later.** Reasons: flying with it, the effect was too subtle to notice at D = 1500; a frame-rate drop was reported but a pane measurement (17 fps with the spike, 17 fps with everything off) showed it was not caused by the spike. If revisited, the formula and findings below still stand; a stronger D or a more visible treatment would be the first thing to try.
- What the spike was (now removed): one raised band on the highest chunk (1,1), cells under half the chunk peak made transparent (RGB kept), all three tiers (the lower two via `reduce2x`), drawn scaled by `heightScale` about the view center inside the rotated frame. Step 7 replaces it with `terrainBands.ts`.
- Test map: peak 1816 m real (181.6 m world), one island. The planned bands (100 to 700 m real) cover only the lower part of that range; pick edges up to about 1500 m real in step 7.
- Seen in the browser pane with the layer tinted, at the closest zoom and a mid zoom, at simulated altitudes 0, 300 and 600 m (forced, sim paused), and with the follow camera: the raised layer sits cleanly on its peak, no seams or gaps at the band edge, contour lines stay continuous, and it shrinks back as altitude rises. Nearest sampling gives slightly uneven pixel widths (a few doubled columns) but nothing that tears.
- **Verdict: acceptable, go on to step 7.** Not checked: live motion (the sim was paused, so shimmer while climbing and turning is unjudged), the widest zoom up close, and the band edge when it crosses a chunk border (only one chunk has a band).
- Lean at D = 1500: about 6% at sea level for a 90 m world band, so about 9 px at 150 px from the view center. Only visible away from the center.

**Step 8, clouds (built):** `views/cloudTile.ts` (seeded 3-octave value noise, wraps, 3 alpha levels), `cloudAlpha` in `depth.ts`, `drawClouds` in `topView.ts` (shadows at scale 1 shifted southeast, clouds scaled about the view center by `heightScale(CLOUD_BASE_M, z)`, drawn after airports). Tests: tile determinism, wrap seam, coverage, alpha ramp. Seen in the browser pane at a forced altitude of 500 m (clouds and shadows draw, tiles meet without gaps, no top-view console errors); not flown through the base altitude, and frame cost not measured on your machine. Cloud coverage and look are untuned. **Switched off by default (`DEPTH_FX.clouds = false`) pending rework; the code is kept.**

_Step 9 (tuning) not done._
