import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "@fortawesome/fontawesome-free/css/fontawesome.css";
import "@fortawesome/fontawesome-free/css/brands.css";
import "@fortawesome/fontawesome-free/css/solid.css";
import "./styles.css";

import { DEFAULT_TILE_LAYERS } from "./constants.js";
import { createMapLayers } from "./mapLayers.js";
import { setupInteraction } from "./interaction.js";
import { setupUI } from "./ui.js";

const map = new maplibregl.Map({
  container: "map",
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

map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(new maplibregl.ScaleControl(), "bottom-left");

map.on("load", function () {
  const ui = setupUI({
    onSwap: function () {
      mapLayers.swap();
    },
  });

  const mapLayers = createMapLayers(map, DEFAULT_TILE_LAYERS, {
    onLayersChanged: ui.setLayerNames,
  });

  setupInteraction(map, {
    onScratch: mapLayers.scratchAt,
    onGestureEnd: mapLayers.endGesture,
  });

  // Zoom, rotate, and pitch all use gestures (scroll wheel, pinch,
  // right-button/Ctrl+drag, Shift+drag) that never collide with a plain
  // single-button/single-finger scratch drag, so they stay on
  // unconditionally. Only dragPan needs to be gated -- see interaction.js.
  map.scrollZoom.enable();
  map.doubleClickZoom.enable();
  map.touchZoomRotate.enable();
  map.touchPitch.enable();
  map.dragRotate.enable();
  map.keyboard.enable();
  map.boxZoom.enable();
});
