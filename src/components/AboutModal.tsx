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
        <div className="flex items-start justify-between gap-4 p-4 border-b border-gray-200">
          <div>
            <h3 className="text-xl font-bold m-0">About Urban Scratchoff</h3>
            <p className="text-sm text-gray-500 m-0">
              A web map by{" "}
              <a href="https://bsky.app/profile/chriswhong.bsky.social" target="_blank" rel="noopener" className="text-sky-600">
                @chriswhong.bsky.social
              </a>
            </p>
          </div>
          <button type="button" className="text-2xl leading-none text-gray-400 hover:text-gray-700" aria-label="Close" onClick={onClose}>
            &times;
          </button>
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
            The map runs on{" "}
            <a href="https://maplibre.org/" target="_blank" rel="noopener" className="text-sky-600">
              MapLibre GL JS
            </a>{" "}
            instead of Leaflet, which means it can be pitched and rotated, not just panned and zoomed. The bottom layer is a normal
            MapLibre raster source/layer. The top (scratchable) layer is a custom MapLibre <code>CustomLayerInterface</code> that renders
            raw WebGL: each visible tile gets its own offscreen 2D canvas holding the tile image, and that canvas is uploaded as a GL
            texture and drawn as a textured quad positioned in Mercator coordinates using the same projection matrix MapLibre uses for the
            rest of the map &mdash; so the overlay stays correctly warped under pitch and rotation instead of breaking like a flat DOM
            layer would. When the user "Scratches" the map, the mouse position is converted to Mercator coordinates and then to a pixel
            position on the relevant tile's offscreen canvas, where a circle is drawn using the 'destination-out' composite operation.
            This turns the affected area transparent; the texture is re-uploaded to the GPU, and the bottom layer shows through! Here's{" "}
            <a href="http://chriswhong.com/local/building-urban-scratchoff/" target="_blank" rel="noopener" className="text-sky-600">
              a blog post about how and why I built Urban Scratchoff.
            </a>{" "}
            (Note: that post describes the original Leaflet-based implementation.)
          </p>

          <h5 className="font-bold text-base">Imagery</h5>
          <p className="line-through text-gray-400">
            The historical imagery is provided by the New York Public Library (NYPL Labs){" "}
            <a href="http://maps.nypl.org/warper/" target="_blank" rel="noopener" className="text-sky-600">
              Mapwarper
            </a>{" "}
            site - "Sectional aerial maps of the City of New York / photographed and assembled under the direction of the chief engineer,
            July 1st, 1924." Mapwarper is a crowd-sourced imagery rectification tool. If you see imagery that doesn't "line up" while
            using Urban Scratchoff, you can actually help out and fix the rectification points on the NYPL This layer is cached on my
            server.
          </p>
          <p className="line-through text-gray-400">
            The modern day imagery is{" "}
            <a href="https://developer.mapquest.com/" target="_blank" rel="noopener" className="text-sky-600">
              Mapquest's OpenAerial
            </a>{" "}
            tileset
          </p>
          <p>
            The 1924 and 2018 aerial imagery is provided by the GIS Team at NYC's Office of Technology &amp; Innovation.{" "}
            <a href="https://maps.nyc.gov/tiles/" target="_blank" rel="noopener" className="text-sky-600">
              They publish these and other historic NYC tilesets here.
            </a>
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

          <h5 className="font-bold text-base">Todo</h5>
          <p>
            I would like to make it so that anyone can submit points of interest. Everyone will be greeted with a marked up map full of
            interesting scratchoffs to explore.
          </p>

          <p className="font-bold">
            <a href="https://github.com/chriswhong/urbanscratchoff" target="_blank" rel="noopener" className="text-sky-600">
              The code is on github
            </a>
            . If you find a bug, please open an issue. If you want to contribute or fork for your city, have at it!
          </p>
        </div>

        <div className="flex justify-end p-4 border-t border-gray-200">
          <button type="button" className="px-3 py-1.5 text-sm rounded bg-gray-100 hover:bg-gray-200" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
