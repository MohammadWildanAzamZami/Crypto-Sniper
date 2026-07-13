# 📖 Buku Panduan — Tool Solana Chain (Memecoin Screener)

> Panduan baca lengkap semua tool di zona **Solana** aplikasi Memecoin Screener:
> apa fungsinya, kapan dipakai, cara pakainya, dan cara membaca hasilnya.
> Ditulis untuk dibaca berurutan dari awal — tapi tiap bab juga bisa dibaca lepas.
>
> Rujukan teknis lanjutan: [PETA-TOOL.md](PETA-TOOL.md) (peta & diagram),
> [REKAP-PARAMETER.md](REKAP-PARAMETER.md) (semua parameter), [SNIPER-ENGINE.md](SNIPER-ENGINE.md)
> (detail mesin sniper). Zona Robinhood Chain/EVM punya panduan sendiri:
> [ROBINHOOD-CHAIN.md](ROBINHOOD-CHAIN.md).
>
> ⚠️ Semua angka & skor di aplikasi ini heuristik — **bukan nasihat keuangan. DYOR.**

---

## Daftar isi

1. [Cara membuka aplikasi](#1-cara-membuka-aplikasi)
2. [Mental model — cara semua tool saling terhubung](#2-mental-model)
3. [💎 GEM Score Screener](#3--gem-score-screener)
4. [🚀 10x Radar](#4--10x-radar)
5. [🧠 Pro Radar (AI)](#5--pro-radar-ai)
6. [🔬 Bedah Coin — Modul A](#6--bedah-coin--modul-a)
7. [🎯 Watchlist Wallet — Modul B](#7--watchlist-wallet--modul-b)
8. [🎯 Sinyal Sniper Live — Modul C](#8--sinyal-sniper-live--modul-c)
9. [🧾 Log Transaksi Wallet](#9--log-transaksi-wallet)
10. [✅ Checklist Manual](#10--checklist-manual)
11. [⚙️ Settings](#11--settings)
12. [💬 Chat AI](#12--chat-ai)
13. [Chart: GMGN & Axiom](#13-chart-gmgn--axiom)
14. [Infrastruktur: server 24/7, ngrok, webhook](#14-infrastruktur)
15. [Troubleshooting — masalah yang sering terjadi](#15-troubleshooting)
16. [Glosarium](#16-glosarium)

---

## 1. Cara membuka aplikasi

Aplikasi jalan **24/7** di komputer ini lewat Windows Scheduled Task
`MemecoinScreener` (supervisor `keep-alive.ps1` menjaga server + ngrok tetap hidup).

| Akses | URL |
|---|---|
| Lokal (di komputer ini) | `http://127.0.0.1:8787` |
| Dari luar (HP / komputer lain) | `https://unsnap-rekindle-patriarch.ngrok-free.dev` |

Di kanan bawah UI ada tombol melayang **Solana ⇄ Robinhood Chain** untuk pindah
zona. Buku ini membahas zona **Solana**.

---

## 2. Mental model

Aplikasi ini punya **dua jalur berburu** yang saling melengkapi:

**Jalur 1 — Screening pasar (token-first):** pindai token yang lagi trending,
beri skor, saring yang berkualitas.

```
Token trending → 💎 GEM Score → 🚀 10x Radar / 🧠 Pro Radar (AI) → alert Telegram
```

**Jalur 2 — SNIPER ENGINE (wallet-first), inti aplikasi:** cari *smart wallet*
(wallet yang terbukti beli winner lebih awal), lalu pantau mereka live. Saat
beberapa wallet pintar memborong token kecil yang sama → sinyal.

```
Token sudah pump ≥10x
      │
      ▼
🔬 Modul A: Bedah Coin ──► temukan wallet yang beli paling awal
      │
      ▼
🎯 Modul B: Watchlist ───► kumpulkan & beri peringkat wallet (self-learning)
      │
      ▼
🎯 Modul C: Sniper Live ─► pantau real-time (webhook Helius) → 🔔 SINYAL
```

**Kuncinya:** makin rajin kamu **Bedah** token winner, makin pintar **Watchlist**,
makin tajam **Sinyal Live**. Sistem belajar dari data yang kamu suapkan.

---

## 3. 💎 GEM Score Screener

**Apa ini:** penilai satu token. Masukkan alamat mint → keluar skor **0–100**
dan verdict (**STRONG / WATCH / SKIP**).

**Kapan dipakai:** setiap kali kamu menemukan token dari mana pun (Twitter,
Telegram, teman) dan mau cek cepat "layak dilirik atau tidak".

**Cara pakai:**
1. Buka panel 💎, tempel alamat mint token, tekan **Screen**.
2. Baca skor + rincian tiga pilar:
   - **Likuiditas & keamanan** — LP lock, ukuran likuiditas, red flag rug.
   - **Momentum** — perubahan harga/volume/txn beberapa jam terakhir.
   - **Trust** — umur pair, sebaran holder, sinyal smart money (jika Birdeye aktif).
3. Chart GMGN tampil inline; tombol **Buka di Axiom ↗** untuk analisis lanjut
   (posisi wallet — perlu login wallet di Axiom).

**Cara baca hasil:** skor tinggi ≠ pasti naik — artinya *struktur token sehat*.
Skor rendah hampir selalu berarti jangan sentuh. Perhatikan alasan per pilar,
bukan cuma angka totalnya.

**Data:** DexScreener (harga/pair), RugCheck (keamanan), Solscan Pro bila ada
(holder), Birdeye bila ada (smart money).

---

## 4. 🚀 10x Radar

**Apa ini:** screener otomatis. Tiap **15 menit** mengambil token trending
(DexScreener boosts), menilai dengan GEM Score, menyaring lewat gate kualitas,
dan menampilkan kandidat terbaik. Pick baru dikirim ke **Telegram** (jika diisi).

**Kapan dipakai:** sebagai "mata" pasif — kamu tidak perlu memantau pasar
manual; buka panel ini beberapa kali sehari atau tunggu alert.

**Cara pakai:** tidak perlu apa-apa — auto-scan jalan sendiri. Tombol scan
manual tersedia untuk memaksa siklus baru. Tiap kartu menampilkan skor, alasan,
MC/likuiditas, dan link **📈 Chart (Axiom)**.

**Catatan:** Radar biasa tidak memakai AI — murni skor heuristik. Untuk penilaian
AI, lihat Pro Radar di bawah.

---

## 5. 🧠 Pro Radar (AI)

**Apa ini:** versi lanjutan 10x Radar. Kandidat yang lolos skor disodorkan ke
**Claude (AI)** yang menilai: **conviction** (keyakinan), **tesis** (kenapa menarik),
**katalis**, dan **red flag**. Punya **track record self-learning** — mencatat
nasib tiap pick (naik/turun berapa X) dan menyetel ambangnya sendiri.

**Kapan dipakai:** saat kamu mau shortlist yang sudah "dipikirkan", bukan sekadar
angka. Ini panel screening paling tajam di jalur token-first.

**Cara pakai:**
1. Buka panel 🧠 — daftar pick terurut conviction.
2. Klik **📈 Lihat chart** → chart GMGN inline + tombol **Buka di Axiom ↗**.
3. Bagian *track record* menunjukkan win-rate radar selama ini — pakai ini untuk
   mengkalibrasi seberapa percaya kamu pada sinyalnya.

**Biaya:** panel ini memanggil AI (mode `local` pakai CLI Claude tanpa biaya API;
mode `api` memakai ANTHROPIC_API_KEY — diatur di Settings).

---

## 6. 🔬 Bedah Coin — Modul A

**Apa ini:** *autopsy* token yang **sudah** pump. Tool membedah riwayat transaksi
dan menemukan **wallet yang beli paling awal** sebelum pump — kandidat smart wallet.

**Kapan dipakai:** setiap kali kamu melihat token yang sudah naik ≥10x. Jangan
sedih ketinggalan — **bedah** token itu, karena wallet pembeli awalnya adalah
harta karun untuk sinyal berikutnya.

**Cara pakai:**
1. Buka panel 🔬, tempel mint token yang sudah pump, tekan **Bedah**.
2. Tool menghitung `launchToNowX` (berapa X dari launch) dan menggali pembeli
   awal via **Birdeye** (top trader) + **Helius** (riwayat tx, verifikasi wallet mapan).
3. **Otomatis:** kandidat wallet yang bersih langsung direkam ke **Watchlist
   (Modul B)**. Kalau tokennya benar winner (≥ `winnerMinX`, default 10x),
   wallet-wallet itu dapat kredit **catch**.

**Cara baca hasil:** perhatikan wallet dengan entry mcap kecil dan pola beli
yang rapi (bukan bot spam). Makin sering wallet yang sama muncul di bedah token
*berbeda*, makin tinggi nilainya.

---

## 7. 🎯 Watchlist Wallet — Modul B

**Apa ini:** bank data smart wallet — hasil panen dari Bedah Coin dan
auto-discovery. Tiap wallet punya **reputasi**, jumlah **catches** (menang di
berapa token berbeda), dan **winnerScore** (total kelipatan semua winner-nya —
ini kunci peringkatnya).

**Dari mana isinya:**
- 🔬 **Bedah Coin** (manual, bab 6) — sumber paling berkualitas.
- 🛰️ **Auto-Discovery** (tiap 20 menit) — memindai token trending & top-trader
  secara otomatis, membedah yang winner, dan menambah wallet sendiri.

**Cara pakai:**
1. Buka panel 🎯 Watchlist — daftar terurut winnerScore (terbesar dulu).
2. Tiap baris: peringkat, reputasi, catches, sightings, best catch (token +
   berapa X), catches terbaru, dan status **aktif** (= dipantau live Modul C).
3. Filter **minCatches** menentukan siapa yang *ditampilkan*: hanya wallet
   dengan ≥ N token winner berbeda. Ini murni filter tampilan — **pemantauan
   tetap berjalan untuk semua wallet**.

**Setelan penting saat ini:**
- `SNIPER_WATCH_SIZE=0` → **semua** wallet di watchlist dipantau (tanpa batas top-N).
- `SNIPER_WEBHOOK_MAX_ADDR=2000` → kapasitas alamat webhook (praktis "semua").
- `minCatches` (panel Settings) → filter tampilan. **Hati-hati:** kalau di-set
  lebih tinggi dari catches maksimum yang ada, panel tampak kosong (lihat
  [Troubleshooting](#15-troubleshooting)).

**Wallet Intelligence v2 (baru):** lapisan penyaring mutu di atas watchlist —
wallet baru masuk **karantina** dulu, di-vet & di-audit bertahap (antrean tiap
10 menit) sebelum dianggap layak. Rancangan lengkap:
[RANCANGAN-WALLET-INTEL-V2.md](RANCANGAN-WALLET-INTEL-V2.md).

---

## 8. 🎯 Sinyal Sniper Live — Modul C

**Apa ini:** jantung aplikasi. Memantau **semua wallet aktif** watchlist secara
**real-time** dan menaikkan 🔔 **sinyal** saat ≥ N wallet pintar memborong token
kecil yang sama dalam waktu berdekatan.

**Cara kerjanya (ringkas):**
1. **Event-driven:** Helius **webhook** mengirim event SWAP wallet terpantau ke
   server (lewat ngrok) begitu terjadi — bukan polling. (Fallback poll: OFF.)
2. Event memicu *sweep*: baca transaksi terbaru wallet → saring **beli asli**
   (bayar SOL/stable + net-buy + ≥ `minBuyUsd`).
3. Kelompokkan per token → butuh ≥ `signalMin` wallet di token yang sama.
4. **Gate keamanan:** mcap/likuiditas minimum, cek rug/honeypot/LP-lock
   (DexScreener + RugCheck + Pump.fun).
5. Skor komposit ≥ `scoreMin` → 🔔 sinyal naik (kedaluwarsa setelah `signalTtlMin`).

**Dua varian sinyal:**
- **v2** — jalur utama, lengkap dengan gate keamanan.
- **awal** — jalur "sinyal dini" yang lebih longgar/lebih cepat, tanpa sebagian
  gate. Berisiko lebih tinggi, tapi lebih dulu. Keduanya tampil terpisah di panel.

**Cara pakai panel:**
1. Buka panel 🎯 Sinyal Sniper Live. Sinyal terurut terbaru.
2. Tiap kartu: token, jumlah wallet yang beli, entry mcap rata-rata, skor, dan
   badge gate.
3. Klik chart → modal **chart GMGN** + tabel **👛 Posisi Smart Money** (siapa
   masih hold, siapa sudah jual — sinyal exit yang sangat berharga!).
4. Tombol **Axiom ↗** membuka chart Axiom penuh (login wallet) untuk lihat posisi
   wallet lain.
5. Tombol **🤖 Jelaskan** meminta AI menjelaskan kenapa sinyal ini muncul.

**Cara membaca sinyal:** jumlah wallet > skor. 3 wallet reputasi tinggi yang
masuk barengan di mcap kecil jauh lebih kuat daripada skor tinggi dengan 2 wallet.
Perhatikan juga tabel posisi: kalau para wallet mulai keluar, itu sinyal exit.

---

## 9. 🧾 Log Transaksi Wallet

**Apa ini:** feed mentah semua transaksi wallet terpantau yang masuk lewat
webhook — beli maupun jual, sebelum difilter jadi sinyal.

**Kapan dipakai:**
- Memverifikasi "apakah pemantauan hidup?" (kalau log berhenti lama, ada masalah
  webhook/ngrok).
- Melihat aktivitas wallet favorit secara langsung, termasuk jual (sinyal exit)
  yang tidak muncul sebagai 🔔.

**Cara pakai:** buka panel 🧾. Tiap baris: waktu, wallet, arah (beli/jual),
token, nilai. Klik tanda tangan tx → Solscan; klik mint → **chart Axiom**.

---

## 10. ✅ Checklist Manual

**Apa ini:** SOP screening manual — daftar periksa bertahap kalau kamu mau
menilai token **tanpa** mengandalkan skor otomatis (atau untuk belajar memahami
apa yang dinilai mesin).

Tahapannya: filter awal di DexScreener (umur, likuiditas, volume) → cek keamanan
(RugCheck, LP lock, mint authority) → cek sosial → keputusan ukuran posisi.
Centang manual satu per satu. Cocok dibaca sekali untuk paham *kenapa* parameter
otomatis di-set seperti sekarang.

---

## 11. ⚙️ Settings

Pusat kendali. Tiga kelompok:

**1. API keys (rahasia, tersimpan server-side):**
- **Birdeye** — WAJIB untuk fitur smart money (siapa top trader).
- **Helius** — verifikasi wallet + webhook real-time Modul C.
- **Solscan Pro** (opsional) — enrich holder.
- **Anthropic** (opsional) — mode AI `api`; default mode `local` (CLI Claude, gratis).
- **Telegram** (opsional) — alert radar.
- Tombol **Test** untuk tiap kelompok memverifikasi key tanpa menampilkan isinya.

**2. Parameter Sniper (grup Deteksi / Skor / Gate / Posisi / Mesin / Discovery):**
semua ambang Modul B & C bisa diubah **live tanpa restart** — tersimpan di
`.sniper-params.json` yang **menang** atas `.env`. Daftar lengkap + penjelasan:
[REKAP-PARAMETER.md](REKAP-PARAMETER.md).

**3. Prioritas nilai (WAJIB paham):**
```
.sniper-params.json / .settings.json  (editan panel Settings — MENANG)
        > .env  (seed saat boot)
        > default di kode
```
Artinya: mengubah `.env` saja **tidak cukup** kalau nilai yang sama pernah
disimpan lewat panel Settings — ubah lewat panel (atau API + admin token).

**Admin token:** endpoint tulis (save settings, sync webhook, ubah params)
dilindungi `ADMIN_TOKEN` (di `.env`) — dikirim sebagai header
`Authorization: Bearer <token>`. Jangan bagikan token ini: aplikasi terekspos
publik via ngrok.

---

## 12. 💬 Chat AI

**Apa ini:** asisten AI yang punya akses langsung ke tool screener (function
calling) — bisa disuruh "screen token X", "bedah token Y", "kenapa sinyal Z
muncul", atau tanya-jawab bebas soal data di aplikasi.

**Mode:** `local` (default; pakai CLI `claude` di komputer ini, tanpa biaya API)
atau `api` (pakai ANTHROPIC_API_KEY). Ada rate-limit + kuota harian supaya chat
publik (via ngrok) tidak membakar token tanpa batas.

---

## 13. Chart: GMGN & Axiom

Sejak Juli 2026 semua chart Solana memakai kombinasi ini:

| Kebutuhan | Yang dipakai | Kenapa |
|---|---|---|
| Chart **inline** di panel | **GMGN** (`gmgn.cc/kline`) | Satu-satunya yang mengizinkan embed iframe; dibentuk dari mint jadi selalu tersedia. |
| Analisis penuh + **posisi wallet** | **Axiom** (`axiom.trade/t/<mint>`) — tombol/link keluar | Fitur posisi wallet paling lengkap; tapi Axiom memblokir embed (X-Frame-Options) dan butuh login wallet, jadi selalu dibuka di tab baru. |

Panel Robinhood/EVM tetap memakai GeckoTerminal (GMGN/Axiom tidak meng-cover
chain itu).

---

## 14. Infrastruktur

**Bagaimana semuanya tetap hidup:**
- Windows Task **`MemecoinScreener`** menjalankan supervisor
  `C:\Users\Daris Novita Sari\.screener-runtime\keep-alive.ps1` saat logon.
- Supervisor mengecek tiap 20 detik: kalau tidak ada yang listen di :8787 →
  start `node index.js`; kalau ngrok mati → start ngrok. Log di
  `.screener-runtime\logs\`.
- **ngrok** memberi URL publik tetap (`unsnap-rekindle-patriarch.ngrok-free.dev`)
  — dipakai webhook Helius. **Jangan restart ngrok sembarangan**; kalau URL
  berubah, webhook harus di-sync ulang (`POST /api/sniper/webhook/sync` + admin
  token, atau otomatis tiap 10 menit).

**Webhook Helius (mesin real-time Modul C):**
- Terdaftar di akun Helius, tipe *enhanced*, event SWAP, berisi semua alamat
  wallet aktif watchlist (di-sync otomatis).
- State lokal: `web/server/screener/.helius-webhook.json` (ID webhook + auth token).
- Kalau **ganti API key / akun Helius**: key baru harus masuk lewat panel
  Settings (ingat prioritas nilai!), lalu webhook akan dibuat ulang otomatis di
  akun baru pada sync berikutnya.

**File rahasia (semua gitignored, jangan pernah di-commit):**
`.env`, `.settings.json`, `.sniper-params.json`, `.helius-webhook.json`, dan
semua file state `.*.json` di `web/server/screener/`.

---

## 15. Troubleshooting

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| **Watchlist tampak kosong** padahal wallet ada | `minCatches` di Settings lebih tinggi dari catches maksimum wallet mana pun | Turunkan `minCatches` (0 = tampilkan semua). Pemantauan tidak pernah berhenti — ini cuma filter tampilan. |
| Sinyal sniper tidak muncul sama sekali | Webhook mati: ngrok URL berubah / kuota Helius habis / key salah | Cek panel 🧾 Log Transaksi (masih ada feed?) → Test Helius di Settings → sync webhook. |
| Helius error `429 max usage reached` | Kuota bulanan key habis | Ganti key di panel Settings (bukan cuma `.env`!) — webhook otomatis pindah ke akun baru saat sync. |
| Ganti nilai di `.env` tapi tidak ngefek | Nilai yang sama pernah disimpan via panel Settings → `.settings.json`/`.sniper-params.json` menang | Ubah lewat panel Settings atau API admin. |
| Server tidak merespons sebentar lalu pulih | Sweep/discovery berat sedang jalan | Tunggu; kalau sering, laporkan untuk diprofil. |
| Banyak proses `node` menumpuk | Supervisor spawn baru tiap 20 dtk selama boot belum selesai | Bunuh semua node, biarkan supervisor start satu; pertimbangkan perbaikan jeda di `keep-alive.ps1`. |
| Chart kartu Pro Radar masih DexScreener | Cache scan lama | Hilang sendiri setelah scan berikutnya (tiap 15 menit). |
| Panel Settings tidak bisa menyimpan | `ADMIN_TOKEN` di-set dan frontend tidak mengirimnya | Sertakan admin token, atau akses dari loopback. |

---

## 16. Glosarium

| Istilah | Arti |
|---|---|
| **Mint** | Alamat kontrak token di Solana. |
| **Mcap** | Market cap. Sinyal sniper fokus di token mcap kecil (floor $20 rb). |
| **Catch** | Kredit untuk wallet yang terbukti beli token winner (≥10x) lebih awal. `catches` = jumlah token *berbeda*. |
| **winnerScore** | Total kelipatan (X) semua winner sebuah wallet — kunci peringkat watchlist. |
| **Sighting** | Kemunculan berulang wallet di daftar top-trader (jalur discovery). |
| **Reputasi** | Skor gabungan kualitas wallet (catches, umur, pola). |
| **Sweep** | Satu putaran pemeriksaan transaksi wallet terpantau. |
| **Gate** | Saringan keamanan sebelum sinyal naik (anti rug/honeypot, LP lock, mcap/likuiditas). |
| **Webhook** | Push event dari Helius ke server saat wallet terpantau bertransaksi — dasar real-time Modul C. |
| **v2 / awal** | Dua varian sinyal sniper: lengkap-dengan-gate vs dini-lebih-longgar. |
| **DYOR** | Do Your Own Research — semua output aplikasi ini alat bantu, bukan perintah beli. |
