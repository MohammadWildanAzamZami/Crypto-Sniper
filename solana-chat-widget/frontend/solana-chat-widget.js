/*
 * Solana Chat Widget — bubble chat yang bisa di-embed ke web mana pun.
 *
 * Pemakaian:
 *   <script src="solana-chat-widget.js" data-backend="https://backend-kamu.com"></script>
 * atau set sebelum script:
 *   <script>window.SOLANA_CHAT_WIDGET = { backend: "https://backend-kamu.com", title: "Tanya AI" }</script>
 *
 * Backend harus mengekspos POST /api/chat (SSE) — lihat folder backend/.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var cfg = window.SOLANA_CHAT_WIDGET || {};
  var BACKEND = (cfg.backend || (script && script.getAttribute("data-backend")) || "http://localhost:8788").replace(/\/+$/, "");
  var TITLE = cfg.title || "Asisten Memecoin";
  var GREETING = cfg.greeting || "Halo! Tanya apa saja soal screening memecoin Solana. (Bukan saran finansial.)";

  // ---- styles (scoped via prefix scw-) ----
  var css = [
    ".scw-fab{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;background:#7cf2b0;color:#07140d;font-size:24px;box-shadow:0 6px 20px rgba(0,0,0,.35);z-index:2147483000;display:flex;align-items:center;justify-content:center;transition:transform .15s ease}",
    ".scw-fab:hover{transform:scale(1.06)}",
    ".scw-panel{position:fixed;right:20px;bottom:88px;width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 120px);background:#13161b;border:1px solid #262b33;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.5);z-index:2147483000;display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}",
    ".scw-panel.scw-open{display:flex}",
    ".scw-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#0f1217;border-bottom:1px solid #262b33}",
    ".scw-head b{color:#e7e9ec;font-size:14px}",
    ".scw-head small{color:#7cf2b0;font-size:11px;font-family:ui-monospace,Consolas,monospace;display:block;margin-top:2px}",
    ".scw-x{background:none;border:none;color:#8b93a1;cursor:pointer;font-size:18px;line-height:1}",
    ".scw-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#0b0d10}",
    ".scw-msg{max-width:85%;padding:9px 12px;border-radius:12px;font-size:13.5px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}",
    ".scw-user{align-self:flex-end;background:#2c4a3a;color:#e7e9ec;border-bottom-right-radius:4px}",
    ".scw-bot{align-self:flex-start;background:#191d24;color:#e7e9ec;border:1px solid #262b33;border-bottom-left-radius:4px}",
    ".scw-err{align-self:flex-start;background:#3a2424;color:#f27c7c;border:1px solid #5a2c2c;font-size:12.5px}",
    ".scw-foot{display:flex;gap:8px;padding:12px;border-top:1px solid #262b33;background:#13161b}",
    ".scw-inp{flex:1;background:#191d24;border:1px solid #262b33;border-radius:10px;padding:9px 12px;color:#e7e9ec;font-size:13.5px;outline:none;resize:none;font-family:inherit;max-height:96px}",
    ".scw-inp:focus{border-color:#7cf2b0}",
    ".scw-send{background:#7cf2b0;color:#07140d;border:none;border-radius:10px;padding:0 14px;cursor:pointer;font-weight:600;font-size:13.5px}",
    ".scw-send:disabled{opacity:.5;cursor:not-allowed}",
    ".scw-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#8b93a1;margin-right:3px;animation:scwb 1s infinite}",
    "@keyframes scwb{0%,60%,100%{opacity:.3}30%{opacity:1}}",
  ].join("");
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // ---- elements ----
  var fab = el("button", "scw-fab", { "aria-label": "Buka chat" });
  fab.textContent = "💬";
  var panel = el("div", "scw-panel", { role: "dialog", "aria-label": TITLE });
  panel.innerHTML =
    '<div class="scw-head"><div><b>' + esc(TITLE) + "</b><small>Solana · bukan saran finansial</small></div>" +
    '<button class="scw-x" aria-label="Tutup">✕</button></div>' +
    '<div class="scw-body"></div>' +
    '<div class="scw-foot"><textarea class="scw-inp" rows="1" placeholder="Ketik pertanyaan…"></textarea>' +
    '<button class="scw-send">Kirim</button></div>';
  document.body.appendChild(fab);
  document.body.appendChild(panel);

  var body = panel.querySelector(".scw-body");
  var inp = panel.querySelector(".scw-inp");
  var sendBtn = panel.querySelector(".scw-send");
  var history = [];
  var busy = false;

  bot(GREETING);

  fab.addEventListener("click", function () {
    panel.classList.toggle("scw-open");
    if (panel.classList.contains("scw-open")) inp.focus();
  });
  panel.querySelector(".scw-x").addEventListener("click", function () { panel.classList.remove("scw-open"); });
  sendBtn.addEventListener("click", send);
  inp.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  inp.addEventListener("input", function () {
    inp.style.height = "auto"; inp.style.height = Math.min(inp.scrollHeight, 96) + "px";
  });

  function send() {
    var text = inp.value.trim();
    if (!text || busy) return;
    inp.value = ""; inp.style.height = "auto";
    user(text);
    history.push({ role: "user", content: text });
    stream();
  }

  function stream() {
    busy = true; sendBtn.disabled = true;
    var bubble = bot("");
    bubble.innerHTML = '<span class="scw-dot"></span><span class="scw-dot"></span><span class="scw-dot"></span>';
    var acc = "";

    fetch(BACKEND + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    })
      .then(function (res) {
        if (!res.ok || !res.body) {
          return res.json().catch(function () { return {}; }).then(function (j) {
            throw new Error(j.error || "Gagal terhubung (" + res.status + ")");
          });
        }
        var reader = res.body.getReader();
        var dec = new TextDecoder();
        var buf = "";
        return (function pump() {
          return reader.read().then(function (r) {
            if (r.done) return;
            buf += dec.decode(r.value, { stream: true });
            var parts = buf.split("\n\n"); buf = parts.pop();
            parts.forEach(function (p) {
              var line = p.replace(/^data: ?/, "");
              if (!line) return;
              var ev; try { ev = JSON.parse(line); } catch (e) { return; }
              if (ev.type === "delta") { acc += ev.text; bubble.textContent = acc; scroll(); }
              else if (ev.type === "error") { bubble.remove(); errMsg(ev.error); }
            });
            return pump();
          });
        })();
      })
      .then(function () {
        if (acc) history.push({ role: "assistant", content: acc });
        else if (bubble.parentNode) bubble.remove();
      })
      .catch(function (e) {
        if (bubble.parentNode) bubble.remove();
        errMsg(String(e.message || e));
      })
      .then(function () { busy = false; sendBtn.disabled = false; scroll(); });
  }

  function user(t) { return add("scw-user", t); }
  function bot(t) { return add("scw-bot", t); }
  function errMsg(t) { return add("scw-err", "⚠ " + t); }
  function add(cls, t) {
    var m = el("div", "scw-msg " + cls); m.textContent = t;
    body.appendChild(m); scroll(); return m;
  }
  function scroll() { body.scrollTop = body.scrollHeight; }
  function el(tag, cls, attrs) {
    var n = document.createElement(tag); if (cls) n.className = cls;
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]); return n;
  }
  function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
})();
