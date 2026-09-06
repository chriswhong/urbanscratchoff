import { useEffect } from "react";
import type { Map as MapLibreMap, LngLat } from "maplibre-gl";
import { setupInteraction } from "../lib/interaction";

export function useInteraction(map: MapLibreMap | null, loaded: boolean, onScratch: (lngLat: LngLat) => void, onGestureEnd: () => void) {
  useEffect(() => {
    if (!map || !loaded) return;

    // Zoom, rotate, and pitch all use gestures (scroll wheel, pinch,
    // right-button/Ctrl+drag, Shift+drag) that never collide with a plain
    // single-button/single-finger scratch drag, so they stay on
    // unconditionally. Only dragPan needs to be gated -- see interaction.ts.
    map.scrollZoom.enable();
    map.doubleClickZoom.enable();
    map.touchZoomRotate.enable();
    map.touchPitch.enable();
    map.dragRotate.enable();
    map.keyboard.enable();
    map.boxZoom.enable();

    return setupInteraction(map, { onScratch, onGestureEnd });
  }, [map, loaded, onScratch, onGestureEnd]);
}
