# A4 Implementation Plan: One airport overlay with an angled runway

**Status:** PLAN, for review. Nothing built.
**Milestone (ARCHITECTURE.md §14):** "Runway is clean in the top view and correct in the side view."
**Starting state:** A3 is committed (`7010fb1`). 64 tests pass. The test map has a hand-flattened level area (x 1810-3320, y 700-1210, 30 m real) waiting for a runway.

All numbers are provisional.

## 1. Scope

**In:** an airport definition in real meters, a fine surface grid, exact runway objects, overlay lookup inside the existing height and surface accessors, edge blending, load-time validation, runway drawing in both views, readouts, and tests.

**Out:**

| Left out | Where it belongs |
|---|---|
| Takeoff, landing and touchdown logic | C4, C5 |
| Taxi graph, hold-short points, gates | G4 |
| Buildings and sprites | G4, H2 (needs side-view corridor objects) |
| Geographic distance scale, real coordinates | E1 |
| Water inside an airport (DCA sits on a river) | E2 |
| Second airport | E3 (the code takes a list; A4 ships one) |
| Airport files on disk, image import | E2 |
| Sloped or uneven runways | When a real airport needs one |

## 2. The airport

Invented: ident `TST`, "Test Field", anchored at world (2560, 955).

Layout is authored in **local real meters** (x east, y north, from the anchor). `buildAirport` converts it once: divide by `airport` scale, add the anchor. This means airport data never needs rewriting when scales are tuned.

`ScaleConfig` gains `airport: 2`. `geoDistance` still waits for E1.

| Part | Real local meters | World |
|---|---|---|
| Boundary | x -1400..1400, y -490..490 | x 1860..3260, y 710..1200 |
| Blend band, inside the boundary | 80 wide | 40 wide |
| Field elevation | 30 (real altitude; divided by `altitude`, not `airport`) | 3 |
| Runway 07/25 | (-987, -359) to (987, 359), 45 wide | about 1,050 x 22.5 m |
| Taxiway | (-990, -264) to (0, 96), 24 wide | 45 m left of the runway, 12 m wide |
| Connector to the 07 end | (-959, -349) to (-990, -264), 24 wide | 12 m wide |
| Apron link | (0, 96) to (0, 250), 24 wide | 12 m wide |
| Apron | x -200..200, y 250..410 | 200 x 80 m |

- The runway bears **070**, so it is clearly diagonal to the grid. A runway this long at a steeper angle would not fit the 510 m tall level area.
- Runway endpoints are the stored truth. Length, heading and direction are derived, so they cannot disagree.
- Taxiway strips extend half a width past each end, so joints have no notch.
- Everything paved sits inside the blend band, on flat ground.

## 3. Data model

```ts
// src/sim/world/airport.ts - geometry and construction; imports no grid code
interface Runway {                    // WORLD meters
  readonly a: Vec2; readonly b: Vec2; // thresholds
  readonly width: number;
  readonly names: readonly [string, string]; // ['07', '25']: landing from a, from b
  readonly length: number;            // derived
  readonly heading: number;           // derived, a -> b, radians clockwise from north
}
interface Airport {
  readonly ident: string; readonly name: string;
  readonly minX: number; readonly minY: number;
  readonly maxX: number; readonly maxY: number;  // WORLD, axis-aligned
  readonly blend: number;                        // WORLD m
  readonly fieldElevationM: number;              // REAL m
  readonly cellSize: number;                     // WORLD m, 2
  readonly cols: number; readonly rows: number;  // 700 x 245
  readonly surface: Uint8Array;                  // Terrain codes; row 0 south
  readonly runways: readonly Runway[];
}
```

- **Fine grid:** 2 m cells, 171,500 bytes. Filled with grass, then each paving shape is painted into the cells whose center lies inside it. Runways are **not** painted into it.
- **Terrain codes:** add `runway: 10` and `taxiway: 11`; the existing `airport: 9` becomes the apron. Existing numbers do not change. Each new code needs a name and a color.
- **`WorldGrid` gains `airports: readonly Airport[]`;** `createGrid` sets `[]`. `withAirports(grid, list)` validates and returns a copy sharing the same arrays. Accessor signatures do not change, so `sliceAlong` and both views pick up the overlay without edits.
- `buildTestMap` stays base terrain only; `main.ts` attaches the airport.

**Deliberate simplification:** ARCHITECTURE.md §7.2 gives the fine grid its own elevation layer. A4 uses one field elevation, because the first airport is flat. A per-cell layer can be added behind `groundAt` later.

## 4. Lookup

Order, from ARCHITECTURE.md §7.2: runway object, then fine grid, then base grid.

