$(document).ready(function () {
  // ---- config -------------------------------------------------------

  var TILE_SIZE = 256;
  var BRUSH_RADIUS = 30; // scales with zoom -- see applyStampToTile()
  var BORDER_LINE_WIDTH = 8; // constant screen pixels -- see the border-layer section below
  var UNION_FLUSH_DELAY = 80; // ms, batches circles sent to the border worker
  var MAX_TILE_SPAN = 20; // per-axis cap on tiles considered, guards against huge pitched viewports
  var MAX_CACHED_TILES = 400; // simple memory cap for the scratch tile cache

  var tileLayers = [
    {
      name: "Present Day Aerials",
      url: "https://maps.nyc.gov/xyz/1.0.0/photo/2018/{z}/{x}/{y}.png8",
    },
    {
      name: "1924 Aerials",
      url: "https://maps.nyc.gov/xyz/1.0.0/photo/1924/{z}/{x}/{y}.png8",
    },
  ];

  var scratchoffMode = true;
  var panModifierHeld = false;
  var isDrawing = false;
  var baseSourceId = "base-tiles";
  var baseLayerId = "base-layer";
  var scratchLayer = null;

  // ---- border layer state ---------------------------------------------
  //
  // The white "torn edge" border is a real vector line layer tracing the
  // union of every scratch ever made, rather than something baked into the
  // raster tiles -- see the big comment above ensureBorderLayer() for why.
  var borderSourceId = "scratch-border";
  var borderLayerId = "scratch-border-line";
  var pendingCircles = [];
  var unionFlushTimer = null;
  // The union itself is computed in a Web Worker (see border-worker.js) so
  // turf.union() never blocks scratching or event handling on the main
  // thread, no matter how expensive it gets over a long session.
  var borderWorker = new Worker("js/border-worker.js");
  borderWorker.onmessage = function (e) {
    var source = map.getSource(borderSourceId);
    if (!source) return;
    var feature = e.data.feature;
    source.setData(feature ? turf.featureCollection([feature]) : turf.featureCollection([]));
  };

  // ---- map setup ------------------------------------------------------

  var map = new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
      sources: {},
      layers: [
        {
          id: "bg",
          type: "background",
          paint: { "background-color": "#1f4b61" },
        },
      ],
    },
    center: [-73.99, 40.7],
    zoom: 14,
    hash: true,
    renderWorldCopies: false,
  });

  map.addControl(new maplibregl.NavigationControl());

  map.on("load", function () {
    addTileLayers(tileLayers);

    // Zoom, rotate, and pitch all use gestures (scroll wheel, two-finger
    // touch, right-button/Ctrl+drag) that never collide with a plain
    // single-button/single-finger scratch drag, so they stay on
    // unconditionally in both UI modes. Only dragPan needs to be gated --
    // see setMode()/updateDragPan() below.
    map.scrollZoom.enable();
    map.doubleClickZoom.enable();
    map.touchZoomRotate.enable();
    map.touchPitch.enable();
    map.dragRotate.enable();
    map.keyboard.enable();
    // MapLibre's default Shift+drag gesture is boxZoom (draw a box to zoom
    // into); we repurpose Shift+drag as the pan modifier instead, so this
    // has to stay off to avoid the two fighting over the same gesture.
    map.boxZoom.disable();

    setMode(scratchoffMode);
  });

  function addTileLayers(layers) {
    var bottomLayer = layers[0],
      topLayer = layers[1];

    $("#bottomLayerButton").text(bottomLayer.name);
    $("#topLayerButton").text(topLayer.name);

    if (map.getLayer(baseLayerId)) map.removeLayer(baseLayerId);
    if (map.getSource(baseSourceId)) map.removeSource(baseSourceId);
    if (scratchLayer) map.removeLayer(scratchLayer.id);

    map.addSource(baseSourceId, {
      type: "raster",
      tiles: [bottomLayer.url],
      tileSize: TILE_SIZE,
    });
    map.addLayer({
      id: baseLayerId,
      type: "raster",
      source: baseSourceId,
    });

    scratchLayer = new ScratchLayer("scratch-layer", topLayer.url);
    map.addLayer(scratchLayer);

    // Swapping recreates the scratch layer from scratch, so the border
    // (which traces its erased area) has to reset along with it.
    resetBorder();
    ensureBorderLayer();
  }

  // ---- Custom WebGL "canvas layer" ------------------------------------
  //
  // Each visible tile gets an offscreen 2D <canvas> holding that tile's
  // image, into which scratching draws destination-out circles directly
  // (erasing an already-transparent area is always a clean no-op, so this
  // unions correctly regardless of path shape or draw order). The canvas is
  // uploaded as a GL texture and drawn as a textured quad positioned with
  // Mercator coordinates through the projection matrix MapLibre hands us
  // in render() -- the same matrix it uses to draw every other layer -- so
  // the overlay stays correctly warped under pitch and rotation.
  //
  // The white border is handled entirely separately, as a real vector line
  // layer -- see the border-layer section below for why.

  function ScratchLayer(id, tileUrlTemplate) {
    this.id = id;
    this.type = "custom";
    this.renderingMode = "2d";
    this.tileUrlTemplate = tileUrlTemplate;
    this.tiles = new Map();
    this.tileZ = null;
    // Every scratch ever made, as a Mercator point plus the tile zoom it
    // was made at (used to scale its erase radius geospatially) -- see
    // rebuildTile() for why this persistent, zoom-independent record is
    // what makes scratches survive crossing a zoom threshold instead of
    // vanishing into a fresh, unscratched tile grid.
    this.stamps = [];
  }

  ScratchLayer.prototype.onAdd = function (map, gl) {
    this.map = map;
    this.gl = gl;

    var vertexSrc = [
      "attribute vec2 a_pos;",
      "uniform mat4 u_matrix;",
      "uniform vec2 u_tileOrigin;",
      "uniform float u_tileScale;",
      "varying vec2 v_texcoord;",
      "void main() {",
      "  vec2 mercPos = u_tileOrigin + a_pos * u_tileScale;",
      "  gl_Position = u_matrix * vec4(mercPos, 0.0, 1.0);",
      "  v_texcoord = vec2(a_pos.x, a_pos.y);",
      "}",
    ].join("\n");

    var fragmentSrc = [
      "precision mediump float;",
      "uniform sampler2D u_sampler;",
      "varying vec2 v_texcoord;",
      "void main() {",
      "  gl_FragColor = texture2D(u_sampler, v_texcoord);",
      "}",
    ].join("\n");

    this.program = createProgram(gl, vertexSrc, fragmentSrc);
    this.aPos = gl.getAttribLocation(this.program, "a_pos");
    this.uMatrix = gl.getUniformLocation(this.program, "u_matrix");
    this.uTileOrigin = gl.getUniformLocation(this.program, "u_tileOrigin");
    this.uTileScale = gl.getUniformLocation(this.program, "u_tileScale");
    this.uSampler = gl.getUniformLocation(this.program, "u_sampler");

    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      gl.STATIC_DRAW
    );
  };

  ScratchLayer.prototype.onRemove = function () {
    var gl = this.gl;
    if (!gl) return;
    this.tiles.forEach(function (tile) {
      if (tile.texture) gl.deleteTexture(tile.texture);
    });
    this.tiles.clear();
    if (this.program) gl.deleteProgram(this.program);
    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
  };

  ScratchLayer.prototype.getTileKey = function (z, x, y) {
    return z + ":" + x + ":" + y;
  };

  ScratchLayer.prototype.getOrCreateTile = function (z, x, y) {
    var key = this.getTileKey(z, x, y);
    var tile = this.tiles.get(key);
    if (tile) {
      tile.lastUsed = performance.now();
      return tile;
    }

    var canvas = document.createElement("canvas");
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;

    tile = {
      canvas: canvas,
      ctx: canvas.getContext("2d"),
      texture: null,
      loaded: false,
      dirty: false,
      lastUsed: performance.now(),
    };
    this.tiles.set(key, tile);

    var self = this;
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function () {
      tile.ctx.drawImage(img, 0, 0, TILE_SIZE, TILE_SIZE);
      tile.loaded = true;
      // Replay scratch history now that there's an image to erase into --
      // covers a fresh zoom level, a tile scrolled back into view, or one
      // recreated after cache eviction, all of which would otherwise show
      // up unscratched even though the ground they cover has been
      // scratched. (Erasing before the image loads would just be wiped out
      // by this drawImage call, so history replay has to happen after it.)
      self.rebuildTile(tile, z, x, y);
      tile.dirty = true;
      self.map.triggerRepaint();
    };
    img.src = tileUrl(this.tileUrlTemplate, z, x, y);

    this.pruneCache();

    return tile;
  };

  ScratchLayer.prototype.pruneCache = function () {
    if (this.tiles.size <= MAX_CACHED_TILES) return;
    var entries = Array.from(this.tiles.entries());
    entries.sort(function (a, b) {
      return a[1].lastUsed - b[1].lastUsed;
    });
    var gl = this.gl;
    var toRemove = entries.slice(0, entries.length - MAX_CACHED_TILES);
    var self = this;
    toRemove.forEach(function (entry) {
      if (entry[1].texture) gl.deleteTexture(entry[1].texture);
      self.tiles.delete(entry[0]);
    });
  };

  // Erases one recorded stamp into a specific tile's canvas. The radius
  // scales with how many zoom levels apart the stamp's original zoom and
  // this target tile's zoom are, so the same real-world ground area stays
  // scratched -- geospatially persistent, exactly like scratching a
  // physical object: zoom out one level and it covers twice the ground per
  // pixel, so the same hole looks twice the pixel size. Returns true if the
  // stamp was actually close enough to touch this tile.
  ScratchLayer.prototype.applyStampToTile = function (tile, stamp, targetZ, tx, ty) {
    var n = Math.pow(2, targetZ);
    var eraseRadius = BRUSH_RADIUS * Math.pow(2, targetZ - stamp.tileZ);

    var px = stamp.mercX * n * TILE_SIZE;
    var py = stamp.mercY * n * TILE_SIZE;
    var localX = px - tx * TILE_SIZE;
    var localY = py - ty * TILE_SIZE;

    if (
      localX < -eraseRadius ||
      localX > TILE_SIZE + eraseRadius ||
      localY < -eraseRadius ||
      localY > TILE_SIZE + eraseRadius
    ) {
      return false;
    }

    eraseCircle(tile.ctx, localX, localY, eraseRadius);
    return true;
  };

  // Replays every stamp ever made onto a (re)created tile, so it shows the
  // correct scratched state immediately -- see the comment where this is
  // called from getOrCreateTile()'s image load handler.
  ScratchLayer.prototype.rebuildTile = function (tile, z, x, y) {
    for (var i = 0; i < this.stamps.length; i++) {
      this.applyStampToTile(tile, this.stamps[i], z, x, y);
    }
  };

  // Erase a brush-radius circle at the given lngLat, spilling into
  // neighboring tiles when the brush overlaps a tile edge.
  ScratchLayer.prototype.scratchAt = function (lngLat) {
    var tileZ = this.tileZ;
    if (tileZ === null) return;

    var merc = maplibregl.MercatorCoordinate.fromLngLat(lngLat);
    var stamp = { mercX: merc.x, mercY: merc.y, tileZ: tileZ };
    this.stamps.push(stamp);

    var n = Math.pow(2, tileZ);
    var px = merc.x * n * TILE_SIZE;
    var py = merc.y * n * TILE_SIZE;
    var baseTileX = Math.floor(px / TILE_SIZE);
    var baseTileY = Math.floor(py / TILE_SIZE);

    var touched = false;
    for (var ty = baseTileY - 1; ty <= baseTileY + 1; ty++) {
      if (ty < 0 || ty >= n) continue;
      for (var tx = baseTileX - 1; tx <= baseTileX + 1; tx++) {
        if (tx < 0 || tx >= n) continue;

        var tile = this.getOrCreateTile(tileZ, tx, ty);
        if (!tile.loaded) continue;
        if (this.applyStampToTile(tile, stamp, tileZ, tx, ty)) {
          tile.dirty = true;
          touched = true;
        }
      }
    }

    if (touched) this.map.triggerRepaint();
  };

  ScratchLayer.prototype.render = function (gl, renderInput) {
    // MapLibre GL JS >= 5 passes a CustomRenderMethodInput object here
    // instead of a raw mat4; older versions passed the mat4 directly.
    // defaultProjectionData.mainMatrix maps plain 0..1 world Mercator
    // coordinates straight to clip space, matching MercatorCoordinate.
    var matrix =
      renderInput && renderInput.defaultProjectionData
        ? renderInput.defaultProjectionData.mainMatrix
        : renderInput;
    var map = this.map;
    var zoom = Math.round(map.getZoom());
    var tileZ = Math.max(0, Math.min(20, zoom));
    this.tileZ = tileZ;

    var range = getTileRange(map, tileZ);
    if (!range) return;

    gl.useProgram(this.program);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);

    var n = Math.pow(2, tileZ);

    for (var y = range.yMin; y <= range.yMax; y++) {
      for (var x = range.xMin; x <= range.xMax; x++) {
        var tile = this.getOrCreateTile(tileZ, x, y);
        if (!tile.loaded) continue;

        gl.activeTexture(gl.TEXTURE0);

        if (!tile.texture) {
          tile.texture = createTileTexture(gl);
        }
        gl.bindTexture(gl.TEXTURE_2D, tile.texture);

        if (tile.dirty) {
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            tile.canvas
          );
          tile.dirty = false;
        }

        gl.uniformMatrix4fv(this.uMatrix, false, matrix);
        gl.uniform2f(this.uTileOrigin, x / n, y / n);
        gl.uniform1f(this.uTileScale, 1 / n);
        gl.uniform1i(this.uSampler, 0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    }
  };

  // ---- border layer (vector line) ---------------------------------------
  //
  // The white "torn edge" border used to be baked into the raster tiles
  // (an extra ring stamped around each erase circle). That worked, but its
  // thickness was measured in tile-texel space, which only equals true
  // screen pixels when the current zoom exactly matches the tile grid's own
  // integer zoom -- in between, MapLibre continuously scales the whole tile
  // texture up or down, so the border's apparent pixel width drifted
  // continuously and then visibly snapped/reset the instant the tile grid
  // switched to a new integer zoom.
  //
  // Real MapLibre vector layers don't have that problem: a `line-width` is
  // rendered at that many screen pixels continuously across zoom, with no
  // integer-snapping, because MapLibre's vector renderer is built to do
  // exactly that. So the border is instead a genuine GeoJSON line layer
  // tracing the true outer boundary of the union of every scratch ever
  // made. Turf.js computes that union: each stamp becomes a circle polygon
  // (sized in real-world meters, matching the raster erase hole's own
  // geospatial scaling), folded into one running unioned polygon.
  //
  // Posting circles to the worker on every single stamp would still be
  // wasteful message-passing overhead -- dragging can generate dozens of
  // interpolated stamps per second -- so new circles are queued and sent as
  // one batch at most every UNION_FLUSH_DELAY ms, with an immediate flush
  // on gesture end so the border doesn't lag visibly after releasing. The
  // union computation itself never blocks the main thread either way (see
  // borderWorker above), so this delay is purely about batching, not
  // waiting out an expensive computation.

  function metersPerPixel(lat, zoom) {
    return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  }

  function queueBorderCircle(lngLat, tileZ) {
    var radiusMeters = BRUSH_RADIUS * metersPerPixel(lngLat.lat, tileZ);
    pendingCircles.push(
      turf.circle([lngLat.lng, lngLat.lat], radiusMeters, {
        steps: 12,
        units: "meters",
      })
    );
    if (!unionFlushTimer) {
      unionFlushTimer = setTimeout(flushBorderUnion, UNION_FLUSH_DELAY);
    }
  }

  function flushBorderUnion() {
    unionFlushTimer = null;
    if (pendingCircles.length === 0) return;
    var newCircles = pendingCircles;
    pendingCircles = [];
    borderWorker.postMessage({ type: "addCircles", circles: newCircles });
  }

  // Cancels any pending circles and clears the rendered border -- called
  // whenever the scratch layer itself resets (e.g. on swap), so the border
  // never ends up tracing an area that's no longer actually scratched.
  function resetBorder() {
    pendingCircles = [];
    if (unionFlushTimer) {
      clearTimeout(unionFlushTimer);
      unionFlushTimer = null;
    }
    borderWorker.postMessage({ type: "reset" });
    var source = map.getSource(borderSourceId);
    if (source) source.setData(turf.featureCollection([]));
  }

  // Adds the border source/layer the first time, or just moves it back to
  // the top of the stack on subsequent calls (addTileLayers just recreated
  // the raster and scratch layers above it).
  function ensureBorderLayer() {
    if (!map.getSource(borderSourceId)) {
      map.addSource(borderSourceId, {
        type: "geojson",
        data: turf.featureCollection([]),
      });
    }
    if (!map.getLayer(borderLayerId)) {
      map.addLayer({
        id: borderLayerId,
        type: "line",
        source: borderSourceId,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ffffff", "line-width": BORDER_LINE_WIDTH },
      });
    } else {
      map.moveLayer(borderLayerId);
    }
  }

  // ---- shared helpers ---------------------------------------------------

  function tileUrl(template, z, x, y) {
    return template
      .replace("{z}", z)
      .replace("{x}", x)
      .replace("{y}", y);
  }

  function createShader(gl, type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      var info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error("Shader compile error: " + info);
    }
    return shader;
  }

  function createTileTexture(gl) {
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
  }

  function createProgram(gl, vertexSrc, fragmentSrc) {
    var program = gl.createProgram();
    gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vertexSrc));
    gl.attachShader(
      program,
      createShader(gl, gl.FRAGMENT_SHADER, fragmentSrc)
    );
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      var info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error("Program link error: " + info);
    }
    return program;
  }

  // Determine the range of z/x/y tiles covering the current viewport at a
  // given integer zoom, clamped to a sane maximum span so a heavily pitched
  // view (whose bounds can balloon toward the horizon) doesn't try to
  // request thousands of tiles.
  function getTileRange(map, z) {
    var n = Math.pow(2, z);
    var bounds = map.getBounds();
    var maxLat = 85.05112878;

    var sw = bounds.getSouthWest();
    var ne = bounds.getNorthEast();

    var nw = maplibregl.MercatorCoordinate.fromLngLat({
      lng: sw.lng,
      lat: Math.max(-maxLat, Math.min(maxLat, ne.lat)),
    });
    var se = maplibregl.MercatorCoordinate.fromLngLat({
      lng: ne.lng,
      lat: Math.max(-maxLat, Math.min(maxLat, sw.lat)),
    });

    var xMin = Math.floor(nw.x * n);
    var xMax = Math.floor(se.x * n);
    var yMin = Math.floor(nw.y * n);
    var yMax = Math.floor(se.y * n);

    xMin = Math.max(0, xMin);
    xMax = Math.min(n - 1, xMax);
    yMin = Math.max(0, yMin);
    yMax = Math.min(n - 1, yMax);

    if (xMax - xMin > MAX_TILE_SPAN) {
      var cx = Math.floor((xMin + xMax) / 2);
      xMin = Math.max(0, cx - MAX_TILE_SPAN / 2);
      xMax = Math.min(n - 1, cx + MAX_TILE_SPAN / 2);
    }
    if (yMax - yMin > MAX_TILE_SPAN) {
      var cy = Math.floor((yMin + yMax) / 2);
      yMin = Math.max(0, cy - MAX_TILE_SPAN / 2);
      yMax = Math.min(n - 1, cy + MAX_TILE_SPAN / 2);
    }

    if (xMin > xMax || yMin > yMax) return null;

    return { xMin: xMin, xMax: xMax, yMin: yMin, yMax: yMax };
  }

  // Punches a transparent hole directly into a tile's image canvas.
  // destination-out is idempotent -- erasing an already-transparent area is
  // always a no-op -- so this unions correctly no matter the path shape,
  // draw order, or number of separate gestures, with no extra bookkeeping
  // needed (unlike drawing an opaque stroke, which would have to worry
  // about repainting over previously-erased pixels).
  function eraseCircle(ctx, x, y, radius) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0, 0, 0, 1)";
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2, false);
    ctx.fill();
  }

  // ---- interaction ------------------------------------------------------

  // dragPan is the only interaction that's ever gated: it shares the same
  // plain left-button/single-finger drag gesture as scratching, so only one
  // of them can own it at a time. It's on permanently in "Pan & Zoom Map"
  // mode, and otherwise only while the pan modifier key is held (which
  // pre-enables it on keydown -- see below -- so it's already active
  // *before* the next mousedown, avoiding a race with MapLibre's own
  // internal drag handler).
  function updateDragPan() {
    if (!scratchoffMode || panModifierHeld) {
      map.dragPan.enable();
    } else {
      map.dragPan.disable();
    }
  }

  function updateCursor() {
    var panning = !scratchoffMode || panModifierHeld;
    map.getCanvas().style.cursor = panning ? "grab" : "crosshair";
  }

  function setMode(scratching) {
    scratchoffMode = scratching;
    updateDragPan();
    updateCursor();
  }

  // Hold Shift while dragging in Scratch Off mode to pan the map instead of
  // scratching -- Ctrl/Cmd+drag and right-drag are left to MapLibre's own
  // always-on dragRotate handler for pitch/rotate (see onScratchStart).
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

  var lastPoint = null;
  var STAMP_SPACING = BRUSH_RADIUS / 3;

  // Erases into the raster tile and queues the matching border circle
  // together, so the two stay in sync at every stamp.
  function scratchAndBorder(lngLat) {
    var tileZ = scratchLayer.tileZ;
    scratchLayer.scratchAt(lngLat);
    if (tileZ !== null) queueBorderCircle(lngLat, tileZ);
  }

  // Stamp repeatedly along a screen-space segment so fast drags (or sparse
  // mousemove events) don't leave gaps -- purely cosmetic now (every stamp
  // unions correctly regardless of spacing), just keeps the swept shape
  // looking like one continuous capsule instead of a string of beads.
  function stampAlong(fromPoint, toPoint) {
    var dx = toPoint.x - fromPoint.x;
    var dy = toPoint.y - fromPoint.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var steps = Math.max(1, Math.ceil(dist / STAMP_SPACING));
    for (var i = 1; i <= steps; i++) {
      var t = i / steps;
      var pt = { x: fromPoint.x + dx * t, y: fromPoint.y + dy * t };
      scratchAndBorder(map.unproject(pt));
    }
  }

  // True for a gesture MapLibre's always-on dragRotate handler owns
  // (Ctrl/Cmd+drag or right-button drag) or for a Shift-held pan drag --
  // in both cases we defer entirely rather than also scratching.
  function isNavigationGesture(e) {
    var oe = e.originalEvent;
    if (!oe) return false;
    return !!(oe.shiftKey || oe.ctrlKey || oe.metaKey || oe.button === 2);
  }

  function onScratchStart(e) {
    if (!scratchoffMode || isNavigationGesture(e)) return;
    isDrawing = true;
    lastPoint = e.point;
    scratchAndBorder(e.lngLat);
  }

  function onScratchMove(e) {
    if (!scratchoffMode || !isDrawing) return;
    if (lastPoint) {
      stampAlong(lastPoint, e.point);
    } else {
      scratchAndBorder(e.lngLat);
    }
    lastPoint = e.point;
  }

  function onScratchEnd() {
    isDrawing = false;
    lastPoint = null;
    // Flush immediately rather than waiting for the throttle timer, so the
    // border doesn't visibly lag after the gesture actually ends.
    if (unionFlushTimer) {
      clearTimeout(unionFlushTimer);
      unionFlushTimer = null;
    }
    flushBorderUnion();
  }

  map.on("mousedown", onScratchStart);
  map.on("mousemove", onScratchMove);
  map.on("mouseup", onScratchEnd);
  map.on("touchstart", onScratchStart);
  map.on("touchmove", onScratchMove);
  map.on("touchend", onScratchEnd);
  window.addEventListener("mouseup", onScratchEnd);
  window.addEventListener("touchend", onScratchEnd);

  // ---- UI wiring ----------------------------------------------------

  $("#modePanAndZoom").click(function () {
    $(".btn-mode").removeClass("active");
    $(this).addClass("active");
    setMode(false);
  });

  $("#modeScratchoff").click(function () {
    $(".btn-mode").removeClass("active");
    $(this).addClass("active");
    setMode(true);
  });

  $("#swap").click(function () {
    var temp = tileLayers[0];
    tileLayers[0] = tileLayers[1];
    tileLayers[1] = temp;

    addTileLayers(tileLayers);
  });

  $("#about-btn").click(function () {
    $("#aboutModal").modal("show");
    return false;
  });
});
