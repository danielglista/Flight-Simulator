# C3C Implementation Plan: Ground detail by altitude (trees, fields, buildings)

**Status:** Planned. Nothing built.
**Milestone (ARCHITECTURE.md §14):** a view-only addition between C3 and C4, so low flight (takeoff and landing in C4 and C5) has something to look at. The ID is provisional; rename it if you prefer another slot. No `sim/` change.
**Starting state:** C3B is built (uncommitted work in the tree). The top view draws cached terrain chunks (`views/topView.ts`, `views/terrainColors.ts`) plus airports (`views/airportLayer.ts`). The grid is 10 m cells, one `Terrain` code per cell, no objects.

All numbers are provisional. "m" means world meters unless it says real.

## 1. Why

Near the ground the top view is a flat color per 10 m cell. A forest cell is a green square, so there is nothing to show height, speed or "I am low" during takeoff and landing. From high up, flat color is exactly right. The wish: **detail you can see when low, fading to plain terrain color as you climb.**

## 2. Scope

**In:**

- A `detail` value, 0 to 1, computed from height above ground (AGL) and the zoom level.
- **Procedural ground props**, drawn on top of the terrain, only for visible cells and only when `detail` is above 0:
  - trees on forest cells (small dark blobs with a tiny shadow);
  - field texture on farmland (furrow stripes), grass speckle, rock speckle on mountain, a few dots on snow and desert;
  - buildings on urban cells (small rectangles with a roof shade and a shadow);
  - cars or lines on road cells only if it is cheap and reads well.
- **Airport detail** in `airportLayer.ts`: hangars, tower, windsock and apron marks at the closest zooms, fading with `detail`.
- Props fade out with altitude **one by one** (each has a stable threshold), not all at once.
- Tests for the pure parts, tuning constants in `config/`, CURRENT.md update.

**Out:**

| Left out | Where it belongs |
|---|---|
| Stored trees, buildings or any per-object data in the map or `sim/` | Only if gameplay needs collisions (not planned) |
| Collisions with trees or buildings | Not planned; every contact is already a crash (B3) |
| Plane shadow, haze, plane size by altitude, parallax layers, clouds | A separate "altitude feel" step; not part of this one |
| Automatic zoom with altitude | Possible follow-up (§9); zoom stays manual here |
| Town placement and road networks in the map data | Map generation work; urban cells that exist are enough for now |
| Side-view ground detail | Not requested |
| Night lighting, seasons, weather | Later milestones |

## 3. Behavior

| Situation | What you see |
|---|---|
| Cruise (above `DETAIL_FADE_END_M` AGL), any zoom | Today's flat terrain colors. No props |
| Descending between the start and end of the fade | Props thin out upward: the tallest-threshold trees and buildings stay longest; alpha eases to 0 |
| Low (under `DETAIL_FULL_M` AGL) at a close zoom | Full detail: trees, field stripes, buildings, airport objects |
| Zoomed out (coarser than `DETAIL_MIN_ZOOM`) | No props at any altitude: cells are under 2 pixels, props would be noise |
| Free look | Same rules, but `detail` follows the **plane's** AGL, not the camera's, so panning does not change the look |
| Over water or seabed | No props |

`detail = fade(AGL) * zoomGate`. `AGL` is the plane's `z` minus the ground height under it (`groundAt`, `src/sim/world/grid.ts`), converted from world to the units the fade uses (see §4.3).

## 4. Model

### 4.1 Stable per-cell randomness

Props must be the same every frame and every run, with no storage and no `Math.random`.

```text
hash(col, row, salt)  -> uint32          integer mix (e.g. the PCG or xorshift-style multiply/xor)
unit(h)               -> [0, 1)          h / 2^32
```

For a cell, `salt` picks the use (tree count, x offset, y offset, size, fade threshold). The same `(col, row)` always gives the same props. The map seed is mixed into the hash so different maps differ.

### 4.2 Props per terrain code

