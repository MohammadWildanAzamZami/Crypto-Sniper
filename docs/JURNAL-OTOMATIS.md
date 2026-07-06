# Rekap Jurnal Otomatis — Cara Kerja

Sistem yang otomatis merekap **setiap perubahan / penambahan fitur** ke
`docs/JURNAL-AUTO.md`, tanpa perlu nulis manual.

## Komponen

| Berkas | Fungsi |
|---|---|
| `scripts/update-jurnal.js` | Generator: baca `git log`, kelompokkan per hari + kategori, tulis ulang `docs/JURNAL-AUTO.md`. Deterministik, tanpa dependency. |
| `.githooks/post-commit` | Git hook: tiap ada **commit**, regenerasi jurnal → commit → push otomatis. |
| `scripts/jurnal-daily.ps1` | Skrip harian (dipanggil Task Scheduler): regenerasi → commit → push. |
| Task `MemecoinScreener-JurnalHarian` | Windows Task Scheduler, jalan **tiap hari 20:00**. |

## Dua pemicu (keduanya aktif)

1. **Saat commit** — `.githooks/post-commit` jalan otomatis. Paling akurat
   karena commit = momen fitur/perubahan ditambah.
2. **Harian 20:00** — Task Scheduler jalankan `jurnal-daily.ps1` sebagai
   cadangan (mis. kalau push dari hook sempat gagal karena offline).

Keduanya **auto-commit + push** ke `origin/main`. Pesan commit diberi marker
`[jurnal-auto]` supaya hook tidak memicu dirinya sendiri (anti-rekursi).

## Dua jurnal, beda peran

- `docs/JURNAL-AUTO.md` — **otomatis**, selalu terkini, daftar semua commit
  per hari. Jangan diedit manual (akan tertimpa).
- `docs/JURNAL-HARIAN.md` — **naratif**, ditulis tangan, penjelasan lebih kaya.

## Setup ulang (kalau clone baru / pindah PC)

```bash
# 1) Aktifkan git hook
git config core.hooksPath .githooks

# 2) Daftarkan task harian (PowerShell)
#    lihat perintah Register-ScheduledTask di riwayat, atau jalankan manual:
node scripts/update-jurnal.js   # tes generator sekali
```

## Menonaktifkan sementara

```bash
git config --unset core.hooksPath                                  # matikan hook
schtasks /Change /TN "MemecoinScreener-JurnalHarian" /DISABLE      # matikan jadwal
```
