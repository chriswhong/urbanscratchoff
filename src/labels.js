import labelConfig from "./data/label-layers.json";

// ---- labels (OpenFreeMap vector tiles) -------------------------------
//
// Place, water, and street labels from OpenFreeMap's "planet" vector
// tileset, using the symbol layers copied from OpenFreeMap's "dark" style
// (data/label-layers.json) as a starting point -- see
// https://openfreemap.org. Added once and re-stacked on top whenever the
// layers below get recreated (e.g. on swap).

export function createLabelLayers(map) {
  function ensure() {
    // addSource/addLayer throw before the style has finished loading, so
    // reschedule via the map's own "idle" event rather than hoping some
    // other caller happens to retry once it's ready.
    if (!map.isStyleLoaded()) {
      map.once("idle", ensure);
      return;
    }

    if (!map.getSource(labelConfig.sourceId)) {
      map.addSource(labelConfig.sourceId, labelConfig.source);
      map.setGlyphs(labelConfig.glyphs);
      map.setSprite(labelConfig.sprite);
    }

    labelConfig.layers.forEach(function (layer) {
      if (map.getLayer(layer.id)) {
        map.moveLayer(layer.id);
      } else {
        map.addLayer(layer);
      }
    });
  }

  return { ensure };
}
