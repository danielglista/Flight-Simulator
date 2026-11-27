# E6 Implementation Plan: Landmarks

**Status:** all the landmarks are built (§10): four in DC and six in Philadelphia, with Two Liberty Place in place of the Comcast Center. All but the Monument wait for your judgment of their looks. Towns and the small airport are planned after the landmarks.
**Milestone (ARCHITECTURE.md §14):** DC and Philadelphia are told apart at a glance.
**Starting state:** E5 and E5B built, building approach rule removed, uncommitted. E4 (scale tuning) is not done.

All numbers are provisional. "World" means world meters, "real" means real meters. Replaces the landmark part of E_PLAN §5.5.

## 1. Scope

| In | Out (where it belongs) |
|---|---|
| Eight landmarks (§3) as authored shapes | Towns and the small airport (E6, planned later) |
| Top view, side view, collision for them | White House, Jefferson Memorial, National Cathedral, Walt Whitman Bridge, stadiums (possible extras) |
| Flying under the Ben Franklin Bridge | Flying under the ordinary highway bridges |
| | Night lights, final art (H) |

## 2. Decisions

| Decision | Choice |
|---|---|
| Washington Monument | Full height at 1:3 (about 57 world) |
| Ben Franklin Bridge | Can be flown under |
| Outside data | None; positions and dimensions written from general knowledge, corrected by eye |
| Pictures | Optional, in `tools/raw/landmarks/` (git-ignored), private references only |
| Size | Footprints about 1:2.5, heights 1:3, each adjustable per landmark. At the core's 1:4 the small ones would be lost among ordinary buildings |
| Cables | Drawn but not solid (proposed) |

## 3. Landmarks

Real sizes are approximate. World sizes follow §2.

| City | Landmark | Shape | Real, w x d x h | World, w x d x h |
|---|---|---|---|---|
| DC | Washington Monument | Tapered shaft, pyramid tip | 17 x 17 x 169 | 7 x 7 x 57 |
| DC | Capitol | Long wings, center block, dome | 229 x 107 x 88 | 92 x 43 x 29 |
| DC | Lincoln Memorial and reflecting pool | White box; flat strip of water | 58 x 36 x 30 | 23 x 14 x 10; pool fitted between memorial and monument |
| DC | Pentagon | Five-sided ring with courtyard | 430 across x 23 | 170 across x 8 |
| Philly | City Hall | Square block, courtyard, tall tower | 148 x 143, tower 167 | 59 x 57, tower 56 |
| Philly | One Liberty Place, Two Liberty Place, Comcast Technology Center | Three towers: chevron crown and spire, pointed crown, stepped with a blade | h 288, 258, 342 | h 96, 86, 114 |
| Philly | Art Museum | U-shaped, tan | 190 x 120 x 31 | 76 x 48 x 10 |
| Philly | Ben Franklin Bridge | Two towers, deck, cables | towers 117, deck underside 41 | towers 39, deck underside 14 |

The bridge is **fitted to the drawn Delaware and its highway**, not placed by lat/lon: the river is widened, so the real tower spacing does not fit it.

## 4. Behavior

