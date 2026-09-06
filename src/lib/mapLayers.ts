import type { Map as MapLibreMap, LngLat } from "maplibre-gl";
import { TILE_SIZE } from "../constants";
import { ScratchLayer } from "./scratchLayer";
import { createBorderLayer, LAYER_ID as BORDER_LAYER_ID } from "./border";
import type { TileLayer } from "../types";

const BASE_SOURCE_ID = "base-tiles";
const BASE_LAYER_ID = "base-layer";
const SCRATCH_LAYER_ID = "scratch-layer";

interface MapLayersOptions {
  onLayersChanged?: (bottomName: string, topName: string) => void;
}

// Owns the base raster layer and the scratch layer, since swapping the two
// tile layers means recreating both from scratch. The border, labels, and
// mask are all declared once in the initial style (see useMapInstance.ts)
// and never move -- these two imagery layers are simply (re-)inserted
// right below the border every time, which keeps the border/labels/mask
// stack on top without ever needing to re-stack it.
export function createMapLayers(map: MapLibreMap, initialTileLayers: [TileLayer, TileLayer], { onLayersChanged }: MapLayersOptions = {}) {
  let layers: [TileLayer, TileLayer] = [...initialTileLayers];
  let scratchLayer: ScratchLayer | null = null;
  const border = createBorderLayer(map);

  function addTileLayers() {
    const bottomLayer = layers[0];
    const topLayer = layers[1];

    onLayersChanged?.(bottomLayer.name, topLayer.name);

    if (map.getLayer(BASE_LAYER_ID)) map.removeLayer(BASE_LAYER_ID);
    if (map.getSource(BASE_SOURCE_ID)) map.removeSource(BASE_SOURCE_ID);
    if (scratchLayer) map.removeLayer(scratchLayer.id);

    map.addSource(BASE_SOURCE_ID, {
      type: "raster",
      tiles: [bottomLayer.url],
      tileSize: TILE_SIZE,
    });
    map.addLayer({ id: BASE_LAYER_ID, type: "raster", source: BASE_SOURCE_ID }, BORDER_LAYER_ID);

    scratchLayer = new ScratchLayer(SCRATCH_LAYER_ID, topLayer.url);
    map.addLayer(scratchLayer, BORDER_LAYER_ID);

    // Swapping recreates the scratch layer from scratch, so the border
    // (which traces its erased area) has to reset along with it.
    border.reset();
  }

  function swap() {
    layers = [layers[1], layers[0]];
    addTileLayers();
  }

  // Erases into the raster tile and queues the matching border circle
  // together, so the two stay in sync at every stamp.
  function scratchAt(lngLat: LngLat, radius: number) {
    if (!scratchLayer || scratchLayer.tileZ === null) return;
    const tileZ = scratchLayer.tileZ;
    scratchLayer.scratchAt(lngLat, radius);
    border.queueCircle(lngLat, tileZ, radius);
  }

  function endGesture() {
    border.flushNow();
  }

  addTileLayers();

  return { swap, scratchAt, endGesture };
}
