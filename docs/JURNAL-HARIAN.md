# Jurnal Harian Pengembangan — Memecoin Screener

Rekap harian pembuatan web **Screening Memecoin Solana** (tool pencari memecoin
dengan teknologi AI Agent + logic Smart Money Tracking), disusun dari riwayat
git repo. Setiap hari dikelompokkan jadi: **Ditambahkan**, **Diubah**, dan
**Dirapikan/Perbaikan**.

Periode: **28 Juni 2026 – 7 Juli 2026** · 77 commit (di luar auto-rekap harian).

---

## 📅 Hari 1 — Sabtu, 28 Juni 2026 (fondasi + fitur inti)

Hari terpadat: dari nol sampai fitur utama jalan (24 commit).

**Ditambahkan**
- Kerangka proyek: `solscan-mcp` (Rust, server MCP Solscan) + web app
  (Vite + Vue 3 frontend, Express proxy backend).
- **GEM Score Screener** — skor heuristik 0–100 dari data pasar DexScreener.
- **Chat AI** gaya WhatsApp (gelembung, header hijau, composer bulat) +
  perbaikan mode serverless (key dari env, anti-buffering SSE, maxDuration 60s).
- **Fitur 10x Radar** — auto-screening token potensi tinggi + alert Telegram +
  Vercel Cron + panel web.
- Konfigurasi deploy Vercel (backend serverless + build frontend).
- README lengkap untuk kolaborator.
- Tombol Hapus di panel screener.

**Diubah**
- Skema warna chat beberapa kali: hijau → hitam & biru → biru `#0057b7` +
  latar hitam corak doodle WhatsApp → corak diperkecil (105px).
- Ukuran kotak chat: eksperimen lebar penuh → kecil mengambang (400×560) →
  responsif multi-ukuran (HP/tablet/desktop) → default diperkecil.
- Subjudul halaman bolak-balik (TOKEN lookup ↔ GEM Score screening).
- Perilaku Radar: tidak menampilkan hasil sebelum tombol "Scan Sekarang" ditekan;
  tambah tombol Tutup untuk menyembunyikan hasil.
- Tombol "Buy via Trojan" jadi hijau; deep-link Trojan pakai payload alamat token
  (salin alamat ke clipboard + buka bot).

**Dirapikan / Dihapus**
- Sembunyikan panel Network status.
- Hapus panel Token lookup & kotak pencarian.
- Hapus tombol & kode Alert Telegram serta link DexScreener.

---

## 📅 Hari 2 — Minggu, 29 Juni 2026 (optimasi Radar)

**Diubah**
- Percepat scan 10x Radar **48 detik → 8 detik**: skip RugCheck saat bulk,
  limit 18 token, konkurensi 9 — sekaligus perbaiki error "Gangguan jaringan".
- Radar kini menampilkan alamat token di bawah nama.

**Perbaikan**
- Styling tombol Tutup (close) di RadarPanel — hover state dengan background subtle.

---

## 📅 Hari 3 — Senin, 30 Juni 2026 (persistensi, kalkulator manual, pindah hosting)

**Ditambahkan**
- Dokumentasi **LAPORAN.md** + pembaruan HANDOVER.
- **Kalkulator skor manual + checklist screening** digabung ke satu app.
- Shared store via **Upstash Redis** untuk dedupe alert lintas-instance.
- Proteksi backend untuk deploy publik: rate-limit, admin gate, budget chat.
- Field **Admin token** di UI untuk administer backend publik.
- **Dockerfile** portable untuk host tanpa kartu (Back4app/Koyeb/dll).

**Diubah**
- Persist Settings & state Radar ke disk agar tidak re-alert / reset saat restart.
- Layout: kalkulator manual jadi tampilan pembuka, lalu Radar & GEM Score di bawah;
  kemudian tema "8080" + Radar di atas + serve frontend langsung dari Express
  (mode single-port).
- Background chat jadi hitam polos.

**Dirapikan**
- **Lepas dari Vercel**: hapus konfigurasi deploy serverless + sisa sebutannya.
- Pindah strategi deploy: frontend ke **GitHub Pages** + backend ke **Render**.

---

## 📅 Hari 4 — Selasa, 1 Juli 2026 (widget embeddable)

**Ditambahkan**
- **solana-chat-widget** — bubble chat AI yang bisa ditanam (embeddable) di situs
  lain + backend proxy-nya.

---

## 📅 Hari 5 — Rabu, 2 Juli 2026 (Pro Radar lahir)

**Ditambahkan**
- **Pro Radar (Fable 5)** — radar bertenaga AI, dengan model default Fable 5.
- Logo coin + alamat token klik-untuk-salin di setiap hasil screening.
- Dokumentasi Pro Radar di LAPORAN: tabel sumber data, alur screening 6 langkah,
  flowchart (Mermaid + ASCII).

**Diubah**
- Kalkulator manual jadi **modal melayang** + ikon chat diperkecil.
- Deploy jadi **satu service Render** (frontend + backend dalam 1 URL).
- AI default ke **mode lokal** (tanpa API key / tanpa biaya).

---

