// Persistence for the 10x Radar's runtime state. The proxy keeps two things
// between scans: the latest scan result (served to the client) and the set of
// mints already alerted (so we don't spam Telegram with repeats). In-memory
// they reset on every restart; this stores them in a gitignored JSON file next
// to .env and reloads on boot.
//
// On read-only/ephemeral filesystems (e.g. Vercel) the save no-ops gracefully,
// falling back to the old in-memory behaviour. NOTE: file persistence does NOT
// share state across serverless instances — a shared KV store is still needed
// for true multi-instance dedupe (see HANDOVER known issues).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const STORE_PATH = fileURLToPath(new URL("./.radar-state.json", import.meta.url));

// Cap the dedupe set so the file (and reloaded Set) can't grow unbounded. A JS
// Set preserves insertion order, so slicing keeps the most recently alerted.
const MAX_ALERTED = 1000;

const EMPTY_SCAN = {
  scannedAt: 0,
  preset: "balanced",
  discovered: 0,
  candidatesScanned: 0,
  matches: [],
  newlyAlerted: 0,
};

/** Load persisted radar state, or sane empties if there's no file yet. */
export function loadRadarState() {
  try {
    const saved = JSON.parse(readFileSync(STORE_PATH, "utf8"));
    return {
      latestScan:
        saved.latestScan && typeof saved.latestScan === "object"
          ? saved.latestScan
          : { ...EMPTY_SCAN },
      alertedMints: new Set(Array.isArray(saved.alertedMints) ? saved.alertedMints : []),
    };
  } catch {
    return { latestScan: { ...EMPTY_SCAN }, alertedMints: new Set() };
  }
}

/** Persist the latest scan + alerted mints. Swallows errors on read-only FS. */
export function saveRadarState({ latestScan, alertedMints }) {
  try {
    const mints = Array.from(alertedMints).slice(-MAX_ALERTED);
    writeFileSync(STORE_PATH, JSON.stringify({ latestScan, alertedMints: mints }, null, 2), "utf8");
  } catch {
    /* read-only/ephemeral FS (Vercel) — state stays in-memory for this process */
  }
}
