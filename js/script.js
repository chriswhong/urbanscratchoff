$(document).ready(function () {
  // ---- config -------------------------------------------------------

  var TILE_SIZE = 256;
  var BRUSH_RADIUS = 30;
  var BORDER_WIDTH = 8; // extra radius, beyond the erase hole, painted white
  var BORDER_RADIUS = BRUSH_RADIUS + BORDER_WIDTH;
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
  var isDrawing = false;
  var baseSourceId = "base-tiles";
  var baseLayerId = "base-layer";
  var scratchLayer = null;

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

  map.on("load", function () {
    addTileLayers(tileLayers);
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
  }

  // ---- Custom WebGL "canvas layer" ------------------------------------
  //
  // Each visible tile gets two offscreen 2D <canvas> elements: one holding
  // the tile's image (drawn once, read-only after that), and one "mask"
  // canvas that scratching stamps into -- see the comment on stampMask()
  // for why the mask uses two separate additive channels (border + erase)
  // rather than drawing directly into the image. Both canvases are
  // uploaded as GL textures and drawn as a textured quad positioned with
  // Mercator coordinates through the projection matrix MapLibre hands us
  // in render() -- the same matrix it uses to draw every other layer -- so
  // the overlay stays correctly warped under pitch and rotation.

  function ScratchLayer(id, tileUrlTemplate) {
    this.id = id;
    this.type = "custom";
    this.renderingMode = "2d";
    this.tileUrlTemplate = tileUrlTemplate;
    this.tiles = new Map();
    this.tileZ = null;
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

    // u_maskSampler encodes two independent, purely-additive coverage masks
    // in one texture: red = "within the border band", green = "erased".
    // Erase always wins over border, border always wins over the original
    // image -- see the big comment on stampMask() for why this composite
    // approach (rather than drawing an opaque stroke into the image itself)
    // is what makes the border trace the true union of the whole scratched
    // area, correctly, regardless of path shape or draw order.
    var fragmentSrc = [
      "precision mediump float;",
      "uniform sampler2D u_imageSampler;",
      "uniform sampler2D u_maskSampler;",
      "varying vec2 v_texcoord;",
      "void main() {",
      "  vec4 img = texture2D(u_imageSampler, v_texcoord);",
      "  vec4 mask = texture2D(u_maskSampler, v_texcoord);",
      "  float bordered = mask.r;",
      "  float erased = mask.g;",
      "  vec3 rgb = mix(img.rgb, vec3(1.0), bordered);",
      "  float alpha = 1.0 - erased;",
      "  gl_FragColor = vec4(rgb * alpha, alpha);",
      "}",
    ].join("\n");

    this.program = createProgram(gl, vertexSrc, fragmentSrc);
    this.aPos = gl.getAttribLocation(this.program, "a_pos");
    this.uMatrix = gl.getUniformLocation(this.program, "u_matrix");
    this.uTileOrigin = gl.getUniformLocation(this.program, "u_tileOrigin");
    this.uTileScale = gl.getUniformLocation(this.program, "u_tileScale");
    this.uImageSampler = gl.getUniformLocation(this.program, "u_imageSampler");
    this.uMaskSampler = gl.getUniformLocation(this.program, "u_maskSampler");

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
      if (tile.imageTexture) gl.deleteTexture(tile.imageTexture);
      if (tile.maskTexture) gl.deleteTexture(tile.maskTexture);
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

    var imageCanvas = document.createElement("canvas");
    imageCanvas.width = TILE_SIZE;
    imageCanvas.height = TILE_SIZE;

    var maskCanvas = document.createElement("canvas");
    maskCanvas.width = TILE_SIZE;
    maskCanvas.height = TILE_SIZE;

    tile = {
      imageCanvas: imageCanvas,
      imageCtx: imageCanvas.getContext("2d"),
      imageTexture: null,
      loaded: false,
      // The image is drawn once on load and never touched again, so it
      // only ever needs a single upload.
      imageUploaded: false,
      maskCanvas: maskCanvas,
      maskCtx: maskCanvas.getContext("2d"),
      maskTexture: null,
      maskDirty: false,
      lastUsed: performance.now(),
    };
    this.tiles.set(key, tile);

    var self = this;
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function () {
      tile.imageCtx.drawImage(img, 0, 0, TILE_SIZE, TILE_SIZE);
      tile.loaded = true;
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
      if (entry[1].imageTexture) gl.deleteTexture(entry[1].imageTexture);
      if (entry[1].maskTexture) gl.deleteTexture(entry[1].maskTexture);
      self.tiles.delete(entry[0]);
    });
  };

  // Erase a brush-radius circle at the given lngLat, spilling into
  // neighboring tiles when the brush overlaps a tile edge.
  ScratchLayer.prototype.scratchAt = function (lngLat) {
    var tileZ = this.tileZ;
    if (tileZ === null) return;

    var n = Math.pow(2, tileZ);
    var merc = maplibregl.MercatorCoordinate.fromLngLat(lngLat);
    var px = merc.x * n * TILE_SIZE;
    var py = merc.y * n * TILE_SIZE;
    var baseTileX = Math.floor(px / TILE_SIZE);
    var baseTileY = Math.floor(py / TILE_SIZE);

    var touched = false;
    for (var ty = baseTileY - 1; ty <= baseTileY + 1; ty++) {
      if (ty < 0 || ty >= n) continue;
      for (var tx = baseTileX - 1; tx <= baseTileX + 1; tx++) {
        if (tx < 0 || tx >= n) continue;

        var localX = px - tx * TILE_SIZE;
        var localY = py - ty * TILE_SIZE;
        if (
          localX < -BORDER_RADIUS ||
          localX > TILE_SIZE + BORDER_RADIUS ||
          localY < -BORDER_RADIUS ||
          localY > TILE_SIZE + BORDER_RADIUS
        ) {
          continue;
        }

        var tile = this.getOrCreateTile(tileZ, tx, ty);
        if (!tile.loaded) continue;

        stampMask(tile.maskCtx, localX, localY);
        tile.maskDirty = true;
        touched = true;
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

        // Unit 0: the tile image, uploaded once and never touched again.
        gl.activeTexture(gl.TEXTURE0);
        if (!tile.imageTexture) {
          tile.imageTexture = createTileTexture(gl);
        }
        gl.bindTexture(gl.TEXTURE_2D, tile.imageTexture);
        if (!tile.imageUploaded) {
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            tile.imageCanvas
          );
          tile.imageUploaded = true;
        }

        // Unit 1: the border/erase mask, re-uploaded whenever a scratch
        // touches this tile.
        gl.activeTexture(gl.TEXTURE1);
        if (!tile.maskTexture) {
          tile.maskTexture = createTileTexture(gl);
        }
        gl.bindTexture(gl.TEXTURE_2D, tile.maskTexture);
        if (tile.maskDirty) {
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            tile.maskCanvas
          );
          tile.maskDirty = false;
        }

        gl.uniformMatrix4fv(this.uMatrix, false, matrix);
        gl.uniform2f(this.uTileOrigin, x / n, y / n);
        gl.uniform1f(this.uTileScale, 1 / n);
        gl.uniform1i(this.uImageSampler, 0);
        gl.uniform1i(this.uMaskSampler, 1);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    }
  };

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

  // Stamps two independent, purely-additive coverage circles into a tile's
  // mask canvas: a bigger "border" circle (red channel) and a smaller
  // "erase" circle (green channel), using globalCompositeOperation =
  // "lighter" (additive/clamped blending) so each channel only ever grows,
  // regardless of draw order.
  //
  // This matters because a decorative stroke drawn with source-over
  // unconditionally repaints opacity over whatever's beneath it -- if we'd
  // drawn a white ring directly per-stamp, each one would re-opacify a
  // sliver of area a *previous* stamp had already erased, and nothing
  // later would ever erase it again since drags keep moving forward. That
  // produced a persistent chain of ring fragments no matter how densely
  // stamps were packed, and per-gesture start/end caps still left a stray
  // ring whenever click-drag-release didn't return to the same spot.
  //
  // Keeping "border" and "erase" as separate monotonic accumulators (never
  // overwritten, only added to) and combining them in the fragment shader
  // (erase always wins over border, border always wins over the image)
  // instead makes the border trace the true outer boundary of the whole
  // union of everything ever scratched -- correct for any path shape,
  // draw order, or number of separate gestures.
  function stampMask(ctx, x, y) {
    ctx.globalCompositeOperation = "lighter";

    ctx.fillStyle = "rgba(255, 0, 0, 1)";
    ctx.beginPath();
    ctx.arc(x, y, BORDER_RADIUS, 0, Math.PI * 2, false);
    ctx.fill();

    ctx.fillStyle = "rgba(0, 255, 0, 1)";
    ctx.beginPath();
    ctx.arc(x, y, BRUSH_RADIUS, 0, Math.PI * 2, false);
    ctx.fill();
  }

  // ---- interaction ------------------------------------------------------

  function setMode(scratching) {
    scratchoffMode = scratching;

    var interactions = [
      "dragPan",
      "scrollZoom",
      "doubleClickZoom",
      "touchZoomRotate",
      "dragRotate",
      "keyboard",
      "touchPitch",
    ];
    interactions.forEach(function (name) {
      if (!map[name]) return;
      if (scratching) {
        map[name].disable();
      } else {
        map[name].enable();
      }
    });

    map.getCanvas().style.cursor = scratching ? "crosshair" : "grab";
  }

  var lastPoint = null;
  var STAMP_SPACING = BRUSH_RADIUS / 3;

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
      scratchLayer.scratchAt(map.unproject(pt));
    }
  }

  function onScratchStart(e) {
    if (!scratchoffMode) return;
    isDrawing = true;
    lastPoint = e.point;
    scratchLayer.scratchAt(e.lngLat);
  }

  function onScratchMove(e) {
    if (!scratchoffMode || !isDrawing) return;
    if (lastPoint) {
      stampAlong(lastPoint, e.point);
    } else {
      scratchLayer.scratchAt(e.lngLat);
    }
    lastPoint = e.point;
  }

  function onScratchEnd() {
    isDrawing = false;
    lastPoint = null;
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
