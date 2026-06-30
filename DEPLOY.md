# Deploy: GitHub Pages (frontend) + Render (backend)

Tujuan: publik bisa buka **`https://mohammadwildanazamzami.github.io/Memecoin-Screener/`**
dengan semua fitur live (🚀 10x Radar, Screener, Chat) jalan lewat backend hosted.

Arsitektur:

```
GitHub Pages (frontend statis)  --->  Render (backend Express /api/*)  --->  DexScreener/RugCheck
```

Repo sudah berisi semua yang otomatis:
- `.github/workflows/deploy-pages.yml` — build & publish frontend ke Pages.
- `render.yaml` — blueprint backend.
- Frontend memanggil API lewat `VITE_API_BASE` (lihat `web/frontend/src/lib/api.js`).

Yang di bawah ini perlu **kamu klik sekali** di dashboard.

---

## 1. Backend di Render (dulu — karena URL-nya dibutuhkan frontend)

1. Buka <https://dashboard.render.com> → **New** → **Blueprint**.
2. Pilih repo `Memecoin-Screener`. Render membaca `render.yaml` → service
   `memecoin-screener-api` (plan **Free**, root `web/server`).
3. Klik **Apply**. Tunggu deploy selesai.
4. Catat URL-nya, mis. `https://memecoin-screener-api.onrender.com`.
5. Tes: buka `…onrender.com/api/health` → harus `{"ok":true,...}`.

> **Keamanan:** biarkan SOLSCAN/ANTHROPIC/TELEGRAM **kosong**. Radar & Screener
> tetap jalan via DexScreener (gratis). Endpoint `/api/settings` & `/api/chat`
> belum ada autentikasi, jadi jangan taruh API key berbayar di backend publik
> sampai ditambah proteksi. (Catatan Render Free: service "tidur" setelah idle,
> request pertama bisa lambat ~30 dtk.)

---

## 2. Arahkan frontend ke backend itu

1. GitHub → repo → **Settings → Secrets and variables → Actions → Variables**.
2. **New repository variable**:
   - Name: `VITE_API_BASE`
   - Value: URL Render dari langkah 1 (tanpa slash akhir),
     mis. `https://memecoin-screener-api.onrender.com`

---

## 3. Nyalakan GitHub Pages

1. GitHub → repo → **Settings → Pages**.
2. **Build and deployment → Source → GitHub Actions**.
3. Jalankan workflow: **Actions → "Deploy frontend to GitHub Pages" → Run workflow**
   (atau cukup push apa pun ke `main` yang menyentuh `web/frontend/**`).
4. Setelah hijau, situs live di:
   **`https://mohammadwildanazamzami.github.io/Memecoin-Screener/`**

---

## Update berikutnya

- **Frontend**: push ke `main` → workflow rebuild & redeploy Pages otomatis.
- **Backend**: push ke `main` → Render auto-deploy (default ON).
- Ganti backend? cukup update variable `VITE_API_BASE` lalu re-run workflow Pages.

## Catatan
- Repo name = subpath Pages. Kalau repo di-rename, ubah `VITE_BASE` di
  `deploy-pages.yml` agar cocok (`/<nama-repo>/`).
- Lokal tetap seperti biasa: `web/server` + `web/frontend` (atau single-port
  `npm run build` lalu `npm start` di `web/server`). `VITE_API_BASE` kosong =
  same-origin, jadi tidak menyentuh Render saat dev.
