import { MercatorCoordinate } from "maplibre-gl";
import { TILE_SIZE, BRUSH_RADIUS, MAX_TILE_SPAN, MAX_CACHED_TILES } from "./constants.js";

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
// layer -- see border.js for why.

export function ScratchLayer(id, tileUrlTemplate) {
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
    // u_matrix here is *not* MapLibre's raw whole-mercator-world matrix --
    // it's that matrix pre-combined, in JS double precision, with this
    // specific tile's translate+scale (see combineTileMatrix()). Letting
    // the GPU's float32 vertex shader multiply a huge matrix scale
    // (needed to map the whole [0,1] mercator range at deep zoom) by a
    // tiny per-tile coordinate loses enough precision to visibly jitter,
    // worse the deeper you zoom in; doing that multiplication in JS
    // first keeps what the GPU actually sees well-conditioned.
    "uniform mat4 u_matrix;",
    "varying vec2 v_texcoord;",
    "void main() {",
    // Each tile is its own draw call, so its edge is computed
    // independently from its neighbor's -- close but not always
    // bit-identical, which can expose a hairline seam. Overscanning
    // very slightly makes tiles overlap a hair instead; CLAMP_TO_EDGE
    // just repeats the edge texel for the extra sliver, so it's
    // invisible.
    "  vec2 p = a_pos * 1.005 - 0.0025;",
    "  gl_Position = u_matrix * vec4(p, 0.0, 1.0);",
    "  v_texcoord = p;",
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
    z: z,
    x: x,
    y: y,
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

  var merc = MercatorCoordinate.fromLngLat(lngLat);
  var stamp = { mercX: merc.x, mercY: merc.y, tileZ: tileZ };
  this.stamps.push(stamp);

  var n = Math.pow(2, tileZ);
  var px = merc.x * n * TILE_SIZE;
  var py = merc.y * n * TILE_SIZE;
  var baseTileX = Math.floor(px / TILE_SIZE);
  var baseTileY = Math.floor(py / TILE_SIZE);

  // Make sure the tiles right around the stamp exist at the current zoom
  // -- a brand new one replays the full stamp history (including this
  // one, already pushed above) via rebuildTile once its image loads.
  for (var ty = baseTileY - 1; ty <= baseTileY + 1; ty++) {
    if (ty < 0 || ty >= n) continue;
    for (var tx = baseTileX - 1; tx <= baseTileX + 1; tx++) {
      if (tx < 0 || tx >= n) continue;
      this.getOrCreateTile(tileZ, tx, ty);
    }
  }

  // Apply this stamp to every already-loaded cached tile, at *any* zoom
  // -- not just the current one. Without this, a tile cached from an
  // earlier visit to a different zoom level (e.g. passed through while
  // panning before this scratch was made) would keep showing unscratched
  // imagery next time that zoom is revisited, since it's already loaded
  // and getOrCreateTile() would just hand it back as-is without ever
  // replaying this stamp into it.
  var touched = false;
  var self = this;
  this.tiles.forEach(function (tile) {
    if (!tile.loaded) return;
    if (self.applyStampToTile(tile, stamp, tile.z, tile.x, tile.y)) {
      tile.dirty = true;
      touched = true;
    }
  });

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
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tile.canvas);
        gl.generateMipmap(gl.TEXTURE_2D);
        tile.dirty = false;
      }

      var tileMatrix = combineTileMatrix(matrix, x / n, y / n, 1 / n);
      gl.uniformMatrix4fv(this.uMatrix, false, tileMatrix);
      gl.uniform1i(this.uSampler, 0);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }
};

// ---- module-private helpers --------------------------------------------

// Combines MapLibre's whole-mercator-world matrix with one tile's own
// translate (ox, oy) + uniform scale, in JS double precision, equivalent
// to `matrix * translate(ox, oy, 0) * scale(scale, scale, 1)`. Doing this
// multiplication here rather than in the vertex shader matters: at deep
// zoom, matrix's scale coefficients are huge (mapping the entire [0,1]
// mercator range), and multiplying that by a tiny per-tile coordinate in
// the GPU's float32 arithmetic loses enough precision to visibly jitter
// tiles as the camera's continuous zoom scale changes -- worse the
// further in you zoom. Pre-combining in double precision keeps the
// values the GPU actually multiplies (the combined matrix's own entries)
// well-conditioned, the same way MapLibre's own per-tile matrices avoid
// this for its native tile rendering.
function combineTileMatrix(matrix, ox, oy, scale) {
  var a = matrix;
  return new Float32Array([
    scale * a[0], scale * a[1], scale * a[2], scale * a[3],
    scale * a[4], scale * a[5], scale * a[6], scale * a[7],
    a[8], a[9], a[10], a[11],
    ox * a[0] + oy * a[4] + a[12],
    ox * a[1] + oy * a[5] + a[13],
    ox * a[2] + oy * a[6] + a[14],
    ox * a[3] + oy * a[7] + a[15],
  ]);
}

function tileUrl(template, z, x, y) {
  return template.replace("{z}", z).replace("{x}", x).replace("{y}", y);
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
  // Mipmapped trilinear filtering -- plain LINEAR minification with no
  // mipmaps shimmers/jitters on the high-frequency detail in aerial
  // photos as the map continuously zooms (each frame samples the full-res
  // texture at a slightly different scale, aliasing differently every
  // time). TILE_SIZE is a power of two so WebGL1 can mipmap it.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return texture;
}

function createProgram(gl, vertexSrc, fragmentSrc) {
  var program = gl.createProgram();
  gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vertexSrc));
  gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, fragmentSrc));
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

  var nw = MercatorCoordinate.fromLngLat({
    lng: sw.lng,
    lat: Math.max(-maxLat, Math.min(maxLat, ne.lat)),
  });
  var se = MercatorCoordinate.fromLngLat({
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
