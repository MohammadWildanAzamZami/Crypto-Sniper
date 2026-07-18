// CabalSpy integration (SNIPER ENGINE — sumber wallet berlabel).
// Menggantikan discovery Birdeye (discoverWallets.js) sebagai SATU-SATUNYA sumber
// pengisian watchlist saat CABALSPY_API_KEY diset: tarik daftar wallet KOL + Smart
// Money Solana terkurasi dari CabalSpy (https://cabalspy.xyz, ±950 wallet) dan
// import ke Modul B (watchlist.js). Sistem lain TIDAK berubah: webhook Helius,
// sniper, dan ranking tetap bekerja di atas watchlist yang sama.
//
// Hemat kredit: 1 sync = 2 request REST (10 kredit/request) — jauh di bawah free
// tier 10.000 kredit/bulan bahkan dengan sync tiap 6 jam. Fail-safe: sync gagal
// TIDAK menyentuh watchlist (tidak pernah wipe berdasarkan respons kosong/error).
//
// Mode pengganti penuh (default, CABALSPY_REPLACE != "false"): sekali per boot,
// setelah sync PERTAMA yang sukses, wallet lama non-CabalSpy dihapus dari
// watchlist — dengan backup otomatis ke .watchlist-state.backup-<tanggal>.json.

import { importCabalspyWallets, resetNonCabalspy } from "./watchlist.js";

const BASE = "https://api.cabalspy.xyz/v1";

let lastSync = null;   // ringkasan sync terakhir (ditampilkan di UI watchlist)
let running = false;   // cegah sync tumpang-tindih (interval + trigger manual)
let wipedThisBoot = false;

/** Ringkasan sync terakhir (default aman sebelum sync pertama). */
export function getCabalspyStatus() {
  return lastSync || { at: null, imported: 0, kol: 0, smart: 0, wiped: 0, error: null };
}

async function fetchWallets(type, key) {
  const res = await fetch(`${BASE}/wallets?blockchain=solana&type=${type}`, {
    headers: { Authorization: `Bearer ${key}`, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`CabalSpy /wallets ${type} → HTTP ${res.status}`);
  const body = await res.json();
  const rows = body?.data?.wallets;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Satu siklus sync: tarik wallet KOL + smart Solana → import ke watchlist.
 * Dipanggil interval background (index.js) dan endpoint admin. Never throws.
 */
export async function syncCabalspy({ key, nowMs } = {}) {
  const now = nowMs ?? Date.now();
  if (!key) return { disabled: true, reason: "CabalSpy key belum diset", ...getCabalspyStatus() };
  if (running) return { skipped: true, reason: "sync masih berjalan", ...getCabalspyStatus() };
  running = true;

  const summary = { at: now, imported: 0, updated: 0, kol: 0, smart: 0, wiped: 0, error: null };
  try {
    const collected = [];
    for (const type of ["kol", "smart"]) {
      try {
        const rows = await fetchWallets(type, key);
        summary[type] = rows.length;
        for (const r of rows) {
          const owner = r.wallet_address || r.address || r.owner;
          if (typeof owner !== "string" || !owner) continue;
          collected.push({
            owner,
            type,
            name: r.name || "",
            twitter: r.twitter || "",
            winRate: Number.isFinite(Number(r.win_rate ?? r.winRate)) ? Number(r.win_rate ?? r.winRate) : null,
          });
        }
      } catch (err) {
        summary.error = String(err?.message || err);
      }
    }

    if (collected.length > 0) {
      const rec = importCabalspyWallets(collected, now);
      summary.imported = rec.imported;
      summary.updated = rec.updated;
      // Mode pengganti penuh: hapus wallet lama non-CabalSpy — hanya sekali per
      // boot dan HANYA setelah sync sukses membawa data (jangan pernah wipe ke kosong).
      if (!wipedThisBoot && process.env.CABALSPY_REPLACE !== "false") {
        summary.wiped = resetNonCabalspy(now);
        wipedThisBoot = true;
      }
    }
    lastSync = summary;
    return summary;
  } finally {
    running = false;
  }
}
