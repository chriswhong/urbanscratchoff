// Computes the union of every scratch border circle off the main thread, so
// turf.union() -- whose cost grows with how much has been scratched -- never
// blocks scratching itself or event handling. The main thread just posts
// batches of new circles here and applies whatever GeoJSON comes back.
importScripts("https://cdn.jsdelivr.net/npm/@turf/turf@7.4.0/turf.min.js");

var accumulated = null;
var flushCount = 0;

// Periodically simplifying keeps the accumulated polygon's vertex count (and
// therefore every subsequent union's cost) roughly bounded, instead of
// growing without limit over a long scratching session. The tolerance is in
// degrees and kept small relative to the brush radius so the shape doesn't
// visibly change.
var SIMPLIFY_TOLERANCE = 0.000004;
var SIMPLIFY_EVERY = 6; // circles now carry 2x the vertices (24-sided, for roundness), so simplify twice as often to keep total complexity growth in check

self.onmessage = function (e) {
  var msg = e.data;

  if (msg.type === "reset") {
    accumulated = null;
    flushCount = 0;
    self.postMessage({ type: "update", feature: null });
    return;
  }

  if (msg.type === "addCircles") {
    var polygons = accumulated ? [accumulated].concat(msg.circles) : msg.circles;
    accumulated =
      polygons.length === 1
        ? polygons[0]
        : turf.union(turf.featureCollection(polygons));

    flushCount++;
    if (accumulated && flushCount % SIMPLIFY_EVERY === 0) {
      try {
        accumulated = turf.simplify(accumulated, {
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
