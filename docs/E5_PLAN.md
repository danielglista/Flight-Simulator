# E5 Implementation Plan: Cities

**Status:** built, E5.1 to E5.6 (§10). Not flown by hand; real frame timing not read.
**Milestone (ARCHITECTURE.md §14):** DC and Philadelphia look like cities in both views, and a building can be hit.
**Starting state:** end of E3, uncommitted in the working tree. **E4 (scale tuning by flying) is not done**; E5 starts ahead of it. All city data is in lat/lon, so a scale change is a map rebuild, but sizes and counts here may then need retuning.

All numbers are provisional. "World" means world meters, "real" means real meters or km. Replaces the outline in E_PLAN §5.4.

## 1. Scope

| In | Out (where it belongs) |
|---|---|
| New ground codes, districts, highways with bridges | Landmarks, small towns, small airport (E6) |
| Ordinary buildings: top view, side view, collision | Streaming, other cities (after E6) |
| Terrain warning sees buildings | Terminals and airport buildings (G4) |
| | Final art, night lights (H) |

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

## 3. Changes to the outline (agreed)

| # | Outline said | Now | Why |
|---|---|---|---|
| P1 | No building in an approach corridor | **No approach rule for buildings at all** (removed after E5B at your request; §5.5) | Unrealistic; downtown DC sits under the approach, as in the real world |
| P2 | About 400 buildings per city | **No set count.** Each district type has a density (share of ground under roofs), tuned by eye; the count follows from district size | A fixed number reads as scattered houses at one size and as a limit at another |

## 4. Data

| File | Holds |
|---|---|
| `data/map/districts.json` | Polygons in lat/lon: city, type, and optionally density, height range (real m) and street angle where they differ from the type's defaults. Hand-drawn by approximation, edited by eye on the preview |
| `data/map/roads.json` | Which real roads, by name and class. Their lines come from the Census TIGER/Line primary roads file (public domain; `data/map/SOURCES.md`), not hand-drawn as first planned |

District types: `downtown`, `residential`, `suburb`, `industrial`, `park`.

The map file's JSON meta gains `roads` (world polylines, width, bridge spans) and `buildings` (center, width, depth, angle, height in world m, style). The binary layers are unchanged; a file without the new keys loads with empty lists.

## 5. Behavior

### 5.1 Ground
- Terrain codes 12 `downtown`, 13 `residential`, 14 `suburb`, 15 `industrial`, 16 `park`. Existing codes are never renumbered; `urban` stays for the test island.
- Districts paint dry land only, never water or anything inside an airport boundary. Each code needs a color, a name in the readout and no contour lines (park keeps them).

### 5.2 Roads
- Warped through the same field as coasts, then drawn as lines over the ground with a width per class (16 and 10 world m). Over water the span is drawn as a bridge. They have no height and no collision.
- Interstates and turnpikes are major; a short list of other highways is minor. HOV lanes are left out.
- A road that would enter an airport boundary follows its edge instead.
- Major roads show at every zoom; minor ones to 10 m/px.

### 5.3 Buildings
- Generated from the fixed seed: streets on a grid at the district's angle, rectangles along them, skipping water, roads, parks and airport boundaries.
- Footprints about 12 to 40 world m, one size everywhere. Height = real height / `buildingHeight` (3).
- Downtown is real-like per city: DC low and even (25 to 42.5 real, about 140 ft; Rosslyn and Crystal City, across the river, 45 to 91, about 150 to 300 ft), Philadelphia a tall cluster (up to about 240 real, 80 world; was 300 until E6, so the landmark towers stand out).
- A building stands on the ground height at its center.