| Accessor | Inside an airport boundary |
|---|---|
| `surfaceAt` | `Terrain.runway` if inside a runway rectangle, else the fine cell |
| `groundAt` | `base + (field - base) * w` |
| `waterLevelAt` | NaN (dry); validation guarantees the base is dry there |
| `heightAt` | No change; it already calls the two above |
| `elevationAtCell`, `waterLevelAtCell` | Stay base-only; commented as such |

- **Blend:** `d` is the distance to the nearest boundary edge; `w = smoothstep(d / blend)`. It is 0 at the boundary and 1 across the interior, so the ground is continuous and the runway is exactly flat.
- **Runway test:** `runwayFrame(rw, x, y)` returns `along` (0 at `a`) and `across` (right positive). On the runway when `0 <= along <= length` and `|across| <= width / 2`. C4 and C5 reuse it for centerline and touchdown.
- `runwayAt(grid, x, y)` returns the airport and runway, or null.
- A bounding-box check comes first, so points away from airports cost almost nothing.

**Validation** (throws with the airport ident): boundary inside the map; boundaries do not overlap each other; runways and paving inside the flat interior; base dry within the boundary; runway names match headings (nearest 10 degrees) and are reciprocal; `blend > 0`.

## 5. Top view

Order: terrain, airport patch, runways, slice line, overlays.

- **Patch:** the fine grid is baked to one canvas per zoom level, by sampling the surface at each screen pixel's center, then drawn 1:1. Scaling a 2 m grid with nearest-neighbor to 1.25 or 2.5 m/px would give uneven edges and dropped columns. Baked on first use and cached; largest about 1120 x 392. Pixels outside the boundary are transparent.
- **Colors** use the same elevation tint as the terrain, so the grass edge is not visible.
- **Runway:** a filled polygon from exact corners, over the patch. Minimum drawn width 2 px, so it stays visible at 40 m/px, where the true width is 0.6 px.
- **Alignment:** terrain is drawn from a map origin rounded to whole pixels. The patch and runway must use **that same rounded origin**, or they will slide by a pixel against the ground while panning.

| Zoom (m/px) | Drawn |
|---|---|
| 40, 20 | Runway bar, ident label |
| 10, 5 | Patch, runway, ident label |
| 2.5 | Plus threshold bars and dashed centerline |
| 1.25 | Plus runway numbers, rotated to read when approaching |

Markings are at least 1 px wide. Dashes are 15 m on, 10 m off (world).

**Readout:** on a runway, the surface name becomes `runway 07/25 TST`.

## 6. Side view

- The runway arrives through `surfaceAt`, as a dark surface layer at the exact columns the slice crosses, with a 1 px white line on top so it stands out.
- **Span label:** `runwaySpan(rw, origin, heading)` clips the slice line against the runway rectangle and returns the entry and exit distances, or null. The view draws a short post at each end and the label `07/25`. This is independent of the sampling, so it also checks it.
- A slice that crosses at an angle shows a short strip. That is correct, not a bug: 22.5 m is 2-3 columns at 10 m/px and 18 at 1.25.
- The hazy side layers show paving too, hidden by the main profile over flat ground. Accepted.
- The readout uses the same runway name as the top view.

## 7. Files

| File | Change | Purpose |
|---|---|---|
| `src/sim/world/airport.ts` | new | Types, `buildAirport`, `runwayFrame`, `runwaySpan`, blend weight |
| `src/sim/world/placeAirports.ts` | new | `withAirports`, validation |
| `src/sim/world/testAirport.ts` | new | The definition in §2 |
| `src/sim/world/grid.ts` | edit | `airports`; overlay in accessors; `runwayAt` |
| `src/sim/world/terrain.ts` | edit | Two codes and names |
| `src/config/scales.ts`, `src/config/palette.ts` | edit | `airport` scale; colors |
| `src/views/airportLayer.ts` | new | Patch baking, runway polygon, markings |
| `src/views/terrainColors.ts` | edit | Export the elevation tint |
| `src/views/topView.ts`, `src/views/sideView.ts` | edit | Layer, labels, readouts |
| `src/main.ts` | edit | Attach the airport |
| `tests/` | new | `airport`, `placeAirports`, `airportLayer`; extend `grid`, `slice` |

`airport.ts` does not import `grid.ts`, which avoids an import cycle. No new dependencies.

## 8. Steps

Each step leaves the page working.

