import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from "maplibre-gl";
import { MIN_ZOOM, MAP_MAX_BOUNDS } from "../constants";
import { SOURCE_ID as BORDER_SOURCE_ID, borderLayerSpec } from "../lib/border";
import { labels } from "../lib/labels";
import { SOURCE_ID as MASK_SOURCE_ID, maskSourceSpec, maskLayerSpec } from "../lib/mask";

// The only layers that ever get added/removed at runtime are the two
// imagery layers (see mapLayers.ts), which are inserted directly below the
// border every time they're recreated (e.g. on swap). Everything else --
// the border's (empty) source/layer, the labels, and the outside-NYC mask
// -- has a shape that never changes, so it's declared once, right here, in
// the order it should always render: base/scratch layers get inserted
// below the border, labels sit above that, and the mask sits above
// everything so it can hide labels outside the city too.
function initialStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      [BORDER_SOURCE_ID]: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      [labels.sourceId]: labels.source,
      [MASK_SOURCE_ID]: maskSourceSpec(),
    },
    glyphs: labels.glyphs,
    sprite: labels.sprite,
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#1f4b61" } },
      borderLayerSpec(),
      ...labels.layers,
      maskLayerSpec(),
    ],
  };
}

// Creates the MapLibre map once, against the returned container ref, and
// tracks its "load" event -- everything else that touches the map (layers,
// interaction, search) waits on `loaded` before doing anything, mirroring
// the original app's single `map.on("load", ...)` gate.
export function useMapInstance() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const instance = new maplibregl.Map({
      container: containerRef.current,
      style: initialStyle(),
      center: [-73.99, 40.7],
      zoom: 14,
      minZoom: MIN_ZOOM,
      maxBounds: [
        [MAP_MAX_BOUNDS.minLon, MAP_MAX_BOUNDS.minLat],
        [MAP_MAX_BOUNDS.maxLon, MAP_MAX_BOUNDS.maxLat],
      ],
      hash: true,
      renderWorldCopies: false,
    });

    instance.once("load", () => setLoaded(true));
    setMap(instance);

    return () => {
      instance.remove();
      setMap(null);
      setLoaded(false);
    };
  }, []);

  return { containerRef, map, loaded };
}
