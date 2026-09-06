## Summary

- **Outside-NYC mask** — added a dark gray fill layer covering everything outside the NYC boundary buffer (`public/data/nyc-boundaries-buffer-inverted.geojson`), since there's no real imagery to show out there. It sits above the raster/scratch layers, the scratch border, *and* the labels, so label text outside the city is hidden too.
- **Layer stacking refactor** — the border, labels, and mask are now declared once in the map's initial style (`useMapInstance.ts`) instead of being added and re-stacked to the top on every layer swap, since their shape never changes. Only the two imagery layers (base raster + scratch layer) still use `addLayer()`/`removeLayer()`, and they now insert themselves directly below the border via `addLayer(def, beforeId)` — so the border/labels/mask stack never needs to move again.
- **Fixed a mobile bug** — tapping the map left a stuck cursor ring at the tapped position after panning, because mobile browsers fire a synthetic `mousemove` after a touch with no matching `mouseout` to ever clear it. The brush-size cursor ring is now only wired up on devices with a fine pointer (mouse/trackpad), with a defensive clear on any touch-originated event.
- **Fixed broken images on GitHub Pages** — the penny mascot and Geocode Earth attribution logo used hardcoded absolute paths (`/assets/...`) that broke under the `/urbanscratchoff/` subpath deployment. Both now use `import.meta.env.BASE_URL`.

## Test plan

- [x] `tsc --noEmit` and `npm run build` succeed
- [x] Verified layer order live in a browser (`bg → base-layer → scratch-layer → scratch-border-line → labels → mask`), both on initial load and after swapping layers
- [x] Confirmed the mask renders dark gray outside the NYC buffer and hides labels there, while leaving the buffered NYC area (imagery + labels) untouched
- [x] Confirmed scratching, the border outline, and layer swap still work correctly after the stacking refactor

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01XwZ8e4LBnxFNivb6iDX8vC
