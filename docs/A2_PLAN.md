# A2 Implementation Plan: Small hand-made grid, drawn in the top view

**Status:** BUILT (2026-11-23). See �12 for results and deviations.
**Milestone (ARCHITECTURE.md §14):** "Land, water and mountains are visible; map pans and zooms."
**Starting state (before A2):** A1 is committed (`3b653f8`). Top, side and instrument canvases show placeholders. There is no loop, input or world code.

All numbers are provisional.

## 1. Scope

**In:** the grid data structure, one hand-made map, `surfaceAt` and `heightAt`, top-view drawing with cached chunks, drag to pan, wheel to zoom, a small cursor readout, tests, and an A1 scaling fix (§2).

**Out:**

| Left out | Where it belongs |
|---|---|
| `sliceAlong`, side view drawing | A3 |
| Airport overlay, fine grid, runway objects | A4 |
| Game loop, keyboard, pause | B1 |
| Follow camera, automatic zoom, heading-up | B2 and later |
| Binary chunk files, loading by distance, image import/export | E2, when real data exists |
| Latitude/longitude, projection, `geoDistance` | E1 |
| Labels, cities as objects, thin roads | Later; they are objects, not grid cells |
| 16-bit tiles and edge tiles | H1 and H2; A2 uses flat colors plus shading |

## 2. Fix first: A1 canvases drop to 1x at DPR 1

A1 was checked only at a device pixel ratio (DPR) of 1.25. Measured now, the 2 px grid gap leaves each view slightly too small for the next whole scale:

| Window | View panel | Scale at DPR 1 | Intended |
|---|---|---|---|
| 1280 x 720 | 639 x 399 | **1x** | 2x |
| 1920 x 1080 | 959 x 599 | **2x** | 3x |

A map at 1x in a quarter of its panel is hard to judge, so this comes first.

- Set the grid `gap` to 0. Draw each panel border as a `::after` overlay with an inset shadow and `pointer-events: none`, so it takes no layout space and does not block dragging.
- Leave `fitScale` unchanged; it is correct.
- Add a comment beside the CSS grid saying that the exact sizes matter.

At 1280 x 720 and DPR 1.5, 2x becomes 3x as well. Correct A1_PLAN.md §11 when this is done.

## 3. World data

### 3.1 Grid

```ts
// src/sim/world/grid.ts
interface WorldGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;         // world meters, 10
  readonly elevation: Int16Array;    // REAL meters above sea level
  readonly terrain: Uint8Array;      // Terrain code
}
```

- **Index:** `row * cols + col`. Column 0 is west, **row 0 is south**, so row increases with world y (north). Only the renderer flips y.
- **Origin:** world (0, 0) is the southwest corner of cell (0, 0). Its center is (5, 5).
- **Size:** 512 x 512 cells, 5.12 x 5.12 km, four chunks of 256 x 256. That is about 0.8 MB, exercises chunk borders, and leaves room for phase C circuits. One chunk (2.56 km) would be cramped: it holds a 1 km runway and little else.
- **Terrain codes:** explicit numbers for all ten types in §7.1, as a `const` object, not a TypeScript `enum`. They will be written to files later, so they must not change.

### 3.2 Queries

| Function | Rule |
|---|---|
| `surfaceAt(grid, x, y)` | Nearest cell: `floor(x / cellSize)`. Outside the map: water |
| `heightAt(grid, scale, x, y)` | Bilinear between cell **centers**, divided by `scale.altitude`; returns **world** meters. Outside the map: 0 |

- The map is surrounded by at least 4 cells of sea at elevation 0, so height is continuous at the edge and "outside is water" matches what is drawn.
- `src/config/scales.ts` gets a `ScaleConfig` with `altitude: 10` only. E1 adds the other two fields when something uses them.
- **Units:** names carry the unit (`elevationRealM`, `heightWorldM`). Branded types are deferred until displayed units appear in B4.

### 3.3 The hand-made map

Built by code in `src/sim/world/testMap.ts` from shapes with hand-chosen coordinates. There are no random numbers, so it is always identical. No binary file or editor is needed yet.

```text
 N
 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 ~~~   forest        /\ /\    ~~     mountains, NE: peak about 1,800 m real,
 ~~  forest  forest /\/S\/\    ~     snow above 1,400 m
 ~~    (lake)     /\ /\ /\    ~~
 ~~~      \__river___/        ~~     river: mountains to west coast, via lake
 ~~~  farm   farm    desert   ~~
 ~~   URBAN ===road=== farm  ~~~     road 2 cells wide; small town
 ~~~    flat grass for A4     ~~     level 1.5 km area for the runway
 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
```

Build order, later steps painting over earlier ones: coast -> base land rising gently inland -> hills and ridge -> lake and river (carved, so water sits below its banks) -> terrain by height -> farmland, desert, town -> road.

