import { useCallback, useRef, useState } from "react";
import { useMapInstance } from "./hooks/useMapInstance";
import { useMapControls } from "./hooks/useMapControls";
import { useMapLayers } from "./hooks/useMapLayers";
import { useInteraction } from "./hooks/useInteraction";
import { Panel } from "./components/Panel";
import { AboutModal } from "./components/AboutModal";
import { BRUSH_RADIUS_DEFAULT } from "./constants";

export function App() {
  const { containerRef, map, loaded } = useMapInstance();
  useMapControls(map);

  const { topName, bottomName, swap, scratchAt, endGesture } = useMapLayers(map, loaded);

  const [brushRadius, setBrushRadius] = useState(BRUSH_RADIUS_DEFAULT);
  // Read fresh from setupInteraction on every stamp instead of passed in
  // once, so dragging the slider takes effect immediately without
  // tearing down and re-registering the map's event listeners.
  const brushRadiusRef = useRef(brushRadius);
  brushRadiusRef.current = brushRadius;
  const getBrushRadius = useCallback(() => brushRadiusRef.current, []);

  useInteraction(map, loaded, scratchAt, endGesture, getBrushRadius);

  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <>
      <div id="map" ref={containerRef} className="fixed inset-0" />

      <Panel
        map={map}
        topName={topName}
        bottomName={bottomName}
        onSwap={swap}
        onAboutClick={() => setAboutOpen(true)}
        brushRadius={brushRadius}
        onBrushRadiusChange={setBrushRadius}
      />

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </>
  );
}
