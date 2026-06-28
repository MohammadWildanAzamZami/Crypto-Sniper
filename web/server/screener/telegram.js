// Telegram alerting. This module only SENDS messages and builds a Trojan
// *deep-link*. It never touches a wallet, seed phrase, or private key — buying
// stays a manual, user-initiated tap inside the Trojan bot. That boundary is
// deliberate: the screener informs, the human decides and executes.

const TG_API = "https://api.telegram.org";

/** Build a one-click Trojan buy deep-link for a token mint. */
export function trojanBuyLink(tokenAddress) {
  return `https://t.me/solana_trojanbot?start=buy_${tokenAddress}`;
}

/** Render a GEM Score report as a Telegram HTML message. */
export function formatAlert(report) {
  const { token, gemScore, verdict, pillars } = report;
  const pillarLines = pillars
    .map((p) => `• <b>${p.name}</b> (${p.weight}%): ${p.score}/${p.weight}`)
    .join("\n");
  const price = token.priceUsd ? `$${token.priceUsd}` : "n/a";

  return [
    `${verdict.emoji} <b>GEM Score ${gemScore}/100 — ${verdict.label}</b>`,
    ``,
    `<b>${token.name}</b> (${token.symbol})`,
    `Price: ${price}`,
    `<code>${token.address}</code>`,
    ``,
    pillarLines,
    ``,
    `➡️ ${verdict.action}`,
    `📈 <a href="${token.url}">DexScreener</a>  |  🤖 <a href="${trojanBuyLink(token.address)}">Buy via Trojan</a>`,
    ``,
    `<i>Heuristic only, not financial advice. DYOR.</i>`,
  ].join("\n");
}

/**
 * Send a GEM Score alert to Telegram. Returns {sent, reason}. No-op (not an
 * error) when bot token / chat id are not configured, so the rest of the
 * screener keeps working without Telegram set up.
 */
export async function sendAlert(report, { botToken, chatId } = {}) {
  if (!botToken || !chatId) {
    return { sent: false, reason: "Telegram not configured (set TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID)" };
  }
  try {
    const res = await fetch(`${TG_API}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatAlert(report),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const body = await res.json();
    if (!body.ok) return { sent: false, reason: body.description || "Telegram API error" };
    return { sent: true, reason: "delivered" };
  } catch (err) {
    return { sent: false, reason: String(err) };
  }
}
