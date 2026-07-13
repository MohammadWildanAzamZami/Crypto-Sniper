# 📖 Buku Panduan — Tool Robinhood Chain

Panduan lengkap ekosistem **Robinhood Chain** di Memecoin Screener: apa itu, cara pakai
tiap panel, cara kerja di balik layar, semua endpoint API, dan semua parameter yang bisa
diatur. Ditulis agar bisa dibaca urut dari atas seperti buku, atau lompat per bab.

> ⚠️ Semua skor/sinyal di tool ini adalah **heuristik on-chain**, bukan nasihat keuangan.
> Scanner rug siap-pakai (GoPlus, Honeypot.is) belum mendukung chain ini — gate keamanan
> dibangun sendiri dari data Blockscout. Selalu DYOR.

---

## Bab 1 — Gambaran Besar

Robinhood Chain adalah L2 EVM (Arbitrum stack, gas ETH, mainnet 1 Juli 2026) yang
permissionless — siapa pun bisa deploy token, sehingga jadi "meme meta" baru. Tool ini
mem-porting seluruh pipeline screener Solana ke chain tersebut, dengan data on-chain
nyata dari dua sumber publik gratis (tanpa API key):

- **GeckoTerminal** (`network: robinhood`) — data pool, harga, likuiditas, volume, chart.
- **Blockscout** (`robinhoodchain.blockscout.com`) — explorer: transfer, saldo, holder,
  API Etherscan-compat + JSON-RPC.

### Pipeline 5 langkah

```
#1 DISCOVER  →  #2 SCREEN (GEM)  →  #3 BEDAH COIN  →  #4 WATCHLIST  →  #5 SNIPER LIVE
   cari pool      nilai layak/        cari early         wallet 0x        sinyal saat
   trending &     tidak + gate        buyer yang         ber-reputasi     ≥2 smart wallet
   fresh          keamanan            masih pegang       (smart money)    beli token sama
```

Intinya: **belajar dari winner**. Token yang sudah terbukti naik di-Bedah untuk menemukan
wallet yang membelinya paling awal *dan masih memegang* (diamond hand early). Wallet-wallet
itu direkam ke Watchlist dengan skor reputasi. Sniper lalu memantau semua wallet tersebut —
saat **≥ 2 wallet berbeda** membeli token fresh yang sama (konfluensi), muncul **sinyal**:
"smart money sedang akumulasi sebelum pump".

Dua otomasi membuat semuanya jalan sendiri tanpa klik:

1. **Auto-pilot (tick 10 menit)** — auto-Bedah winner trending → watchlist tumbuh sendiri
   → sweep sniper. Berperan sebagai *seeding + rekonsiliasi*.
2. **Watcher real-time (poll 12 detik)** — membaca event `Transfer` langsung dari chain
   via `eth_getLogs`; begitu konfluensi tercapai, sinyal naik **saat itu juga**, tidak
   menunggu tick 10 menit.

---

## Bab 2 — Menjalankan & Membuka Panel

Aplikasi (server :8787 + frontend :5173 + ngrok) sudah berjalan 24/7 lewat Windows
Scheduled Task **"MemecoinScreener"** (supervisor di luar repo). Untuk menjalankan manual:

```bash
cd web/server   && npm run dev    # backend :8787
cd web/frontend && npm run dev    # UI      :5173
```

Buka UI → panel **Robinhood Chain** (badge `EVM · L2 · Live`). Panel tersusun dari atas
ke bawah persis mengikuti pipeline: Auto-pilot → Discover → Bedah Coin → Watchlist EVM →
Sniper Live. Panel otomatis menyegarkan sinyal + status auto-pilot **tiap 15 detik**
(di-skip saat tab tersembunyi agar hemat).

---

## Bab 3 — Panel per Panel (Cara Pakai)

### 3.1 🤖 Auto-pilot

Baris status di paling atas: ukuran watchlist (`watchlist 120/300`), jumlah wallet yang
disweep, jumlah sinyal aktif, dan kapan tick terakhir jalan. Badge `🔒 penuh` artinya
watchlist mencapai cap (default 300) — berhenti *menambah* wallet baru, tapi semua yang
sudah ada tetap dipantau.

- **⚡ Jalankan sekarang** — memicu satu putaran penuh (seed + sweep) tanpa menunggu tick.

Tiap tick auto-pilot melakukan:
1. Ambil pool **trending** GeckoTerminal, saring yang mcap ≥ $250k (winner).
2. Bedah maksimal 4 winner per tick (yang belum di-Bedah dalam 6 jam terakhir).
3. Rekam kandidat smart wallet-nya ke Watchlist EVM.
4. Jalankan sweep Sniper.

