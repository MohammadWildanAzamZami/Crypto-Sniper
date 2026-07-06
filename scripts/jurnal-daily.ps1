# jurnal-daily.ps1 — Rekap jurnal harian terjadwal (Windows Task Scheduler).
# Regenerasi docs/JURNAL-AUTO.md dari git, lalu commit + push kalau ada perubahan.
# Backup dari git hook: memastikan rekap tetap terpush walau tidak ada commit baru
# hari itu, atau kalau push dari hook sempat gagal.

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

node "$repo\scripts\update-jurnal.js"
if ($LASTEXITCODE -ne 0) { exit 0 }

$changed = git status --porcelain -- docs/JURNAL-AUTO.md
if ($changed) {
  git add docs/JURNAL-AUTO.md
  git commit -m "docs(jurnal): auto-update rekap harian terjadwal [jurnal-auto]" -- docs/JURNAL-AUTO.md
  $branch = (git rev-parse --abbrev-ref HEAD).Trim()
  if ($branch -eq "main") { git push origin main }
  Write-Output "[jurnal] rekap harian diperbarui & dipush."
} else {
  Write-Output "[jurnal] tidak ada perubahan, lewati."
}
