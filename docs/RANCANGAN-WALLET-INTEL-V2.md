# Rancangan Wallet Intelligence v2

Model reputasi wallet generasi kedua untuk SNIPER ENGINE (zona Solana).
Mengganti model lama "hitung tembakan kena saja" menjadi **akurasi terbukti +
bukan pelaku**. Ditulis sederhana supaya keputusan kalibrasinya bisa dibaca ulang
kapan pun. Heuristik on-chain — **bukan nasihat keuangan**.

## Konsep

Masalah model lama (watchlist Modul B): satu tembakan kena = reputasi naik.
Wallet hoki sekali, bot bundle, bahkan orang dalam (insider) ikut terangkat —
padahal yang kita cari adalah wallet yang **berulang kali benar** dan **menang
karena analisis, bukan karena tahu duluan**.

Pipeline v2, enam tahap:

1. **Kandidat — dua pintu masuk.** (a) Hasil Bedah winner (sudah ada, Modul A/B);
   (b) **kemunculan berulang** (baru): wallet yang terlihat sebagai early buyer di
   ≥ `recurMinHits` token BERBEDA otomatis jadi kandidat. Pencatatan kemunculan
   menumpang jalur yang sudah menarik data (Bedah, discovery, top-trader) — nol
   call API tambahan.
2. **Vetting "KTP".** Umur transaksi pertama-terlihat, rentang aktivitas 20 tx
   terakhir, dan penelusuran sumber dana lapis-1 (siapa pengirim SOL masuk
   pertama). Beberapa kandidat berbagi induk dana yang sama → ditandai
   `sharedFunding` (indikasi jaringan sybil satu operator). Wallet kemarin sore /
   bot sekali pakai gugur di sini.
3. **Audit akurasi retrospektif.** Tarik riwayat `auditLookbackDays` hari, temukan
   semua **entry early** (mcap saat beli < $100rb — definisi yang sama dengan
   Bedah Coin), lalu hitung **hit-rate = winner ÷ semua entry early** (winner =
   naik ≥ `winnerMinX` dari entry, ambang yang sama dengan watchlist). Reputasi
   instan dari sejarah — tidak perlu menunggu wallet menang lagi.
4. **Klasifikasi.**
   - `SMART_MONEY` — hit-rate ≥ ambang, bukan insider → dipercaya.
   - `INSIDER` — beli pra-likuiditas dan/atau early di ≥ N token dari deployer
     yang sama. **Tidak dibuang** — tetap dipantau (mereka tahu duluan = informasi),
     tapi sinyal yang semua pemicunya insider berlabel **⚠ insider**.
   - `REJECTED` — gagal vetting, atau hit-rate di bawah ambang.
   - `UNRATED` — sampel belum cukup; menunggu data.
5. **Siklus hidup.** `CANDIDATE → QUARANTINE → ACTIVE → EVICTED`. Wallet baru masuk
   **karantina**: reputasinya hanya dihitung `quarantineWeightPct`% di skor sinyal,
   sampai ikut `quarantineSignals` sinyal yang sudah dinilai track record. Bukti
   sejarah kuat (sampel besar + hit-rate tinggi + bukan insider) di-**fast-track**:
   karantina 1 sinyal, bobot 80%.
6. **Umpan balik + decay.** Setiap sinyal yang dinilai sniperTrack mengkredit
   (+`trackCredit` per WIN) / mendebit (−`trackDebitRug` per RUG) reputasi wallet
   pemicunya — idempoten, satu record dinilai sekali. Tanpa bukti baru reputasi
   **membusuk eksponensial** (half-life `repDecayHalflifeDays` hari): edge kemarin
   bukan edge selamanya. Reputasi efektif < `evictRepMin` → `EVICTED`.

**Reputasi efektif** (yang dipakai skor sinyal saat `repWeighted` aktif):
`basis (hit-rate / hasil umpan balik) × decay half-life × bobot status`.
Wallet yang belum melewati pipeline memakai reputasi watchlist lama (fallback) —
migrasi pertama membawa semua anggota lama ke status QUARANTINE tanpa menghapus
data apa pun.

## Tabel keputusan WI1–WI17

Semua angka HANYA dari registry `walletIntelParams.js` (env `WI_*` sebagai default,
live-editable dari Settings → 🧠 Wallet Intelligence). Centang = disetujui dipakai.

