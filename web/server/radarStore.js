// Shared store for the 10x Radar's runtime state: the latest scan result (served
// to the client) and the set of mints already alerted (so we don't spam Telegram
// with repeats). Three backends, picked automatically:
//
//   1. Upstash Redis (REST)  — when UPSTASH_REDIS_REST_URL + _TOKEN are set.
//      The ONLY backend that is correct across multiple serverless instances:
//      dedupe uses an atomic Redis SADD, so two instances scanning at the same
//      time can't both alert the same mint. Uses plain fetch (no SDK dep).
//   2. File (.radar-state.json) — local/single-instance with a writable disk.
//   3. In-memory — read-only/ephemeral FS and no Redis; resets on restart.
//
// The API is async (Redis is a network call). Every backend fails safe: a Redis
// error never throws into the request, and dedupe fails OPEN (alert rather than
// silently drop) so an outage can't suppress alerts.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FILE_PATH = fileURLToPath(new URL("./.radar-state.json", import.meta.url));
const MAX_ALERTED = 1000; // cap the file-backed set so it can't grow unbounded
const ALERTED_TTL = 60 * 60 * 24 * 30; // 30d TTL on the Redis set (self-trims)

const KEY_LATEST = "radar:latest";
const KEY_ALERTED = "radar:alerted";

const EMPTY_SCAN = {
  scannedAt: 0,
  preset: "balanced",
  discovered: 0,
  candidatesScanned: 0,
  matches: [],
  newlyAlerted: 0,
};

const KV_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const useKv = Boolean(KV_URL && KV_TOKEN);

export function radarBackend() {
  return useKv ? "upstash" : "file/memory";
}

// ---- Upstash REST helpers -------------------------------------------------
async function kvCmd(cmd) {
  const res = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  return (await res.json()).result;
}

// Run several commands in one round trip; returns [{result}, ...] in order.
async function kvPipeline(cmds) {
  const res = await fetch(`${KV_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  return res.json();
}

// ---- File / in-memory backend (seeded once at module load) ----------------
let memLatest = { ...EMPTY_SCAN };
let memAlerted = new Set();
if (!useKv) {
  try {
    const saved = JSON.parse(readFileSync(FILE_PATH, "utf8"));
    if (saved.latestScan && typeof saved.latestScan === "object") memLatest = saved.latestScan;
    if (Array.isArray(saved.alertedMints)) memAlerted = new Set(saved.alertedMints);
  } catch {
    /* no file yet, or unreadable FS — start empty */
  }
}

function fileSave() {
  try {
    const mints = Array.from(memAlerted).slice(-MAX_ALERTED); // Set preserves insertion order
    writeFileSync(FILE_PATH, JSON.stringify({ latestScan: memLatest, alertedMints: mints }, null, 2), "utf8");
  } catch {
    /* read-only/ephemeral FS — keep state in-memory for this process */
  }
}

// ---- Public API -----------------------------------------------------------

/** The most recent scan result (shared via Redis when configured). */
export async function getLatestScan() {
  if (useKv) {
    try {
      const raw = await kvCmd(["GET", KEY_LATEST]);
      if (raw) return JSON.parse(raw);
    } catch {
      /* fall through to empty */
    }
    return { ...EMPTY_SCAN };
  }
  return memLatest;
}

/** Persist the latest scan result. */
export async function setLatestScan(scan) {
  if (useKv) {
    try {
      await kvCmd(["SET", KEY_LATEST, JSON.stringify(scan)]);
    } catch {
      /* swallow — a failed write just means the next /latest read is stale */
    }
    return;
  }
  memLatest = scan;
  fileSave();
}

/**
 * Atomically claim a mint for alerting. Returns true if this is the FIRST time
 * we've seen it (caller should send the alert), false if already alerted.
 * With Redis this is atomic across instances; on failure it fails OPEN (true).
 */
export async function markAlerted(mint) {
  if (useKv) {
    try {
      const out = await kvPipeline([
        ["SADD", KEY_ALERTED, mint],
        ["EXPIRE", KEY_ALERTED, String(ALERTED_TTL)],
      ]);
      return out?.[0]?.result === 1; // SADD returns 1 when newly added
    } catch {
      return true; // don't let a Redis outage suppress alerts
    }
  }
  if (memAlerted.has(mint)) return false;
  memAlerted.add(mint);
  fileSave();
  return true;
}