- The river is 4 cells wide so it survives zooming out.
- A 1,800 m peak is 180 world meters. Spread over about 1 km, it makes a clear slope for A3.
- The level area (about 1,500 x 500 world m, constant elevation) gives A4 and C4 a place to work.
- `airport` is the only code not used.

## 4. Top view

### 4.1 Camera

```ts
// src/views/camera.ts - pure, no DOM
interface Camera { x: number; y: number; zoom: number }   // center in world meters; zoom = index into levels
```

- **Zoom levels (world meters per internal pixel):** 40, 20, 10, 5, 2.5, 1.25. The start is 10, or one cell per pixel (3.2 x 2 km visible). At 20 the view is 6.4 x 4 km; at 40 the whole map is visible; at 1.25 a cell is 8 px. Regional levels come with E2.
- **Pure functions:** `worldToScreen`, `screenToWorld`, `panBy(dx, dy)`, `zoomAt(cursor, steps)` and `clampToMap`.
- `zoomAt` keeps the world point under the cursor fixed, except where clamping applies.
- Clamping keeps the camera **center** inside the map, so some map is always visible.

Stepped levels keep cells a whole number of pixels, or a whole number of cells per pixel, so nothing shimmers.

### 4.2 Drawing

1. **Color pass** (`terrainColors.ts`, pure): converts one chunk to RGBA bytes, one pixel per cell. Base color by terrain, then hillshade from the elevation slope, lit from the northwest and quantized to 5 steps so it looks like pixel art. Water is not shaded. Slopes are read from the **whole grid**, not the chunk, so there are no seams.
2. **Reduced copies** for 20 and 40 m/px: each averages 2 x 2 pixels of the level above. Plain nearest-neighbor reduction would make roads and rivers flicker while panning. Averaging produces off-palette colors, which is fine until H1.
3. **Chunk cache** (`topView.ts`): each chunk and level becomes an offscreen canvas, built on first use. All levels for four chunks total about 1.4 MB.
4. **Draw:** fill with sea color, then `drawImage` for visible chunks with smoothing off. Round the map origin to a whole pixel **once**, then place chunks at whole-pixel offsets from it. Rounding each chunk separately would open seams.
5. **Overlays:** a north marker and a scale bar. The bar is labelled in **world** meters and says so, because displayed distance does not exist until E1.

The palette lives in `src/config/palette.ts`, as placeholder colors.

### 4.3 Input

- **Drag** (pointer events with capture, primary button) pans, so the map follows the cursor.
- **Wheel** zooms at the cursor. Accumulate `deltaY` to a threshold (about 100 px, normalizing `deltaMode`), so a trackpad does not jump through levels. Call `preventDefault` so the page does not scroll below its minimum size. Leave Ctrl+wheel to the browser.
- Cursor positions are converted from CSS to internal pixels using the canvas's bounding rectangle, so they are right at any DPR.
- No keys: keyboard input is B1, where W/A/S/D are flight controls. B2's follow camera replaces free panning as the default.

### 4.4 Cursor readout

A line at the bottom of the canvas, such as `x 2310 y 1875 forest 240 m real / 24 m world`, uses `surfaceAt` and `heightAt`. It is the quickest check that the picture and the data agree. It is drawn in the top view only, and moves to the debug panel in B4.

## 5. Wiring and redraw

- `panels.ts` takes a draw function per panel: `initPanels({ top: drawTop })`. Panels without one keep the A1 placeholder. `setupPanel` returns the canvas and a `requestDraw()`.
- `requestDraw()` sets a flag and schedules at most one `requestAnimationFrame`. There is no continuous loop; B1 adds it.
- `main.ts` builds the test map, camera and top view, then connects input.
- `sim/` must not import from views, app, input or the browser. A test enforces this by reading `src/sim/**` through `import.meta.glob` with `?raw`, and checking import paths and the names `document` and `window`.

## 6. Files

| File | Change | Purpose |
|---|---|---|
| `src/styles.css` | edit | §2 fix; grab cursor |
| `src/config/scales.ts` | new | `ScaleConfig` (altitude only) |
| `src/config/palette.ts` | new | Terrain colors |
| `src/sim/world/terrain.ts` | new | Terrain codes and names |
| `src/sim/world/grid.ts` | new | Grid type, `surfaceAt`, `heightAt` |
| `src/sim/world/testMap.ts` | new | Hand-made map |
| `src/views/camera.ts` | new | Pure camera math |
| `src/views/terrainColors.ts` | new | Color pass and 2 x 2 reduction (pure) |
| `src/views/topView.ts` | new | Chunk cache, drawing, overlays |
| `src/input/mapPointer.ts` | new | Drag and wheel to camera changes |
| `src/app/panels.ts`, `src/main.ts` | edit | Draw functions and wiring |
| `tests/` | new | `grid`, `testMap`, `camera`, `terrainColors`, `boundaries` |

No new dependencies.

## 7. Steps

Each step leaves the page working.

