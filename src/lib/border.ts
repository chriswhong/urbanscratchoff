import { circle } from "@turf/circle";
import { featureCollection } from "@turf/helpers";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import { GeoJSONSource, type Map as MapLibreMap, type LngLat } from "maplibre-gl";
import { BRUSH_RADIUS, BORDER_LINE_WIDTH, UNION_FLUSH_DELAY } from "../constants";
import BorderWorker from "../workers/borderWorker?worker";

// ---- border layer (vector line) ---------------------------------------
//
// The white "torn edge" border used to be baked into the raster tiles (an
// extra ring stamped around each erase circle). That worked, but its
// thickness was measured in tile-texel space, which only equals true
// screen pixels when the current zoom exactly matches the tile grid's own
// integer zoom -- in between, MapLibre continuously scales the whole tile
// texture up or down, so the border's apparent pixel width drifted
// continuously and then visibly snapped/reset the instant the tile grid
// switched to a new integer zoom.
//
// Real MapLibre vector layers don't have that problem: a `line-width` is
// rendered at that many screen pixels continuously across zoom, with no
// integer-snapping, because MapLibre's vector renderer is built to do
// exactly that. So the border is instead a genuine GeoJSON line layer
// tracing the true outer boundary of the union of every scratch ever made.
// Turf computes that union: each stamp becomes a circle polygon (sized in
// real-world meters, matching the raster erase hole's own geospatial
// scaling), folded into one running unioned polygon -- in a Web Worker
// (borderWorker.ts) so the union computation never blocks the main thread,
// no matter how expensive it gets over a long scratching session.
//
// Posting circles to the worker on every single stamp would still be
// wasteful message-passing overhead -- dragging can generate dozens of
// interpolated stamps per second -- so new circles are queued and sent as
// one batch at most every UNION_FLUSH_DELAY ms, with an immediate flush on
// gesture end so the border doesn't lag visibly after releasing.

const SOURCE_ID = "scratch-border";
const LAYER_ID = "scratch-border-line";

type BorderFeature = Feature<Polygon | MultiPolygon>;
type WorkerUpdateMessage = { type: "update"; feature: BorderFeature | null };

function metersPerPixel(lat: number, zoom: number) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

export function createBorderLayer(map: MapLibreMap) {
  let pendingCircles: BorderFeature[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const worker = new BorderWorker();

  worker.onmessage = function (e: MessageEvent<WorkerUpdateMessage>) {
    const source = map.getSource(SOURCE_ID);
    if (!(source instanceof GeoJSONSource)) return;
    const feature = e.data.feature;
    source.setData(feature ? featureCollection([feature]) : featureCollection([]));
  };

  function queueCircle(lngLat: LngLat, tileZ: number) {
    const radiusMeters = BRUSH_RADIUS * metersPerPixel(lngLat.lat, tileZ);
    pendingCircles.push(circle([lngLat.lng, lngLat.lat], radiusMeters, { steps: 24, units: "meters" }));
    if (!flushTimer) {
      flushTimer = setTimeout(flush, UNION_FLUSH_DELAY);
    }
  }

  function flush() {
    flushTimer = null;
    if (pendingCircles.length === 0) return;
    const newCircles = pendingCircles;
    pendingCircles = [];
    worker.postMessage({ type: "addCircles", circles: newCircles });
  }

  // Flushes immediately rather than waiting for the throttle timer, so the
  // border doesn't visibly lag after a drag gesture actually ends.
  function flushNow() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flush();
  }

  // Cancels any pending circles and clears the rendered border -- call
  // whenever the scratch layer itself resets (e.g. on swap), so the border
  // never ends up tracing an area that's no longer actually scratched.
  function reset() {
    pendingCircles = [];
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    worker.postMessage({ type: "reset" });
    const source = map.getSource(SOURCE_ID);
    if (source instanceof GeoJSONSource) source.setData(featureCollection([]));
  }

  // Adds the border source/layer the first time, or just moves it back to
  // the top of the stack on subsequent calls (after the raster and scratch
  // layers below it get recreated, e.g. on swap).
  function ensureLayer() {
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, { type: "geojson", data: featureCollection([]) });
    }
    if (!map.getLayer(LAYER_ID)) {
      map.addLayer({
        id: LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ffffff", "line-width": BORDER_LINE_WIDTH },
      });
    } else {
      map.moveLayer(LAYER_ID);
    }
  }

  return { queueCircle, flushNow, reset, ensureLayer };
}
