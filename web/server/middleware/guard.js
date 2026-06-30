// Lightweight, dependency-free guards for a publicly-hosted backend:
//   - rateLimit:    per-IP fixed-window limiter (in-memory; fine for one instance)
//   - chatBudget:   global per-day cap so public AI chat can't burn unbounded tokens
//   - requireAdmin: gate sensitive writes behind ADMIN_TOKEN (or loopback in dev)
//
// In-memory state is per-process. On a single Render instance that's correct; if
// you ever scale to multiple instances, move these counters to Redis.
import { timingSafeEqual } from "node:crypto";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** Per-IP fixed-window rate limit. Returns 429 with Retry-After when exceeded. */
export function rateLimit({ windowMs, max, name = "rl" }) {
  const hits = new Map(); // ip -> { count, resetAt }

  // Sweep expired buckets so the map can't grow unbounded. unref() so this timer
  // never keeps the process alive on its own.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, e] of hits) if (now > e.resetAt) hits.delete(ip);
  }, windowMs);
  sweep.unref?.();

  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || "unknown";
    let e = hits.get(ip);
    if (!e || now > e.resetAt) {
      e = { count: 0, resetAt: now + windowMs };
      hits.set(ip, e);
    }
    e.count++;
    if (e.count > max) {
      const retry = Math.ceil((e.resetAt - now) / 1000);
      res.set("Retry-After", String(retry));
      return res.status(429).json({ error: `Terlalu banyak permintaan (${name}). Coba lagi dalam ${retry} detik.` });
    }
    next();
  };
}

/** Global per-UTC-day counter — caps total AI chat calls regardless of source. */
export function chatBudget({ max }) {
  let day = "";
  let count = 0;
  return (_req, res, next) => {
    const today = new Date().toISOString().slice(0, 10);
    if (day !== today) { day = today; count = 0; }
    if (count >= max) {
      return res.status(429).json({ error: "Kuota chat AI harian tercapai. Coba lagi besok." });
    }
    count++;
    next();
  };
}

function constantTimeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function presentedToken(req) {
  const auth = req.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return (m ? m[1] : req.get("x-admin-token") || "").trim();
}

/**
 * Gate for sensitive writes (settings, alert, batch). Policy:
 *   - ADMIN_TOKEN set  → require a matching Bearer / x-admin-token header.
 *   - ADMIN_TOKEN unset → allow only loopback (local dev); block remote, since an
 *     un-tokened public backend must not expose writable endpoints by default.
 */
export function requireAdmin(req, res, next) {
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
  if (ADMIN_TOKEN) {
    if (constantTimeEqual(presentedToken(req), ADMIN_TOKEN)) return next();
    return res.status(401).json({ error: "Butuh admin token (header Authorization: Bearer …)." });
  }
  if (LOOPBACK.has(req.ip)) return next();
  return res.status(403).json({
    error: "Endpoint admin dinonaktifkan di host ini. Set env ADMIN_TOKEN untuk mengaktifkan admin dari jarak jauh.",
  });
}
