#!/usr/bin/env node
/*
 * update-jurnal.js — Regenerasi docs/JURNAL-AUTO.md dari riwayat git.
 *
 * Deterministik, tanpa dependency. Membaca `git log`, mengelompokkan commit
 * per hari, mengategorikan (fitur/perbaikan/docs/refactor/lainnya), lalu
 * menulis ulang docs/JURNAL-AUTO.md. TIDAK menyentuh JURNAL-HARIAN.md (naratif).
 *
 * Dipanggil oleh: .githooks/post-commit (tiap commit) & scripts/jurnal-daily.ps1
 * (terjadwal harian via Windows Task Scheduler).
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function git(args) {
  return execFileSync("git", args, { maxBuffer: 32 * 1024 * 1024 })
    .toString()
    .replace(/\r/g, "");
}

const repoRoot = git(["rev-parse", "--show-toplevel"]).trim();
const outFile = path.join(repoRoot, "docs", "JURNAL-AUTO.md");

// Tab (%x09) sebagai pemisah field; newline (%n bawaan) pemisah baris.
const raw = git([
  "log",
  "--reverse",
  "--date=format:%Y-%m-%d",
  "--pretty=format:%ad%x09%h%x09%an%x09%s",
]).trim();

const commits = raw
  ? raw.split("\n").map((line) => {
      const [date, hash, author, ...rest] = line.split("\t");
      return { date, hash, author, subject: rest.join("\t") };
    })
  : [];

function categorize(subject) {
  const m = subject.match(/^(\w+)(\([^)]*\))?!?:/);
  const type = m ? m[1].toLowerCase() : "";
  if (type === "feat") return "feat";
  if (type === "fix") return "fix";
  if (type === "docs") return "docs";
  if (type === "refactor") return "refactor";
  if (["chore", "style", "perf", "test", "build", "ci", "revert"].includes(type))
    return "other";
  // Heuristik kata (commit lama pakai bahasa Indonesia tanpa prefix konvensional).
  const s = subject.toLowerCase();
  if (/(fitur|tambah|add|feat|buat)/.test(s)) return "feat";
  if (/(perbaik|fix|bug|error|percepat)/.test(s)) return "fix";
  if (/(dokumentasi|docs|laporan|readme|jurnal)/.test(s)) return "docs";
  if (/(refactor|rapik|pecah|kelompokkan|bersih|hapus|hilangkan)/.test(s))
    return "refactor";
  return "other";
}

const catMeta = {
  feat: "✨ Fitur baru / penambahan",
  fix: "🐛 Perbaikan",
  docs: "📝 Dokumentasi",
  refactor: "♻️ Refactor / rapikan",
  other: "🔧 Lainnya",
};
const catOrder = ["feat", "fix", "docs", "refactor", "other"];
const hariID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

const byDate = new Map();
for (const c of commits) {
  if (!byDate.has(c.date)) byDate.set(c.date, []);
  byDate.get(c.date).push(c);
}

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp =
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
  `${pad(now.getHours())}:${pad(now.getMinutes())}`;

let out = "";
out += "# Jurnal Otomatis — Rekap Perubahan Harian\n\n";
out += "> ⚙️ File ini **dibuat otomatis** oleh `scripts/update-jurnal.js` dari riwayat git.\n";
out += "> Jangan diedit manual — perubahan akan tertimpa. Untuk jurnal naratif, lihat `JURNAL-HARIAN.md`.\n";
out += ">\n";
out += `> Terakhir diperbarui: **${stamp}** · Total **${commits.length}** commit dalam **${byDate.size}** hari.\n\n`;
out += "---\n\n";

const dates = [...byDate.keys()].sort().reverse(); // terbaru di atas
for (const date of dates) {
  const list = byDate.get(date);
  const d = new Date(date + "T00:00:00");
  out += `## ${date} (${hariID[d.getDay()]}) — ${list.length} commit\n\n`;

  const grouped = {};
  for (const c of list) (grouped[categorize(c.subject)] ||= []).push(c);

  for (const cat of catOrder) {
    if (!grouped[cat]) continue;
    out += `**${catMeta[cat]}**\n`;
    for (const c of grouped[cat]) out += `- ${c.subject}  \`${c.hash}\`\n`;
    out += "\n";
  }
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, out, "utf8");
console.log(
  `[jurnal] docs/JURNAL-AUTO.md diperbarui — ${commits.length} commit, ${byDate.size} hari.`
);
