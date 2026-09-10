import type { Map as MapLibreMap, MapMouseEvent, MapTouchEvent, Point, LngLat } from "maplibre-gl";
import { TILE_SIZE } from "../constants";

// MapLibre's internal Transform always treats one tile as 512 CSS pixels
// wide at the zoom bucket it's rendering (a fixed architectural constant,
// independent of TILE_SIZE or devicePixelRatio -- confirmed by measuring
// map.project() across one tile-width of longitude). Our tile canvases
// are TILE_SIZE (256) texels, stretched across that same 512px quad, so
// one texel maps to 512/TILE_SIZE CSS pixels, not 1:1.
const TEXEL_TO_CSS_PIXEL = 512 / TILE_SIZE;

interface InteractionOptions {
  onScratch: (lngLat: LngLat, radius: number, restore: boolean) => void;
  onGestureEnd?: () => void;
  // Read fresh on every stamp rather than passed once, so dragging the
  // brush-size slider takes effect immediately without tearing down and
  // re-registering every listener here.
  getBrushRadius: () => number;
}

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
// below). Hold Shift while dragging to scratch in "restore" mode instead
// -- redrawing rather than erasing -- which is why boxZoom (MapLibre's
// own default use of Shift+drag) is disabled in useInteraction.ts.
export function setupInteraction(map: MapLibreMap, { onScratch, onGestureEnd, getBrushRadius }: InteractionOptions) {
  let panModifierHeld = false;
  let touchPanning = false;
  let isDrawing = false;
  let lastPoint: Point | null = null;
  let hoverPoint: Point | null = null;

  // A ring around the mouse showing the actual on-screen size of the next
  // scratch, so the user can see what they're about to erase before they
  // click. Screen radius = brush radius (in "tile pixels at the current
  // zoom bucket") scaled by how far the continuous zoom has drifted from
  // that bucket -- the same math scratchLayer.ts's render() uses, so the
  // ring matches the real erase footprint instead of just approximating
  // it as constant-screen-pixels.
  const cursorCircle = document.createElement("div");
  cursorCircle.style.position = "absolute";
  cursorCircle.style.pointerEvents = "none";
  cursorCircle.style.borderRadius = "50%";
  cursorCircle.style.border = "2px solid white";
  cursorCircle.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(0,0,0,0.5)";
  cursorCircle.style.transform = "translate(-50%, -50%)";
  cursorCircle.style.display = "none";
  cursorCircle.style.zIndex = "10";
  map.getCanvasContainer().appendChild(cursorCircle);

  function currentScreenRadius() {
    const zoom = map.getZoom();
    const tileZ = Math.round(zoom);
    return getBrushRadius() * TEXEL_TO_CSS_PIXEL * Math.pow(2, zoom - tileZ);
  }

  function updateCursorCircle() {
    const panning = panModifierHeld || touchPanning;
    if (!hoverPoint || panning) {
      cursorCircle.style.display = "none";
      return;
    }
    const r = currentScreenRadius();
    cursorCircle.style.width = cursorCircle.style.height = r * 2 + "px";
    cursorCircle.style.left = hoverPoint.x + "px";
    cursorCircle.style.top = hoverPoint.y + "px";
    cursorCircle.style.display = "block";
  }

  function updateDragPan() {
    if (panModifierHeld || touchPanning) {
      map.dragPan.enable();
    } else {
      map.dragPan.disable();
    }
  }

  function updateCursor() {
    const panning = panModifierHeld || touchPanning;
    // The ring above replaces the crosshair as the "you'll scratch here"
    // affordance, so hide the native cursor rather than show both.
    map.getCanvas().style.cursor = panning ? "grab" : "none";
    updateCursorCircle();
  }

  // dragPan starts disabled -- see updateDragPan above.
  map.dragPan.disable();
  updateCursor();

  function onPanModifierDown(e: KeyboardEvent) {
    if (e.key !== "Meta" || panModifierHeld) return;
    panModifierHeld = true;
    updateDragPan();
    updateCursor();
  }

  function onPanModifierUp(e: KeyboardEvent) {
    if (e.key !== "Meta") return;
    panModifierHeld = false;
    updateDragPan();
    updateCursor();
  }

  function onWindowBlur() {
    if (!panModifierHeld) return;
    panModifierHeld = false;
    updateDragPan();
    updateCursor();
  }

  window.addEventListener("keydown", onPanModifierDown);
  window.addEventListener("keyup", onPanModifierUp);
  window.addEventListener("blur", onWindowBlur);

  // The ring is a "where's my mouse" affordance -- meaningless on touch,
  // which has no concept of hovering before you commit to a point. Worse,
  // mobile browsers can fire a synthetic compatibility mousemove right
  // after a tap (to support code that only listens for mouse events),
  // which would otherwise set hoverPoint and then never clear it, since a
  // touch device never fires the mouseout that a real pointer leaving
  // would. Only wire it up at all on devices whose primary pointer is
  // fine (a real mouse/trackpad), and clear it defensively on any touch.
  const hasFinePointer = window.matchMedia("(pointer: fine)").matches;

  function onHoverMove(e: MapMouseEvent) {
    hoverPoint = e.point;
    updateCursorCircle();
  }

  function onHoverLeave() {
    hoverPoint = null;
    updateCursorCircle();
  }

  if (hasFinePointer) {
    map.on("mousemove", onHoverMove);
    map.on("mouseout", onHoverLeave);
    map.on("zoom", updateCursorCircle);
  }

  // Stamp repeatedly along a screen-space segment so fast drags (or sparse
  // mousemove events) don't leave gaps -- purely cosmetic (every stamp
  // unions correctly regardless of spacing), just keeps the swept shape
  // looking like one continuous capsule instead of a string of beads.
  function stampAlong(fromPoint: Point, toPoint: Point, restore: boolean) {
    const radius = getBrushRadius();
    const dx = toPoint.x - fromPoint.x;
    const dy = toPoint.y - fromPoint.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const spacing = radius / 3;
    const steps = Math.max(1, Math.ceil(dist / spacing));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const pt = { x: fromPoint.x + dx * t, y: fromPoint.y + dy * t } as Point;
      onScratch(map.unproject(pt), radius, restore);
    }
  }

  type ScratchEvent = MapMouseEvent | MapTouchEvent;
  type EndEvent = ScratchEvent | MouseEvent | TouchEvent;

  // True for a gesture MapLibre's own always-on handlers own -- Ctrl+drag
  // or right-button drag (dragRotate), or a Cmd/Win-held pan drag -- in all
  // cases we defer entirely rather than also scratching. Shift isn't
  // included: it's the restore modifier (see isRestoreGesture), not a
  // navigation gesture.
  function isNavigationGesture(e: ScratchEvent) {
    const oe = e.originalEvent as MouseEvent | undefined;
    if (!oe) return false;
    return !!(oe.metaKey || oe.ctrlKey || oe.button === 2);
  }

  // True while Shift is held during a scratch drag -- redraws (restores)
  // rather than erases. Read fresh per event rather than tracked like
  // panModifierHeld, since there's no race to guard against here: nothing
  // else claims the drag gesture based on Shift once boxZoom is disabled
  // (see useInteraction.ts), so switching mid-drag can just take effect
  // stamp-by-stamp.
  function isRestoreGesture(e: ScratchEvent) {
    const oe = e.originalEvent as MouseEvent | undefined;
    return !!oe?.shiftKey;
  }

  // Number of simultaneous touches for a MapLibre touch event (e) or a
  // raw window-level TouchEvent (window's touchend fallback below).
  function touchCount(e: EndEvent | undefined) {
    const oe = e && "originalEvent" in e ? e.originalEvent : e;
    return oe && "touches" in oe ? oe.touches.length : 0;
  }

  function onScratchStart(e: ScratchEvent) {
    // Belt and suspenders alongside the pointer-fine gate above: a stray
    // hover-ring left over from some edge case shouldn't survive into a
    // touch gesture, since it'd otherwise be stuck at that screen
    // position (touch has no "pointer left the area" event to clear it).
    if ("touches" in (e.originalEvent ?? {})) {
      hoverPoint = null;
      updateCursorCircle();
    }

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
    onScratch(e.lngLat, getBrushRadius(), isRestoreGesture(e));
  }

  function onScratchMove(e: ScratchEvent) {
    if (touchPanning || !isDrawing) return;
    const restore = isRestoreGesture(e);
    if (lastPoint) {
      stampAlong(lastPoint, e.point, restore);
    } else {
      onScratch(e.lngLat, getBrushRadius(), restore);
    }
    lastPoint = e.point;
  }

  function onScratchEnd(e?: EndEvent) {
    if (touchPanning && touchCount(e) === 0) {
      touchPanning = false;
      updateDragPan();
      updateCursor();
    }
    isDrawing = false;
    lastPoint = null;
    onGestureEnd?.();
  }

  map.on("mousedown", onScratchStart);
  map.on("mousemove", onScratchMove);
  map.on("mouseup", onScratchEnd);
  map.on("touchstart", onScratchStart);
  map.on("touchmove", onScratchMove);
  map.on("touchend", onScratchEnd);
  window.addEventListener("mouseup", onScratchEnd);
  window.addEventListener("touchend", onScratchEnd);

  return function dispose() {
    window.removeEventListener("keydown", onPanModifierDown);
    window.removeEventListener("keyup", onPanModifierUp);
    window.removeEventListener("blur", onWindowBlur);
    map.off("mousemove", onHoverMove);
    map.off("mouseout", onHoverLeave);
    map.off("zoom", updateCursorCircle);
    map.off("mousedown", onScratchStart);
    map.off("mousemove", onScratchMove);
    map.off("mouseup", onScratchEnd);
    map.off("touchstart", onScratchStart);
    map.off("touchmove", onScratchMove);
    map.off("touchend", onScratchEnd);
    window.removeEventListener("mouseup", onScratchEnd);
    window.removeEventListener("touchend", onScratchEnd);
    cursorCircle.remove();
  };
}
