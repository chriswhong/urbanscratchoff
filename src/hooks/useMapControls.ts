import { useEffect } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";

// On narrow screens the search box lives inside the main panel (see
// SearchBox.tsx) rather than floating in the top-right corner, but the
// zoom control would still sit right under the panel there -- move it to
// bottom-left, alongside the scale control, so it's not obscured.
export function useMapControls(map: MapLibreMap | null) {
  useEffect(() => {
    if (!map) return;

    const navControl = new maplibregl.NavigationControl();
    const scaleControl = new maplibregl.ScaleControl();
    const desktopMql = window.matchMedia("(min-width: 640px)");
    let navControlAdded = false;

    function placeNavControl(isDesktop: boolean) {
      if (navControlAdded) map!.removeControl(navControl);
      map!.addControl(navControl, isDesktop ? "top-right" : "bottom-left");
      navControlAdded = true;
    }

    placeNavControl(desktopMql.matches);
    function onChange(e: MediaQueryListEvent) {
      placeNavControl(e.matches);
    }
    desktopMql.addEventListener("change", onChange);

    map.addControl(scaleControl, "bottom-left");

    return () => {
      desktopMql.removeEventListener("change", onChange);
      map!.removeControl(navControl);
      map!.removeControl(scaleControl);
    };
  }, [map]);
}
