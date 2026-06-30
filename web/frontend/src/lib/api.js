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

// ---- Admin token (for write endpoints gated by ADMIN_TOKEN on the backend) ----
// Kept only in this browser's localStorage; sent as a Bearer header on admin
// requests. Never part of the build, never shared between users.
const ADMIN_KEY = "mcs_admin_token";

export function getAdminToken() {
  try { return localStorage.getItem(ADMIN_KEY) || ""; } catch { return ""; }
}

export function setAdminToken(token) {
  try {
    const t = (token || "").trim();
    if (t) localStorage.setItem(ADMIN_KEY, t);
    else localStorage.removeItem(ADMIN_KEY);
  } catch { /* storage blocked (private mode) — token just won't persist */ }
}

/** Headers for admin-gated requests: Bearer token when one is stored, else none. */
export function authHeaders() {
  const t = getAdminToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
