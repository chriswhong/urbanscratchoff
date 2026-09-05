import { STAMP_SPACING } from "./constants.js";

// ---- interaction ------------------------------------------------------
//
// dragPan is the only interaction that's ever gated: it shares the same
// plain left-button/single-finger drag gesture as scratching, so only one
// of them can own it at a time. It's on permanently in "Pan & Zoom Map"
// mode, and otherwise only while the pan modifier key is held (which
// pre-enables it on keydown -- so it's already active *before* the next
// mousedown, avoiding a race with MapLibre's own internal drag handler).
//
// Hold Shift while dragging in Scratch Off mode to pan the map instead of
// scratching -- Ctrl/Cmd+drag and right-drag are left to MapLibre's own
// always-on dragRotate handler for pitch/rotate (see isNavigationGesture
// below).
export function setupInteraction(map, { onScratch, onGestureEnd }) {
  let scratchoffMode = true;
  let panModifierHeld = false;
  let isDrawing = false;
  let lastPoint = null;

  function updateDragPan() {
    if (!scratchoffMode || panModifierHeld) {
      map.dragPan.enable();
    } else {
      map.dragPan.disable();
    }
  }

  function updateCursor() {
    const panning = !scratchoffMode || panModifierHeld;
    map.getCanvas().style.cursor = panning ? "grab" : "crosshair";
  }

  function setMode(scratching) {
    scratchoffMode = scratching;
    updateDragPan();
    updateCursor();
  }

  function onPanModifierDown(e) {
    if (e.key !== "Shift" || panModifierHeld) return;
    panModifierHeld = true;
    updateDragPan();
    updateCursor();
  }

  function onPanModifierUp(e) {
    if (e.key !== "Shift") return;
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

  // True for a gesture MapLibre's always-on dragRotate handler owns
  // (Ctrl/Cmd+drag or right-button drag) or for a Shift-held pan drag --
  // in both cases we defer entirely rather than also scratching.
  function isNavigationGesture(e) {
    const oe = e.originalEvent;
    if (!oe) return false;
    return !!(oe.shiftKey || oe.ctrlKey || oe.metaKey || oe.button === 2);
  }

  function onScratchStart(e) {
    if (!scratchoffMode || isNavigationGesture(e)) return;
    isDrawing = true;
    lastPoint = e.point;
    onScratch(e.lngLat);
  }

  function onScratchMove(e) {
    if (!scratchoffMode || !isDrawing) return;
    if (lastPoint) {
      stampAlong(lastPoint, e.point);
    } else {
      onScratch(e.lngLat);
    }
    lastPoint = e.point;
  }

  function onScratchEnd() {
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

  return { setMode };
}
