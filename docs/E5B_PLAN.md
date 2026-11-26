# E5B Implementation Plan: Neighborhood Density

**Status:** E5B.1 to E5B.3 built. Uncommitted.
**Goal:** neighborhoods from exurb to rowhomes look different from the air, and dense ones show a street grid. No roads are drawn for it.
**Starting state:** E5 built ([E5_PLAN](E5_PLAN.md)), uncommitted.

All numbers are provisional, in world meters unless noted.

## 1. Scope

| In | Out |
|---|---|
| `suburb` and `residential` become one district type, `housing`, with `density` 1 to 5 | Drawing local streets; diagonal avenues |
| Layout per level: footprint shape, gaps, blocks, nudge, lot fill | Building heights and the height scale (kept, §5) |
| No nudge in `downtown`, for a straight grid | Downtown sizes and cover; industrial; park |
| Density and street angle per existing district | New or reshaped district outlines |

## 2. Why

- The suburbs are set to 6% roof cover (5% built), which is nearer exurb than suburb.
- Streets are hidden: each building is nudged anywhere within its lot, and about a quarter of residential lots are empty, so random gaps are as large as the 10 m streets.

## 3. Behavior

### 3.1 Levels

"Along" and "across" are relative to the district's street heading. "Nudge" is the share of the free room in a lot a building may move by. "Fill" is the share of lots built. "Block" is lots along x across between streets. Cover is what the other numbers should give before footprints are rejected at edges and highways.

| Density | Reads as | Along | Across | Lot gap | Street | Block | Nudge | Fill | Cover |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Exurb | 12 to 15 | 12 to 15 | 12 | 10 | 4 x 2 | 1.0 | 20% | 4% |
| 2 | Outer suburb | 12 to 15 | 12 to 15 | 12 | 10 | 4 x 2 | 0.6 | 65% | 12% |
| 3 | Inner suburb | 12 to 16 | 10 to 14 | 6 | 10 | 4 x 2 | 0.3 | 75% | 21% |
| 4 | City neighborhood | 14 to 22 | 10 to 12 | 2 | 10 | 4 x 2 | 0.15 | 85% | 33% |
| 5 | Rowhomes | 14 to 16 | 9 to 10 | 1 | 10 | 2 x 4 | 0 | 95% | 44% |

- Nudge falls as density rises, so dense areas become a regular grid and sparse ones stay loose.
- Level 5 uses thin footprints, 2 x 4 to a block: four homes side by side sharing long walls, two back to back, each with its short end on a street. (Changed after the trial: first 28 to 34 m long at 2 x 2, then 4 x 2, which stacked homes end to end.)
- Fill is set directly for `housing`; cover follows and is reported. `downtown` and `industrial` keep `coverage`.

### 3.2 Starting assignments

| District | Density | District | Density |
|---|---|---|---|
| `dc-suburbs`, `phl-suburbs` | 2 | `dc-capitol-hill`, `phl-north`, `phl-south` | 5 |
| `dc-anacostia`, `dc-arlington` | 3 | `dc-north`, `dc-georgetown`, `phl-west`, `phl-camden-homes` | 4 |

Neighboring districts have different `streetDeg` values so their grids meet at an angle: `dc-suburbs` 15, `dc-anacostia` 38, `dc-arlington` -12, `phl-suburbs` -6, `phl-camden-homes` -8; the other DC districts stay 0 and the other Philadelphia ones 9.

### 3.3 What stays the same
- **Ground codes and colors:** density 1 to 3 paints `suburb` (14), 4 and 5 paint `residential` (13). No code is added or renumbered.
- **Map file:** the building record and its style index are unchanged (4 and 5 store the residential index, 1 to 3 the suburb one), so the loader, drawing and collision need no change.

## 4. Files

| File | Change |
|---|---|
| `data/map/districts.json` | `types.housing` holds the five levels; districts use `housing` with `density` |
| `tools/map/types.ts`, `validate.ts` | New type and level fields; density must be 1 to 5 |
| `tools/map/districts.ts` | Ground code from density |
| `tools/map/buildings.ts` | Separate along and across sizes and lot pitch; per level gaps, block, nudge, fill |
| `tools/build-map.mjs` | Report count and cover per level |
| `tests/mapDistricts.test.ts`, `mapBuildings.test.ts` | New data form; nudge 0 gives straight rows; cover rises with density |
| `public/maps/mid-atlantic.bin` | Rebuilt |
| `docs/CURRENT.md` | Describe the levels |

## 5. Decisions

| Decision | Why |
|---|---|
| 1 to 5, not 1 to 10 | Neighboring steps of ten would not be told apart from the air |
| `downtown` stays its own type | It differs in height, shape and roofs, not only density |
| Heights stay at 1:3 | The look works; the altimeter (1:5) reads roofs about 1.7x their real height, accepted |

## 6. Steps

Each code step ends with `npm run typecheck`, `npm test` and a look in the browser.

| Step | Work | Done when |
|---|---|---|
| E5B.1 | Level data, validation, generator; existing districts mapped to levels | Tests pass; two builds give identical bytes |
| E5B.2 | Trial look: `phl-south` at 5 and `phl-west` at 3 beside their neighbors | You have judged both and the table is adjusted |
| E5B.3 | All assignments, street angles, rebuild, measure | Both cities checked; costs recorded |