### 3.2 🚀 Discover Pool

Klik **Scan Robinhood Chain** → menarik gabungan pool *trending* + *new* dari
GeckoTerminal, dedupe, saring lantai likuiditas (default ≥ $5.000), urut volume 24 jam.
Pool baru diberi badge `✨ baru <umur>`.

Tiap baris pool punya aksi:
- **🔬 screen** — jalankan Screen EVM (GEM Score) langsung di tempat (lihat 3.3).
- **🩻 bedah** — kirim alamat tokennya ke panel Bedah Coin.
- **chart ↗** — buka halaman pool GeckoTerminal.

### 3.3 🔬 Screen EVM — "GEM Score"

Padanan GEM Score di dunia EVM. Satu token dinilai dari dua sisi:

**Gate keamanan (heuristik on-chain, hasil: risk `low`/`med`/`high`):**

| Pemeriksaan | Ambang | Risk |
|---|---|---|
| Likuiditas tipis | < $10.000 | high |
| Indikasi honeypot | > 20 beli 24j tapi **0 jual** | high |
| Blockscout menandai reputasi | `scam` / `spam` | high |
| Holder sangat sedikit | < 50 | med |
| Konsentrasi 1 wallet (non-LP, non-burn) | ≥ 30% supply (≥ 50% → high) | med/high |

**Skor kualitas/momentum 0–100:**

| Komponen | Maks | Logika |
|---|---|---|
| Kedalaman likuiditas | 25 | log-scale: $10k = 12,5 · $100k = 25 |
| Turnover (vol24j ÷ liq) | 25 | 3× ≈ 24 poin |
| Jumlah pembeli 24j | 20 | 1.000 pembeli = 20 |
| Tekanan beli (rasio buy:sell) | 15 | 100% beli = 15 |
| Perubahan harga 24j positif | 15 | +150% = 15 |
| Bonus sebaran holder ≥ 500 | 5 | flat |

**Verdict:** risk `high` → **SKIP** · skor ≥ 65 → **STRONG** · skor ≥ 40 → **WATCH** ·
sisanya **SKIP**.

Screen ini adalah **fondasi bersama** — dipakai panel Discover, enrich Bedah, dan sebagai
*safety gate* Sniper.

### 3.4 🩻 Bedah Coin

Tempel alamat token winner (`0x…`) atau klik **🩻 bedah** dari Discover. Yang terjadi:

1. Cari pool likuiditas terbesar token (GeckoTerminal) → harga, mcap, waktu launch.
2. Tarik histori transfer **paling awal** (ascending, sampai 300 transfer — GeckoTerminal
   trades hanya menyimpan ±300 trade terakhir, tidak cukup untuk menemukan pembeli launch).
3. Definisi **BELI** = transfer `pool → wallet`; **JUAL** = `wallet → pool`.
4. **Early buyer** = termasuk 30 pembelian pertama ATAU membeli dalam 60 menit pertama.
5. Cek saldo **sekarang** (40 kandidat teratas): masih pegang > 10% dari yang dibeli →
   `🟢 pegang`. Inilah pembeda "diamond hand early" (kandidat smart) dari yang sudah exit.

Hasil: tabel kandidat (urutan beli `#`, alamat, jumlah dibeli, status pegang). Klik
**➕ Rekam ke Watchlist EVM** untuk menyemai watchlist (server mem-Bedah ulang secara
otoritatif sebelum merekam).

Bila Blockscout sedang sibuk (rate-limit/timeout), muncul error dengan tombol
**🔄 Coba lagi** — itu transien, bukan berarti token tak ada.

### 3.5 👛 Watchlist EVM

Memori smart money. Wallet hanya dikreditkan "catch" bila token yang di-Bedah benar-benar
**winner** (mcap ≥ $100k), idempoten per pasangan (wallet, token).

**Reputasi 0–100** = jumlah winner berbeda yang ditangkap (dominan, 22 poin per catch,
maks 65) + kualitas entri (semakin awal `buyIdx`, semakin tinggi, maks 35). Menangkap
winner demi winner = edge; satu beli awal yang beruntung = noise.

**Semua wallet terdaftar dipantau Sniper** (tanpa batas aktif), terurut reputasi.
Persistensi maks 2.000 wallet, 20 catch terakhir per wallet.

### 3.6 🎯 Sniper Live

