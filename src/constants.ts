import type { TileLayer } from "./types";

export const TILE_SIZE = 256;
// Brush radius scales with zoom -- see scratchLayer.ts. User-adjustable via
// the panel slider; existing scratches keep whatever radius they were made
// with (see types.ts's Stamp), so changing it only affects new scratches.
export const BRUSH_RADIUS_MIN = 10;
export const BRUSH_RADIUS_MAX = 80;
export const BRUSH_RADIUS_DEFAULT = 15;
export const BORDER_LINE_WIDTH = 8; // constant screen pixels -- see border.ts
export const UNION_FLUSH_DELAY = 80; // ms, batches circles sent to the border worker
export const MAX_TILE_SPAN = 20; // per-axis cap on tiles considered, guards against huge pitched viewports
export const MAX_CACHED_TILES = 400; // simple memory cap for the scratch tile cache

// Loosely covers the five boroughs -- used to bias/filter address search
// results, which benefits from staying tight (keeps far-away places out).
export const NYC_BOUNDS = { minLon: -74.26, minLat: 40.49, maxLon: -73.68, maxLat: 40.92 };

// Padded well beyond NYC_BOUNDS for the map's own maxBounds: MapLibre
// clamps so the whole *viewport* stays within the box, not just its
// center, so a tight box would make it impossible to ever pan a point
// near the real edge of the city into the middle of the screen.
export const MAP_MAX_BOUNDS = { minLon: -74.55, minLat: 40.25, maxLon: -73.35, maxLat: 41.15 };

export const MIN_ZOOM = 10.5;

export const DEFAULT_TILE_LAYERS: [TileLayer, TileLayer] = [
  {
    name: "1924 Aerials",
    url: "https://maps.nyc.gov/xyz/1.0.0/photo/1924/{z}/{x}/{y}.png8",
  },
  {
    // A mosaic of 2022-2025 NYS ITS statewide orthoimagery, re-tiled and
    // self-hosted from R2 (see workers/tile-server) -- replaces NYC's own
    // 2018 photo service, which was 8 years old at this point.
    name: "2022–2025 Aerials",
    url: "https://urbanscratchoff-tiles.chris-m-whong.workers.dev/{z}/{x}/{y}.jpg",
  },
];
