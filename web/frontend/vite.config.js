import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Dev server proxies /api → Express proxy (:8787) so the browser talks to one
// origin and the Solscan key stays server-side.
//
// VITE_BASE: public path. "/" for local dev and single-port Express serving;
//   set to "/Memecoin-Screener/" when building for GitHub Pages (project site).
// VITE_API_BASE: where /api/* requests go (see src/lib/api.js). Empty for local;
//   the deployed backend URL when the frontend is hosted separately.
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
