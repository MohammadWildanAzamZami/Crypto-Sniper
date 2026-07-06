# Diskusi: Sinyal Sniper Live (Modul C) — Bedah Celah & Parameter Baru

> Dokumen kerja untuk **membedah** engine "Sinyal Sniper Live" sebelum menambah
> fitur/parameter. Bukan spec final — ini bahan diskusi. Referensi kode:
> `web/server/screener/sniper.js`, sumber data `web/server/screener/watchlist.js`,
> UI `web/frontend/src/components/panels/SniperPanel.vue`.
> Status per: 2026-07-06.

---

## 1. Apa yang sinyal ini *klaim* lakukan

> "Token yang **sedang diborong beberapa smart wallet sekaligus** (dari Watchlist)
> selagi masih kecil — sinyal akumulasi **sebelum** pump."

Jadi janji produknya: **konfluensi smart money pada token kecil, lebih awal dari
crowd.** Semua celah di bawah diukur terhadap janji ini.

---

## 2. Cara kerja sekarang (pipeline satu sweep)

`runSniperSweep()` (`sniper.js:130`) tiap `SNIPER_POLL_MIN` (default 5m, dijadwalkan
di `index.js:70`):

1. **Ambil wallet aktif** — top `WATCH_SIZE` (40) dari watchlist by reputasi.
2. **Baca buys tiap wallet** — `recentBuys()`: Helius `/v0/addresses/.../transactions?limit=20`,
   ambil `tokenTransfers` di mana `toUserAccount === owner` & `tokenAmount > 0` &
   bukan stable/wSOL, dan `timestamp` masih dalam `LOOKBACK_MIN` (90m).
3. **Kelompokkan per token** — `byToken`: mint → { set wallet, lastAt }.
4. **Kandidat** — token dengan `wallets.size >= SIGNAL_MIN` (2), urut jumlah wallet,
   ambil `MAX_ENRICH` (20) teratas.
5. **Enrich + gate mcap** — Birdeye `token_overview`; buang kalau `mcap > SIGNAL_MAX_MCAP`
   (2jt). Simpan/refresh sinyal.
6. **Expire** — sinyal > `SIGNAL_TTL_MIN` (360m) dihapus.

Tunable sekarang: `SIGNAL_MIN`, `SIGNAL_MAX_MCAP`, `RECENT_TX`, `LOOKBACK_MIN`,
`SIGNAL_TTL_MIN`, `MAX_ENRICH`, `POLL_MIN`, `WATCH_SIZE`.

---

## 3. Peta celah (yang belum ketutup)

Diurut kira-kira dari paling berdampak. Severity: 🔴 tinggi / 🟠 sedang / 🟡 kecil.