Panel pamungkas. Tiap sinyal = satu token yang dibeli **≥ 2 wallet Watchlist berbeda**
dalam window 3 jam, lolos gate keamanan, **GEM Score ≥ 40** (di bawah itu = kualitas/
momentum kurang, dibuang), dan mcap ≤ $5 juta (lebih besar = sudah telat).

**Urutan daftar sinyal: GEM Score tertinggi dulu** (sinyal yang belum ter-screen di
bawah), tiebreaker: jumlah wallet yang masih pegang → jumlah wallet → skor sinyal →
paling baru.

Anatomi satu baris sinyal:

| Elemen | Arti |
|---|---|
| `3👛` | Jumlah wallet Watchlist berbeda yang membeli |
| Nama/alamat (klik) | Salin alamat token ke clipboard |
| `BARU` | Sinyal baru terdeteksi (belum pernah muncul) |
| `GEM 72 · STRONG` | Hasil screen EVM (skor + verdict) |
| `🖐 2/3 pegang` | Hold-tracking: berapa wallet yang **masih** memegang token |
| `mcap / liq` | Market cap & likuiditas saat screen |
| `skor N` | Skor sinyal = Σ reputasi wallet pembeli + (GEM Score × 0,5) |
| **📈 chart** | Modal chart GeckoTerminal melayang (Esc untuk tutup) + link keluar GeckoTerminal |

- **🔍 Sweep sekarang** — paksa satu sweep tanpa menunggu.
- **📊 Rekap PnL** — performa screener: tiap sinyal dibandingkan **harga kini vs harga
  saat pertama terdeteksi** (entry snapshot tak ditimpa refresh; riwayat sampai 300
  sinyal bertahan walau sinyal live sudah di-cull, ditandai `keluar`). Ringkasan berisi
  win rate, rata-rata, terbaik, terburuk. Harga kini di-fetch on-demand (default 30
  token terbaru, `?limit=` sampai 100 — GeckoTerminal publik ±30 req/mnt).
- Baris sinyal & judul modal chart menampilkan **logo token** (dari GeckoTerminal;
  token tanpa logo tampil tanpa gambar).
- Baris meta menampilkan `⚡ real-time (cek tiap 12 dtk)` bila watcher real-time aktif.

**Siklus hidup sinyal (hold-tracking):**
- Sinyal fresh kebal culling selama **grace 45 menit** (scalper watchlist sering sudah
  jual saat sweep mengecek — tanpa grace, sinyal mati di sweep yang sama saat dibuat).
- Setelah grace: tiap sweep mengecek saldo on-chain semua wallet di balik sinyal. Sinyal
  dihapus bila yang masih pegang < 2 **dan** sudah ada yang terkonfirmasi jual. Gagal
  fetch saldo = "unknown" dan **tidak pernah** memicu penghapusan (fail-safe).
- Bila hold-tracking dimatikan, fallback TTL 12 jam.
- Endpoint admin `POST /api/robinhood/sniper/purge` menghapus paksa sinyal yang semua
  wallet-nya sudah jual (abaikan grace).

---

## Bab 4 — Di Balik Layar: Dua Jalur Deteksi Beli

### 4.1 Jalur sweep (batch, tiap tick / manual)

Untuk tiap wallet aktif, baca 50 transaksi token terakhir (`tokentx`) dalam window 3 jam.

**Definisi BELI di chain ini (penting):** pembelian dibayar ETH native lewat router DEX,
jadi dari sudut pandang `tokentx` si pembeli hanya terlihat "token IN" — leg WETH terjadi
di router↔pool, bukan di wallet. Maka:

> **BELI = transaksi yang DIINISIASI wallet sendiri** (`txlist: tx.from == wallet`)
> **di mana wallet menerima token non-base** (bukan WETH/USDG) **yang tak ia kirim balik.**

Syarat "diinisiasi sendiri" inilah yang memisahkan beli-via-router dari **airdrop /
distribusi** (yang diinisiasi executor lain). Gagal fetch → dianggap bukan beli
(konservatif: lebih baik kelewatan beli daripada menampilkan airdrop sebagai sinyal).

Token dengan ≥ 2 wallet pembeli → di-screen (maks 20 kandidat teratas) → lolos gate →
jadi/refresh sinyal.

### 4.2 Jalur real-time (watcher eth_getLogs, tiap 12 detik)

Menghapus ketergantungan pada tick 10 menit untuk *deteksi*:

1. Poll `eth_getLogs` untuk event `Transfer` yang **masuk ke wallet Watchlist**
   (filter `topic2` = array alamat wallet, di-chunk 200 wallet; blok di-chunk 512).
