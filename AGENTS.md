# Flight Simulator

A 2D browser flight simulator: top view + side view of one plane, real geography, ATC radio as gameplay. TypeScript (strict), Vite, Canvas 2D, Vitest. No UI framework, few dependencies. Currently in milestone phase B ("Move a plane"); see `docs/ARCHITECTURE.md` §14.

## Commands (run from repo root; Windows/PowerShell)

- `npm run dev`: dev server on port 5173 (`.claude/launch.json` has a `dev` entry).
- `npm test`: all tests, once. One file: `npx vitest run tests/sim.test.ts`.
- `npm run typecheck`: `tsc --noEmit`. `npm run build` = typecheck + Vite build.
- Before calling any change done: `npm run typecheck` and `npm test` must both pass.

## Architecture rules (the ones easy to break)

- **`src/sim/` is headless.** It must not import from `views/`, `input/`, `app/`, the DOM, or the network. Input reaches it only as commands (`sim/commands.ts`); views read state/snapshots and never mutate it.
- **Fixed 60 Hz step; views interpolate** (`sim/interpolate.ts`). No `Math.random`, `Date.now` or `performance.now` inside `sim/`; use seeded RNG passed in, so runs replay.
- **Units:** world meters (x east, y north, z up), SI, radians inside `sim/`. Convert to knots/feet/degrees only at display boundaries. Real, world and displayed values are different things: keep names or types distinct (scales in `src/config/scales.ts`).
- **Tunable numbers go in `src/config/`**, not inline in logic. Colors in `config/palette.ts`.
- Add structure only when needed. Follow the layout in `docs/ARCHITECTURE.md` §3; don't create the planned-but-empty folders (`comms/`, `audio/`, `sim/weather/`, ...) ahead of their milestone.

## Code conventions

- `tsconfig` is strict with `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`: handle `undefined` from indexing, don't suppress with `!` or `any`.
- State types are `readonly`; step functions return new state rather than mutating.
- Every new `sim/`, `input/` or pure `views/` function gets a test in `tests/<module>.test.ts`. Tests are headless and fast; keep them that way. Canvas drawing itself is checked by eye, not unit-tested.
- Match the style of neighboring files (no formatter is configured yet).

## How work is organized

- Work proceeds in small steps named by milestone (A1, B1, B2, ...). Each step has a plan in `docs/<ID>_PLAN.md` (scope in/out, behavior, files, steps, verification, decisions, risks, "done when", results). Read the current plan before changing code for that step, and keep its Status and Results sections accurate.
- **All numbers in docs and code are provisional.** When a value changes, update the doc that states it. If code and a plan disagree, say so rather than silently picking one.
- Don't add features from later milestones; the plans' "Out" tables say where things belong.
- **Do not commit or push unless asked.** When asked, commit message format is `<ID>: short summary` (e.g. `B1: fixed-step loop, keyboard input and pause`).

## Verifying UI changes

Start the `dev` server and look at it in the browser pane; type checks and tests cannot tell you the plane is drawn right. Check the console for errors. If you cannot verify visually, say so instead of claiming it works.

## Where to look

| Need | File |
|---|---|
| What the game is, pillars, scope | `docs/GAME_DESIGN.md` |
| Tech choices, layout, sim loop, units, milestones, open decisions | `docs/ARCHITECTURE.md` |
| What the current/last step does and how it was verified | `docs/B3_PLAN.md` (latest) |
| Tuning (speeds, turn rates, climb angle) | `src/config/motion.ts` |
| Map, airports, terrain | `src/sim/world/` |
