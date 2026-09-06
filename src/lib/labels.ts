import type { SourceSpecification, LayerSpecification } from "maplibre-gl";
import labelConfig from "../data/label-layers.json";

// ---- labels (OpenFreeMap vector tiles) -------------------------------
//
// Place, water, and street labels from OpenFreeMap's "planet" vector
// tileset, using the symbol layers copied from OpenFreeMap's "dark" style
// (data/label-layers.json) as a starting point -- see
// https://openfreemap.org. This never changes, so it's baked directly
// into the map's initial style (see useMapInstance.ts) rather than added
// at runtime.

interface LabelConfig {
  sourceId: string;
  source: SourceSpecification;
  glyphs: string;
  sprite: string;
  layers: LayerSpecification[];
}

export const labels = labelConfig as LabelConfig;
