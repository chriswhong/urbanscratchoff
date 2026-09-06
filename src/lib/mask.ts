import type { LayerSpecification, SourceSpecification } from "maplibre-gl";

// ---- outside-NYC mask ---------------------------------------------
//
// data/nyc-boundaries-buffer-inverted.geojson is a single polygon covering
// the whole world with a hole cut out for a buffer around NYC's boundary
// (an outer ring plus an inner ring acting as the hole), so filling it
// shades everything *except* the city -- there's no real imagery or
// labels worth showing out there anyway. Its shape never changes, so it's
// baked into the map's initial style (see useMapInstance.ts) as the very
// top layer rather than added/re-stacked at runtime.

export const SOURCE_ID = "outside-nyc-mask";
export const LAYER_ID = "outside-nyc-mask-fill";

const DATA_URL = `${import.meta.env.BASE_URL}data/nyc-boundaries-buffer-inverted.geojson`;

export function maskSourceSpec(): SourceSpecification {
  return { type: "geojson", data: DATA_URL };
}

export function maskLayerSpec(): LayerSpecification {
  return {
    id: LAYER_ID,
    type: "fill",
    source: SOURCE_ID,
    paint: { "fill-color": "#2b2b2b" },
  };
}
