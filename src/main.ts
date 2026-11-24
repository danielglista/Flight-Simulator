import './styles.css';
import { attachCrashBanner } from './app/crashBanner';
import { createLoop } from './app/loop';
import { initPanels } from './app/panels';
import { attachPause } from './app/pause';
import { SCALES } from './config/scales';
import { attachKeyboard } from './input/keyboard';
import { attachMapPointer } from './input/mapPointer';
import { attachSidePointer } from './input/sidePointer';
import type { SimWorld } from './sim/step';
import { heightAt, worldHeight, worldWidth } from './sim/world/grid';
import { withAirports } from './sim/world/placeAirports';
import { buildTestAirport } from './sim/world/testAirport';
import { buildTestMap } from './sim/world/testMap';
import { DEFAULT_ZOOM, type Point } from './views/camera';
import { cameraFor, initialFollow, panned, recentered, zoomed } from './views/followCamera';
import { clampSideZoom, DEFAULT_SIDE_ZOOM } from './views/sideCamera';
import { createSideView } from './views/sideView';
import { createTopView } from './views/topView';

const grid = withAirports(buildTestMap(), [buildTestAirport(SCALES)]);
const world: SimWorld = {
  width: worldWidth(grid),
  height: worldHeight(grid),
  heightAt: (x, y) => heightAt(grid, SCALES, x, y),
};
const bounds = world;
const crashBanner = attachCrashBanner(grid, SCALES);
const syncBanner = (): void => crashBanner.update(loop.state.crash, loop.state.craft);
const topView = createTopView(grid, SCALES);
const sideView = createSideView(grid, SCALES);

// Top-view camera: locked to the plane, or free look. Never part of the simulation.
let follow = initialFollow(DEFAULT_ZOOM);
let cursor: Point | null = null;
let sideZoom = DEFAULT_SIDE_ZOOM;
let sideCursor: Point | null = null;
// Kept here, not read from `panels`, because the first draws run inside initPanels.
let sideSize = { width: 640, height: 360 };
let sideSized = false;
let requestTop: () => void = () => {};

// The loop owns the only copy of the simulation state; views read snapshots.
const keyboard = attachKeyboard({
  KeyP: () => loop.toggle(),
  KeyC: () => {
    follow = recentered(follow);
    if (loop.paused) panels.top.requestDraw();
  },
  Enter: () => loop.send({ kind: 'restart' }),
});
const loop = createLoop({
  world,
  draw: () => {
    syncBanner();
    panels.top.render();
    panels.side.render();
  },
  requestDraw: () => {
    syncBanner();
    panels.top.requestDraw();
    panels.side.requestDraw();
  },
  sampleKeys: () => keyboard.keys.sample(),
  clearKeys: () => keyboard.keys.clear(),
  startPaused: !document.hasFocus(),
});
// Camera and plane both come from one snapshot, so they cannot disagree.
const currentCraft = () => loop.snapshot();

topView.warm();
sideView.warm();

const panels = initPanels({
  top: (ctx, size) => {
    const craft = currentCraft();
    topView.draw(
      ctx,
      size,
      cameraFor(follow, craft),
      cursor,
      {
        craft,
        size: sideSize,
        zoom: sideZoom,
        hoverDistance: sideCursor ? sideView.distanceAt(sideSize, sideZoom, sideCursor.x) : null,
        crashed: loop.state.crash !== null,
      },
      follow.following,
    );
  },
  side: (ctx, size) => {
    const changed = size.width !== sideSize.width || size.height !== sideSize.height;
    sideSize = { width: size.width, height: size.height };
    sideView.draw(ctx, sideSize, currentCraft(), sideZoom, sideCursor, loop.state.crash !== null);
    // The top view marks exactly what this panel shows, so it follows our size.
    // Redraw only on a change, so the two panels cannot trigger each other forever.
    if (changed || !sideSized) {
      sideSized = true;
      requestTop();
    }
  },
});
requestTop = panels.top.requestDraw;

// While running, the loop draws every frame. Draw on demand only when paused.
const redrawBoth = (): void => {
  if (!loop.paused) return;
  panels.top.requestDraw();
  panels.side.requestDraw();
};

attachMapPointer({
  canvas: panels.top.canvas,
  getView: () => panels.top.size,
  getCamera: () => cameraFor(follow, currentCraft()),
  onPan: (dx, dy) => {
    follow = panned(follow, currentCraft(), dx, dy, bounds);
    if (loop.paused) panels.top.requestDraw();
  },
  onZoom: (at, steps) => {
    follow = zoomed(follow, currentCraft(), panels.top.size, at, steps, bounds);
    if (loop.paused) panels.top.requestDraw();
  },
  setCursor: (c) => {
    cursor = c;
    if (loop.paused) panels.top.requestDraw();
  },
  onClick: (w) => {
    loop.send({ kind: 'place', x: w.x, y: w.y });
  },
});

attachSidePointer({
  canvas: panels.side.canvas,
  onTurn: (r) => {
    loop.send({ kind: 'rotate', by: r });
  },
  onZoom: (steps) => {
    sideZoom = clampSideZoom(sideZoom + steps);
    redrawBoth();
  },
  setCursor: (c) => {
    sideCursor = c;
    redrawBoth();
  },
});

attachPause(loop);
loop.start();
