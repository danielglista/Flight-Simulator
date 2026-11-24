# A1 Implementation Plan: Project setup and empty four-panel layout

**Status:** BUILT AND VERIFIED (2026-11-23). Typecheck, 7 unit tests and production build pass; manual checks done in the browser pane (see §11). Not yet committed.
**Milestone (ARCHITECTURE.md §14):** "Page opens with both views, instruments and terminal areas."
**Starting state:** the folder held only `docs/`. There was no code.

## 0. Prerequisites (resolved)

- Node 26.13.1, npm 11.20.0 and git are now installed. npm is the package manager. The repo is initialised on `main` with no commits yet.
- Installed versions: Vite 8.3.8, TypeScript 7.0.2, Vitest 5.1.1 (recorded in `package-lock.json`).

## 1. Scope

**In:** tooling, strict TypeScript, a four-panel page, canvases that scale in whole numbers, placeholder drawing, a static terminal shell, one unit test.
**Out (later milestones):** the game loop (B1), any map data (A2), keyboard handling and pause-on-blur (B1), instruments (D), terminal behaviour (F), the pixel font and art (H).

Only the folders A1 needs are created (`src/app`, `src/config`, `tests`). `sim/`, `views/` and the rest appear when their milestones need them (goal 4: no structure before it is needed).

## 2. Layout

Four panels in a CSS grid, with the minimum window of 1280 x 720 as the reference.

```text
+----------------------+----------------------+
|  TOP VIEW   (canvas) |  SIDE VIEW  (canvas) |   row 1: 400 px at minimum size
+----------------------+----------------------+
|  INSTRUMENTS (canvas)|  TERMINAL   (HTML)   |   row 2: 320 px at minimum size
+----------------------+----------------------+
```

| Panel | Type | Internal size (provisional) | Scale at 1280 x 720 |
|---|---|---|---|
| Top view | canvas | 320 x 200 | 2x -> 640 x 400 |
| Side view | canvas | 320 x 200 | 2x -> 640 x 400 |
| Instruments | canvas | 320 x 160 | 2x -> 640 x 320 |
| Terminal | HTML | n/a (text, not scaled) | 640 x 320 |

- Columns are `1fr 1fr`. Rows are `5fr 4fr`, which gives 400 + 320 at minimum size.
- Below 1280 x 720 the page keeps its minimum size and scrolls, rather than shrinking the panels.
- The top and side views each use the 320 x 200 working default (§15). The instruments size is my proposal and is easy to change: it is one constant.

## 3. Pixel scaling

Each canvas has a fixed internal size. A pure function picks the largest whole-number scale that fits its panel:

```ts
fitScale(panelCssPx, internalPx, devicePixelRatio) -> { scale, cssWidth, cssHeight }
```

- Scale is calculated in **device pixels** (`floor(panelPx * dpr / internalPx)`), and the CSS size is set to `internal * scale / dpr`. On Windows displays set to 125% or 150%, scaling in CSS pixels would make some pixels wider than others.
- The scale never drops below 1. The canvas is centred in its panel, and any leftover space is a plain border colour.
- CSS uses `image-rendering: pixelated`. The 2D context turns off image smoothing.
- A `ResizeObserver` on each panel (the DPR is re-read on every resize) recomputes the size and redraws. There is no animation loop in A1.

## 4. Files

| File | Purpose |
|---|---|
| `package.json` | Scripts `dev`, `build`, `preview`, `test`, `typecheck`. Dev dependencies: `vite`, `typescript`, `vitest`. No runtime dependencies. |
| `tsconfig.json` | `strict`, plus `noUncheckedIndexedAccess` and `noUnusedLocals`. Target ES2022, bundler module resolution, DOM lib. |
| `vite.config.ts` | Minimal. Includes the Vitest config. |
| `.gitignore` | `node_modules`, `dist`, `.env`, `.env.*`. The `.env` entry covers the key for F7. |
| `index.html` | Four panel elements, a `<canvas>` in each canvas panel, and the terminal markup. |
| `src/styles.css` | Grid, colours, panel borders, terminal look. Uses CSS variables so the palette can change in one place. |
| `src/config/display.ts` | Panel names and internal canvas sizes, plus the minimum window size, as typed constants. |
| `src/app/scaling.ts` | `fitScale`, pure and DOM-free so it can be tested. |
| `src/app/panels.ts` | Finds each panel, attaches the `ResizeObserver`, applies the scale, and calls the placeholder draw. |
| `src/main.ts` | Entry point: builds the panels and nothing else. |
| `tests/scaling.test.ts` | Unit tests for `fitScale`. |
| `.claude/launch.json` | Lets the in-app browser start the dev server for checking. |

