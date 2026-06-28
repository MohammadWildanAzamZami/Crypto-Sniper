// Shared Solscan access layer. Both the public proxy route (/api/:resource) and
// the AI tool runner go through this, so the allowlist is the single source of
// truth for "what the browser/AI can reach" — no new attack surface is opened
// by the chat feature.

const PRO_BASE = "https://pro-api.solscan.io/v2.0";
const PUBLIC_BASE = "https://public-api.solscan.io";

// Allowlist of Solscan endpoints. Keeping this explicit prevents the proxy from
// being abused as an open relay and documents the surface the AI can touch.
export const ALLOWED = {
  "chain-info": { base: PUBLIC_BASE, path: "/chaininfo", params: [] },
  "token-meta": { base: PRO_BASE, path: "/token/meta", params: ["token_address"] },
  "token-price": { base: PRO_BASE, path: "/token/price", params: ["token_address", "from_time", "to_time"] },
  "token-top": { base: PRO_BASE, path: "/token/top", params: [] },
  "token-holders": { base: PRO_BASE, path: "/token/holders", params: ["token_address", "page", "page_size"] },
  "account-detail": { base: PRO_BASE, path: "/account/detail", params: ["address"] },
  "account-transactions": { base: PRO_BASE, path: "/account/transactions", params: ["address", "before", "limit"] },
};

/**
 * Fetch one allowlisted Solscan resource. Returns { ok, status, body }.
 * Never throws on HTTP errors — Solscan's status/message is forwarded so the
 * caller (proxy or AI) can render a real error (e.g. 401 "upgrade your key").
 */
export async function solscanFetch(resource, query, apiKey) {
  const spec = ALLOWED[resource];
  if (!spec) return { ok: false, status: 404, body: { error: `Unknown resource '${resource}'` } };

  const url = new URL(spec.base + spec.path);
  for (const key of spec.params) {
    const value = query[key];
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  try {
    const upstream = await fetch(url, { headers: { token: apiKey ?? "" } });
    const text = await upstream.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
    return { ok: upstream.ok, status: upstream.status, body };
  } catch (err) {
    return { ok: false, status: 502, body: { error: "Upstream request failed", detail: String(err) } };
  }
}
