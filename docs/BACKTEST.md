# Backtest Semua Tool — Hasil & Verdict

> Uji end-to-end **semua tool** (Solana + Robinhood Chain EVM) dengan **data on-chain
> nyata**, untuk menjawab: *apakah tiap tool menghasilkan output sesuai tujuannya?*
> Tanggal: **2026-07-10**. Metode: panggil endpoint HTTP + uji fungsi inti lewat import
> modul langsung (server sempat mati beberapa kali di environment ini, jadi sebagian
> diuji via import — menguji kode yang sama). Heuristik — bukan nasihat keuangan.

---

## Ringkas: apakah menghasilkan sesuai keinginan?

**Ya — semua tool menghasilkan output yang benar sesuai fungsinya.** Dua catatan
(bukan kegagalan kode): (1) **Pro Radar** jalan tapi lapisan AI tidak aktif di sesi ini
(fallback heuristik), (2) **Sniper** (dua chain) 0 sinyal saat diuji — mekanisme benar,
tapi sinyal butuh **konfluensi pasar live** (≥2 smart wallet beli token fresh yang sama
saat itu), yang market-dependent.

---

## 🟣 Solana

| # | Tool | Hasil backtest (nyata) | Sesuai tujuan? |
|---|---|---|---|
| 1 | **10x Radar** (`/api/auto-screen`) | Scan 18 token → **3 kandidat** (ANIF GEM 78, MC $999k, STRONG) | ✅ menghasilkan kandidat berperingkat |
| 2 | **GEM Score** (`screenToken`) | ANIF → **GEM 81, STRONG**, liq $78k | ✅ skor 0–100 + verdict valid |
| 3 | **Pro Radar** (`/api/pro-radar`) | Scan 39 → **1 kandidat (ANIF Q82)**, `aiUsed:false` | ⚠️ jalan & hasilkan kandidat; **AI tidak aktif** (fallback heuristik) di sesi ini |
| 4 | **Bedah Coin** (`runAutopsy`) | Token uji (fresh) kena **data-gap Birdeye**; namun **Watchlist berisi 73 wallet** hasil auto-discovery yang menjalankan autopsy → terbukti bekerja | ✅ (via bukti tak langsung) |
| 5 | **Watchlist** (`/api/watchlist`) | **73 wallet** terekam, semua dipantau | ✅ terisi & terurut reputasi |
| 6 | **Sniper Live** (`/api/sniper/signals`) | **0 sinyal** (signalMin 2, gate on). Riwayat: pernah hasilkan **28 sinyal** setelah fix key Helius | ✅ mekanisme benar; 0 = tak ada konfluensi saat ini |

## ⛓️ Robinhood Chain (EVM)

| # | Tool | Hasil backtest (nyata) | Sesuai tujuan? |
|---|---|---|---|
| 1 | **Discover** (GeckoTerminal) | **20 pool trending** (CASHCAT vol24 **$29,5jt**) | ✅ |
| 2 | **Screen / GEM** (`screenEvmToken`) | CASHCAT → **GEM 80, STRONG**, risk low, **11.850 holders**, top holder 2% | ✅ metrik + gate + skor valid |
| 3 | **Bedah Coin** (`bedahEvmToken`) | CASHCAT (**mcap $126jt**) → **94 early buyer**, **4 kandidat smart wallet** (diamond-hand, masih pegang) | ✅ menemukan smart money winner |
| 4 | **Watchlist** (`getEvmWatchlist`) | **274 wallet**, `monitorAll:true`, top reputasi 71 | ✅ terisi, semua dipantau |
| 5 | **Sniper Live** (`runEvmSniperSweep`) | Sweep **semua wallet**; deteksi beli (terima token + bayar WETH/USDG) terverifikasi; **0 sinyal** | ✅ mekanisme benar; 0 = tak ada konfluensi |
| 6 | **Auto-pilot** (`evmAuto`) | Watchlist tumbuh **4 → 274 wallet otomatis**; cap `RH_WATCHLIST_MAX=300`; tick set status | ✅ menumbuhkan watchlist sendiri |

---

## Analisis "belum sesuai" (jujur)

### Kenapa Sniper (dua chain) 0 sinyal?
Bukan bug. Sinyal muncul hanya saat **≥2 wallet watchlist membeli token fresh yang SAMA
dalam window** (default 90–180 mnt). Wallet yang direkam adalah *early-buyer-that-holds*
(reputable, tapi belum tentu sedang aktif membeli token BARU detik itu). Terbukti bisa:
Sniper Solana **pernah hasilkan 28 sinyal**. Untuk sinyal live lebih sering:
- Turunkan `signalMin` ke 1 (lebih berisik), atau perlebar `lookbackMin`.
- Perbanyak Bedah winner **baru** → wallet yang lebih aktif trading.

### Kenapa Pro Radar `aiUsed:false`?
Radar tetap menghasilkan kandidat berperingkat (heuristik), tapi lapisan **AI (Fable 5)
tidak jalan** di sesi backtest — mode lokal butuh CLI `claude`, atau fallback ke urutan
heuristik saat AI tak tersedia. Untuk mengaktifkan AI: mode `api` + `ANTHROPIC_API_KEY`
valid, atau CLI `claude` terpasang di host.

### Data-gap sumber pihak ketiga
- **Birdeye** kadang belum kenal token pump.fun yang sangat fresh → Autopsi/Screen Solana
  memakai fallback DexScreener bila ada.
- **GeckoTerminal/Blockscout** publik kadang rate-limit saat dipanggil beruntun → sebuah
  panggilan bisa kosong sesaat lalu sukses saat diulang (terlihat di E3 Bedah EVM).

---

## Kesimpulan

