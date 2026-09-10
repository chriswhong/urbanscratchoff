// Computes the union/difference of every scratch (and redraw) border circle
// off the main thread, so turf's union()/difference() -- whose cost grows
// with how much has been scratched -- never block scratching itself or
// event handling. The main thread just posts batches of new circle ops
// here and applies whatever GeoJSON comes back.
import { union } from "@turf/union";
import { difference } from "@turf/difference";
import { simplify } from "@turf/simplify";
import { featureCollection } from "@turf/helpers";
import type { Feature, Polygon, MultiPolygon } from "geojson";

type BorderFeature = Feature<Polygon | MultiPolygon>;
type BorderOp = { feature: BorderFeature; subtract: boolean };

type IncomingMessage = { type: "reset" } | { type: "applyOps"; ops: BorderOp[] };

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

  if (msg.type === "applyOps") {
    // Ops are applied in order, but consecutive same-type ops are still
    // batched into a single union/difference call each -- the common case
    // (a drag gesture holds one modifier state for many stamps) stays as
    // cheap as before, while a flush that happens to straddle a direction
    // change (scratch then shift-redraw within the same window) still
    // comes out correct.
    let i = 0;
    while (i < msg.ops.length) {
      const subtract = msg.ops[i].subtract;
      const batch: BorderFeature[] = [];
      while (i < msg.ops.length && msg.ops[i].subtract === subtract) {
        batch.push(msg.ops[i].feature);
        i++;
      }

      if (!accumulated) {
        // Nothing scratched yet -- a redraw batch has nothing to subtract
        // from, so it's a no-op; an add batch just becomes the border.
        if (!subtract) {
          accumulated = batch.length === 1 ? batch[0] : (union(featureCollection(batch)) as BorderFeature | null);
        }
        continue;
      }

      // Clipping (difference especially) can occasionally choke on
      // degenerate geometry, same as simplify below -- keep the prior
      // accumulated polygon rather than losing the border entirely.
      try {
        accumulated = subtract
          ? (difference(featureCollection([accumulated, ...batch])) as BorderFeature | null)
          : (union(featureCollection([accumulated, ...batch])) as BorderFeature | null);
      } catch {
        // no-op: this batch's ops are dropped, accumulated stays as-is
      }
    }

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
