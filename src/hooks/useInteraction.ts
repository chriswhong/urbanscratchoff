import { useEffect } from "react";
import type { Map as MapLibreMap, LngLat } from "maplibre-gl";
import { setupInteraction } from "../lib/interaction";

export function useInteraction(
  map: MapLibreMap | null,
  loaded: boolean,
  onScratch: (lngLat: LngLat, radius: number, restore: boolean) => void,
  onGestureEnd: () => void,
  getBrushRadius: () => number,
) {
  useEffect(() => {
    if (!map || !loaded) return;

    // Zoom, rotate, and pitch all use gestures (scroll wheel, pinch,
    // right-button/Ctrl+drag) that never collide with a plain
    // single-button/single-finger scratch drag, so they stay on
    // unconditionally. Only dragPan needs to be gated -- see interaction.ts.
    // boxZoom is disabled rather than enabled: it's MapLibre's own default
    // use of Shift+drag, which interaction.ts repurposes as the "restore"
    // (redraw) modifier instead.
    map.scrollZoom.enable();
    map.doubleClickZoom.enable();
    map.touchZoomRotate.enable();
    map.touchPitch.enable();
    map.dragRotate.enable();
    map.keyboard.enable();
    map.boxZoom.disable();

    return setupInteraction(map, { onScratch, onGestureEnd, getBrushRadius });
  }, [map, loaded, onScratch, onGestureEnd, getBrushRadius]);
}
