import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, LngLat } from "maplibre-gl";
import { createMapLayers } from "../lib/mapLayers";
import { DEFAULT_TILE_LAYERS } from "../constants";

export function useMapLayers(map: MapLibreMap | null, loaded: boolean) {
  const [topName, setTopName] = useState("");
  const [bottomName, setBottomName] = useState("");
  const handleRef = useRef<ReturnType<typeof createMapLayers> | null>(null);

  useEffect(() => {
    if (!map || !loaded) return;

    const handle = createMapLayers(map, DEFAULT_TILE_LAYERS, {
      onLayersChanged: (bottom, top) => {
        setBottomName(bottom);
        setTopName(top);
      },
    });
    handleRef.current = handle;

    return () => {
      handleRef.current = null;
    };
  }, [map, loaded]);

  const swap = useCallback(() => handleRef.current?.swap(), []);
  const scratchAt = useCallback((lngLat: LngLat, radius: number) => handleRef.current?.scratchAt(lngLat, radius), []);
  const endGesture = useCallback(() => handleRef.current?.endGesture(), []);

  return { topName, bottomName, swap, scratchAt, endGesture };
}
