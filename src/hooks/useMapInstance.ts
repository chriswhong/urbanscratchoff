import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";

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
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: "bg",
            type: "background",
            paint: { "background-color": "#1f4b61" },
          },
        ],
      },
      center: [-73.99, 40.7],
      zoom: 14,
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
