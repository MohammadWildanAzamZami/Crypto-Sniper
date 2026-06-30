/**
 * Central API base. Locally this is empty, so requests hit "/api/*" on the same
 * origin (Vite dev proxy, or the single-port Express server). When the frontend
 * is hosted separately (e.g. GitHub Pages) set VITE_API_BASE at build time to the
 * deployed backend URL, e.g. "https://memecoin-screener.onrender.com".
 */
export const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

/** Prefix an "/api/..." path with the configured backend base. */
export function apiUrl(path) {
  return API_BASE + path;
}
