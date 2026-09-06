import { useState } from "react";
import { useMapInstance } from "./hooks/useMapInstance";
import { useMapControls } from "./hooks/useMapControls";
import { useMapLayers } from "./hooks/useMapLayers";
import { useInteraction } from "./hooks/useInteraction";
import { Panel } from "./components/Panel";
import { AboutModal } from "./components/AboutModal";

export function App() {
  const { containerRef, map, loaded } = useMapInstance();
  useMapControls(map);

  const { topName, bottomName, swap, scratchAt, endGesture } = useMapLayers(map, loaded);
  useInteraction(map, loaded, scratchAt, endGesture);

  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <>
      <div id="map" ref={containerRef} className="fixed inset-0" />

      <Panel map={map} topName={topName} bottomName={bottomName} onSwap={swap} onAboutClick={() => setAboutOpen(true)} />

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </>
  );
}