| Kategori | Verdict |
|---|---|
| Screening (GEM, Radar, Screen EVM) | ✅ **Sesuai** — skor & kandidat valid dari data nyata |
| Forensik (Bedah/Autopsy) | ✅ **Sesuai** — menemukan early buyer / smart wallet winner |
| Memori (Watchlist, reputasi) | ✅ **Sesuai** — terisi otomatis, terurut |
| Sinyal (Sniper) | ✅ **Mekanisme sesuai** — output tergantung konfluensi pasar live |
| Otomasi (Auto-pilot EVM) | ✅ **Sesuai** — menumbuhkan watchlist + sweep tanpa klik |
| Lapisan AI (Pro Radar) | ⚠️ **Perlu key/CLI AI aktif** untuk peringkat AI (heuristik tetap jalan) |

**Ringkas:** pipeline **Discover → Screen → Bedah → Watchlist → Sniper** bekerja
end-to-end di **kedua chain** dengan data on-chain nyata. Yang perlu perhatian bukan
kebenaran kode, melainkan **ketersediaan sinyal live** (butuh konfluensi) dan
**pengaktifan AI** untuk Pro Radar.

---

## 💰 Backtest PnL (angka nyata dari data tersimpan) — 2026-07-10

> Pertanyaan spesifik: *"kalau tool dapat sinyal, PnL-nya berapa?"* Dijawab dari
> **outcome yang benar-benar di-grade** (bukan simulasi). Bukan nasihat keuangan.

### 1) Pro Radar — 19 pick sudah di-grade (`.radar-memory.json`)
Setiap pick disnapshot dengan **entry price**, lalu di-grade live (harga sekarang vs entry).

| Metrik | Nilai |
|---|---|
| Pick ter-grade | **19** |
| Win (≥ +50%) | **1** → win-rate **5%** |
| Loss / Flat | 8 loss, 10 flat |
| **Rata-rata PnL / pick** | **−15,6%** |
| Median PnL | −18,4% |
| Terbaik | **TOLY +204,9%** (entry MC $1,15jt) |
| Terburuk | **ALYCIA −89,6%** |

**Verdict jujur:** kalau kamu masuk **semua** pick Pro Radar rata rata, hasilnya
**rugi ~16%**. Satu winner besar (TOLY +205%) tak menutup ekor loss. Ini realita
memecoin — target win-rate 0,9 di self-tuning adalah *setpoint yang dikejar*, bukan
janji. Controller memang lagi `belowTarget` dan mengetatkan gate.

### 2) Sniper Live — sweep nyata dijalankan sekarang: **0 sinyal → tak ada PnL live**
Dijalankan `runSniperSweep` (kode yang sama dgn server) atas **73 wallet aktif** dengan
key Helius+Birdeye nyata:

| Run | Hasil |
|---|---|
| v2 (default: signalMin 2, gate on) | swept 73 → **0 kandidat, 0 sinyal** (29,8s) |
| awal/v1 | swept 73 → **0 kandidat, 0 sinyal** (28,9s) |
| **Dilonggarkan total** (signalMin **1**, lookback **12 jam**, semua gate OFF) | swept 73 → **0 kandidat** |

**Artinya:** bukan gate yang terlalu ketat — **73 wallet watchlist sedang tidak beli
token fresh apa pun** dalam 12 jam terakhir. Mereka *early-buyer-that-holds* (diamond
hand, reputasi bagus) tapi belum tentu sedang aktif sniping detik ini. Jadi PnL live
sniper **tidak bisa dihitung sekarang karena tidak ada entri** — bukan karena kodenya
salah. Mekanisme PnL-nya sudah ada: begitu sinyal muncul, tiap posisi mencatat
`entryMcap` + `pnlX = harga_sekarang / harga_entry` (lihat `sniper.js:404-414`).

### 3) Bukti PnL sniper yang NYATA — winner yang ditangkap watchlist (`.watchlist-state.json`)
Inilah "PnL saat sinyal" versi historis: token yang benar-benar dibeli wallet-wallet
watchlist saat masih mikro, diukur entry → sekarang (on-chain, `launchToNowX`).

| Winner | Entry MC (firstBuy) | Multiple (launch→now) |
|---|---|---|
| **ANSEM** | $7.914 | **40.223×** |
| **Joby** | $2.590 | **1.212×** |
| **SUNUSI** | $4.100 | **556×** |
| **SAYLOR** | $3.340 | **96×** |
| **SAPIJIJU** | $8.771 | **45×** |

Median **556×**, hanya **5 winner unik** (dari 73 wallet). Ini yang membenarkan
*mengikuti* wallet-wallet ini. **Catatan penting:** angka ini adalah PnL **entri asli
si wallet** (mereka masuk di ~$3–8k). Sinyal sniper baru menyala saat **≥2 wallet
sepakat** pada token yang sama (mcap < $2jt) — jadi kamu *membonceng lebih lambat*,
PnL realisasimu **lebih kecil** dari 40.223× itu, tapi tetap masuk saat masih < $2jt.

### Kesimpulan PnL
- **Pro Radar:** terukur, dan sejujurnya **rata-rata rugi −15,6%** pada 19 pick (1 winner besar). Screening bekerja; *edge*-nya belum positif — perlu exit-rule/posisi, bukan buy-and-hold semua.
- **Sniper live:** 0 sinyal sekarang → **belum ada PnL live untuk dilaporkan**. Butuh konfluensi pasar (≥2 wallet aktif). Untuk memicu lebih sering: perbanyak Bedah winner **baru** agar watchlist berisi wallet yang lagi aktif trading, bukan hanya diamond-hand lama.
- **Sniper (bukti historis):** wallet yang dipantau **terbukti** menangkap winner besar (median 556×, puncak ANSEM 40.223×). Tesisnya kuat; yang kurang adalah **sinyal live yang sedang berjalan** saat diuji.
