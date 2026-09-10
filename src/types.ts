export interface TileLayer {
  name: string;
  url: string;
}

// A single scratch, recorded as a Mercator-space point plus the tile zoom
// and brush radius it was made with -- persistent and zoom-independent so
// it survives crossing a zoom threshold (see scratchLayer.ts), and keeps
// its own size even if the user changes the brush slider afterward.
export interface Stamp {
  mercX: number;
  mercY: number;
  tileZ: number;
  radius: number;
  // True for a shift-drag "redraw" stamp that restores original pixels
  // instead of erasing them -- see scratchLayer.ts's applyStampToTile.
  restore?: boolean;
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
