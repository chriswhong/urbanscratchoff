import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { NYC_BOUNDS } from "../constants";
import type { GeocodeFeature, GeocodeResponse } from "../types";

// ---- Address search (geocode.earth) --------------------------------
//
// Autocompletes as the user types, lets them pick a result, flies the
// map there, and drops a marker with the picked address in a label
// above it. Requires VITE_GEOCODE_EARTH_API_KEY (see .env.example).

const API_BASE = "https://api.geocode.earth/v1";
const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 3;

const PIN_SVG =
  '<svg width="22" height="28" viewBox="0 0 22 28" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M11 0C4.9 0 0 4.9 0 11c0 8.25 11 17 11 17s11-8.75 11-17C22 4.9 17.1 0 11 0z" fill="#0284c7"/>' +
  '<circle cx="11" cy="11" r="4" fill="white"/>' +
  "</svg>";

interface SearchBoxProps {
  map: MapLibreMap | null;
}

export function SearchBox({ map }: SearchBoxProps) {
  const apiKey = import.meta.env.VITE_GEOCODE_EARTH_API_KEY;
  const isDesktop = useMediaQuery("(min-width: 640px)");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeFeature[]>([]);
  const [showResults, setShowResults] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortController = useRef<AbortController | null>(null);

  useEffect(() => {
    function onDocumentClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setShowResults(false);
    }
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, []);

  // Clear the marker on unmount only -- selecting a new result replaces it
  // directly (see selectFeature), and clearing on every re-render would
  // wipe it out as soon as the surrounding state changes.
  useEffect(() => {
    return () => {
      markerRef.current?.remove();
    };
  }, []);

  if (!apiKey) {
    console.warn("Search disabled: VITE_GEOCODE_EARTH_API_KEY is not set (see .env.example).");
    return null;
  }

  function clearMarker() {
    markerRef.current?.remove();
    markerRef.current = null;
  }

  function fetchResults(text: string) {
    if (!map) return;
    abortController.current?.abort();
    const controller = new AbortController();
    abortController.current = controller;

    const center = map.getCenter();
    const url =
      API_BASE +
      "/autocomplete?api_key=" +
      encodeURIComponent(apiKey!) +
      "&text=" +
      encodeURIComponent(text) +
      "&focus.point.lat=" +
      center.lat +
      "&focus.point.lon=" +
      center.lng +
      "&boundary.rect.min_lon=" +
      NYC_BOUNDS.minLon +
      "&boundary.rect.min_lat=" +
      NYC_BOUNDS.minLat +
      "&boundary.rect.max_lon=" +
      NYC_BOUNDS.maxLon +
      "&boundary.rect.max_lat=" +
      NYC_BOUNDS.maxLat;

    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("geocode.earth request failed: " + res.status);
        return res.json() as Promise<GeocodeResponse>;
      })
      .then((data) => {
        // Staten Island's westward extent unavoidably overlaps New
        // Jersey's longitude range (Newark, Passaic, etc. sit at similar
        // or even less extreme longitudes, just further north), so the
        // rect above can't geometrically exclude them on its own. Belt
        // and suspenders: drop anything not explicitly in NY state.
        const features = (data.features || []).filter((f) => f.properties.region === undefined || f.properties.region === "New York");
        setResults(features);
        setShowResults(features.length > 0);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.error("Search failed:", err);
          setShowResults(false);
        }
      });
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    const text = e.target.value;
    setQuery(text);

    if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
    if (text.trim().length < MIN_QUERY_LENGTH) {
      setShowResults(false);
      return;
    }
    debounceTimer.current = window.setTimeout(() => fetchResults(text.trim()), DEBOUNCE_MS);
  }

  function selectFeature(feature: GeocodeFeature) {
    if (!map) return;
    const [lng, lat] = feature.geometry.coordinates;
    const label = feature.properties.label;

    setQuery(label);
    setShowResults(false);
    clearMarker();

    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16) });

    const el = document.createElement("div");
    el.className = "flex flex-col items-center pointer-events-none";

    const bubble = document.createElement("div");
    bubble.className = "bg-white rounded-lg shadow-lg px-3 py-1.5 mb-1 text-xs font-medium text-gray-900 max-w-[220px] truncate";
    bubble.textContent = label;
    el.appendChild(bubble);

    const pin = document.createElement("div");
    pin.innerHTML = PIN_SVG;
    el.appendChild(pin.firstElementChild!);

    markerRef.current = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([lng, lat]).addTo(map);
  }

  function clearSearch() {
    setQuery("");
    setShowResults(false);
    clearMarker();
    inputRef.current?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setShowResults(false);
    } else if (e.key === "Enter" && results.length > 0) {
      selectFeature(results[0]);
    }
  }

  const content = (
    <div
      id="search-box"
      ref={containerRef}
      className="mt-3 pt-3 border-t border-gray-200 sm:mt-0 sm:pt-0 sm:border-t-0 sm:fixed sm:top-2.5 sm:right-2.5 sm:w-72 sm:z-40 sm:bg-white/95 sm:backdrop-blur sm:rounded-xl sm:shadow-lg"
    >
      <div className="flex items-center gap-2 py-2 sm:px-3">
        <i className="fa-solid fa-magnifying-glass text-gray-400 text-sm" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search for an address…"
          autoComplete="off"
          className="flex-1 min-w-0 text-sm outline-none bg-transparent placeholder:text-gray-400"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
        />
        {query.length > 0 && (
          <button type="button" aria-label="Clear search" className="text-gray-400 hover:text-gray-700 cursor-pointer" onClick={clearSearch}>
            <i className="fa-solid fa-xmark" />
          </button>
        )}
      </div>
      {showResults && (
        <div className="border-t border-gray-200">
          <div className="max-h-72 overflow-y-auto">
            {results.map((feature, i) => (
              <button
                key={i}
                type="button"
                className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 truncate"
                onClick={() => selectFeature(feature)}
              >
                {feature.properties.label}
              </button>
            ))}
          </div>
          <a
            href="https://geocode.earth"
            target="_blank"
            rel="noopener"
            className="flex items-center gap-1 px-3 py-1.5 border-t border-gray-100 text-[11px] text-gray-400 hover:text-gray-500"
          >
            <img src="/assets/geocode-earth-pin.svg" alt="" className="w-2.5 h-2.5 opacity-60" />
            Powered by Geocode Earth
          </a>
        </div>
      )}
    </div>
  );

  // On desktop the search box floats independently in the top-right
  // corner; on mobile it renders in its normal place in the JSX tree
  // (inside the main panel, right after the byline). #panel has
  // `backdrop-blur`, which per spec makes it a containing block for any
  // `position:fixed` descendant, which would otherwise trap the search
  // box's fixed positioning relative to the panel instead of the
  // viewport -- portaling to <body> on desktop sidesteps that entirely.
  return isDesktop ? createPortal(content, document.body) : content;
}
