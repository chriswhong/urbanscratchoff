// Computes the union of every scratch border circle off the main thread, so
// turf's union() -- whose cost grows with how much has been scratched -- never
// blocks scratching itself or event handling. The main thread just posts
// batches of new circles here and applies whatever GeoJSON comes back.
import { union } from "@turf/union";
import { simplify } from "@turf/simplify";
import { featureCollection } from "@turf/helpers";
import type { Feature, Polygon, MultiPolygon } from "geojson";

type BorderFeature = Feature<Polygon | MultiPolygon>;

type IncomingMessage = { type: "reset" } | { type: "addCircles"; circles: BorderFeature[] };

// A minimal local stand-in for DedicatedWorkerGlobalScope, rather than
// adding a "webworker" lib to the app-wide tsconfig, which would conflict
// with the DOM lib the rest of the app needs (both declare a
// differently-typed global `self`).
interface WorkerSelf {
  postMessage(message: { type: "update"; feature: BorderFeature | null }): void;
  onmessage: ((this: WorkerSelf, ev: MessageEvent<IncomingMessage>) => void) | null;
}
const worker = self as unknown as WorkerSelf;

let accumulated: BorderFeature | null = null;
let flushCount = 0;

// Periodically simplifying keeps the accumulated polygon's vertex count (and
// therefore every subsequent union's cost) roughly bounded, instead of
// growing without limit over a long scratching session. The tolerance is in
// degrees and kept small relative to the brush radius so the shape doesn't
// visibly change.
const SIMPLIFY_TOLERANCE = 0.000004;
const SIMPLIFY_EVERY = 6; // circles carry 24 vertices (for roundness), so simplify often to keep total complexity growth in check

worker.onmessage = function (e: MessageEvent<IncomingMessage>) {
  const msg = e.data;

  if (msg.type === "reset") {
    accumulated = null;
    flushCount = 0;
    worker.postMessage({ type: "update", feature: null });
    return;
  }

  if (msg.type === "addCircles") {
    const polygons = accumulated ? [accumulated, ...msg.circles] : msg.circles;
    accumulated = polygons.length === 1 ? polygons[0] : (union(featureCollection(polygons)) as BorderFeature | null);

    flushCount++;
    if (accumulated && flushCount % SIMPLIFY_EVERY === 0) {
      try {
        accumulated = simplify(accumulated, {
          tolerance: SIMPLIFY_TOLERANCE,
          highQuality: false,
        });
      } catch {
        // simplify can occasionally choke on degenerate geometry -- keep the
        // unsimplified polygon rather than losing the border entirely.
      }
    }

    worker.postMessage({ type: "update", feature: accumulated });
  }
};
