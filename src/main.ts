import './styles.css';
import { createLoop } from './app/loop';
import { initPanels } from './app/panels';
import { attachPause } from './app/pause';
import { SCALES } from './config/scales';
import { attachKeyboard } from './input/keyboard';
import { attachMapPointer } from './input/mapPointer';
import { attachSidePointer } from './input/sidePointer';
import { worldHeight, worldWidth } from './sim/world/grid';
import { withAirports } from './sim/world/placeAirports';
import { buildTestAirport } from './sim/world/testAirport';
import { buildTestMap } from './sim/world/testMap';
import { DEFAULT_ZOOM, type Camera, type Point } from './views/camera';
import { clampSideZoom, DEFAULT_SIDE_ZOOM } from './views/sideCamera';
import { createSideView } from './views/sideView';
import { createTopView } from './views/topView';

const grid = withAirports(buildTestMap(), [buildTestAirport(SCALES)]);
const bounds = { width: worldWidth(grid), height: worldHeight(grid) };
const topView = createTopView(grid, SCALES);
const sideView = createSideView(grid, SCALES);

let camera: Camera = { x: bounds.width / 2, y: bounds.height / 2, zoom: DEFAULT_ZOOM };
let cursor: Point | null = null;
let sideZoom = DEFAULT_SIDE_ZOOM;
let sideCursor: Point | null = null;
// Kept here, not read from `panels`, because the first draws run inside initPanels.
let sideSize = { width: 640, height: 360 };
let sideSized = false;
let requestTop: () => void = () => {};

// The loop owns the only copy of the simulation state; views read snapshots.
const keyboard = attachKeyboard(() => loop.toggle());
const loop = createLoop({
  bounds,
  draw: () => {
    panels.top.render();
    panels.side.render();
  },
  requestDraw: () => {
    panels.top.requestDraw();
    panels.side.requestDraw();
  },
  sampleKeys: () => keyboard.keys.sample(),
  clearKeys: () => keyboard.keys.clear(),
  startPaused: !document.hasFocus(),
});
const currentProbe = () => loop.snapshot();

const panels = initPanels({
  top: (ctx, size) =>
    topView.draw(ctx, size, camera, cursor, {
      probe: currentProbe(),
      size: sideSize,
      zoom: sideZoom,
      hoverDistance: sideCursor ? sideView.distanceAt(sideSize, sideZoom, sideCursor.x) : null,
    }),
  side: (ctx, size) => {
    const changed = size.width !== sideSize.width || size.height !== sideSize.height;
    sideSize = { width: size.width, height: size.height };
    sideView.draw(ctx, sideSize, currentProbe(), sideZoom, sideCursor);
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
  bounds,
  getCamera: () => camera,
  setCamera: (c) => {
    camera = c;
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