### 4.1 Data
- `data/map/landmarks.json`: per landmark an id, city, lat/lon, heading and a list of parts.
- A part has a plan shape (rectangle, regular polygon, ring, circle), a bottom and top (real m above the landmark's ground), a color and a top style (flat, pyramid, dome, spire).
- The generator converts to world units, writes `landmarks` into the map meta, and keeps ordinary buildings and roads' drawing clear of them. A file without the key loads with none.

### 4.2 Views
- Top view: parts drawn low to high with shadows, visible at every zoom where buildings are, and the Monument and bridge farther out if they read.
- Side view: each part's silhouette (the same solid, beside and skyline passes as buildings), with the gap under the bridge deck left open.
- Under the deck, the top view draws the deck over the plane, dimmed enough to keep the plane readable.

### 4.3 Collision
- A solid gets a **bottom** as well as a top. `obstacleAt(x, y, z?)` returns the highest top among solids whose bottom is at or below `z`; without `z`, the highest top (placing the plane by click).
- Contact, ground roll and the terrain warning pass their height, so flying under the deck is clear and does not warn.
- Tapered and domed parts collide as stacked slices, so what is seen is what is hit.
- Deck underside about 14 world over the water, which the altimeter (1:5) reads as about 225 ft.
- Crash cause stays `building`.

## 5. Steps

Each code step ends with `npm run typecheck`, `npm test` and a look in the browser.

| Step | Work | Done when |
|---|---|---|
| E6.1 | Data format, validation, generator, map meta, loader; Washington Monument only | It is in the map file at the right place |
| E6.2 | Top view and side view | The Monument reads in both views |
| E6.3 | Collision with bottoms, terrain warning | Tests: hit, near miss, pass under a deck |
| E6.4 | The other DC landmarks | You have judged sizes and looks |
| E6.5 | Philadelphia landmarks and the bridge | You have flown under it |

## 6. Files

| File | Change |
|---|---|
| `data/map/landmarks.json`, `tools/map/landmarks.ts` | New |
| `tools/map/types.ts`, `validate.ts`, `buildings.ts`, `build-map.mjs`, `shade.ts` | New data, clearing, meta, preview |
| `src/sim/world/mapFile.ts`, `obstacles.ts`; `src/sim/contact.ts`, `flight/ground.ts`, `flight/terrain.ts` | Load, solids with bottoms |
| `src/views/landmarkLayer.ts`, `sideLandmarks.ts` (new), `topView.ts`, `sideView.ts` | Drawing |
| `src/config/map.ts`, `palette.ts` | Numbers and colors |

## 7. Verification

| Check | Expectation |
|---|---|
| Determinism | Two builds give identical bytes |
| Placement | Every landmark on dry land (bridge excepted); no ordinary building overlaps one |
| Collision | Tower, deck and dome hits; flight under the deck is clear; no tunneling at 300 m/s |
| Flight | The scripted DCA to PHL flight still lands |
| By eye | DC and Philadelphia are told apart in both views |

## 8. Risks

| Risk | Response |
|---|---|
| Pentagon at 170 world swamps its surroundings | Scale that one down |
| The highway at the bridge does not line up with a good crossing | Author the crossing and drop the road's own bridge span there |
| The gap under the deck is too tight to be fun | Raise the deck; it is data |
| Shapes look crude | Pictures as guidance; final art is H |
| E4 changes the scales | Rebuild and recheck sizes |

## 9. Done when

All eight are in the game in both views, can be hit, the bridge can be flown under, and you accept how they look.

## 10. Results

**Washington Monument built** (E6.1, E6.2 and the monument's part of E6.3), shaped from your side and top pictures. `npm run typecheck` and 761 tests pass; guardrails pass, with a new one that each landmark is on land. The ordinary building count is unchanged (16,409).

Differences from the plan above:
- A solid is a north-aligned rectangle that may narrow toward its top, not a general shape list. Rings, domes, polygons and turning are added with the landmark that needs them.
- Sloping parts collide on their true surface, not as stacked slices.
- Solids have no bottom for collision yet: that comes with the bridge.
- Added: flat ground decoration (disc, ring, line) and a circle of flag poles, drawn but not solid.
- The side view shows a landmark's outline up to 200 m left of the flight line (buildings: 60 m).
- The terrain warning now looks for obstacles every 4 m (was 8), so a narrow shaft is not stepped over.
- The generator preview images do not draw landmarks.
- Later fix, after your note: the side view first lit the left half and shaded the right whatever the heading. It now draws the faces turned to the viewer, shaded by compass side (763 tests; checked by rendering the layer alone at headings 0 to 70, not in flight). Ordinary buildings still do not do this.

**Seen** at 1280 x 720: top view with plaza, paths and shadow; the monument in the side view; the terrain warning; flying into it shows `CRASHED: park, hit a building`; clean console.
**Not checked:** flags and the two-tone shaft close up, frame timing, in flight by hand.

**Capitol built** (part of E6.4), shaped from your west-front and top pictures: 22 solids, about 92 world m long with the statue about 29 up. Added for it: round solids (drum and dome) with matching collision, column lines on walls, and rectangles of paving. The side view paints standing parts farthest first, then what is on top from the bottom up. `npm run typecheck` and 769 tests pass; guardrails pass; the building count is unchanged and no highway runs within 90 m.
**Seen:** both views by rendering the landmark layers alone, and the game loading with a clean console. **Not checked:** in flight, in the running game's views, the crash, frame timing. Trees and the stairs on the west front are left out.

**Lincoln Memorial and Pentagon built** (the rest of E6.4), from your pictures. Added for them: prism solids (convex outline, flat top, roof color) for angled walls, with matching collision. Both sit on dry ground with no highway across them; the Pentagon keeps the full 1:2.5 plan (about 190 world m), and 33 ordinary buildings made way for it. The reflecting pool is drawn decoration, not map water, fitted at the footprint scale. `npm run typecheck` and 775 tests pass.
**Seen:** both from above and from the side by rendering the landmark layers alone; the game loads with a clean console. **Not checked:** in flight, in the running game's views, frame timing.

**City Hall, Art Museum and Ben Franklin Bridge built** (part of E6.5), from your pictures. `npm run typecheck` and 782 tests pass; guardrails pass; ordinary buildings 16,356 (was 16,409).
- Added: a landmark may be turned as a whole (`turn`), with turned rectangles in collision and both views; `wires` (cables, braces, lattice, flag poles: drawn, not solid); `clearAlso` circles; `overWater` (skips the on-land guardrail). Heights are measured from the top surface, so from the water for the bridge.
- Solids now have bottoms for collision and the terrain warning (§4.3). In the top view, what the plane is under is drawn again over it at 0.6.
- **City Hall:** about 59 x 57 world, turned 9 degrees to the street grid, open courtyard, tower on the north side with the statue about 56 up.
- **Art Museum:** about 80 x 48 world, opening southeast, roofs about 12 up, with the forecourt, steps and flag poles. Stands on its own hill, 5 up (15 m real), part of the landmark and solid: sloping sides, stone steps and grass terraces in front. The terrain of the map is unchanged (its elevation samples are too coarse to show Fairmount).
- **Bridge:** on the highway over the drawn river. Towers 124 world apart and about 39 tall, deck underside 14, top 17, anchorages 240 apart, approaches stepping down over another 80 each side. The towers stand in the water near the banks, so the proportions are the drawn river's, not the real bridge's.
- Flying very low over water still sets off the terrain warning (ground within 10 m), also under the bridge; the deck itself does not.
- In the side view, wires are drawn over solids that stand in front of them.

**Seen:** all three from above and from the side, and the plane marker under the deck from above, by rendering the landmark layers alone; the game loads with a clean console. **Not checked:** flown by hand (including under the bridge), in the running game's views, frame timing.

**The three skyscrapers built** (the rest of E6.5), from your pictures: One Liberty Place (about 96 up), Two Liberty Place (86), Comcast Technology Center (114), turned to the street grid. The side view now paints landmarks farthest first. `npm run typecheck` and 786 tests pass; ordinary buildings 16,353.
- Ordinary Center City buildings are limited to 80 world (district heights 30 to 240 m real, was 300), under all three towers (86 to 114). The range was narrowed, so many are a little lower than before, not only the tallest.
- The diagonal braces on the Technology Center are left out.
**Seen:** the towers from above and from the side, and the museum's hill, by rendering the landmark layers alone; clean console. **Not checked:** flown by hand, in the running game's views, frame timing.

**Performance** (after all ten were built). As first built, nothing skipped far landmarks: a terrain warning check cost about 9 ms anywhere on the map (run in the step and again for the display), and the top view about 8 ms with none on screen. Now collision looks only inside each landmark's and solid's box, and both views skip landmarks out of sight; top-view shadows are worked out once. `npm run typecheck` and 790 tests pass. Timed piece by piece in the browser (dev server, 960 x 540, forced readback), not in live flight:

| ms | Away | At City Hall |
|---|---|---|
| Terrain warning check | under 0.6 | under 0.1 |
| Top view | under 0.1 | about 6 |
| Side view | about 0.1 | about 3 |

With 100 landmarks (copies spread over the map) the figures near one are about the same. With 500, the side view is 6 to 12 ms and the warning about 2 ms. The landmarks in view are drawn afresh each frame; saving their pictures is the next step if that becomes too slow.
