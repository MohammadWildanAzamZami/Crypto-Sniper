// Real-time Sniper (SNIPER ENGINE Modul C — push mode). Instead of polling the
// watchlist every SNIPER_POLL_MIN, we register a HELIUS WEBHOOK on the active
// smart-money wallets. Helius then PUSHES a notification the moment any of them
// swaps — and we react immediately by running the (existing) sniper sweep, so a
// signal appears seconds after smart money buys, not up to 5 minutes later.
//
// Flow:
//   startWebhookAutoSync() → resolve a PUBLIC url (env PUBLIC_URL, else auto-detect
//     the local ngrok tunnel) → create/update ONE Helius webhook that watches the
//     top watchlist wallets and calls POST /api/sniper/helius-webhook. Re-synced
//     periodically so the watched set follows the (self-learning) watchlist and a
//     changed ngrok url is picked up.
//   POST /api/sniper/helius-webhook (route) → debouncedSweep(sniperSweepOnce): a
//     burst of events coalesces into ONE sweep, rate-limited so we never hammer
//     Helius. The classic interval stays on as a safety-net fallback.
//
// Degrades safely: no Helius key / no public url → logs why and does nothing (the
// interval sweep still works). Never throws into the caller.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { getActiveWallets } from "./watchlist.js";
import { getState } from "../ai/settings.js";

const HELIUS_API = "https://api.helius.xyz/v0/webhooks";
const STORE_PATH = fileURLToPath(new URL("./.helius-webhook.json", import.meta.url));
const CALLBACK_PATH = "/api/sniper/helius-webhook";

// Helius allows many addresses per webhook; the active watchlist is small (≤40),
// but cap defensively so an accidental "monitor all" can't blow the payload.
const MAX_ADDRESSES = Number(process.env.SNIPER_WEBHOOK_MAX_ADDR || 100);
// Coalesce a burst of push events into one sweep; never sweep more often than the gap.
const DEBOUNCE_MS = Number(process.env.SNIPER_WEBHOOK_DEBOUNCE_MS || 6000);
const MIN_GAP_MS = Number(process.env.SNIPER_WEBHOOK_MIN_GAP_MS || 25000);
// Re-push the address list + re-check the public url on this cadence.
const SYNC_MIN = Number(process.env.SNIPER_WEBHOOK_SYNC_MIN || 10);

// ---- Persisted webhook id + auth token (gitignored) -----------------------
function loadStore() {
  try { return JSON.parse(readFileSync(STORE_PATH, "utf8")) || {}; } catch { return {}; }
}
function saveStore(obj) {
  try { writeFileSync(STORE_PATH, JSON.stringify(obj, null, 2), "utf8"); } catch { /* read-only FS */ }
}
// Stable secret Helius echoes back in the Authorization header so we can verify
// that an incoming POST really came from our webhook (not a random caller).
export function webhookAuthToken() {
  const s = loadStore();
  if (s.authToken) return s.authToken;
  const token = process.env.SNIPER_WEBHOOK_AUTH || randomBytes(16).toString("hex");
  saveStore({ ...s, authToken: token });
  return token;
}

