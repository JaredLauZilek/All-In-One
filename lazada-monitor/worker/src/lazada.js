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

/** Hydration wait. Lazada paints the cart button shortly after DOMContentLoaded. */
const HYDRATE_MS = 6000;

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
export async function checkStock(browser, url) {
  const start = Date.now();
  let ctx;
  try {
    ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      locale: "en-US",
      viewport: { width: 1366, height: 900 },
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    const page = await ctx.newPage();
    // Skip images/fonts/media: big speed + bandwidth win, cart button is DOM/JS only.
    await page.route("**/*", (route) => {
      const t = route.request().resourceType();
      if (t === "image" || t === "font" || t === "media") return route.abort();
      return route.continue();
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(HYDRATE_MS);

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
  } finally {
    await ctx?.close().catch(() => {});
  }
}