| # | Celah | Di mana | Dampak | Sev |
|---|-------|---------|--------|-----|
| C1 | **Token paling fresh malah dibuang** | `sniper.js:167` `if (!snap) return;` | Birdeye sering belum kenal token yang baru launch beberapa menit — padahal itulah target "sebelum pump". Snapshot `null` → kandidat di-drop diam-diam. **Sinyal terbaik justru hilang.** | 🔴 |
| C2 | **"Buy" palsu** | `recentBuys()` `sniper.js:81` | Semua token *masuk* dihitung buy. Tidak ada verifikasi ini benar swap (SOL/USDC keluar). Airdrop, kiriman orang, LP token, transfer antar-wallet sendiri → ikut jadi "buy". Confluence bisa dari non-buy. | 🔴 |
| C3 | **mcap tak dikenal lolos gate** | `sniper.js:169` `snap.mcap > 0 && …` | Kalau Birdeye balikin `mcap = 0` (tak diketahui), token **lolos** filter tanpa dicek. Gate hanya menyaring yang *kebesaran*, tidak yang *tak terverifikasi*. | 🟠 |
| C4 | **Tidak ada lantai bawah / gate keamanan** | tidak ada | Tidak ada `MIN_MCAP`/`MIN_LIQUIDITY`, tidak ada cek mint/freeze authority, LP locked/burned, konsentrasi holder. Sinyal bisa menunjuk honeypot/rug likuiditas $300. | 🔴 |
| C5 | **Semua wallet dianggap sama** | `sniper.js:158` count | `SIGNAL_MIN` hanya menghitung *jumlah* wallet distinct. 2 wallet elite (rep 95, 3 winner) = 2 wallet pinggiran (rep 30). Tidak ada bobot reputasi → sinyal encer & kuat tak terbedakan. | 🟠 |
| C6 | **Ukuran buy diabaikan** | `recentBuys()` | Beli $5 = beli $5.000. Bot sniper sering *test-buy* dust. Tanpa `MIN_BUY_USD` / bobot ukuran, dust bareng bisa lolos sebagai "akumulasi". | 🟠 |
| C7 | **Tidak sadar SELL** | tidak ada | Wallet beli lalu dump di window yang sama tetap dihitung "sedang akumulasi". Tidak ada net-position. Sinyal bisa dari wallet yang sudah keluar. | 🟠 |
| C8 | **Window confluence longgar** | `LOOKBACK_MIN` 90m | 2 wallet beli beda 89 menit dianggap sekuat beda 3 menit. Tidak ada *co-buy window* ketat untuk menangkap konviksi/koordinasi bareng (sinyal paling tajam). | 🟡 |
| C9 | **Entry smart money tak ditampilkan** | signal shape `sniper.js:171` | UI tampil `mcap` sekarang, bukan mcap saat smart wallet beli. User tak tahu **sudah telat berapa x**. (`firstBuyMcap` ada di watchlist catches, tak dibawa ke sinyal live.) | 🟠 |
| C10 | **Ranking cuma by waktu** | `getSignals()` `sniper.js:198` | Diurut `updatedAt` saja. Sinyal 5 wallet elite kalah "baru" dari 2 wallet dust. Tidak ada **skor kekuatan** komposit untuk urutan & ambang. | 🟠 |
| C11 | **`RECENT_TX = 20` truncation diam** | `sniper.js:23,82` | Wallet sangat aktif (>20 tx/90m) → buy lama dalam window kelewat; lookback efektif menyusut. Tanpa paging/log, tak kelihatan. | 🟡 |
| C12 | **`MAX_ENRICH = 20` buang diam** | `sniper.js:160` | Saat burst kandidat, sisanya dibuang tanpa jejak — terbaca seolah "cuma segini sinyalnya". | 🟡 |
| C13 | **Belum ada alert channel (D4)** | — | "Live" tapi user harus buka tab. `isNew` ada, tapi tak ada push/Telegram. Nilai real-time-nya hilang untuk sniping. | 🟠 |

---

## 4. Parameter baru yang diusulkan (untuk menutup celah)

Semua env-overridable, sejalan gaya tunable yang sudah ada. **Belum diimplementasi
— ini untuk disepakati dulu.**

| Parameter | Default usul | Menutup | Fungsi |
|-----------|-------------|---------|--------|
| `SNIPER_REQUIRE_SWAP` | `true` | C2 | Hanya hitung buy dari tx `type=SWAP` **dan** ada native SOL/USDC keluar dari owner. Bunuh airdrop/transfer palsu. |
| `SNIPER_MIN_BUY_USD` | `50` | C6 | Abaikan test-buy dust di bawah nilai ini (butuh harga saat beli). |
| `SNIPER_MIN_MCAP` | `10000` | C3, C4 | Lantai bawah — buang token terlalu mikro/tak likuid. |
| `SNIPER_MIN_LIQUIDITY` | `5000` | C4 | Lantai likuiditas (dari Birdeye) — kurangi honeypot/rug. |
| `SNIPER_ALLOW_UNKNOWN_MCAP` | `false` | C1, C3 | Kalau `false`: token yang Birdeye belum kenal **ditahan** (bukan diam-diam di-drop atau diam-diam lolos) → masuk antrean *retry* sweep berikutnya. Kalau `true`: loloskan dengan flag `unverified`. Ini keputusan trade-off (lihat §5). |
| `SNIPER_COBUY_WINDOW_MIN` | `20` | C8, C10 | Window ketat: confluence dianggap "kuat" bila ≥`SIGNAL_MIN` wallet beli dalam rentang ini. Jadi komponen skor. |
| `SNIPER_REP_WEIGHTED` | `true` | C5, C10 | Skor confluence = Σ reputasi wallet, bukan sekadar hitung kepala. |
| `SNIPER_SCORE_MIN` | `120` | C10 | Ambang skor komposit (rep + ukuran + kerapatan window) agar sinyal muncul — pelengkap/pengganti `SIGNAL_MIN`. |
| `SNIPER_SAFETY_GATE` | `true` | C4 | Reuse pemeriksaan keamanan dari Bedah Coin (mint/freeze authority, LP, top holders) sebelum sinyal ditayangkan. |
| `SNIPER_NET_BUY_ONLY` | `true` | C7 | Kurangi jumlah token yang dijual owner di window yang sama; hanya hitung net-buy positif. |