| Terrain | Prop | Notes |
|---|---|---|
| forest | 1 to 3 tree blobs per cell | Dark green disc, 1.5 to 3 m real-looking radius in world meters, hashed position inside the cell. Tiny offset shadow, darker, same direction on every prop |
| farmland | Parallel stripes across the cell | Stripe angle hashed per **field** (use `col >> 3, row >> 3` so neighboring cells match), low contrast |
| grass | A few lighter or darker specks | Sparse |
| mountain | Rock specks | Sparse, no stripes |
| snow, desert | Very faint specks | Mostly skip; keep the cost near zero |
| urban | 1 or 2 buildings per cell | Rectangle (hashed width and depth, 4 to 8 m), lighter roof, offset shadow |
| road, airport, runway, taxiway | None from this layer | Airport objects come from `airportLayer.ts` |

Counts and sizes are constants in `config/detail.ts` (new, small), colors in `config/palette.ts`. Shadow direction uses one constant, kept in line with the hillshade light direction in `terrainColors.ts` (check it when building).

### 4.3 The `detail` value

```text
agl      = (craft.z - groundAt(grid, scale, craft.x, craft.y))       world meters
fade(a)  = 1                                   a <= DETAIL_FULL_M
         = 1 - smoothstep(FULL, END, a)        between
         = 0                                   a >= DETAIL_FADE_END_M
zoomGate = zoom >= DETAIL_MIN_ZOOM ? 1 : 0
detail   = fade(agl) * zoomGate
```

Check `scale.altitude` (world to real conversion) so the thresholds are in the units the code means; keep names distinct per the units rule. The pure function lives in `views/groundDetail.ts` and takes plain numbers.

A prop with hashed threshold `t` in [0, 1) is drawn when `detail > t`, with alpha `clamp((detail - t) * 4, 0, 1)`. This gives the one-by-one thinning.

### 4.4 Drawing

Props are drawn inside the rotated terrain frame in `topView.draw`, right after `drawTerrain` and before `airportLayer.draw`, so they rotate with the map and airports draw over them.

```text
for each cell in the visible area (from `area`, clamped to the map):
  code = terrain code of the cell
  if the code has no prop: continue
  for each prop of the cell: compute hashed position, skip if detail <= t, fillRect / small arc
```

Rules to keep it cheap:

- Batch by color: set `fillStyle` once per color and draw all rects of that color (collect into per-color lists, or loop per color).
- Use `fillRect` with sizes snapped to whole pixels where the prop is under about 3 px, so nothing shimmers.
- Cap work per frame: visible cells at the closest zoom are about a few thousand. If a profile shows trouble, bake a per-chunk prop canvas at a coarse `detail` step (for example 4 steps) and cross-fade, rather than redrawing per cell.
- Skip cells with no visible area before hashing anything.

### 4.5 Airport objects

`airportLayer.ts` already draws by zoom (`zoom >= 4`, `zoom >= 5` checks). Add objects with simple local geometry derived from the airport's runways and bounds (no new data): hangars on the apron edge, a tower near the apron, a windsock near a runway end. Placement is deterministic from the airport ident. They fade with the same `detail`. Exact object list is a decision for step 4 (§6).

## 5. Files

| File | Change |
|---|---|
| `src/config/detail.ts` | new: fade thresholds, zoom gate, prop counts and sizes, shadow offset |
| `src/config/palette.ts` | prop colors (tree, tree shadow, field stripe, roof, wall, shadow, rock) |
| `src/views/groundDetail.ts` | new, pure: `hash`, `unit`, `detailAt(agl, zoom)`, per-terrain prop generation for one cell (returns plain numbers) |
| `src/views/propLayer.ts` | new: draws the props for the visible cells (canvas only) |
| `src/views/topView.ts` | compute AGL and `detail`; call the prop layer after the terrain; pass `detail` to the airport layer |
| `src/views/airportLayer.ts` | hangars, tower, windsock, fading with `detail` |
| `src/app/debugPanel.ts` | show `AGL` and `detail` |
| `tests/groundDetail.test.ts` | see §7 |
| `docs/CURRENT.md` | top-view section: ground detail, thresholds, zoom gate |
| `docs/C3C_PLAN.md` | this file: keep Status and Results accurate |

`sim/` is untouched, so the headless rule is intact. `views/` only reads state.

## 6. Steps