1. **Geometry:** airport types, `runwayFrame`, `runwaySpan`, `buildAirport`, scale and codes, with tests. Nothing visible.
2. **Lookup and validation:** accessors, `withAirports`, test airport attached. The runway strip appears in the side view.
3. **Top view patch and runway polygon,** sharing the rounded origin.
4. **Markings and labels** by zoom.
5. **Side view** white line, span posts and label; both readouts.
6. **Verify (§9), then update documents:** results here; ARCHITECTURE.md §7.2 (single field elevation), §16 (next is B1).

## 9. Verification

**Automated**

| Area | Tests |
|---|---|
| Runway frame | Ends, center and corners; just inside and just outside every edge; left and right sign at headings 0, 90 and 070; reversed endpoints swap along and across |
| Build | Real to world (2100 m to 1,050 m); anchor applied; elevation not divided by `airport`; heading 070; 07 and 25 |
| Fine grid | Apron, taxiway, link and grass at known points, including points that would be wrong if rows were flipped |
| Lookup | Runway beats fine grid beats base; no change outside the boundary; a map with no airports matches the old results |
| Blend | On a synthetic map with different base and field heights: equals base at the boundary, field in the interior, monotonic between, no jump across any edge; no NaN |
| Span | Along, across at 90 degrees (22.5 m), oblique, missing, parallel outside, origin on the runway; agrees with `sliceAlong` samples to one column |
| Slice | From the 07 threshold along 070: runway for about 1,050 m, constant 3 world m, then not runway |
| Validation | Each rule rejects a bad airport; the test airport passes |
| Layer | Baked pixel matches `surfaceAt` at its center for every zoom; transparent outside |

All 64 existing tests, boundaries, typecheck and build must also pass.

**Manual, in the browser pane**
- Runway edges are straight, with no stairs, at every zoom. No hairline at the patch border.
- Panning slowly: the runway does not shimmer against the ground.
- Click the 07 threshold and drag the side view 50 px right (045 to 070): the runway fills about 1,050 m ahead, flat.
- Turn to cross it at 160: a short strip at the right distance. Hover it: the top-view dot is on the runway and both readouts agree.
- The numbers read correctly from each approach end.
- The town, lake, river and peak look unchanged.
- No console errors. Side redraw still under 4 ms.

## 10. Decisions

**Recommended defaults; say so if you want any changed:**

1. **Author in real meters with an `airport: 2` scale now,** rather than in world meters until E1.
2. **One field elevation,** rather than a fine elevation layer.
3. **Airports live on `WorldGrid`,** rather than a new `World` type that every call would have to adopt.
4. **Runway 07/25, 2,100 x 45 m real,** with one taxiway and one apron, so the fine grid has something to show.
5. **Anti-aliased runway polygon,** rather than pixel-stepped edges; revisit in H1.
6. **Axis-aligned boundary.** Rotated boundaries only if a real airport needs one.

## 11. Risks

| Risk | Response |
|---|---|
| Fine grid upside down or mirrored | Asymmetric layout (paving only to the north and west); point tests; linked hover |
| Patch shimmers against terrain | Shared rounded origin; slow-pan check |
| Height step at the boundary | Continuity test on uneven synthetic ground; the test map alone would hide it, as it is already flat at 30 m |
| Airport and altitude scales mixed up | Distinct names, unit comments, build test |
| Runway hard to see in the side view (3 world m is about 1 px above sea at 2.5 m/px) | Dark layer, white line, end posts |
| Views read raw base arrays and miss the overlay | Only `terrainColors` does, and the patch covers it there |

## 12. Done when

An angled runway is clean in the top view at every zoom, the side view shows it at the right place, length and height, and typecheck, tests and build pass.

**Next:** B1, fixed-step loop and keyboard input.

## 13. Results

**Status:** BUILT. Typecheck, build and 100 tests pass (64 before; 36 new).

- Built as planned in sections 2-8. New files: `airport.ts`, `placeAirports.ts`, `testAirport.ts`, `airportLayer.ts`, `surfaceName.ts`.
- Checked in the browser pane: runway diagonal and clean at 5, 2.5 and 1.25 m/px, with taxiway and apron in the right (north-west) places; dashed centerline and numbers at close zoom; side view shows the runway strip, end posts and the `07/25` label; both readouts say `runway 07/25 TST`; no console errors.
- Not done by eye: slow-pan shimmer check, side redraw timing, and an exact 070 slice (the unit test covers it: about 1,050 m, constant 3 world m).
- Deviations: `Terrain.airport` is now named `apron`; the `bakePatch` test compares against the fine grid, since `surfaceAt` returns `runway` where the polygon is drawn over it.
- Added helpers: `onRunway`, `airportAt`, `fineSurfaceAt`, `runwayNumber`.
