// Shared Lazada fetch + parse logic.
// Calibrated 2026-07 against lazada.com.my: product pages served without JS
// rendering contain a schema.org Product JSON-LD block (stock availability)
// and window.__moduleData__ (price via fields.tracking.pdt_price).

export type StockStatus = "in_stock" | "out_of_stock" | "unknown" | "blocked" | "error";

export interface ParsedProduct {
  status: StockStatus;
  title?: string;
  image?: string;
  price?: number;
  currency?: string;
  shopName?: string;
}

export interface FetchResult {
  html?: string;
  method: "direct" | "scrape_api";
  httpStatus: number;
  latencyMs: number;
  error?: string;
}

export interface FetchState {
  cookies: string | null;
  user_agent: string | null;
  blocked_until: string | null;
}

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export function parseLazadaUrl(url: string): { itemId: string; skuId: string | null; host: string } | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)lazada\./.test(u.hostname)) return null;
    const m = u.pathname.match(/-i(\d+)(?:-s(\d+))?\.html/);
    if (!m) return null;
    return { itemId: m[1], skuId: m[2] ?? u.searchParams.get("skuId"), host: u.hostname };
  } catch {
    return null;
  }
}

function looksBlocked(html: string): boolean {
  const hasProductLd = /"@type":\s*"Product"/.test(html);
  const hasModuleData = html.includes("__moduleData__");
  if (hasProductLd || hasModuleData) return false;
  return /punish|captcha|baxia|slide to verify|unusual traffic/i.test(html) || html.length < 20000;
}

export async function fetchDirect(url: string, state: FetchState): Promise<FetchResult> {
  const start = Date.now();
  try {
    const headers: Record<string, string> = {
      "User-Agent": state.user_agent || DEFAULT_UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    };
    if (state.cookies) headers["Cookie"] = state.cookies;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000), redirect: "follow" });
    const html = await res.text();
    const latencyMs = Date.now() - start;
    if (res.status !== 200 || looksBlocked(html)) {
      return { method: "direct", httpStatus: res.status, latencyMs, error: "blocked_or_bad_response", html };
    }
    return { html, method: "direct", httpStatus: res.status, latencyMs };
  } catch (e) {
    return { method: "direct", httpStatus: 0, latencyMs: Date.now() - start, error: String(e) };
  }
}

export async function fetchViaScraperApi(url: string, apiKey: string): Promise<FetchResult> {
  const start = Date.now();
  try {
    const api = `https://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(url)}&country_code=my`;
    const res = await fetch(api, { signal: AbortSignal.timeout(70000) });
    const html = await res.text();
    const latencyMs = Date.now() - start;
    if (res.status !== 200 || looksBlocked(html)) {
      return { method: "scrape_api", httpStatus: res.status, latencyMs, error: "blocked_or_bad_response" };
    }
    return { html, method: "scrape_api", httpStatus: res.status, latencyMs };
  } catch (e) {
    return { method: "scrape_api", httpStatus: 0, latencyMs: Date.now() - start, error: String(e) };
  }
}

export function parseProductPage(html: string): ParsedProduct {
  const out: ParsedProduct = { status: "unknown" };

  // 1) schema.org Product JSON-LD -> availability, name, image
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(m[1]);
      if (d && d["@type"] === "Product") {
        out.title = d.name || out.title;
        if (Array.isArray(d.image) && d.image[0]) {
          out.image = String(d.image[0]).startsWith("//") ? "https:" + d.image[0] : d.image[0];
        }
        const offers = d.offers || {};
        const avail = String(offers.availability || "");
        if (/InStock|LimitedAvailability|PreOrder/i.test(avail)) out.status = "in_stock";
        else if (/OutOfStock|SoldOut|Discontinued/i.test(avail)) out.status = "out_of_stock";
        const p = parseFloat(offers.price ?? offers.lowPrice ?? "");
        if (!Number.isNaN(p)) out.price = p;
        if (offers.priceCurrency) out.currency = offers.priceCurrency;
        if (offers.seller?.name) out.shopName = offers.seller.name;
        break;
      }
    } catch { /* tolerate malformed blocks */ }
  }

  // 2) __moduleData__ tracking -> price ("RM1,300.00") + currency + seller
  const priceM = html.match(/"pdt_price":"([^"]+)"/);
  if (priceM && out.price === undefined) {
    const p = parseFloat(priceM[1].replace(/[^\d.]/g, ""));
    if (!Number.isNaN(p)) out.price = p;
  }
  const curM = html.match(/"currencyCode":"([A-Z]{3})"/);
  if (curM && !out.currency) out.currency = curM[1];
  const sellerM = html.match(/"seller_name":"([^"]+)"/);
  if (sellerM && !out.shopName) out.shopName = sellerM[1];
  if (!out.title) {
    const t = html.match(/<title>([^<]*?)(?:\s*\|\s*Lazada[^<]*)?<\/title>/);
    if (t) out.title = t[1].trim();
  }

  if (out.status === "unknown" && looksBlockedForParse(html)) out.status = "blocked";
  return out;
}

function looksBlockedForParse(html: string): boolean {
  return !/"@type":\s*"Product"/.test(html) && !html.includes("__moduleData__");
}

/** Tiered fetch: direct first (fast, free) unless recently blocked; ScraperAPI fallback. */
export async function fetchProductPage(
  url: string,
  state: FetchState,
  scraperApiKey: string | null,
): Promise<FetchResult & { usedFallback: boolean }> {
  const blockedUntil = state.blocked_until ? new Date(state.blocked_until).getTime() : 0;
  const directAllowed = Date.now() > blockedUntil;

  if (directAllowed) {
    const direct = await fetchDirect(url, state);
    if (!direct.error) return { ...direct, usedFallback: false };
    if (!scraperApiKey) return { ...direct, usedFallback: false };
    const fb = await fetchViaScraperApi(url, scraperApiKey);
    return { ...fb, usedFallback: true };
  }
  if (scraperApiKey) {
    const fb = await fetchViaScraperApi(url, scraperApiKey);
    return { ...fb, usedFallback: true };
  }
  return { method: "direct", httpStatus: 0, latencyMs: 0, error: "direct_blocked_no_fallback", usedFallback: false };
}
