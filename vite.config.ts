import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Relative base so the built site works whether it's served from a
  // domain root or a subpath (e.g. GitHub Pages project sites).
  base: "./",
  plugins: [react(), tailwindcss()],
});
