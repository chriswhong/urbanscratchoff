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
import { setupSearch } from "./search.js";

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

// On narrow screens the search box lives inside the main panel (see
// search.js) rather than floating in the top-right corner, but the zoom
// control would still sit right under the panel there -- move it to
// bottom-left, alongside the scale control, so it's not obscured.
const navControl = new maplibregl.NavigationControl();
const desktopMql = window.matchMedia("(min-width: 640px)");
let navControlAdded = false;
function placeNavControl(isDesktop) {
  if (navControlAdded) map.removeControl(navControl);
  map.addControl(navControl, isDesktop ? "top-right" : "bottom-left");
  navControlAdded = true;
}
placeNavControl(desktopMql.matches);
desktopMql.addEventListener("change", function (e) {
  placeNavControl(e.matches);
});

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

  setupSearch(map);

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