### 5.4 Collision
- `obstacleAt(x, y)` returns the roof height or NaN, through a bucket grid (`sim/world/obstacles.ts`). `heightAt` is unchanged, so ground handling, AGL and landing are too.
- In the air, contact is ground or roof, checked in the existing 0.5 m sweep pieces. Cause `building`; the wreck stays at the hit height. Rolling into one on the ground is the same crash.
- The terrain warning (and so the autopilot's let-go) sees roofs.
- A top-view click inside a building places the plane above its roof.

### 5.5 Approaches
There is no height limit on buildings near runways. The clearance surface first built here (2 deg from each runway end, lowering or dropping buildings, with a guardrail and tests) was removed after E5B at your request.

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
| E5.3 | Building generator, map meta, loader | Same inputs give the same file; guardrails pass |
| E5.4 | Top-view building layer | Cities read as cities at every zoom to 10 m/px; frame times hold |
| E5.5 | Side view | Skylines show; the building ahead is clear |
| E5.6 | Collision, terrain warning, crash banner | A test flies into a roof and a wall |

## 7. Files

| File | Change |
|---|---|
| `tools/map/districts.ts`, `roads.ts`, `shapefile.ts`, `buildings.ts` | New, pure |
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
| Placement | No building on water, a road or airport ground; roof cover near each district's density; the count is reported, not set |
| Flight | The scripted DCA to PHL flight still lands |
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

**Later change:** the clearance surface, its guardrail and its tests, and the check that no building reaches a 3 deg final, were removed (§5.5). Mentions of them below are history.

**E5.1 built.** 31 outlines in `data/map/districts.json`, painted by `tools/map/districts.ts` as the last step of the skeleton; codes 12 to 16 with colors, readout names and no contour lines (park keeps them). Map rebuilt: all guardrails pass, two builds are byte identical, file size unchanged. `npm run typecheck` and 685 tests pass.

- **Seen:** both cities show district patches in the generator preview and in the game, with a clean console. The readout names the district under the cursor.
- **Looks rough:** most outlines are rectangles, and each suburb outline reads as one large oval, because the warp rounds it. Roads and buildings should break these up; if not, edit the data.
- **Not checked:** a full-size window, in flight.

**E5.2 built.** `tools/map/shapefile.ts` reads the TIGER file, `roads.ts` joins, warps, reroutes, de-duplicates, thins and splits at water; `views/roadLayer.ts` strokes them as vectors over the terrain. The map meta holds 384 road pieces (123 over water, 5,411 points); the file is 3.08 MB. All guardrails pass, two builds are byte identical, `npm run typecheck` and 703 tests pass.

- **Seen in the game:** the Capital Beltway, the I-95 and I-76 routes and bridges over the Potomac and Delaware, close up and at the farthest zoom; clean console.
- **Left out:** George Washington Memorial Parkway, which runs along the bank and fell into the hand-drawn Potomac.
- **Visible compromise:** around PHL (moved toward the city) rerouted highways trace straight edges around the airport, reading as a rectangular ring road.
- **Restyled (your call, after seeing them):** dark asphalt in place of the off-yellow. Majors are divided highways (white edge and dashed lane lines, yellow lines, grass median), minors two lanes with a double yellow line; bridges have a deck, rails, pier caps and a shadow. Yellow lines only at the closest zoom (to 0.8 m/px; farther out they read as one stripe); white edge and lane lines and the median to 1.25 m/px, edge lines to 2.5, plain asphalt beyond. The two directions of a highway are now merged into one centerline (`mergeM`, 24 world m): 238 pieces, 58 over water. This also merges any two roads running closer than that.
- **Draw cost:** first version stroked the whole network every frame: about 25 to 38 ms close up. Roads are now cut into 400 m tiles and only those in view are drawn (`ROAD_TILE_M`), with plain joints past 2.5 m/px: about 5 to 10 ms close up. At 5 m/px and farther the whole map is in view and the cost is about the same as before, 3 to 9 ms. Measured by timing the layer alone on an 800 x 534 canvas with the browser pane hidden, so absolute figures are rough (they varied up to 3x between runs); the live frame timing in the debug panel has not been read. If it matters, next: bake zoomed-out roads into cached images.
- **Not checked:** roads running in water for short stretches elsewhere (crossings over 300 m world are listed by the build; the seven are two real bridge sites), frame times, a full-size window, in flight.

**E5.3 built.** `tools/map/buildings.ts` lays lots on a grid at each district's street angle (a 10 m street after 4 lots along and 2 across; Philadelphia at 9 deg) and keeps a rectangle only if all of it is on its own district's ground, 4 m clear of highways and clear of other buildings. Settings per district type (coverage, side length, real height) are in `data/map/districts.json`, with per-district overrides; Center City reaches 300 m real. The map meta holds 7,434 buildings (about 180 KB); `grid.buildings` carries them into the game. Two builds are byte identical, guardrails pass including the new clearance one, `npm run typecheck` and 722 tests pass.

| Type | Buildings | Roof cover set | Roof cover built |
|---|---|---|---|
| Downtown | 496 | 40% | 31% |
| Residential | 4,749 | 28% | 25% |
| Suburb | 1,957 | 6% | 5% |
| Industrial | 232 | 25% | 17% |

- The shortfall is footprints rejected at district edges, parks and highways; raise a type's `coverage` to make up for it.
- The clearance rule lowered and dropped nothing: the DC heights already fit under the DCA surface. It is covered by a test with made-up buildings.
- **Seen** in the generator preview only: **nothing draws them in the game until E5.4**, and nothing collides until E5.6.

**E5.4 built.** `views/cityLayer.ts` draws the buildings over the roads from 256 px tiles baked per zoom level: shadows to the southeast (0.5 m per m of height), roof colors by district type, and to 1.25 m/px outlines with ridged roofs (residential, suburb) or flat ones with a rim and plant room (downtown, industrial). Nothing past 10 m/px. `npm run typecheck` and 729 tests pass.

- **Tiles:** 10, 5 and 2.5 m/px are baked at load and kept; 1.25 and 0.5 are baked as they come into view, about 6 ms a frame, with the 2.5 tile stretched in their place until then. The last 150 are kept. While paused the view asks for more frames until sharp.
- **Cost,** timed on the layer alone (800 x 534 canvas, browser pane, rough): a frame typically 2 to 4 ms; worst frame while moving 4 to 28 ms; first frame after a jump to a new place 27 to 73 ms. Load time grows by about 0.5 s. Before the per-frame limit the first frame at a zoom took up to 235 ms.
- **Seen** at 1280 x 720: both downtowns at 5, 2.5 and 1.25 m/px, a clean console; stand-in tiles line up with the sharp ones.
- **Not checked:** frame timing in real flight (the debug panel), shimmer while turning.

**E5.5 built.** `views/sideBuildings.ts`, three passes in the side view: each parallax layer gets a hazed skyline of the buildings in its band; buildings within 60 world m of the flight line but not on it show pale behind the main profile; those the line goes through are solid, exactly as wide as the line's path through them, with windows at the closest zoom. Skylines and the pale ones keep only the highest building per pixel column. `npm run typecheck` and 733 tests pass.

- **For E5.6:** a solid building's roof is drawn at the ground height under its center plus its height. Collision must use the same.
- **Cost,** the buildings alone on a 640 x 360 canvas (browser pane, rough): about 1 to 8 ms a frame, most when zoomed out over Philadelphia.
- **Seen** at 1280 x 720 in Philadelphia, clean console.
- **Not checked:** DC's side view up close, in flight (popping as the heading turns), frame timing in real flight.

**E5.6 built.** `sim/world/obstacles.ts` files buildings in 100 m squares and gives the roof over a point (ground under the building's middle plus its height); `heightAt` is unchanged. The 0.5 m contact sweep checks roofs and walls, cause `building`, and the wreck stays where it hit. A roll into one on the ground is the same crash (in practice leaving the airport is already one). The terrain warning, and so the autopilot's let-go, looks for roofs every 8 m along its path. A click in the top view places the plane above any roof. `npm run typecheck` and 746 tests pass, including the scripted DCA to PHL flight among the buildings and a check that no building reaches a 3 deg final.

- **Seen** in the browser: flying into a Philadelphia tower shows `CRASHED: downtown, hit a building`, clean console.
- **As built:** the plane is a point, as for terrain, so a wingtip can pass through a wall.
- **Not checked:** the terrain warning heard or seen over a city in flight, and whether it nags on a visual circuit.