## 📅 Hari 6 — Jumat, 4 Juli 2026 (Pro Radar makin pintar)

**Ditambahkan / Diubah**
- **Pro Radar v2**: gerbang kualitas, filter AVOID, self-tuning, chart inline.
- **Pro Radar v3**: controller target win-rate, sinyal Pump.fun, chart mobile.

---

## 📅 Hari 7 — Sabtu, 5 Juli 2026 (Smart Money + refactor besar)

**Ditambahkan**
- **Smart money tracking**: top traders dari Birdeye + verifikasi wallet via Helius.
- **Smart money meter** di kartu Pro Radar.
- Dokumentasi + flowchart Smart money tracking & breakdown scoring `smartScore`.

**Dirapikan (refactor)**
- Kelompokkan components ke folder `ui/`, `chat/`, `panels/`.
- Pusatkan semua dokumentasi ke folder `docs/`.
- Pecah `index.js` server jadi `routes/` per-domain.
- Hilangkan tombol "Buy via Trojan" dari semua kartu.

---

## 📅 Hari 8 — Minggu, 6 Juli 2026 (Sniper Engine)

**Ditambahkan**
- **Sniper Engine** — fitur **Bedah Coin** (bongkar siapa beli awal, hold vs jual,
  bundle/bot, kandidat smart wallet) + **Watchlist** + **Live Monitor**.

---

## 📅 Hari 9 — Senin, 7 Juli 2026 (Fable 5 di semua, Sniper v2, flowchart, perbaikan mode AI)

**Ditambahkan**
- **Sniper Live v2** — registry parameter yang bisa diubah **live dari Settings**
  (berlaku di sweep berikutnya, tanpa restart), mesin **net-buy** (wallet yang
  beli lalu jual di window tidak dihitung sebagai akumulasi), dan **dua aliran**
  sinyal berjalan paralel (**Awal/v1** & **v2**).
- **Flowchart alur** (Mermaid + ASCII) untuk **Bedah Coin (Modul A)** dan
  **Sniper Live (Modul C)** — ditambahkan di LAPORAN.md (§7 & §8) dan
  SNIPER-ENGINE.md.
- **REKAP-PARAMETER.md** — rekap semua parameter (Awal v1 vs v2) + peta/flowchart
  semua tool.
- **SNIPER-LIVE-DISKUSI.md** — dokumen bahan bedah Modul C (celah & parameter baru).

**Diubah**
- **Semua model AI dikunci ke Fable 5** (`claude-fable-5`): dropdown model di
  Settings jadi satu pilihan; default widget chat + `.env.example` → Fable 5;
  chat lokal, Pro Radar, dan "Jelaskan sinyal" kini meneruskan
  `--model claude-fable-5`. *(Pengurangan: opsi Opus/Sonnet/Haiku dihapus dari UI.)*
- Subjudul halaman utama → *"Tool Pencari Memecoin dengan teknologi AI Agent
  menggunakan logic Smart Money Tracking."*
- Verifikasi tampilan: app dijalankan (Vite + Express) dan dicek render-nya
  di browser — semua panel tampil normal.

**Perbaikan**
- **Mode AI lokal jadi independen dari API key.** CLI `claude` yang di-spawn tidak
  lagi mewarisi `ANTHROPIC_API_KEY` dari `.env` (diperbaiki di `local.js`,
  `explainSignal.js`, `analyze.js`) — sebelumnya gagal *"Invalid API key"* saat
  key .env kosong / saldo rendah.
- **"Jelaskan sinyal ini"** tak lagi memaksa jalur API saat mode Local. Sebelumnya
  selalu pakai API key (walau saldo habis) → error 400 *"credit balance too low"*.
  Kini pilihan mode Local menang → jalan lewat CLI langganan tanpa biaya.
- Flowchart Mermaid: node keputusan gate dikutip agar aman di-parse GitHub.
- Jurnal harian: push post-commit dibuat foreground agar andal di Windows.

---

## 🧾 Ringkasan fitur akhir web

| Fitur | Fungsi |
|---|---|
| **GEM Score Screener** | Skor heuristik 0–100 per token dari data DexScreener |
| **10x Radar** | Auto-screening token Solana potensi tinggi (funnel cepat ~8 dtk) |
| **Pro Radar (Fable 5)** | 10x Radar + AI: gerbang kualitas, self-tuning, target win-rate |
| **Smart Money Tracking** | Top traders (Birdeye) + verifikasi wallet (Helius) + meter |
| **Sniper / Bedah Coin** | Bongkar early buyers, hold/jual, bundle/bot, Watchlist, Live Monitor (v2: net-buy, dua aliran Awal/v2, parameter live dari Settings) |
| **Kalkulator manual** | Modal skoring manual (input DexScreener/RugCheck) |
| **Chat AI** | Asisten gaya WhatsApp, default mode lokal (tanpa biaya) |
| **Chat widget** | Bubble chat AI embeddable untuk situs lain |

**Stack:** Vite + Vue 3 (frontend) · Express (backend proxy) · Rust `solscan-mcp`
(server MCP) · Deploy: satu service Render (single-port).