## 5. Placeholder content

- **Canvases:** a dark fill, a one-pixel inner border, a faint grid or checker (so scaling and crispness are visible), and the panel name and internal size drawn as text, for example `TOP VIEW 320x200`. The text uses the browser's built-in monospace font drawn on the canvas, which is sharp enough for a placeholder. Real pixel text arrives with the art pass.
- **Terminal:** a header, a scrolling log region with two static example lines, and a **disabled** text input with a prompt. It is real HTML and keeps its layout, but does nothing until F1.
- **Accessibility from the start:** each panel is a `section` with an `aria-label`. The canvases get `role="img"` and a label. The terminal log is `role="log"`. Focus handling and the hidden instrument text come in D and F.
- **Style:** system monospace and a single dark palette for now. A pixel font is a dependency decision, so it waits for H1.

## 6. Steps

1. Install Node LTS (and Git, if wanted). Confirm `node -v` and `npm -v`.
2. Write `package.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`; run `npm install`.
3. Write `display.ts` and `scaling.ts`, then `scaling.test.ts`. Run the tests.
4. Write `index.html` and `styles.css`.
5. Write `panels.ts` and `main.ts`.
6. Run `npm run typecheck`, `npm test` and `npm run build`.
7. Run `npm run dev` and check the page in the in-app browser (see below).

## 7. Verification

**Automated**
- `fitScale`: exact fit (640 x 400 panel with 320 x 200 internal -> 2x); panel larger than a multiple (leftover space is centred, scale rounds down); panel smaller than internal (scale stays at 1); DPR 1.5 gives a whole number of *device* pixels; zero or negative input does not return NaN.
- Typecheck is clean under strict mode and `npm run build` succeeds.

**Manual, in the browser pane**
- At 1280 x 720, all four panels are visible with no page scrollbar, and the canvases read 640 x 400, 640 x 400 and 640 x 320.
- At 1920 x 1080, the canvases grow to 3x and stay crisp, with no blur.
- Below 1280 x 720, the page scrolls instead of shrinking.
- The console has no errors.

## 8. Done when

The page opens with the top view, side view, instruments and terminal areas, as ARCHITECTURE.md §14 says, and typecheck, tests and build all pass.

## 9. Risks and notes

- **Provisional sizes:** 320 x 160 for instruments, and a 5:4 row split, are guesses. They are constants, so changing them costs nothing now, and H1 decides the final look.
- **Performance targets** (§13) are not measurable yet because nothing animates. The first measurement is B2.
- **Version drift:** I'll let `npm install` pick the current stable versions of Vite, TypeScript and Vitest and record them in the lockfile, since I can't check them without Node.

## 10. Decisions

No answers were given, so the recommended option was taken for each. Say so if you want any changed:

1. **Package manager:** npm.
2. **Git:** installed; repo exists, no commits made yet.
3. **Instruments canvas:** 320 x 160 internal (one constant in `src/config/display.ts`).
4. **Fonts:** system monospace; pixel font deferred to H1.

## 11. Build log and results

**Built as planned.** All files in §4 exist. `package.json` has no runtime dependencies. `build` runs `tsc --noEmit && vite build`.

**Differences from the plan**
- `fitScale` takes `Size` objects (`{width, height}`) for the panel and internal size, rather than single numbers. It scales on the tighter axis.
- Added `noUnusedParameters` to `tsconfig.json`, and `types: ["vite/client"]` so CSS imports typecheck.
- The `.claude/launch.json` dev server uses `--strictPort` on 5173.
- Canvas placeholder text is 10 px monospace; the terminal also has a header, so it reads as a real panel.

**Results**
- `npm run typecheck`: clean. `npm test`: 7 of 7 pass (exact fit, round-down, tighter axis, minimum 1, fractional DPR in whole device pixels, 3x at 1920 panels, no NaN). `npm run build`: succeeds (about 2 kB JS, 1 kB CSS).
- Browser pane at 1280 x 720: no page scrollbar, all four panels visible, scale 2x on every canvas. The pane reported a DPR of 1.25, so the canvases measure 512 x 320, 512 x 320 and 512 x 256 CSS px (640 x 400 etc. in device pixels). This is the DPR rule working, not a bug; the 640 x 400 figures in §2 and §7 hold at DPR 1.
- At 1920 x 1080: 3x on every canvas, no scrollbar.
- At 1000 x 600: the page keeps 1280 x 720 and scrolls.
- Console: no errors.

**Not checked:** visual crispness was judged from one screenshot only; a pixel-level check at DPR 1 and 1.5 is worth a glance on your own screen.

**Next:** A2, a small hand-made grid drawn in the top view.
