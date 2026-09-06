import { useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import * as Slider from "@radix-ui/react-slider";
import { SearchBox } from "./SearchBox";
import { BRUSH_RADIUS_MIN, BRUSH_RADIUS_MAX } from "../constants";

interface PanelProps {
  map: MapLibreMap | null;
  topName: string;
  bottomName: string;
  onSwap: () => void;
  onAboutClick: () => void;
  brushRadius: number;
  onBrushRadiusChange: (radius: number) => void;
}

const SWAP_ANIMATION_MS = 220;

const isMac = /mac|iphone|ipad|ipod/i.test(
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? navigator.userAgent,
);

function LayerIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      <circle cx="7" cy="8" r="1.5" />
      <path d="M2.5 13.5l4-4 3 3 3.5-3.5 4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Panel({ map, topName, bottomName, onSwap, onAboutClick, brushRadius, onBrushRadiusChange }: PanelProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const topRowRef = useRef<HTMLDivElement>(null);
  const bottomRowRef = useRef<HTMLDivElement>(null);

  // Slide the two layer rows past each other, then swap their text (via
  // onSwap, which updates React state synchronously) right as they land
  // back in place -- reads as the two layers trading positions.
  function animateSwap() {
    const topEl = topRowRef.current;
    const bottomEl = bottomRowRef.current;
    if (!topEl || !bottomEl) {
      onSwap();
      return;
    }

    const distance = bottomEl.offsetTop - topEl.offsetTop;

    topEl.style.transition = bottomEl.style.transition = `transform ${SWAP_ANIMATION_MS}ms ease, opacity ${SWAP_ANIMATION_MS}ms ease`;
    topEl.style.transform = `translateY(${distance}px)`;
    bottomEl.style.transform = `translateY(${-distance}px)`;
    topEl.style.opacity = bottomEl.style.opacity = "0.4";

    window.setTimeout(() => {
      onSwap();

      topEl.style.transition = bottomEl.style.transition = "none";
      topEl.style.transform = bottomEl.style.transform = "";
      topEl.style.opacity = bottomEl.style.opacity = "";
      // Force a reflow so the transition removal above takes effect
      // before it's re-enabled for the next swap.
      void topEl.offsetHeight;
      topEl.style.transition = bottomEl.style.transition = "";
    }, SWAP_ANIMATION_MS);
  }

  return (
    <div
      id="panel"
      className="fixed top-2.5 left-2.5 right-2.5 sm:right-auto sm:w-[320px] z-40 bg-white/95 backdrop-blur rounded-xl shadow-lg p-4"
    >
      <h1 className="text-2xl font-extrabold tracking-tight m-0 flex items-center gap-2">
        <img src={`${import.meta.env.BASE_URL}assets/penny.png`} alt="" className="coin inline-block w-8 h-8 rounded-full shadow-sm" />
        <span className="bg-gradient-to-r from-sky-600 to-blue-900 bg-clip-text text-transparent">Urban Scratchoff</span>
      </h1>
      <p id="byline" className="text-xs text-gray-500 mt-0.5 mb-0">
        by{" "}
        <a
          href="https://bsky.app/profile/chriswhong.bsky.social"
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1 font-medium text-sky-600 hover:underline"
        >
          <i className="fa-brands fa-bluesky" /> Chris Whong
        </a>
      </p>

      <SearchBox map={map} />

      <button
        type="button"
        className="sm:hidden flex items-center justify-center gap-1.5 w-full mt-3 pt-2 border-t border-gray-200 text-xs font-medium text-gray-500 cursor-pointer"
        onClick={() => setMoreOpen((v) => !v)}
      >
        <span>{moreOpen ? "Less" : "More"}</span>
        <i className={`fa-solid fa-chevron-down text-[10px] transition-transform ${moreOpen ? "rotate-180" : ""}`} />
      </button>

      <div className={`${moreOpen ? "block" : "hidden"} sm:block`}>
        <p className="text-sm text-gray-600 mt-1.5 mb-0">
          Present-day NYC is hiding 1924 underneath. Click and drag on the map to scratch it away.
        </p>

        {isMac ? (
          <p className="hidden sm:pointer-fine:block text-xs text-gray-400 mt-2 mb-0">
            Hold <kbd className="px-1 py-0.5 rounded border border-gray-300 bg-gray-50 font-sans">⌘</kbd> and drag to pan the map.
          </p>
        ) : (
          <p className="hidden sm:pointer-fine:block text-xs text-gray-400 mt-2 mb-0">
            Hold <kbd className="px-1 py-0.5 rounded border border-gray-300 bg-gray-50 font-sans">Ctrl</kbd> and drag to pan the map.
          </p>
        )}
        <p className="hidden pointer-coarse:block text-xs text-gray-400 mt-2 mb-0">Use two fingers to pan the map.</p>

        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Brush Size</div>
            <div className="text-[11px] font-semibold text-gray-500 tabular-nums">{brushRadius}</div>
          </div>
          <Slider.Root
            className="relative flex items-center select-none touch-none w-full h-4"
            min={BRUSH_RADIUS_MIN}
            max={BRUSH_RADIUS_MAX}
            step={1}
            value={[brushRadius]}
            onValueChange={([value]) => onBrushRadiusChange(value)}
          >
            <Slider.Track className="bg-gray-200 relative grow rounded-full h-1.5">
              <Slider.Range className="absolute bg-sky-600 rounded-full h-full" />
            </Slider.Track>
            <Slider.Thumb
              className="block w-4 h-4 bg-white border-2 border-sky-600 rounded-full shadow cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-300"
              aria-label="Brush size"
            />
          </Slider.Root>
        </div>

        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Layer Order</div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Swap layer order"
              title="Swap layer order"
              className="shrink-0 w-9 h-9 rounded-full bg-sky-600 text-white hover:bg-sky-700 cursor-pointer flex items-center justify-center text-lg leading-none"
              onClick={animateSwap}
            >
              ⇅
            </button>
            <div className="flex-1 min-w-0 text-sm">
              <div ref={topRowRef} className="flex items-center gap-2 py-1">
                <LayerIcon className="shrink-0 w-4 h-4 text-gray-500" />
                <span className="font-semibold text-gray-900 truncate">{topName}</span>
              </div>
              <div className="border-t border-gray-200" />
              <div ref={bottomRowRef} className="flex items-center gap-2 py-1">
                <LayerIcon className="shrink-0 w-4 h-4 text-gray-300" />
                <span className="text-gray-400 truncate">{bottomName}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pt-3 border-t border-gray-200 text-sm font-medium text-sky-700">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onAboutClick();
            }}
          >
            About
          </a>
          <a href="http://chriswhong.com/local/building-urban-scratchoff/" target="_blank" rel="noopener" className="inline-flex items-center gap-1">
            Blog Post
          </a>
          <a
            href="https://github.com/chriswhong/urbanscratchoff"
            target="_blank"
            rel="noopener"
            aria-label="Github"
            title="Github"
            className="inline-flex items-center"
          >
            <i className="fa-brands fa-github text-base leading-none" />
          </a>
        </div>
      </div>
    </div>
  );
}
