import { useEffect } from "react";

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
}

export function AboutModal({ open, onClose }: AboutModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <div
      id="aboutModal"
      className={`fixed inset-0 z-[1000] items-center justify-center bg-black/50 p-4 ${open ? "flex" : "hidden"}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-xl font-bold m-0">About Urban Scratchoff</h3>
          <p className="text-sm text-gray-500 m-0">
            A web map by{" "}
            <a href="https://bsky.app/profile/chriswhong.bsky.social" target="_blank" rel="noopener" className="text-sky-600">
              @chriswhong.bsky.social
            </a>
          </p>
        </div>

        <div className="p-4 overflow-y-auto space-y-3 text-sm text-gray-700">
          <h5 className="font-bold text-base">Idea</h5>
          <p>
            I often drive on the BQE, an interstate highway that snakes its way through Brooklyn. I've learned about the massive number
            buildings that had to be demolished, and people displaced, to make way for this and other urban highways. I wanted to allow
            the user to drag their mouse over the old buildings on a historical layer and "reveal" the highway beneath to get a better
            idea of the cost of progress. This was the original concept.
          </p>
          <p>
            After some hacking and getting a prototype working, scratching off parts of the city became downright addictive (especially
            waterfronts/docks, large construction projects, highways, etc.)
          </p>

          <h5 className="font-bold text-base">Tech</h5>
          <p>
            Urban Scratchoff was originally built with Leaflet, then overhauled in 2026 to run on{" "}
            <a href="https://maplibre.org/" target="_blank" rel="noopener" className="text-sky-600">
              MapLibre GL JS
            </a>{" "}
            instead, for a much smoother map experience &mdash; among other things, it can now be pitched and rotated, not just panned and
            zoomed. The bottom layer is a normal raster tile layer showing whichever imagery is "revealed." The top (scratchable) layer is
            a custom WebGL layer: dragging on the map punches a transparent hole in it, letting the layer below show through. It's tied to
            the real map projection and to actual geography, so the hole stays put and warps correctly no matter how you pan, zoom, pitch,
            or rotate afterward.
          </p>

          <h5 className="font-bold text-base">Imagery</h5>
          
          <p>
            The 1924 aerial imagery is provided by the GIS Team at NYC's Office of Technology &amp; Innovation.{" "}
            <a href="https://maps.nyc.gov/tiles/" target="_blank" rel="noopener" className="text-sky-600">
              They publish this and other historic NYC tilesets here.
            </a>
          </p>
          <p>
            The present-day layer is a mosaic of 2022&ndash;2025 orthoimagery (~12in resolution) from{" "}
            <a href="https://gis.ny.gov/orthoimagery" target="_blank" rel="noopener" className="text-sky-600">
              NYS ITS Geospatial Services' statewide orthoimagery program
            </a>
            . It's re-cut into a zoom 11&ndash;18 raster tile pyramid, recompressed to JPEG, and packaged as a single{" "}
            <a href="https://protomaps.com/docs/pmtiles" target="_blank" rel="noopener" className="text-sky-600">
              PMTiles
            </a>{" "}
            archive self-hosted on Cloudflare R2 &mdash; this replaced NYC's own 2018 imagery layer, which was no longer current.
          </p>

          <h5 className="font-bold text-base">Attribution & Thanks</h5>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <a href="https://twitter.com/riordan" target="_blank" rel="noopener" className="text-sky-600">
                Dave Riordan
              </a>{" "}
              for answering an early tweet and pointing me to mapwarper
            </li>
            <li>
              <a href="https://twitter.com/recessionporn" target="_blank" rel="noopener" className="text-sky-600">
                John Krauss
              </a>{" "}
              and{" "}
              <a href="https://twitter.com/andrewxhill" target="_blank" rel="noopener" className="text-sky-600">
                Andrew Hill
              </a>{" "}
              for looking over my shoulder during development
            </li>
            <li>
              <a href="https://twitter.com/brymcbride" target="_blank" rel="noopener" className="text-sky-600">
                Bryan McBride
              </a>{" "}
              for making{" "}
              <a href="https://github.com/bmcbride/bootleaf" target="_blank" rel="noopener" className="text-sky-600">
                bootleaf
              </a>
              , an awesome template layout for leaflet maps & bootstrap
            </li>
            <li>
              <a href="https://twitter.com/vtcraghead" target="_blank" rel="noopener" className="text-sky-600">
                Bill Morris
              </a>
              ,{" "}
              <a href="https://twitter.com/pcrickard" target="_blank" rel="noopener" className="text-sky-600">
                Paul Crickard
              </a>{" "}
              and{" "}
              <a href="https://twitter.com/sr_spatial" target="_blank" rel="noopener" className="text-sky-600">
                Steve Romalewski
              </a>{" "}
              for testing out the first prototype and giving feedback
            </li>
            <li>
              <a href="https://twitter.com/atogle" target="_blank" rel="noopener" className="text-sky-600">
                Aaron Ogle
              </a>{" "}
              for guidance on combining tiles and HTML canvas
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
