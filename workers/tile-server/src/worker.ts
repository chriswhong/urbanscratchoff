// Serves the self-hosted NYS ITS orthoimagery mosaic (packaged as a single
// PMTiles archive in R2) as plain {z}/{x}/{y}.jpg tiles, so the frontend can
// keep using the same simple XYZ-template tile fetching it already uses for
// maps.nyc.gov. PMTiles resolves each tile with a couple of small R2 range
// reads instead of needing the whole 2GB archive in memory.
import { PMTiles, type Source, type RangeResponse } from "pmtiles";

export interface Env {
  BUCKET: R2Bucket;
}

const KEY = "nyc-orthos-2022-2025.pmtiles";

class R2Source implements Source {
  constructor(
    private bucket: R2Bucket,
    private key: string,
  ) {}

  getKey() {
    return this.key;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const obj = await this.bucket.get(this.key, { range: { offset, length } });
    if (!obj) throw new Error(`R2 object not found: ${this.key}`);
    const data = await obj.arrayBuffer();
    return { data, etag: obj.httpEtag };
  }
}

// Reused across requests on a warm isolate; PMTiles keeps its own header
// and directory cache internally.
let pmtiles: PMTiles | undefined;
function getPmtiles(env: Env): PMTiles {
  if (!pmtiles) pmtiles = new PMTiles(new R2Source(env.BUCKET, KEY));
  return pmtiles;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const match = url.pathname.match(/^\/(\d+)\/(\d+)\/(\d+)(?:\.\w+)?$/);
    if (!match) {
      return new Response("expected /{z}/{x}/{y}.jpg", { status: 404, headers: CORS_HEADERS });
    }
    const [, zStr, xStr, yStr] = match;
    const z = Number(zStr);
    const x = Number(xStr);
    const y = Number(yStr);

    let tile;
    try {
      tile = await getPmtiles(env).getZxy(z, x, y);
    } catch (err) {
      return new Response(`tile lookup failed: ${err}`, { status: 500, headers: CORS_HEADERS });
    }

    if (!tile) {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    return new Response(tile.data, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  },
};
