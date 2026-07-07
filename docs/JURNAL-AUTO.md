# Jurnal Otomatis — Rekap Perubahan Harian

> ⚙️ File ini **dibuat otomatis** oleh `scripts/update-jurnal.js` dari riwayat git.
> Jangan diedit manual — perubahan akan tertimpa. Untuk jurnal naratif, lihat `JURNAL-HARIAN.md`.
>
> Terakhir diperbarui: **2026-07-07 12:51** · Total **74** commit dalam **9** hari.

---

## 2026-07-07 (Selasa) — 10 commit

**✨ Fitur baru / penambahan**
- feat(jurnal): rekap harian otomatis (git hook + Task Scheduler + auto-push)  `ef8284e`
- feat(ai): kunci semua model ke Fable 5 + perbaiki mode AI lokal  `0ac485d`

**🐛 Perbaikan**
- fix(jurnal): push foreground di post-commit agar andal di Windows  `f8dd08c`

**📝 Dokumentasi**
- docs: jurnal harian pengembangan + subjudul halaman jadi 'AI Agent'  `6dd606e`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `6679ced`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `f0b8689`
- docs: tambah SNIPER-LIVE-DISKUSI.md (bahan diskusi Modul C)  `5f0df49`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `0628f19`
- docs(jurnal): auto-update rekap harian [jurnal-auto]  `6a71758`
- docs(sniper): tambah flowchart alur Bedah Coin (Modul A)  `5835fff`

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

