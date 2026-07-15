// Real-browser stock check.
//
// WHY A BROWSER: Lazada's server-rendered HTML is stock-INDEPENDENT — the JSON-LD
// `offers.availability` is always "InStock", every SKU's `operation` is always
// "Add to Cart", and the module list always includes add-to-cart, regardless of real
// stock. True availability is applied client-side after hydration. The only reliable
// signal is whether a real "Add to Cart" / "Buy Now" button exists in the loaded page.
// Verified 2026-07: OOS box -> no cart button; in-stock pack -> cart button present.

const OOS = /out of stock|sold out|currently unavailable|no longer available|notify me/i;
const BUYABLE = /add to cart|buy now|add to basket/i;
const CAPTCHA = /slider|captcha|punish|unusual traffic|verify to continue/i;

// Lazada paints the real buy/OOS state shortly after DOMContentLoaded. Rather than
// sleeping a fixed interval, poll until a definitive signal appears — usually far
// sooner. If nothing definitive shows up in time we fall through and evaluate anyway
// (yielding "unknown"), so this can only make us faster, never wrong.
// Generous on purpose: the wait POLLS and returns the instant a signal appears (~0.2-1.4s
// on a healthy page), so a long ceiling costs nothing normally. It only matters when the
// page is slow — where a short ceiling would report "unknown" instead of the real status.
const HYDRATE_TIMEOUT_MS = 25000;

export function parseLazadaUrl(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)lazada\./.test(u.hostname)) return null;
    const m = u.pathname.match(/-i(\d+)(?:-s(\d+))?\.html/);
    if (!m) return null;
    return { itemId: m[1], skuId: m[2] ?? u.searchParams.get("skuId") };
  } catch {
    return null;
  }
}

/**
 * @returns {{status:'in_stock'|'out_of_stock'|'unknown'|'blocked'|'error',
 *            price?:number, currency?:string, title?:string, image?:string,
 *            latencyMs:number, error?:string}}
 */
export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** One shared, long-lived context: a single warm session (see checkStock). */
export async function createContext(browser) {
  const ctx = await browser.newContext({
    userAgent: UA,
    locale: "en-US",
    viewport: { width: 1366, height: 900 },
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  return ctx;
}

/** A warm page bound to one product URL. Skips images/fonts/media. */
export async function createPage(ctx) {
  const page = await ctx.newPage();
  await page.route("**/*", (route) => {
    const t = route.request().resourceType();
    if (t === "image" || t === "font" || t === "media") return route.abort();
    return route.continue();
  });
  return page;
}

/**
 * Check stock on an EXISTING warm page — reloading if we're already on the URL.
 *
 * Why warm: opening a fresh context per check (new cookies/fingerprint every few
 * seconds) reads as a bot swarm and Lazada tarpits it — measured 2026-07, latency
 * decayed 6s -> 89s at a 10s interval. Reusing one session and reloading held FLAT at
 * ~2.5s across 14 reloads at 5s. The session, not the rate, was the trigger.
 */
export async function checkStock(page, url) {
  const start = Date.now();
  try {
    const onUrl = (() => {
      try {
        return new URL(page.url()).pathname === new URL(url).pathname;
      } catch {
        return false;
      }
    })();

    if (onUrl) await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
    else await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page
      .waitForFunction(
        () => {
          const btns = Array.from(
            document.querySelectorAll("button, .pdp-button, [class*='add-to-cart'], [class*='buy']"),
          )
            .map((b) => (b.textContent || "").trim())
            .join(" | ")
            .toLowerCase();
          if (/add to cart|buy now|add to basket/.test(btns)) return true;
          const txt = (document.body.innerText || "").toLowerCase();
          return /out of stock|sold out|no longer available|currently unavailable/.test(btns + " " + txt);
        },
        { timeout: HYDRATE_TIMEOUT_MS, polling: 200 },
      )
      .catch(() => {}); // no definitive signal in time -> evaluate as-is

    const info = await page.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll("button, .pdp-button, [class*='add-to-cart'], [class*='buy']"),
      )
        .map((b) => (b.textContent || "").trim())
        .filter(Boolean);

      let price = null;
      let currency = null;
      let title = null;
      let image = null;
      try {
        const f = window.__moduleData__?.data?.root?.fields;
        const raw = f?.tracking?.pdt_price;
        if (raw) {
          const n = parseFloat(String(raw).replace(/[^\d.]/g, ""));
          if (!Number.isNaN(n)) price = n;
        }
        currency = f?.tracking?.core?.currencyCode ?? null;
        title = f?.product?.title ?? null;
      } catch {}
      if (price === null) {
        const el = document.querySelector("[class*='pdp-price']");
        if (el) {
          const n = parseFloat((el.textContent || "").replace(/[^\d.]/g, ""));
          if (!Number.isNaN(n)) price = n;
        }
      }
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const d = JSON.parse(s.textContent);
          if (d && d["@type"] === "Product") {
            title = title || d.name || null;
            const img = Array.isArray(d.image) ? d.image[0] : null;
            if (img) image = String(img).startsWith("//") ? "https:" + img : img;
            break;
          }
        } catch {}
      }
      return { buttons, price, currency, title, image, text: (document.body.innerText || "").slice(0, 4000) };
    });

    const btns = info.buttons.join(" | ");
    let status = "unknown";
    // Order matters: a live cart button is positive proof of buyability. Only if it is
    // absent do we look for OOS wording (the phrase also appears in static UI labels).
    if (BUYABLE.test(btns)) status = "in_stock";
    else if (OOS.test(btns) || OOS.test(info.text)) status = "out_of_stock";
    else if (CAPTCHA.test(info.text)) status = "blocked";

    const pageTitle = await page.title();
    if (/no longer available/i.test(pageTitle)) status = "out_of_stock";

    return {
      status,
      price: info.price ?? undefined,
      currency: info.currency ?? undefined,
      title: info.title ?? ((pageTitle || "").replace(/\s*\|\s*Lazada.*$/, "").trim() || undefined),
      image: info.image ?? undefined,
      latencyMs: Date.now() - start,
    };
  } catch (e) {
    return { status: "error", latencyMs: Date.now() - start, error: String(e).slice(0, 200) };
  }
}