1. **Pure core.** `config/detail.ts`, `views/groundDetail.ts` (hash, `detailAt`, prop generation) with tests first. No drawing yet.
2. **Trees and fields.** `propLayer.ts` for forest, farmland, grass; hook into `topView.draw`; add `AGL` and `detail` to the debug panel. Check by eye at each zoom and altitude.
3. **Buildings and rock.** Urban buildings, mountain specks, snow and desert (only if they read well). Check the urban cells that exist in the test map; if there are none in view, say so.
4. **Airport objects.** Hangars, tower, windsock; fade with `detail`. Decide the final list from how the airports look.
5. **Tune and write up.** Fly low and climb at several zooms; adjust thresholds, counts and shadows; profile frame time at the closest zoom; update CURRENT.md and Results.

## 7. Verification

**Tests** (headless, in `tests/groundDetail.test.ts`):

- `hash`: same inputs give the same output; changing the salt, column, row or map seed changes it; outputs are spread over [0, 1) (loose bucket check).
- `detailAt`: 1 at and below `DETAIL_FULL_M`; 0 at and above `DETAIL_FADE_END_M`; strictly decreasing between; 0 when the zoom is under `DETAIL_MIN_ZOOM`; never outside [0, 1]; handles NaN and negative AGL without throwing.
- Prop generation: the same cell always gives identical props; counts stay in the configured range; positions stay inside the cell; terrain codes with no prop give an empty list; farmland cells in the same field share a stripe angle.
- Thinning: for a fixed cell, the set of drawn props at lower `detail` is a subset of the set at higher `detail`.

**By eye** (dev server, full-size window; type checks cannot tell you this looks right):

- Take off height and a low pass at zoom 3, 4 and 5: trees, fields, buildings read clearly and do not shimmer while the map rotates.
- Climb: props thin out smoothly and are gone by `DETAIL_FADE_END_M`; the terrain looks as it does today above that.
- Zoom out at low altitude: props vanish at the gate, with no pop-in at the edges of the screen.
- Free look: panning does not change the density.
- Frame time at the closest zoom stays comfortable; no console errors.

## 8. Decisions

| Decision | Choice | Why |
|---|---|---|
| Source of props | Hashed from cell and terrain code, drawn live | The map has no objects; nothing to store, replays and maps stay identical |
| What drives the fade | AGL, with a zoom gate | Altitude is what the player feels; the gate stops sub-2-pixel noise |
| Layer in `views/`, not `sim/` | Yes | Purely visual; no gameplay depends on it |
| Free look | Fade by plane AGL | Detail should describe the plane's situation, not where the camera is |
| Zoom | Stays manual | Auto zoom is a feel change with its own risks (§9) |
| Per-prop thresholds | Hashed | Gradual thinning looks natural; a global alpha fade looks like a dimmer |

## 9. Risks

- **Per-frame cost at the closest zoom.** Thousands of cells with a few props each. Batch by color and skip early; fall back to a baked per-chunk prop canvas with a few `detail` steps if needed.
- **Shimmer and noise.** Sub-pixel props crawling as the map rotates. Snap small props to whole pixels; fade or skip anything under about 2 pixels.
- **Looks wrong against the hillshade.** Tree shadows and the baked slope light must agree. Check the light direction in `terrainColors.ts` and match it.
- **Few urban cells in the map.** Buildings may rarely appear until town placement exists. That is a map-data issue, not this step's.
- **Airport objects clutter the runway area.** Keep them off runway and taxiway cells and out of the approach path.
- **Optional follow-up:** auto zoom that steps one level closer below some AGL, with different step-in and step-out thresholds so it does not flicker. Only worth doing after the by-eye checks; it stays discrete because the terrain chunks are cached per zoom.

## 10. Done when

- `npm run typecheck` and `npm test` pass.
- Flying low at a close zoom shows trees, field texture, buildings and airport objects; climbing fades them to flat terrain color with no popping; zooming out removes them cleanly.
- Frame time and the console are fine at the closest zoom.
- All thresholds and counts are in `config/detail.ts`; colors in `config/palette.ts`.
- `docs/CURRENT.md` describes the behavior; this plan's Status and Results are accurate.

## 11. Results

Not started.
