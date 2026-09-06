/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEOCODE_EARTH_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
