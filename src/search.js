import maplibregl from "maplibre-gl";

// ---- Address search (geocode.earth) --------------------------------
//
// Autocompletes as the user types, lets them pick a result, flies the
// map there, and drops a marker with the picked address in a label
// above it. Requires VITE_GEOCODE_EARTH_API_KEY (see .env.example).

const API_BASE = "https://api.geocode.earth/v1";
const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 3;

// Loosely covers the five boroughs -- keeps results relevant to what
// this app is actually about, rather than matching "Broadway" anywhere
// in the country.
const NYC_BOUNDS = { minLon: -74.26, minLat: 40.49, maxLon: -73.68, maxLat: 40.92 };

const PIN_SVG =
  '<svg width="22" height="28" viewBox="0 0 22 28" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M11 0C4.9 0 0 4.9 0 11c0 8.25 11 17 11 17s11-8.75 11-17C22 4.9 17.1 0 11 0z" fill="#0284c7"/>' +
  '<circle cx="11" cy="11" r="4" fill="white"/>' +
  "</svg>";

export function setupSearch(map) {
  const apiKey = import.meta.env.VITE_GEOCODE_EARTH_API_KEY;
  const searchBox = document.getElementById("search-box");
  const input = document.getElementById("search-input");
  const clearBtn = document.getElementById("search-clear");
  const resultsBox = document.getElementById("search-results");

  if (!apiKey) {
    console.warn("Search disabled: VITE_GEOCODE_EARTH_API_KEY is not set (see .env.example).");
    searchBox.classList.add("hidden");
    return;
  }

  setupResponsivePlacement(searchBox);

  let marker = null;
  let debounceTimer = null;
  let abortController = null;

  function clearMarker() {
    if (marker) {
      marker.remove();
      marker = null;
    }
  }

  function hideResults() {
    resultsBox.classList.add("hidden");
    resultsBox.innerHTML = "";
  }

  function showResults(features) {
    resultsBox.innerHTML = "";
    if (features.length === 0) {
      hideResults();
      return;
    }
    features.forEach(function (feature) {
      const row = document.createElement("button");
      row.type = "button";
      row.className =
        "search-result block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 truncate";
      row.textContent = feature.properties.label;
      row.addEventListener("click", function () {
        selectFeature(feature);
      });
      resultsBox.appendChild(row);
    });
    resultsBox.classList.remove("hidden");
  }

  function selectFeature(feature) {
    const [lng, lat] = feature.geometry.coordinates;
    const label = feature.properties.label;

    input.value = label;
    clearBtn.classList.remove("hidden");
    hideResults();
    clearMarker();

    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16) });

    const el = document.createElement("div");
    el.className = "flex flex-col items-center pointer-events-none";

    const bubble = document.createElement("div");
    bubble.className =
      "bg-white rounded-lg shadow-lg px-3 py-1.5 mb-1 text-xs font-medium text-gray-900 max-w-[220px] truncate";
    bubble.textContent = label;
    el.appendChild(bubble);

    const pin = document.createElement("div");
    pin.innerHTML = PIN_SVG;
    el.appendChild(pin.firstElementChild);

    marker = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([lng, lat]).addTo(map);
  }

  function clearSearch() {
    input.value = "";
    clearBtn.classList.add("hidden");
    hideResults();
    clearMarker();
    input.focus();
  }

  function fetchResults(text) {
    if (abortController) abortController.abort();
    abortController = new AbortController();

    const center = map.getCenter();
    const url =
      API_BASE +
      "/autocomplete?api_key=" +
      encodeURIComponent(apiKey) +
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

    fetch(url, { signal: abortController.signal })
      .then(function (res) {
        if (!res.ok) throw new Error("geocode.earth request failed: " + res.status);
        return res.json();
      })
      .then(function (data) {
        // Staten Island's westward extent unavoidably overlaps New
        // Jersey's longitude range (Newark, Passaic, etc. sit at similar
        // or even less extreme longitudes, just further north), so the
        // rect above can't geometrically exclude them on its own. Belt
        // and suspenders: drop anything not explicitly in NY state.
        const features = (data.features || []).filter(function (f) {
          return f.properties.region === undefined || f.properties.region === "New York";
        });
        showResults(features);
      })
      .catch(function (err) {
        if (err.name !== "AbortError") {
          console.error("Search failed:", err);
          hideResults();
        }
      });
  }

  input.addEventListener("input", function () {
    const text = input.value.trim();
    clearBtn.classList.toggle("hidden", text.length === 0);

    window.clearTimeout(debounceTimer);
    if (text.length < MIN_QUERY_LENGTH) {
      hideResults();
      return;
    }
    debounceTimer = window.setTimeout(function () {
      fetchResults(text);
    }, DEBOUNCE_MS);
  });

  input.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      hideResults();
    } else if (e.key === "Enter") {
      const first = resultsBox.querySelector(".search-result");
      if (first) first.click();
    }
  });

  clearBtn.addEventListener("click", clearSearch);

  document.addEventListener("click", function (e) {
    if (!searchBox.contains(e.target)) hideResults();
  });
}

// The search box sits in the document as a normal part of the main panel
// (right after the byline) so it's naturally part of the panel's mobile
// layout with no positioning math needed. On wider screens it needs to
// pop out as its own independent floating box in the top-right corner --
// but #panel has `backdrop-blur` (backdrop-filter), which per spec makes
// it a containing block for any `position:fixed` descendant, trapping
// the search box's fixed positioning relative to the panel instead of
// the viewport. Physically moving it to be a direct child of <body> at
// the desktop breakpoint sidesteps that; moving it back keeps the mobile
// layout intact if the window is resized back down.
function setupResponsivePlacement(searchBox) {
  const byline = document.getElementById("byline");
  const mql = window.matchMedia("(min-width: 640px)");

  function place(isDesktop) {
    if (isDesktop) {
      if (searchBox.parentElement !== document.body) {
        document.body.appendChild(searchBox);
      }
    } else if (searchBox.previousElementSibling !== byline) {
      byline.insertAdjacentElement("afterend", searchBox);
    }
  }

  place(mql.matches);
  mql.addEventListener("change", function (e) {
    place(e.matches);
  });
}