1. **Scaling fix** (§2). Check 2x at 1280 x 720 and 3x at 1920 x 1080 for DPR 1.
2. **Grid and queries**, with tests.
3. **Test map**, with tests.
4. **Camera math**, with tests.
5. **Color pass**, with tests.
6. **Panel refactor and first drawing:** the map appears at the starting zoom.
7. **Pan and zoom.**
8. **Readout, scale bar, north marker.**
9. **Internal resolution check** (§9), then update the documents: results here, the A1 correction, and ARCHITECTURE.md §15 and §16.

## 8. Verification

**Automated**

| Area | Tests |
|---|---|
| Grid | Cell index and orientation (row 0 south); height exact at cell centers, halfway between two, and divided by 10; continuous across a chunk border; outside is water and 0; negative coordinates and the exact far edge do not read past the array; NaN input is handled |
| Map | Two builds are identical; sea border at elevation 0; all codes except `airport` present; peak in range; river connects mountain to sea; level area is constant |
| Camera | World/screen round trip at every zoom; north is up; zoom keeps the cursor point fixed; clamped at edges; zoom stops at both ends |
| Colors | Adjacent chunks match a whole-map render at their border; northwest slopes are brighter than southeast ones; water unshaded; north row is written first; reduction gives the mean |
| Boundaries | `sim/` imports nothing forbidden |

Typecheck and build must also pass.

**Manual, in the browser pane**
- Land, water and mountains are recognizable without reading the readout.
- Dragging across chunk borders shows no seams or shimmer at any zoom level.
- Wheel zoom keeps the point under the cursor; the page does not scroll.
- The readout matches the picture at sea, lake, peak, town and all four corners.
- A drag that leaves the canvas continues and ends cleanly.
- Crisp pixels at DPR 1, 1.25 and 1.5, with no console errors.
- First draw of a chunk is under about 20 ms and a redraw under 4 ms. This is an early indication only; B2 is the real measurement.

## 9. Decisions

**Recommended defaults; say so if you want any changed:**

1. **Map made by code**, rather than a painted image. Image import is deferred to E2, where painting over real data becomes useful. If you would rather paint this map yourself, PNG import would move into A2, at the cost of about one extra step.
2. **512 x 512 cells** (5.12 km square).
3. **Stepped zoom**, rather than smooth.
4. **Flat colors with stepped shading**, rather than tiles.
5. **Invented island**, rather than a real place, since DCA-ORD arrives in E2.

**Settled during A2 (ARCHITECTURE.md §15):** internal resolution. Keep 320 x 200 unless the map looks too coarse. The alternative to try is 640 x 360 at 1x for this panel (one constant), compared by screenshot. H1 makes the final choice.

## 10. Risks

| Risk | Response |
|---|---|
| y-axis mix-up between world, array and screen | One flip, in the color pass and camera only; orientation tests |
| Real and world meters confused | Names carry units; one function divides by the altitude scale |
| Mountains do not read as mountains | Shading strength and snow line are constants; tune in step 6 |
| A code-made map is thrown away at E2 | Expected. Keep it small; it remains useful as a test fixture |
| `testMap.ts` grows into a terrain generator | Hand-placed shapes only, about 150 lines |

## 11. Done when

Land, water and mountains are visible in the top view, the map pans and zooms, and typecheck, tests and build pass.

**Next:** A3, a side view of the same grid. It reuses `heightAt` and adds `sliceAlong`.

## 12. Results (2026-11-23)

- All steps built. Typecheck, 34 tests and the build pass.
- **Scaling fix:** grid gap set to 0 with `.panel::after` borders. Checked in the browser pane at 1280 x 720 (DPR 1.25): 2x, no page scroll. The DPR 1 sizes in �2 were calculated, not re-measured.
- **Browser checks done:** the island renders (sea, forest, farmland, desert, town, lake, river, mountains); wheel zoom and drag pan work; readout follows the cursor; no console errors.
- **Not yet checked by eye:** seams while dragging across chunk borders at every zoom, DPR 1 and 1.5, draw timings, and the corner and peak readouts. Automated tests cover chunk-border color matching and height continuity.
- **Internal resolution:** the top view was raised to 640 x 360 (text was too hard to read at 320 x 200), with 12 px text and a default zoom of 5 m per pixel. Side view and instruments stay 320 x 200 until A3 and later. H1 makes the final choice.
- Hillshade strength (`SHADE_GAIN`), the snow line and palette colors are constants to tune.
- Hand-made map: coordinates are in `TEST_MAP_LANDMARKS` (`testMap.ts`), used by the tests.
- **Elevation cues (after review):** an oblique parallax shift was tried and removed; it showed no useful depth on smooth, flat-colored terrain. The color pass now uses exaggerated hillshade (`SHADE_EXAGGERATION`, shading only), lighter and warmer 100 m elevation bands, and 100 m contour lines. Aircraft shadow and relative-altitude coloring are left for B2 and later.