// ---- Public URL resolution ------------------------------------------------
// Prefer an explicit PUBLIC_URL; otherwise auto-detect the local ngrok tunnel so
// the "run app + ngrok" workflow needs zero extra config.
export async function resolvePublicUrl() {
  const envUrl = process.env.PUBLIC_URL || process.env.PUBLIC_BASE_URL;
  if (envUrl) return envUrl.replace(/\/+$/, "");
  try {
    const res = await fetch("http://127.0.0.1:4040/api/tunnels", { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const j = await res.json();
      const t = (j.tunnels || []).find((x) => typeof x.public_url === "string" && x.public_url.startsWith("https"));
      if (t) return t.public_url.replace(/\/+$/, "");
    }
  } catch { /* ngrok not running / unreachable */ }
  return null;
}

// ---- Helius webhook REST helpers ------------------------------------------
async function heliusFetch(url, opts, key) {
  const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}api-key=${key}`, {
    ...opts,
    headers: { "content-type": "application/json", accept: "application/json", ...(opts?.headers || {}) },
  });
  return res;
}
async function listWebhooks(key) {
  try {
    const res = await heliusFetch(HELIUS_API, { method: "GET" }, key);
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

/**
 * Create or update ONE Helius webhook watching `addresses` → our callback.
 * @returns {Promise<{ok:boolean, reason?:string, id?:string, count?:number, url?:string, mode?:string}>}
 */
export async function syncHeliusWebhook({ heliusKey, addresses } = {}) {
  const key = heliusKey || getState().heliusKey;
  if (!key) return { ok: false, reason: "Helius key belum diset" };
  const addrs = (addresses || getActiveWallets() || []).slice(0, MAX_ADDRESSES);
  if (addrs.length === 0) return { ok: false, reason: "watchlist masih kosong — belum ada wallet aktif" };

  const base = await resolvePublicUrl();
  if (!base) return { ok: false, reason: "tak ada URL publik (set PUBLIC_URL atau jalankan ngrok)" };
  const webhookURL = `${base}${CALLBACK_PATH}`;

  const body = {
    webhookURL,
    transactionTypes: ["SWAP"],   // only swaps — buys/sells; we detect buy-side ourselves
    accountAddresses: addrs,
    webhookType: "enhanced",
    authHeader: webhookAuthToken(),
  };

  try {
    const store = loadStore();
    const existing = await listWebhooks(key);
    // Match by our stored id first, else by the callback URL (survives an id loss).
    const ours = existing.find((w) => w.webhookID === store.webhookID) ||
      existing.find((w) => (w.webhookURL || "").endsWith(CALLBACK_PATH));

    if (ours) {
      const res = await heliusFetch(`${HELIUS_API}/${ours.webhookID}`, { method: "PUT", body: JSON.stringify(body) }, key);
      if (!res.ok) return { ok: false, reason: `update gagal (HTTP ${res.status})` };
      saveStore({ ...store, webhookID: ours.webhookID, webhookURL, updatedAt: Date.now() });
      return { ok: true, mode: "updated", id: ours.webhookID, count: addrs.length, url: webhookURL };
    }

    const res = await heliusFetch(HELIUS_API, { method: "POST", body: JSON.stringify(body) }, key);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, reason: `create gagal (HTTP ${res.status}) ${txt.slice(0, 120)}` };
    }
    const created = await res.json();
    saveStore({ ...store, webhookID: created.webhookID, webhookURL, createdAt: Date.now() });
    return { ok: true, mode: "created", id: created.webhookID, count: addrs.length, url: webhookURL };
  } catch (err) {
    return { ok: false, reason: `error: ${err?.message || err}` };
  }
}

// ---- Debounced sweep trigger ----------------------------------------------
let sweepTimer = null;
let lastSweepAt = 0;

/**
 * Ask for a sweep "soon". A burst of webhook events collapses into a single run,
 * and runs are spaced ≥ MIN_GAP_MS apart so Helius can't be hammered.
 * @param {() => Promise<any>} runFn  the sweep to run (e.g. sniperSweepOnce)
 */
export function debouncedSweep(runFn) {
  if (sweepTimer) return; // a sweep is already scheduled — this event folds into it
  const sinceLast = Date.now() - lastSweepAt;
  const wait = Math.max(DEBOUNCE_MS, MIN_GAP_MS - sinceLast);
  sweepTimer = setTimeout(async () => {
    sweepTimer = null;
    lastSweepAt = Date.now();
    try { await runFn(); } catch { /* sweep never throws into the loop */ }
  }, wait);
  sweepTimer.unref?.();
}

// ---- Boot-time auto sync ---------------------------------------------------
/**
 * Register the webhook now and keep its watched addresses (and the public url) in
 * sync on an interval. Safe to call unconditionally — logs and no-ops when it
 * can't (no key / no public url), so the classic interval sweep still covers us.
 */
export function startWebhookAutoSync() {
  const run = async () => {
    const r = await syncHeliusWebhook();
    if (r.ok) console.log(`[sniper-webhook] ${r.mode} — pantau ${r.count} wallet → ${r.url}`);
    else console.log(`[sniper-webhook] belum aktif: ${r.reason} (fallback ke polling ${SYNC_MIN >= 0 ? "" : ""}tetap jalan)`);
    return r;
  };
  run(); // initial (async, fire-and-forget)
  if (SYNC_MIN > 0) {
    const t = setInterval(run, SYNC_MIN * 60_000);
    t.unref?.();
  }
  return { syncMin: SYNC_MIN };
}
