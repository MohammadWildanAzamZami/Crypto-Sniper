// Momentum multi-timeframe untuk Pro Radar. DexScreener memberi volume, price
// change, dan jumlah buy/sell per jendela 5 menit / 1 jam / 6 jam / 24 jam —
// dari situ kita hitung apakah sebuah token SEDANG trending (trafik transaksi
// masih ramai sekarang, bukan cuma ramai kemarin) dan apakah lajunya
// terakselerasi di atas rata-rata hariannya.
//
// "Pace" per jendela = volume jendela itu disetahunkan ke 24 jam, dibagi volume
// 24 jam. Pace 1 = sama dengan rata-rata harian; 2 = dua kali lebih ramai; di
// bawah ~0.4 artinya trafik sedang mati — pump-nya sudah lewat.

const WINDOW_PER_DAY = { m5: 288, h1: 24, h6: 4 };
const HOT_PACE = 1.3; // pace ≥ 1.3× rata-rata harian = jendela itu "panas"

const txOf = (t) => (t?.buys || 0) + (t?.sells || 0);
const buyRatioOf = (t) => {
  const n = txOf(t);
  return n > 0 ? Number(((t.buys || 0) / n).toFixed(2)) : null;
};

/**
 * Hitung momentum dari metrics DexScreener (butuh `volume` + `txns` per jendela).
 * @returns {{ score, tx:{m5,h1,h6,h24}, vol:{m5,h1,h6,h24},
 *             pace:{m5,h1,h6}, buyRatio:{m5,h1,h24}, hotWindows:string[] }}
 */
export function computeMomentum(metrics) {
  const m = metrics || {};
  const vol = {
    m5: m.volume?.m5 || 0,
    h1: m.volume?.h1 || 0,
    h6: m.volume?.h6 || 0,
    h24: m.volume?.h24 || 0,
  };
  const t = m.txns || {};
  const tx = { m5: txOf(t.m5), h1: txOf(t.h1), h6: txOf(t.h6), h24: txOf(t.h24) || txOf(m.txns24h) };

  const pace = {};
  for (const [w, perDay] of Object.entries(WINDOW_PER_DAY)) {
    pace[w] = vol.h24 > 0 ? Number(((vol[w] * perDay) / vol.h24).toFixed(2)) : null;
  }

  const buyRatio = { m5: buyRatioOf(t.m5), h1: buyRatioOf(t.h1), h24: buyRatioOf(t.h24 || m.txns24h) };

  // Jendela yang lagi panas: laju di atas rata-rata harian DAN benar-benar ada
  // transaksi di jendela itu (pace tinggi dari 2 trade kecil bukan trending).
  const hotWindows = [];
  if (pace.m5 != null && pace.m5 >= HOT_PACE && tx.m5 >= 5) hotWindows.push("5m");
  if (pace.h1 != null && pace.h1 >= HOT_PACE && tx.h1 >= 30) hotWindows.push("1h");
  if (pace.h6 != null && pace.h6 >= HOT_PACE && tx.h6 >= 100) hotWindows.push("6h");

  // Skor 0–100:
  //   trafik hidup sekarang (tx 5m + tx 1h)        → maks 35
  //   akselerasi vs rata-rata harian (pace 1h/5m)  → maks 45
  //   tekanan beli 1 jam terakhir (>50% beli)      → maks 20
  let score = 0;
  score += Math.min(20, tx.m5 * 2);        // 10+ tx / 5 mnt = penuh
  score += Math.min(15, Math.round(tx.h1 / 8)); // 120+ tx / jam = penuh
  if (pace.h1 != null) score += Math.min(25, Math.max(0, Math.round((pace.h1 - 1) * 15)));
  if (pace.m5 != null) score += Math.min(20, Math.max(0, Math.round((pace.m5 - 1) * 10)));
  if (buyRatio.h1 != null) score += Math.min(20, Math.max(0, Math.round((buyRatio.h1 - 0.5) * 40)));
  score = Math.min(100, Math.max(0, score));

  return { score, tx, vol, pace, buyRatio, hotWindows };
}
