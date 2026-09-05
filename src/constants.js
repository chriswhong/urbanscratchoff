export const TILE_SIZE = 256;
export const BRUSH_RADIUS = 30; // scales with zoom -- see scratchLayer.js
export const BORDER_LINE_WIDTH = 8; // constant screen pixels -- see border.js
export const UNION_FLUSH_DELAY = 80; // ms, batches circles sent to the border worker
export const MAX_TILE_SPAN = 20; // per-axis cap on tiles considered, guards against huge pitched viewports
export const MAX_CACHED_TILES = 400; // simple memory cap for the scratch tile cache
export const STAMP_SPACING = BRUSH_RADIUS / 3;

export const DEFAULT_TILE_LAYERS = [
  {
    name: "2018 Aerials",
    url: "https://maps.nyc.gov/xyz/1.0.0/photo/2018/{z}/{x}/{y}.png8",
  },
  {
    name: "1924 Aerials",
    url: "https://maps.nyc.gov/xyz/1.0.0/photo/1924/{z}/{x}/{y}.png8",
  },
];