2. **Anti-cap:** Blockscout diam-diam memotong hasil di ±1.000 log — chunk yang kena cap
   dipecah dua rekursif sampai tak ada log yang lolos.
3. Anti-airdrop paritas sweep: `eth_getTransactionByHash` → hanya hitung bila
   `tx.from == wallet` (satu lookup per tx unik, di-cache).
4. Buffer beli per token (window 3 jam yang sama). Begitu **≥ 2 wallet** → panggil
   `raiseEvmSignalNow()` → screen → gate → **sinyal langsung tampil**, digabung dengan
   wallet sinyal yang sudah ada (konfluensi lintas-jalur sweep + real-time saling
   menambah, bukan menimpa).
5. Kursor blok hanya maju sampai chunk terakhir yang sukses penuh; gagal fetch → blok
   dicoba lagi putaran berikut. Ketinggalan > 2.048 blok → lompat (tick 10-menit menambal).

Tick 10 menit tetap berjalan sebagai **seeding watchlist + rekonsiliasi hold** — bukan
lagi satu-satunya jalur deteksi.

---

## Bab 5 — Referensi API

Semua di bawah `/api` (Express :8787):

| Method | Endpoint | Fungsi |
|---|---|---|
| GET | `/robinhood/discover?min_liq=` | Pool trending + new (dedupe, lantai liq, urut vol24j) |
| GET | `/robinhood/screen?token=0x…&min_liq=` | Screen EVM satu token (GEM + gate + verdict) |
| GET | `/robinhood/bedah?token=0x…&max=` | Bedah: early buyer + kandidat smart (503 = transien, retry) |
| GET | `/robinhood/watchlist` | Watchlist smart-wallet terurut reputasi |
| POST | `/robinhood/watchlist/record` `{token}` | Bedah server-side + rekam kandidat |
| GET | `/robinhood/auto/status` | Status tick terakhir + watcher real-time |
| POST | `/robinhood/auto/seed` | Auto-seed sekarang |
| POST | `/robinhood/auto/tick` | Satu putaran penuh (seed + sweep) sekarang |
| GET | `/robinhood/sniper/signals` | Sinyal live saat ini (murah, tanpa sweep; **urut GEM Score**) |
| GET | `/robinhood/sniper/sweep` | Sweep sekarang |
| GET | `/robinhood/sniper/pnl?limit=` | Rekap PnL sinyal sejak pertama terdeteksi (maks 100) |
| POST | `/robinhood/sniper/purge` | (Admin) hapus sinyal yang smart money-nya sudah keluar semua |

---

## Bab 6 — Semua Parameter (env, `web/server/.env`)

### Auto-pilot (`evmAuto.js`)

| Env | Default | Arti |
|---|---|---|
| `RH_TICK_MIN` | 10 | Interval tick (menit); `0` = mati |
| `RH_SEED_MIN_MCAP` | 250000 | Mcap minimum winner trending yang di-Bedah |
| `RH_SEED_MAX_BEDAH` | 4 | Maks Bedah per tick |
| `RH_SEED_RESEED_MIN` | 360 | Jangan re-Bedah token sama dalam N menit |
| `RH_WATCHLIST_MAX` | 300 | Cap pertumbuhan watchlist (yang ada tetap dipantau) |

### Watchlist (`evmWatchlist.js`)

| Env | Default | Arti |
|---|---|---|
| `RH_WINNER_MIN_MCAP` | 100000 | Ambang mcap agar token dianggap winner (kredit catch) |
| `RH_WATCH_SIZE` | 40 | (legacy) dulu batas set aktif — kini semua dipantau |

### Sniper (`evmSniper.js`)

| Env | Default | Arti |
|---|---|---|
| `RH_SNIPER_SIGNAL_MIN` | 2 | Minimal wallet berbeda untuk sinyal (konfluensi) |
| `RH_SNIPER_LOOKBACK_MIN` | 180 | Window beli dihitung (menit) |
| `RH_SNIPER_RECENT_TX` | 50 | Transaksi terakhir dibaca per wallet |
| `RH_SNIPER_MAX_MCAP` | 5000000 | Mcap maksimum sinyal (lebih besar = telat) |
| `RH_SNIPER_MIN_GEM` | 40 | GEM Score minimum sinyal (di bawahnya dibuang) |
| `RH_SNIPER_MAX_ENRICH` | 20 | Maks kandidat di-screen per sweep |
| `RH_SNIPER_SAFETY_GATE` | true | Gate keamanan screen (`false` = matikan) |
| `RH_SNIPER_TRACK_HOLDING` | true | Hold-tracking on-chain (`false` = pakai TTL) |
| `RH_SNIPER_HOLD_GRACE_MIN` | 45 | Grace sinyal fresh sebelum eligible culling |
| `RH_SNIPER_TTL_MIN` | 720 | TTL fallback saat hold-tracking off |

