// Influencer watchlist (SNIPER ENGINE Modul B2). The MANUAL counterpart to the
// self-learning smart-wallet watchlist (Modul B): wallets we already KNOW belong
// to a named crypto influencer. Unlike smart wallets — auto-discovered from
// autopsies and ranked by track record — influencers are added by hand with a
// label, have no "catches" ranking, and a SINGLE influencer buying is itself a
// signal (the live monitor fires on 1, not the ≥2 confluence smart wallets need).
//
// Store keyed by wallet. File-persisted like watchlist/sniper — fails safe on a
// read-only/ephemeral FS (stays in-memory). The live monitor (Modul C, sniper.js)
// sweeps the union of active smart wallets + these influencer wallets.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FILE_PATH = fileURLToPath(new URL("./.influencers-state.json", import.meta.url));

const MAX_INFLUENCERS = 500;   // hard cap so the file can't grow unbounded
// Solana address: base58, 32–44 chars (same shape as the mint check in autopsy.js).
const ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// ---- Store (seeded once at module load) -----------------------------------
/** @type {Map<string, object>} owner → influencer record */
let influencers = new Map();
try {
  const saved = JSON.parse(readFileSync(FILE_PATH, "utf8"));
  if (Array.isArray(saved.influencers)) influencers = new Map(saved.influencers.map((w) => [w.owner, w]));
} catch {
  /* no file yet, or unreadable FS — start empty */
}

function save() {
  try {
    const list = [...influencers.values()].slice(0, MAX_INFLUENCERS);
    writeFileSync(FILE_PATH, JSON.stringify({ influencers: list }, null, 2), "utf8");
  } catch {
    /* read-only/ephemeral FS — keep state in-memory for this process */
  }
}

/** Shape a record for the client (compact). */
function toPublic(w) {
  return { owner: w.owner, label: w.label, handle: w.handle || "", addedAt: w.addedAt, active: w.active !== false };
}

/**
 * Add (or update the label of) a manually-tracked influencer wallet.
 * @param {{owner:string,label:string,handle?:string}} input
 * @returns {{ok:true,influencer:object}|{ok:false,error:string}}
 */
export function addInfluencer({ owner, label, handle } = {}) {
  owner = String(owner || "").trim();
  label = String(label || "").trim();
  handle = String(handle || "").trim().replace(/^@/, ""); // store without a leading @
  if (!ADDR_RE.test(owner)) return { ok: false, error: "Alamat wallet tidak valid (base58 Solana, 32–44 karakter)." };
  if (!label) return { ok: false, error: "Label/nama influencer wajib diisi." };
  if (!influencers.has(owner) && influencers.size >= MAX_INFLUENCERS) {
    return { ok: false, error: `Batas ${MAX_INFLUENCERS} influencer tercapai.` };
  }
  const existing = influencers.get(owner);
  const rec = existing
    ? { ...existing, label, handle, active: true }
    : { owner, label, handle, source: "manual", addedAt: Date.now(), active: true };
  influencers.set(owner, rec);
  save();
  return { ok: true, influencer: toPublic(rec) };
}

/** Remove a tracked influencer. Returns whether anything was removed. */
export function removeInfluencer(owner) {
  const had = influencers.delete(String(owner || "").trim());
  if (had) save();
  return { ok: true, removed: had };
}

/** The full influencer list (newest first) for the UI. */
export function getInfluencers() {
  const list = [...influencers.values()].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).map(toPublic);
  return { total: list.length, influencers: list };
}

/** Active influencer wallets for the live monitor to sweep (sibling of watchlist's getActiveWallets). */
export function getActiveInfluencerWallets() {
  return [...influencers.values()].filter((w) => w.active !== false).map((w) => w.owner);
}

/** Influencer meta for annotating a signal position. Fail-safe for unknown wallets. */
export function getInfluencerMeta(owner) {
  const w = influencers.get(owner);
  if (!w || w.active === false) return { isInfluencer: false };
  return { isInfluencer: true, label: w.label, handle: w.handle || "" };
}