| # | Parameter | Env | Default | Keputusan | Setuju |
|---|---|---|---|---|---|
| WI1 | `recurMinHits` | `WI_RECUR_MIN_HITS` | 3 | Muncul ≥3× sebagai early buyer lintas token → kandidat | [x] |
| WI2 | `minWalletAgeDays` | `WI_MIN_WALLET_AGE_DAYS` | 7 | Umur tx pertama-terlihat minimal 7 hari | [x] |
| WI3 | `minTxSpanDays` | `WI_MIN_TX_SPAN_DAYS` | 3 | Rentang 20 tx terakhir minimal 3 hari | [x] |
| WI4 | `fundingCheckDepth` | `WI_FUNDING_DEPTH` | 1 | Telusuri sumber dana 1 lapis; induk sama = sharedFunding (0 = off) | [x] |
| WI5 | `auditLookbackDays` | `WI_AUDIT_LOOKBACK_DAYS` | 30 | Jendela riwayat yang diaudit 30 hari | [x] |
| WI6 | `auditMinSample` | `WI_AUDIT_MIN_SAMPLE` | 5 | Minimal 5 entry early untuk bisa dinilai (di bawah itu UNRATED) | [x] |
| WI7 | `hitrateMinPct` | `WI_HITRATE_MIN_PCT` | 25 | Hit-rate ≥25% lolos jadi SMART_MONEY | [x] |
| WI8 | `auditMaxPerTick` | `WI_AUDIT_MAX_PER_TICK` | 3 | Jatah audit 3 wallet per putaran — tidak pernah massal | [x] |
| WI9 | `insiderPreliq` | `WI_INSIDER_PRELIQ` | true | Beli pra-likuiditas = insider | [x] |
| WI10 | `insiderSameDeployerMin` | `WI_INSIDER_SAME_DEPLOYER` | 2 | Early di ≥2 token deployer sama = insider | [x] |
| WI11 | `quarantineSignals` | `WI_QUARANTINE_SIGNALS` | 3 | 3 sinyal ternilai sebelum naik ACTIVE | [x] |
| WI12 | `quarantineWeightPct` | `WI_QUARANTINE_WEIGHT` | 50 | Bobot reputasi 50% selama karantina | [x] |
| WI13 | `trackCredit` | `WI_TRACK_CREDIT` | 8 | +8 reputasi per sinyal WIN | [x] |
| WI14 | `trackDebitRug` | `WI_TRACK_DEBIT_RUG` | 15 | −15 reputasi per sinyal RUG (hukuman > hadiah) | [x] |
| WI15 | `repDecayHalflifeDays` | `WI_DECAY_HALFLIFE` | 30 | Half-life pembusukan reputasi 30 hari | [x] |
| WI16 | `evictRepMin` | `WI_EVICT_REP_MIN` | 20 | Rep efektif < 20 → EVICTED | [x] |
| WI17 | `fastTrackSample` | `WI_FASTTRACK_SAMPLE` | 15 | ≥15 sampel & hit-rate ≥40% & bukan insider → karantina 1 sinyal, bobot 80% | [x] |

Catatan implementasi: ambang fast-track 40% / bobot 80% / 1 sinyal adalah bagian
dari definisi WI17 (konstanta bernama di `walletIntel.js`, bukan angka tersebar);
batas kapasitas (jumlah tx ditarik, token unik per audit, concurrency) adalah
konstanta struktural bernama di kepala modul — pola yang sama dengan `POOL` di
`sniper.js` — bukan knob sinyal.

## Cara kalibrasi dari data sniperTrack

`GET /api/sniper/track` adalah kebenaran-dasarnya: tiap sinyal dinilai
win/loss/rug/flat beberapa jam setelah muncul. Pakai itu untuk menyetel WI:

1. **Ambang hit-rate (WI7).** Bandingkan win-rate sinyal yang dipicu wallet
   SMART_MONEY vs semua sinyal. Kalau tidak lebih baik, naikkan `hitrateMinPct`
   (atau `auditMinSample` — sampel kecil = hit-rate bohong).
2. **Bobot karantina (WI12).** Kalau sinyal dari wallet karantina ternyata sama
   akuratnya dengan wallet ACTIVE, naikkan bobot dari 50% (karantina terlalu
   pelit menahan skor). Kalau banyak rug dari wallet baru, turunkan.
3. **Kredit/debit (WI13/WI14).** Rasio 8:15 menghukum rug ~2× hadiah win. Kalau
   track record menunjukkan rug jarang tapi fatal, perbesar debit; kalau rug
   sering tapi dangkal, kecilkan supaya wallet bagus tak tergusur karena sial.
4. **Half-life (WI15).** Lihat berapa lama wallet juara bertahan akurat di track
   record. Meta memecoin cepat basi → half-life pendek (mis. 14 hari) lebih
   jujur; meta stabil → panjangkan.
5. **Evict (WI16).** Setelah beberapa minggu, cek daftar EVICTED: kalau ada
   wallet yang belakangan sering benar (masuk lagi sebagai kandidat dan lolos),
   ambangnya terlalu galak — turunkan.
6. **Insider (WI9/WI10).** Cek sinyal berlabel ⚠ di track record: kalau justru
   PnL-nya terbaik dan kamu nyaman menunggangi orang dalam, biarkan label sebagai
   informasi; kalau mayoritas berakhir rug (insider dump), pertimbangkan
   mengecualikan mereka dari skor (matikan lewat bobot, bukan hapus data).

## Titik integrasi (untuk pembaca kode)

- `walletIntel.js` — modul inti (pipeline + persistensi `.wallet-intel.json`).
- `walletIntelParams.js` — registry WI1–WI17 (pola `sniperParams.js`).
- `watchlist.js` — `getWalletsRaw()` (hook baca untuk migrasi; data lama utuh).
- `sniper.js` — skor pakai `effectiveReputation()` saat `repWeighted`; field
  `insider: true` bila SEMUA wallet pemicu berkelas INSIDER (label ⚠ di UI).
- `sniperTrack.js` — menyimpan wallet pemicu per record; setelah grading
  memanggil `applyTrackFeedback()` (import lazy + try/catch).
- Endpoint: `GET /api/wallet-intel`, `GET/POST /api/wallet-intel/params`,
  `POST /api/wallet-intel/audit/:wallet`. Interval antrean: `WI_TICK_MIN`
  (default 10 menit) di `index.js`.
