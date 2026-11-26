# E5 Implementation Plan: Cities

**Status:** planned, no code yet. Two proposals in §3 await a yes.
**Milestone (ARCHITECTURE.md §14):** DC and Philadelphia look like cities in both views, and a building can be hit.
**Starting state:** end of E3, uncommitted in the working tree. **E4 (scale tuning by flying) is not done**; E5 starts ahead of it. All city data is in lat/lon, so a scale change is a map rebuild, but sizes and counts here may then need retuning.

All numbers are provisional. "World" means world meters, "real" means real meters or km. Replaces the outline in E_PLAN §5.4.

## 1. Scope

| In | Out (where it belongs) |
|---|---|
| New ground codes, districts, highways with bridges | Landmarks, small towns, small airport (E6) |
| Ordinary buildings: top view, side view, collision | Streaming, other cities (after E6) |
| Terrain warning sees buildings | Terminals and airport buildings (G4) |
| Obstacle clearance guardrail | Final art, night lights (H) |

## 2. What was measured

From the built map at 1:25 (throwaway script):

| | DC | Philadelphia |
|---|---|---|
| City center, world m | 4723, 7057 | 11194, 11778 |
| Core box, world m | 2000 x 1500 | 2000 x 1250 |
| Water in the core | 12% | 10% |
| Dry core area | 2.64 km2 | 2.26 km2 |
| Center from the nearest runway | **1.18 km past DCA's north end, 80 m off its line** | 1.05 km north of PHL's line, just past its east end |

So the approach to DCA 19 flies straight over downtown DC. The 3 deg path is about 70 world m up over the city center and 30 up at the core's south edge.

## 3. Changes to the outline (need a yes)

| # | Outline said | Proposed | Why |
|---|---|---|---|
| P1 | No building in an approach corridor | **Height limit under a sloped surface** (§5.5) | The E1 corridor is 1 km wide and 4 km long. At DCA it would clear out the middle of downtown DC |
| P2 | About 400 buildings per city | **About 1,500 per city** | 400 on 2.6 km2 is one every 80 m, about 3% roof cover: it would read as scattered houses |

## 4. Data

| File | Holds |
|---|---|
| `data/map/districts.json` | Polygons in lat/lon: city, type, density, height range (real m), street angle. Hand-drawn by approximation, edited by eye on the preview |
| `data/map/roads.json` | Polylines in lat/lon with a class: I-95, I-76, I-395, a simplified Beltway. Hand-drawn; no new download |

District types: `downtown`, `residential`, `suburb`, `industrial`, `park`.

The map file's JSON meta gains `roads` (world polylines, width, bridge spans) and `buildings` (center, width, depth, angle, height in world m, style). The binary layers are unchanged; a file without the new keys loads with empty lists.

## 5. Behavior

### 5.1 Ground
- Terrain codes 12 `downtown`, 13 `residential`, 14 `suburb`, 15 `industrial`, 16 `park`. Existing codes are never renumbered; `urban` stays for the test island.
- Districts paint dry land only, never water or airport ground. Each code needs a color, a name in the readout and no contour lines (park keeps them).

### 5.2 Roads
- Warped through the same field as coasts, then drawn as lines over the ground with a width per class (16 and 10 world m). Over water the span is drawn as a bridge. They have no height and no collision.

### 5.3 Buildings
- Generated from the fixed seed: streets on a grid at the district's angle, rectangles along them, skipping water, roads, parks and airport boundaries.
- Footprints about 12 to 40 world m, one size everywhere. Height = real height / `buildingHeight` (3).
- Downtown is real-like per city: DC low and even (about 25 to 45 real), Philadelphia a tall cluster (up to about 300 real, 100 world).
- A building stands on the ground height at its center.

