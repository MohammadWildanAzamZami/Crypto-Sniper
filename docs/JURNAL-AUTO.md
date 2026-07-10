# Jurnal Otomatis — Rekap Perubahan Harian

> ⚙️ File ini **dibuat otomatis** oleh `scripts/update-jurnal.js` dari riwayat git.
> Jangan diedit manual — perubahan akan tertimpa. Untuk jurnal naratif, lihat `JURNAL-HARIAN.md`.
>
> Terakhir diperbarui: **2026-07-11 00:40** · Total **150** commit dalam **13** hari.

---

## 2026-07-11 (Sabtu) — 1 commit

**✨ Fitur baru / penambahan**
- feat(sniper): grup Discovery editable di Settings + rapikan teks watchlist  `6a9a5a4`

## 2026-07-10 (Jumat) — 31 commit

**✨ Fitur baru / penambahan**
- feat(robinhood): Watchlist EVM (langkah #4) — rekam kandidat Bedah → reputasi → ranking  `cc17367`
- feat(robinhood): Sniper Live EVM (langkah #5) — pipeline EVM lengkap  `009e206`
- feat(robinhood): POWER — auto-seed watchlist + hold-tracking EVM + background auto-loop  `c18be30`
- feat(robinhood): UI auto-pilot — strip status background loop + indikator holder sinyal  `f0e2e8f`
- feat(ui): toggle tampilan Solana ⇄ Robinhood Chain (tombol melayang)  `0ac76e1`
- feat(ui): tema Robinhood untuk zona Solana + sembunyikan GEM Score & 10x Radar  `65ecbd9`
- feat(sniper): real-time via Helius webhook (ganti polling 5-menit → push)  `4198970`
- feat(sniper): grading PnL persisten sinyal live + panel UI + backtest doc  `0c8591e`

**🐛 Perbaikan**
- fix(robinhood): retry Blockscout 429/5xx/timeout — hentikan error "tak ada histori" palsu  `ec33f0c`
- fix(autopsy,screener): fallback DexScreener + harga quote-kanonik saat Birdeye CU habis  `2d907cd`

**📝 Dokumentasi**
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `5ce3f87`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `428e648`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `3aefda5`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `15dc9e5`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `8234d25`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `c85ba27`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `2420618`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `b37919d`
- docs: dokumentasikan ekosistem Robinhood Chain (EVM) — tata sesuai topik file  `320afd8`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `22bf7ab`
- docs(sniper): auto-discovery watchlist (A+B) + parameter  `040b747`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `dd8360b`
- docs: rekam perubahan sniper (rug-check diperkuat) + UI (view toggle, tema hitam)  `5a56a95`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `d638d34`
- docs(laporan): pembaruan 8–10 Juli (hold/exit, floor mcap, real-time webhook, Robinhood Chain, tema)  `b2a53aa`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `c0de00d`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `210eef4`
- docs(jurnal): auto-update rekap harian terjadwal [jurnal-auto]  `2203096`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `ed6ac82`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `f15e0d2`

**♻️ Refactor / rapikan**
- refactor(robinhood): hapus daftar roadmap "rencana" — semua tool sudah live  `4d31345`

## 2026-07-09 (Kamis) — 9 commit

**✨ Fitur baru / penambahan**
- feat(watchlist): sembunyikan tab/tombol Influencer dari UI  `2a53f23`
- feat(robinhood): ekosistem Robinhood Chain (EVM) — discover + screen + bedah coin  `f89593c`

**🐛 Perbaikan**
- fix(sniper): sinyal v2 hilang otomatis saat smart money tak lagi hold/akumulasi  `774c3b4`
- fix(sniper): hold-check pakai filter {mint} + fallback RPC publik  `e7d4cb0`

**📝 Dokumentasi**
- docs(jurnal): auto-update rekap harian terjadwal [jurnal-auto]  `5953dbb`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `24c4325`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `1313bfd`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `33fd185`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `c48e8c3`

## 2026-07-08 (Rabu) — 5 commit

**✨ Fitur baru / penambahan**
- feat(sniper): lacak hold/exit smart money — buang sinyal saat holders < signalMin & sudah jual  `f44f933`
- feat(sniper): sinyal bertahan selama smart money pegang (hapus TTL) + urut by jumlah smart wallet  `7800cfe`

**📝 Dokumentasi**
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `bcef67c`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `595d6bb`
- docs(jurnal): auto-update rekap harian terjadwal [jurnal-auto]  `1dc7a5c`

## 2026-07-07 (Selasa) — 40 commit

**✨ Fitur baru / penambahan**
- feat(jurnal): rekap harian otomatis (git hook + Task Scheduler + auto-push)  `ef8284e`
- feat(ai): kunci semua model ke Fable 5 + perbaiki mode AI lokal  `0ac485d`
- feat(sniper): Sniper Live v2 — registry parameter + mesin net-buy + dua aliran (awal/v2)  `097396f`
- feat(sniper-ui): kotak sinyal melebar otomatis saat penjelasan AI dibuka  `3e41162`
- feat(sniper-ui): sembunyikan sinyal unverified dari tampilan  `960e68b`
- feat(sniper): batas minimal mcap default jadi $20.000  `53e559f`

**🐛 Perbaikan**
- fix(jurnal): push foreground di post-commit agar andal di Windows  `f8dd08c`
- fix(ai): mode lokal "Jelaskan sinyal" independen dari API key  `e9cc831`
- fix(ai): Pro Radar mode lokal independen dari API key  `babd0a5`
- fix(sniper): tegakkan batas minimal mcap $20rb di sinyal live (kedua aliran)  `8da0df3`

**📝 Dokumentasi**
- docs: jurnal harian pengembangan + subjudul halaman jadi 'AI Agent'  `6dd606e`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `6679ced`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `f0b8689`
- docs: tambah SNIPER-LIVE-DISKUSI.md (bahan diskusi Modul C)  `5f0df49`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `0628f19`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `6a71758`
- docs(sniper): tambah flowchart alur Bedah Coin (Modul A)  `5835fff`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `9457cf5`
- docs(sniper): tambah flowchart alur Sniper Live (Modul C)  `a30f01b`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `6210985`
- docs(sniper): quote node keputusan gate agar Mermaid parse aman  `7ac1dc8`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `7642cb0`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `b2d5363`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `4a513e5`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `b548175`
- docs(sniper): rekap parameter Awal (v1) vs v2 + entri log v2/dua-aliran  `544c8eb`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `d7c8df7`
- docs: rekap parameter + peta/flowchart semua tool (Mermaid)  `31a4f33`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `0215ca2`
- docs: rekap perubahan 7 Juli (Fable 5, Sniper v2, flowchart, fix mode AI lokal)  `3746589`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `cc501e7`
- docs(jurnal): auto-update rekap harian terjadwal [jurnal-auto]  `bb0e737`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `02b291d`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `629f338`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `7358a0c`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `e253b99`
- docs: tambah seksi + flowchart kategori Smart Money (REKAP-PARAMETER & SNIPER-ENGINE)  `1594167`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `39ac22c`
- docs: tambah seksi + flowchart reputasi Watchlist (REKAP-PARAMETER & SNIPER-ENGINE)  `8b1d5ea`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `cd72962`

## 2026-07-06 (Senin) — 1 commit

**✨ Fitur baru / penambahan**
- feat(sniper): Sniper Engine — Bedah Coin + Watchlist + Live Monitor  `57a3962`

## 2026-07-05 (Minggu) — 9 commit

**✨ Fitur baru / penambahan**
- feat(ui): Smart money meter di kartu Pro Radar  `63051df`
- feat(ui): hilangkan tombol Buy via Trojan dari semua kartu  `745eb7a`

**📝 Dokumentasi**
- docs: bagian "Pembaruan terbaru" yang mudah dibaca di LAPORAN.md + TL;DR HANDOVER  `3d12680`
- docs: tambah flowchart Smart money tracking di LAPORAN.md  `1327b29`
- docs: tambah flowchart breakdown scoring smartScore  `fabadda`
- docs: pusatkan semua dokumentasi ke folder docs/  `b536119`

**♻️ Refactor / rapikan**
- refactor(ui): kelompokkan components ke ui/ chat/ panels/  `d553bea`
- refactor(server): pecah index.js jadi routes/ per-domain  `1b33163`

**🔧 Lainnya**
- Smart money tracking: Birdeye top traders + Helius wallet verification  `574fbc8`

## 2026-07-04 (Sabtu) — 2 commit

**🔧 Lainnya**
- Pro Radar v2: gerbang kualitas, filter AVOID, self-tuning, chart inline  `0ddc95f`
- Pro Radar v3: win-rate-target controller + Pump.fun signals + mobile chart  `21af105`

## 2026-07-02 (Kamis) — 7 commit

**✨ Fitur baru / penambahan**
- LAPORAN: tambah flowchart alur Pro Radar (Mermaid + ASCII)  `fef1ac1`

**📝 Dokumentasi**
- LAPORAN: perjelas Pro Radar — tabel sumber data + alur screening 6 langkah  `a60972a`

**🔧 Lainnya**
- UI: kalkulator manual jadi modal melayang + kecilkan ikon chat  `b6810a1`
- Deploy: satu service Render (frontend + backend dalam 1 URL)  `ced6a20`
- AI: default ke mode lokal (tanpa API key / tanpa biaya)  `89d35c1`
- UI: logo coin + alamat token klik-untuk-salin di setiap screening  `7b5222a`
- Pro Radar (Fable 5): radar bertenaga AI + default model Fable 5  `0e332af`

## 2026-07-01 (Rabu) — 1 commit

**✨ Fitur baru / penambahan**
- Tambah solana-chat-widget: bubble chat AI embeddable + backend proxy  `f684bfb`

## 2026-06-30 (Selasa) — 14 commit

**✨ Fitur baru / penambahan**
- Dokumentasi: tambah LAPORAN.md + perbarui HANDOVER; persist Settings ke disk  `e51d367`
- Laporan: tambah kalkulator manual + checklist, mode single-port, tema 8080  `791cc8a`

**♻️ Refactor / rapikan**
- Lepas dari Vercel: hapus konfigurasi deploy serverless  `d64215a`
- Bersihkan sisa sebutan Vercel di komentar & .env.example  `051e025`

**🔧 Lainnya**
- Radar: persist state ke disk agar tidak re-alert / reset saat restart  `2925f9a`
- Radar: shared store via Upstash Redis untuk dedupe lintas-instance (Vercel)  `272af4f`
- Web: gabungkan kalkulator skor manual + checklist screening ke satu app  `56bc9ab`
- ChatPanel: ganti background chat jadi hitam polos  `89119a4`
- Web: jadikan kalkulator manual sebagai tampilan pembuka, Radar & GEM Score di bawah  `841be7e`
- Web: tema 8080 + Radar di atas + serve frontend dari Express  `8765861`
- Deploy: frontend ke GitHub Pages + backend ke Render  `02763d1`
- Backend: proteksi untuk deploy publik (rate-limit, admin gate, budget chat)  `2d03d70`
- Settings: field Admin token untuk administer backend publik dari UI  `3129870`
- Backend: Dockerfile portable untuk host tanpa kartu (Back4app/Koyeb/dll)  `39af194`

## 2026-06-29 (Senin) — 3 commit

**🐛 Perbaikan**
- Percepat scan 10x Radar (48s->8s): skip RugCheck saat bulk, limit 18, konkurensi 9 — perbaiki error Gangguan jaringan  `e4877eb`
- RadarPanel: perbaiki styling closebtn hover state dengan background subtle  `a7c49eb`

**🔧 Lainnya**
- Radar: tampilkan alamat token di bawah nama  `799c6ea`

## 2026-06-28 (Minggu) — 27 commit

**✨ Fitur baru / penambahan**
- Add full SolScanMcp + GEM Score screener project  `fbdac28`
- Tambah konfigurasi deploy Vercel (serverless backend + build frontend)  `b3190f7`
- Tambah tombol Hapus (merah) di panel screener  `8504de2`
- Fitur 10x Radar: auto-screening token potensi tinggi + alert Telegram + Vercel Cron + panel web  `234902f`
- Radar: tambah tombol Tutup untuk menyembunyikan hasil scan  `d129d1f`

**🐛 Perbaikan**
- Perbaiki chat AI untuk serverless: key dari env, anti-buffering SSE, maxDuration 60s  `8738d5a`

**📝 Dokumentasi**
- Tulis README lengkap untuk kolaborator  `3fc5389`

**♻️ Refactor / rapikan**
- Hapus panel Token lookup & kotak pencarian token  `c6b624a`
- Hapus tombol Alert Telegram & kode terkait  `b133336`
- Hapus link DexScreener; tombol Buy via Trojan jadi hijau  `c2a89ef`
- Pindahkan tombol Hapus ke samping tombol Buy via Trojan  `1ae45b7`
- Tombol Hapus di kiri tombol Buy via Trojan  `f052c85`

**🔧 Lainnya**
- first commit  `ca6833a`
- Redesain tampilan chat jadi gaya WhatsApp (gelembung, header hijau, composer bulat)  `f103c27`
- Ubah skema warna chat jadi hitam & biru  `5bba5ef`
- Biru #0057b7 + latar hitam corak doodle WhatsApp  `9600518`
- Perkecil corak background chat (105px)  `3edf143`
- Lebar kotak chat mengikuti lebar web (default fill, maks 1400px)  `c1ecb82`
- Kembalikan ukuran kotak chat ke kecil mengambang (400x560)  `9f9910f`
- Kotak chat responsif multi-ukuran (HP/tablet/desktop)  `3bb55d7`
- Perkecil ukuran default kotak chat  `3085b78`
- Sembunyikan sementara panel Network status  `33d0c59`
- Ganti subjudul jadi 'TOKEN lookup'  `7bdf8f5`
- Kembalikan subjudul ke GEM Score screening  `00809ab`
- Trojan deep-link: start payload = alamat token (auto-load saat Start)  `5ad6de3`
- Buy via Trojan: salin alamat token ke clipboard + buka bot (auto-load via link tak didukung Trojan)  `6f0696f`
- Radar: jangan tampilkan hasil sebelum tombol Scan Sekarang ditekan  `610f02a`

