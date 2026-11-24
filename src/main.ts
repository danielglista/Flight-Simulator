import './styles.css';
import { initPanels } from './app/panels';
import { SCALES } from './config/scales';
import { attachMapPointer } from './input/mapPointer';
import { worldHeight, worldWidth } from './sim/world/grid';
import { buildTestMap } from './sim/world/testMap';
import { DEFAULT_ZOOM, type Camera, type Point } from './views/camera';
import { createTopView } from './views/topView';

const grid = buildTestMap();
const bounds = { width: worldWidth(grid), height: worldHeight(grid) };
const topView = createTopView(grid, SCALES);

let camera: Camera = { x: bounds.width / 2, y: bounds.height / 2, zoom: DEFAULT_ZOOM };
let cursor: Point | null = null;

const panels = initPanels({
  top: (ctx, size) => topView.draw(ctx, size, camera, cursor),
});

attachMapPointer({
  canvas: panels.top.canvas,
  getView: () => panels.top.size,
  bounds,
  getCamera: () => camera,
  setCamera: (c) => {
    camera = c;
    panels.top.requestDraw();
  },
  setCursor: (c) => {
    cursor = c;
    panels.top.requestDraw();
  },
});