Tambahan non-parameter (perlu kode):
- **C9** — bawa `firstBuyMcap`/mcap-saat-beli ke shape sinyal, tampilkan "smart money masuk di $X → sekarang $Y (nY×)".
- **C11/C12** — naikkan/paging `RECENT_TX`, dan `log()` berapa kandidat dibuang oleh `MAX_ENRICH`.
- **C13** — kanal alert (Telegram webhook / Web Push) saat `isNew`.

---

## 5. Titik keputusan yang perlu kamu jawab

1. **Filosofi C1 (token belum dikenal Birdeye)** — ini inti "sebelum pump". Pilih:
   - (a) **Tahan & retry** (`ALLOW_UNKNOWN_MCAP=false`) — tak pernah tampilkan token
     tak terverifikasi; risiko: telat beberapa menit sampai Birdeye kenal.
   - (b) **Tampilkan dengan label `unverified`** (`=true`) — paling awal, tapi bisa
     nunjuk token sampah; wajib dipadu `SAFETY_GATE`.
   - (c) **Sumber kedua** — pakai DexScreener/on-chain pool untuk mcap/likuiditas saat
     Birdeye kosong (paling akurat, paling banyak kerja).

2. **Model ambang** — tetap `SIGNAL_MIN` (hitung kepala) yang mudah dipahami, atau
   pindah ke `SCORE_MIN` (skor tertimbang reputasi+ukuran+window) yang lebih tajam
   tapi kurang intuitif? Atau dua-duanya (minimal N wallet **dan** skor ≥ ambang)?

3. **Ketat vs. ramai** — sniper ini mau **sedikit tapi tajam** (banyak gate, sinyal
   jarang) atau **ramai tapi bising** (gate longgar, banyak sinyal)? Ini menentukan
   default semua angka di atas.

4. **Alert (C13)** — perlu Telegram/push sekarang, atau cukup badge "BARU" di UI dulu?

5. **Prioritas** — mana yang dikerjakan lebih dulu? Usulan urutan by rasio dampak/usaha:
   **C2 → C1/C3 → C4 → C5/C10 → C9 → sisanya.**

---

## 5.1 Keputusan (terjawab 2026-07-06)

| Pertanyaan | Jawaban | Konsekuensi |
|-----------|---------|-------------|
| C1 token belum dikenal Birdeye | **Tampilkan label `unverified`** (opsi b) | `SNIPER_ALLOW_UNKNOWN_MCAP=true`, TAPI wajib lolos `SNIPER_SAFETY_GATE` dulu. Token muncul dengan badge `unverified` di UI. |
| Karakter sniper | **Sedikit tapi tajam** | Semua gate aktif, default diperketat (lihat tabel di bawah). Sinyal jarang = fitur, bukan bug. |
| Prioritas | **Semua** dikerjakan, urut: C2 + C1/C3 → C4 → C5/C10 → C13 | Bertahap; tiap tahap fail-safe & bisa dirilis sendiri. |

**Resolusi tegangan "unverified" vs "tajam":** token fresh boleh tampil lebih awal
(unverified), **tapi tidak melewati `SAFETY_GATE`**. Jadi urutan gate:
`SWAP asli → net-buy → likuiditas/mcap floor → SAFETY → (mcap dikenal? verified : unverified)`.
Yang tak dikenal Birdeye lolos ke UI **hanya** kalau on-chain safety-nya bersih.

### Default mode "sedikit tapi tajam"

| Parameter | Default lama/usul | **Default ketat** |
|-----------|------------------|-------------------|
| `SNIPER_REQUIRE_SWAP` | true | **true** |
| `SNIPER_NET_BUY_ONLY` | true | **true** |
| `SNIPER_MIN_BUY_USD` | 50 | **100** |
| `SNIPER_MIN_MCAP` | 10.000 | **15.000** |
| `SNIPER_MIN_LIQUIDITY` | 5.000 | **8.000** |
| `SNIPER_SAFETY_GATE` | true | **true (wajib)** |
| `SNIPER_ALLOW_UNKNOWN_MCAP` | false | **true** (aman krn SAFETY wajib) |
| `SNIPER_REP_WEIGHTED` | true | **true** |
| `SNIPER_SIGNAL_MIN` | 2 | **2** (tetap; kualitas via skor, bukan jumlah) |
| `SNIPER_SCORE_MIN` | 120 | **150** |
| `SNIPER_COBUY_WINDOW_MIN` | 20 | **15** |

### Rencana kerja bertahap

- **Tahap 1 — Akurasi deteksi (C2 + C1/C3).** Filter `type=SWAP` + native-out di
  `recentBuys()`; berhenti drop token `null` diam-diam → tandai `unverified`;
  perbaiki logika gate mcap==0. *Fondasi — tanpa ini gate lain menyaring data kotor.*