## 7. Verification

| Check | Expectation |
|---|---|
| Placement and clearance | E5 guardrails still pass; both finals stay clear |
| By eye | Levels differ; street grid visible at 2.5 and 1.25 m/px in levels 4 and 5 |
| Count | Reported per level. Estimate: 12,000 to 15,000, from 7,434 |
| Cost | File size, load time and top-view frame time over both cities, before and after |

## 8. Risks

| Risk | Response |
|---|---|
| More buildings slow loading or tile baking | Measure; lower fill or cover, or lengthen footprints |
| Long rowhomes are often rejected at district edges and highways, leaving ragged borders | Allow a shorter footprint where the full one does not fit |
| A perfect grid looks mechanical | Keep a little fill below 100%; vary street angles |
| 10 m streets vanish when zoomed out | Widen the street at level 5 |
| District rectangles still show as hard edges | Later: more outlines with neighboring densities |

## 9. Results

**E5B.1 built.** `types.housing` holds the five levels as in §3.1; every suburb outline became density 2 and every residential one 4. `npm run typecheck` and the tests pass (751). Two builds gave identical bytes, 13,606 buildings, all guardrails ok.

Added beyond the plan:
- **Later districts keep their ground.** A building may not reach into a district listed later. Levels 1 to 3 share a ground code, so without this the suburb ring would fill the gaps inside a level 3 district.
- `nudge` is also a field of `downtown` (0) and `industrial` (1).
- Heights per level: 1 to 3 keep the old suburb 6 to 9 m, 4 and 5 the old residential 8 to 15 m. So a district moved from residential to 3 (Anacostia, Arlington, and `phl-west` in the trial) also gets lower.

**E5B.2 first trial** (`phl-south` 5, `phl-west` 3, the rest as above, level 5 at its first values): 13,133 buildings, file 3.42 MB (E5: 7,434 and 3.26 MB).

| Density | Buildings | Cover planned | Cover built |
|---|---|---|---|
| 2 | 4,530 | 12% | 11% |
| 3 | 1,021 | 21% | 20% |
| 4 | 6,214 | 33% | 31% |
| 5 | 652 | 44% | 34% |

- Built cover is roof area over the district's own painted ground, highways included, sampled every 20 m.
- **Level 5 falls 10 points short.** In an open square it gives the planned cover (tested), so the loss is long footprints rejected at edges, highways and water (the second risk in §8). The shorter-footprint fallback is not built.
- **Seen** in the game at 1280 x 720: `phl-south` rows with a clear street grid at 5, 2.5, 1.25 and 0.5 m/px; `phl-west` at 3 a loose grid of houses; clean console.
**Level 5 revised on your feedback** (14 to 16 m long, 4 x 2 blocks): 13,944 buildings, file 3.45 MB, level 5 now 1,463 buildings at 36.5% cover (was 34%, planned 44%). Two builds gave identical bytes; typecheck and 751 tests pass; seen in `phl-south` at 2.5 and 0.5 m/px with a clean console. The cover is still short, so long footprints were only a small part of the loss; the rest has not been traced.

**Level 5 blocks turned on your feedback** (4 x 2 to 2 x 4): 14,007 buildings, file 3.45 MB, level 5 now 1,526 buildings at 38.1% cover (planned 44%). Two builds gave identical bytes; typecheck and 751 tests pass; seen in `phl-south` at 2.5 and 0.5 m/px with a clean console.

**E5B.2 accepted** (your go-ahead after the turned blocks).

**E5B.3 built.** The §3.2 assignments and the street angles above. Two builds gave identical bytes, all guardrails ok (12 roofs lowered under the approaches, none left out), typecheck and 751 tests pass.

| Density | Buildings | Cover planned | Cover built |
|---|---|---|---|
| 2 | 4,462 | 12% | 11% |
| 3 | 894 | 21% | 19% |
| 4 | 3,664 | 33% | 31% |
| 5 | 6,673 | 44% | 42% |

Level 5 is close to plan across its three districts, so the trial's shortfall was mostly particular to `phl-south`. The shorter-footprint fallback and a wider level 5 street were not needed.

**Cost**, E5 map against this one, same code, medians of 3 runs in the browser pane (rough; the city layer alone on a 640 x 400 canvas):

| | E5 | E5B |
|---|---|---|
| Buildings | 7,434 | 16,409 |
| File | 3.26 MB | 3.53 MB |
| Read the map file | 7 ms | 9 ms |
| Index obstacles | 4 ms | 8 ms |
| Bake the kept tiles at load | 274 ms | 1,098 ms |
| First frame over a city, 5 to 1.25 m/px | 5 to 12 ms | 5 to 30 ms |
| Frame with tiles baked | 0.1 to 0.2 ms | 0.1 to 0.2 ms |
| Worst frame while moving | 0.5 to 3 ms | 0.4 to 9 ms |

- **Load is about 0.8 s longer,** nearly all of it tile baking. Not acted on.
- **Seen:** in the game, DC downtown and Capitol Hill and central Philadelphia, clean console; both cities in the generator preview, including the angled grids.
- **Not checked:** whole page load time, side view cost with more buildings, frame timing in real flight, Arlington and Anacostia up close in the game.
