import { STAMP_SPACING } from "./constants.js";

// ---- interaction ------------------------------------------------------
//
// dragPan is the only interaction that's ever gated: it shares the same
// plain single-button/single-finger drag gesture as scratching, so only
// one of them can own it at a time. On desktop it's off unless the pan
// modifier key is held (pre-enabled on keydown -- so it's already active
// *before* the next mousedown, avoiding a race with MapLibre's own
// internal drag handler). On touch, a single finger scratches and a
// second finger switches the whole gesture to panning (see touchCount
// below) -- there's no keyboard modifier to reach for on a phone.
//
// Hold Cmd/Win (the "Meta" key) while dragging to pan the map instead of
// scratching -- Ctrl+drag and right-drag are left to MapLibre's own
// always-on dragRotate handler for pitch/rotate (see isNavigationGesture
// below).
export function setupInteraction(map, { onScratch, onGestureEnd }) {
  let panModifierHeld = false;
  let touchPanning = false;
  let isDrawing = false;
  let lastPoint = null;

  function updateDragPan() {
    if (panModifierHeld || touchPanning) {
      map.dragPan.enable();
    } else {
      map.dragPan.disable();
    }
  }

  function updateCursor() {
    const panning = panModifierHeld || touchPanning;
    map.getCanvas().style.cursor = panning ? "grab" : "crosshair";
  }

  // dragPan starts disabled -- see updateDragPan above.
  map.dragPan.disable();
  updateCursor();

  function onPanModifierDown(e) {
    if (e.key !== "Meta" || panModifierHeld) return;
    panModifierHeld = true;
    updateDragPan();
    updateCursor();
  }

  function onPanModifierUp(e) {
    if (e.key !== "Meta") return;
    panModifierHeld = false;
    updateDragPan();
    updateCursor();
  }

  window.addEventListener("keydown", onPanModifierDown);
  window.addEventListener("keyup", onPanModifierUp);
  window.addEventListener("blur", function () {
    if (!panModifierHeld) return;
    panModifierHeld = false;
    updateDragPan();
    updateCursor();
  });

  // Stamp repeatedly along a screen-space segment so fast drags (or sparse
  // mousemove events) don't leave gaps -- purely cosmetic (every stamp
  // unions correctly regardless of spacing), just keeps the swept shape
  // looking like one continuous capsule instead of a string of beads.
  function stampAlong(fromPoint, toPoint) {
    const dx = toPoint.x - fromPoint.x;
    const dy = toPoint.y - fromPoint.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(dist / STAMP_SPACING));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const pt = { x: fromPoint.x + dx * t, y: fromPoint.y + dy * t };
      onScratch(map.unproject(pt));
    }
  }

  // True for a gesture MapLibre's own always-on handlers own -- Ctrl+drag
  // or right-button drag (dragRotate), Shift+drag (boxZoom), or a
  // Cmd/Win-held pan drag -- in all cases we defer entirely rather than
  // also scratching.
  function isNavigationGesture(e) {
    const oe = e.originalEvent;
    if (!oe) return false;
    return !!(oe.metaKey || oe.ctrlKey || oe.shiftKey || oe.button === 2);
  }

  // Number of simultaneous touches for a MapLibre touch event (e) or a
  // raw window-level TouchEvent (window's touchend fallback below).
  function touchCount(e) {
    const oe = e && e.originalEvent ? e.originalEvent : e;
    return oe && oe.touches ? oe.touches.length : 0;
  }

  function onScratchStart(e) {
    if (touchCount(e) >= 2) {
      // A second finger landed -- hand the whole gesture to dragPan
      // instead, even if a first-finger scratch was already in progress.
      touchPanning = true;
      isDrawing = false;
      lastPoint = null;
      updateDragPan();
      updateCursor();
      return;
    }
    if (isNavigationGesture(e)) return;
    isDrawing = true;
    lastPoint = e.point;
    onScratch(e.lngLat);
  }

  function onScratchMove(e) {
    if (touchPanning || !isDrawing) return;
    if (lastPoint) {
      stampAlong(lastPoint, e.point);
    } else {
      onScratch(e.lngLat);
    }
    lastPoint = e.point;
  }

  function onScratchEnd(e) {
    if (touchPanning && touchCount(e) === 0) {
      touchPanning = false;
      updateDragPan();
      updateCursor();
    }
    isDrawing = false;
    lastPoint = null;
    if (onGestureEnd) onGestureEnd();
  }

  map.on("mousedown", onScratchStart);
  map.on("mousemove", onScratchMove);
  map.on("mouseup", onScratchEnd);
  map.on("touchstart", onScratchStart);
  map.on("touchmove", onScratchMove);
  map.on("touchend", onScratchEnd);
  window.addEventListener("mouseup", onScratchEnd);
  window.addEventListener("touchend", onScratchEnd);
}
