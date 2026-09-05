// Computes the union of every scratch border circle off the main thread, so
// turf's union() -- whose cost grows with how much has been scratched -- never
// blocks scratching itself or event handling. The main thread just posts
// batches of new circles here and applies whatever GeoJSON comes back.
import { union } from "@turf/union";
import { simplify } from "@turf/simplify";
import { featureCollection } from "@turf/helpers";

let accumulated = null;
let flushCount = 0;

// Periodically simplifying keeps the accumulated polygon's vertex count (and
// therefore every subsequent union's cost) roughly bounded, instead of
// growing without limit over a long scratching session. The tolerance is in
// degrees and kept small relative to the brush radius so the shape doesn't
// visibly change.
const SIMPLIFY_TOLERANCE = 0.000004;
const SIMPLIFY_EVERY = 6; // circles carry 24 vertices (for roundness), so simplify often to keep total complexity growth in check

self.onmessage = function (e) {
  const msg = e.data;

  if (msg.type === "reset") {
    accumulated = null;
    flushCount = 0;
    self.postMessage({ type: "update", feature: null });
    return;
  }

  if (msg.type === "addCircles") {
    const polygons = accumulated ? [accumulated, ...msg.circles] : msg.circles;
    accumulated = polygons.length === 1 ? polygons[0] : union(featureCollection(polygons));

    flushCount++;
    if (accumulated && flushCount % SIMPLIFY_EVERY === 0) {
      try {
        accumulated = simplify(accumulated, {
          tolerance: SIMPLIFY_TOLERANCE,
          highQuality: false,
        });
      } catch (err) {
        // simplify can occasionally choke on degenerate geometry -- keep the
        // unsimplified polygon rather than losing the border entirely.
      }
    }

    self.postMessage({ type: "update", feature: accumulated });
  }
};