- **Tahap 2 — Gate keamanan (C4).** Reuse cek honeypot/rug dari Bedah Coin +
  `MIN_MCAP`/`MIN_LIQUIDITY`. Ini yang bikin `unverified` boleh tampil.
- **Tahap 3 — Skor tertimbang (C5/C10).** Skor = f(reputasi, ukuran buy, kerapatan
  co-buy window); urutkan & ambang dengan `SCORE_MIN`. Sertakan `why:[...]` di sinyal.
- **Tahap 4 — Alert (C13).** Telegram webhook / Web Push saat sinyal `isNew` & skor tinggi.

### Progres

- ✅ **Tahap 1 (C2 + C1/C3)** — `recentBuys()` verifikasi buy asli (bayar SOL/stable);
  token fresh tak dibuang, ditandai `unverified`; badge di UI. Tunable `SNIPER_REQUIRE_SWAP`,
  `SNIPER_ALLOW_UNKNOWN_MCAP`.
- ✅ **C9 (Panel A — Posisi Smart Money)** — sinyal kini membawa `positions[]` per-wallet
  (reputasi, waktu masuk, harga/mcap entry, ukuran, PnL×), dihitung dari isi tx tanpa
  API tambahan (harga SOL diambil sekali/sweep). Ditampilkan sebagai tabel di dalam
  popup chart. Catatan: overlay marker di chart DexScreener tak mungkin (cross-origin) —
  marker "di dalam candle" butuh chart sendiri (opsi B/C, ditunda). Whale (top holders)
  belum — smart money dulu.
- ✅ **Tahap 2 (C4 — gate keamanan)** — `safetyCheck()` me-reuse `screenToken` (DexScreener +
  RugCheck + Pump.fun) sebagai gate: tolak rug/honeypot, likuiditas < `SNIPER_MIN_LIQUIDITY`
  (8k), mcap < `SNIPER_MIN_MCAP` (15k). **Bukan** full quality gate Pro Radar (yang menuntut
  volume/graduate — justru membunuh target fresh). DexScreener jadi **sumber kedua**: token
  yang Birdeye tak kenal tapi lolos screener dapat mcap asli → jadi verified; yang tak
  terverifikasi sama sekali → **ditahan (fail-closed)** — inilah yang bikin `unverified` aman
  sesuai keputusan §5.1. Sinyal kini bawa `liquidityUsd` + `safetyChecked`; UI: chip "🛡️ gate
  aman" + badge 🛡️ per sinyal + likuiditas di tiap baris. Tunable: `SNIPER_SAFETY_GATE`,
  `SNIPER_MIN_MCAP`, `SNIPER_MIN_LIQUIDITY`, `SNIPER_MIN_LOCKED_PCT`.
- ✅ **Tahap 3 (C5/C10 — skor tertimbang)** — tiap sinyal kini punya `score` komposit =
  reputasi (`Σ` tertimbang, atau flat per-kepala kalau `SNIPER_REP_WEIGHTED=false`) +
  bonus ukuran beli (log-scaled) + bonus kerapatan co-buy (wallet yang beli dalam
  `SNIPER_COBUY_WINDOW_MIN` menit = konviksi terkoordinasi). Sinyal di bawah
  `SNIPER_SCORE_MIN` (150) **ditahan**, dan daftar **diurut by skor** (bukan lagi cuma
  waktu). Tiap sinyal bawa `why[]` (alasan) → UI: pill **🔥 skor** (tooltip = why) +
  chip "skor ≥ N". Tunable: `SNIPER_REP_WEIGHTED`, `SNIPER_SCORE_MIN`, `SNIPER_COBUY_WINDOW_MIN`.
  Catatan: dengan watchlist masih baru (reputasi rendah), sinyal bisa jarang lolos —
  turunkan `SNIPER_SCORE_MIN` sementara untuk testing.
- ⏳ **Berikutnya:** Tahap 4 (alert Telegram/push C13).

## 6. Catatan implementasi (kalau lanjut)

- Semua gate baru harus **fail-safe**: sumber data mati → jangan buang sinyal diam-diam,
  tandai `unverified`/`unknown` sesuai kesepakatan §5.1. Prinsip "sweep never throws"
  di `sniper.js` dipertahankan.
- Skor & alasan sebaiknya ikut di shape sinyal (`why: [...]`) supaya UI bisa jelaskan
  "kenapa ini sinyal" — bukan angka gelap.
- Tetap heuristik, **bukan nasihat keuangan** — bahasa disclaimer di UI dipertahankan.
</content>