### Watcher real-time (`evmRealtime.js`)

| Env | Default | Arti |
|---|---|---|
| `RH_RT` | true | `false` = matikan watcher |
| `RH_RT_POLL_SEC` | 12 | Jeda antar poll (detik) |
| `RH_RT_CHUNK_BLOCKS` | 512 | Blok per chunk `eth_getLogs` (±50 dtk chain) |
| `RH_RT_WALLET_CHUNK` | 200 | Wallet per filter `topic2` |
| `RH_RT_MAX_SPAN` | 2048 | Batas kejar-ketinggalan blok per putaran |
| `RH_RT_BACKLOG_BLOCKS` | 600 | Mundur ±1 menit saat boot |

### Discover (`routes/robinhood.js`)

| Env | Default | Arti |
|---|---|---|
| `RH_MIN_LIQUIDITY` | 5000 | Lantai likuiditas Discover (USD) |

### File state (persisted, di-gitignore)

| File | Isi |
|---|---|
| `web/server/screener/.evm-watchlist-state.json` | Watchlist wallet + reputasi + catches |
| `web/server/screener/.evm-sniper-state.json` | Sinyal Sniper Live aktif |

Keduanya fail-safe: FS read-only → tetap jalan in-memory.

---

## Bab 7 — Batasan, Gotcha & Troubleshooting

**Batasan yang perlu diingat:**
- Mcap memakai **fallback FDV** — `market_cap_usd` GeckoTerminal hampir selalu null
  untuk memecoin baru (butuh verifikasi CoinGecko).
- Blockscout publik **sering rate-limit / blip transien** — semua fetch punya retry 3×
  dengan backoff, dan kegagalan selalu degrade aman (tidak pernah melempar ke loop).
- `eth_getLogs` Blockscout: filter array `topics` didukung tapi kadang flaky ("Internal
  server error" transien → di-retry), dan hasil **di-cap ±1.000 log tanpa penanda** —
  sudah ditangani dengan pecah-chunk rekursif.
- Gate keamanan **bukan** simulasi honeypot penuh — hanya heuristik on-chain.
- Bedah menganalisis maksimal 300 transfer awal (`?max=` sampai 600) — token yang sangat
  ramai bisa punya early buyer di luar window (`windowTruncated: true`).

**"Kenapa Sniper kosong?"** — checklist:
1. Watchlist masih kosong → Bedah beberapa winner dulu, atau tunggu auto-pilot
   (tick pertama 15 detik setelah boot, lalu tiap 10 menit).
2. Belum ada konfluensi — sinyal butuh ≥ 2 wallet berbeda beli token yang sama dalam
   3 jam. Ini memang jarang; makin banyak winner di-Bedah → makin banyak wallet dipantau
   → makin sering sinyal.
3. Kandidat terganjal gate (risk high / GEM < 40 / mcap > $5 jt) — by design.
4. Wallet scalper sudah jual sebelum grace habis → sinyal ter-culling (cek `🖐 pegang`).

**"Bedah gagal terus"** — error dengan tombol retry = Blockscout sibuk (transien).
Tunggu sebentar lalu coba lagi; bukan berarti token tidak ada.

---

## Bab 8 — Peta Kode

| File | Peran |
|---|---|
| `web/server/routes/robinhood.js` | Semua endpoint HTTP `/api/robinhood/*` |
| `web/server/screener/evmScreen.js` | Langkah #2 — GEM Score + gate keamanan (fondasi bersama) |
| `web/server/screener/evmAutopsy.js` | Langkah #3 — Bedah Coin (early buyer, transfer asc) |
| `web/server/screener/evmWatchlist.js` | Langkah #4 — watchlist + reputasi wallet |
| `web/server/screener/evmSniper.js` | Langkah #5 — sweep, sinyal, hold-tracking, purge |
| `web/server/screener/evmRealtime.js` | Watcher real-time `eth_getLogs` |
| `web/server/screener/evmAuto.js` | Auto-pilot: seed + sweep per tick |
| `web/frontend/src/components/panels/RobinhoodPanel.vue` | Seluruh UI panel |

Modul dinyalakan dari `web/server/index.js`: `startEvmAuto()` (tick) dan
`startEvmRealtime()` (watcher).
