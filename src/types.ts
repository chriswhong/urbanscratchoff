export interface TileLayer {
  name: string;
  url: string;
}

// A single scratch, recorded as a Mercator-space point plus the tile
// zoom it was made at -- see scratchLayer.ts for why this persistent,
// zoom-independent record is what makes scratches survive crossing a
// zoom threshold.
export interface Stamp {
  mercX: number;
  mercY: number;
  tileZ: number;
}

export interface GeocodeFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: {
    label: string;
    region?: string;
    [key: string]: unknown;
  };
}

export interface GeocodeResponse {
  features: GeocodeFeature[];
}
