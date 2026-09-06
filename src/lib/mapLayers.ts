import type { Map as MapLibreMap, LngLat } from "maplibre-gl";
import { TILE_SIZE } from "../constants";
import { ScratchLayer } from "./scratchLayer";
import { createBorderLayer } from "./border";
import { createLabelLayers } from "./labels";
import type { TileLayer } from "../types";

const BASE_SOURCE_ID = "base-tiles";
const BASE_LAYER_ID = "base-layer";
const SCRATCH_LAYER_ID = "scratch-layer";

interface MapLayersOptions {
  onLayersChanged?: (bottomName: string, topName: string) => void;
}

// Owns the base raster layer, the scratch layer, the border, and the
// labels together, since swapping the two tile layers means recreating
// the raster source/layer and the scratch layer from scratch -- and the
// border and labels both need to react to that (border resets since it
// traces the scratch layer's erased area; labels just need to be
// re-stacked back on top).
export function createMapLayers(map: MapLibreMap, initialTileLayers: [TileLayer, TileLayer], { onLayersChanged }: MapLayersOptions = {}) {
  let layers: [TileLayer, TileLayer] = [...initialTileLayers];
  let scratchLayer: ScratchLayer | null = null;
  const border = createBorderLayer(map);
  const labels = createLabelLayers(map);

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
    map.addLayer({ id: BASE_LAYER_ID, type: "raster", source: BASE_SOURCE_ID });

    scratchLayer = new ScratchLayer(SCRATCH_LAYER_ID, topLayer.url);
    map.addLayer(scratchLayer);

    // Swapping recreates the scratch layer from scratch, so the border
    // (which traces its erased area) has to reset along with it.
    border.reset();
    border.ensureLayer();

    // Labels should always sit above both the raster layers and the
    // scratch border, so re-stack them on top every time those get
    // recreated too.
    labels.ensure();
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