### 5.4 Collision
- `obstacleAt(x, y)` returns the roof height or NaN, through a bucket grid (`sim/world/obstacles.ts`). `heightAt` is unchanged, so ground handling, AGL and landing are too.
- In the air, contact is ground or roof, checked in the existing 0.5 m sweep pieces. Cause `building`; the wreck stays at the hit height. Rolling into one on the ground is the same crash.
- The terrain warning (and so the autopilot's let-go) sees roofs.
- A top-view click inside a building places the plane above its roof.

### 5.5 Clearance guardrail
For each runway end, out to 4 km from the threshold, within a half width of 150 m growing by 0.1 m per meter: a roof may be no higher than the field height plus the distance times tan 2 deg. The generator lowers or drops a building that breaks it, and the guardrail fails if one remains. At DC this allows about 15 world m at the core's south edge and 40 at its center.

### 5.6 Top view
- Roofs, and shadows falling southeast like the plane's. Roads under them.
- The ground chunks are 20 m per pixel, too coarse for buildings, so this is **its own layer**, baked in tiles per zoom level, built as needed and dropped when far (the outline said "baked into chunks").
- Not drawn past 10 m/px: only the ground color shows.

### 5.7 Side view
- Buildings the slice line passes through are solid, full color: what you see there is what you can hit.
- Those within 60 world m either side are drawn behind, dimmed.
- Parallax layers take buildings in their own bands, hazed, as skylines.

## 6. Steps

Each step ends with `npm run typecheck`, `npm test` and a look in the browser.

| Step | Work | Done when |
|---|---|---|
| E5.1 | District data, codes 12 to 16, painted by the generator, colors and names | Both cities show district patches in preview and game |
| E5.2 | Road data, warp, bridges, map meta, top-view drawing | Highways run unbroken through both cities and cross rivers |
| E5.3 | Building generator, clearance guardrail, map meta, loader | Same inputs give the same file; guardrails pass |
| E5.4 | Top-view building layer | Cities read as cities at every zoom to 10 m/px; frame times hold |
| E5.5 | Side view | Skylines show; the building ahead is clear |
| E5.6 | Collision, terrain warning, crash banner | A test flies into a roof and a wall; both finals stay clear |

## 7. Files

| File | Change |
|---|---|
| `tools/map/districts.ts`, `roads.ts`, `buildings.ts` | New, pure |
| `tools/map/types.ts`, `validate.ts`, `guard.ts`, `build-map.mjs`, `shade.ts` | New data, meta, guardrail, preview |
| `src/sim/world/terrain.ts`, `mapFile.ts`, `grid.ts` | Codes, new lists |
| `src/sim/world/obstacles.ts` | New |
| `src/sim/contact.ts`, `flight/air.ts`, `flight/ground.ts`, `flight/terrain.ts`, `flight/stability.ts`, `step.ts` | Collision and warning |
| `src/views/cityLayer.ts` (new), `topView.ts`, `sideView.ts`, `terrainColors.ts`, `app/crashBanner.ts` | Drawing and banner |
| `src/config/map.ts`, `palette.ts`, `display.ts` | Numbers and colors |

## 8. Verification

| Check | Expectation |
|---|---|
| Determinism | Two builds give identical bytes |
| Placement | No building on water, a road or airport ground; counts near the budget |
| Clearance | No roof above the surface; the scripted DCA to PHL flight still lands |
| Collision | Roof hit, wall hit and a near miss, in tests; no tunneling at 300 m/s |
| Cost | Load time and top-view frame time over DC recorded before and after |
| By eye | Both views over both cities; DC and Philadelphia look different |

## 9. Risks

| Risk | Response |
|---|---|
| Hand-drawn districts and roads are wrong in places | Approximations, fixed by editing the data against the preview |
| Warp bends a street grid or crowds the ring | Streets are generated in world space; only district outlines are warped |
| Tile baking stutters in flight | Build at most a few tiles per frame; warm both cities at load if needed |
| Side view reads as a wall over downtown | Dim the near ones further, or narrow the 60 m band |
| E4 later changes the scales | Rebuild; retune counts |

## 10. Results

None yet.
