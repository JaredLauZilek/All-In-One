// Real-browser stock check.
//
// WHY A BROWSER: Lazada's server-rendered HTML is stock-INDEPENDENT — the JSON-LD
// `offers.availability` is always "InStock", every SKU's `operation` is always
// "Add to Cart", and the module list always includes add-to-cart, regardless of real
// stock. True availability is applied client-side after hydration. The only reliable
// signal is whether a real "Add to Cart" / "Buy Now" button exists in the loaded page.
// Verified 2026-07: OOS box -> no cart button; in-stock pack -> cart button present.

import { randomBytes } from "node:crypto";

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

/**
 * Base residential proxy config from env, or null (inert → plain Fly IP). DataImpulse
 * gateway is `http://gw.dataimpulse.com:823`; the base username is enriched per check.
 */
export function proxyFromEnv() {
  const server = process.env.PROXY_SERVER;
  if (!server) return null;
  return { server, username: process.env.PROXY_USERNAME, password: process.env.PROXY_PASSWORD };
}

/** Does the launched browser need the per-context proxy placeholder? (Chromium requires it.) */
export const PROXY_ENABLED = !!process.env.PROXY_SERVER;

/**
 * Per-check proxy: pin ONE sticky residential IP for every request in this check via a
 * random `sessid`, and rotate to a fresh IP on the next check. This is essential —
 * DataImpulse rotating mode otherwise hands out a *different* IP per request, so a single
 * page load scatters its document/scripts/XHRs across many IPs at once, which Lazada
 * instantly bot-flags (→ x5sec punish). `__cr.sg` keeps the exit IP in Singapore.
 * DataImpulse username syntax: `login__cr.sg;sessid.<id>`.
 */
function perCheckProxy() {
  const base = proxyFromEnv();
  if (!base) return undefined;
  const country = process.env.PROXY_COUNTRY || "sg";
  const sessid = randomBytes(6).toString("hex");
  return { server: base.server, username: `${base.username}__cr.${country};sessid.${sessid}`, password: base.password };
}

/** A fresh context per check — carries the per-check sticky-proxy identity. */
export async function createContext(browser) {
  const proxy = perCheckProxy();
  const ctx = await browser.newContext({
    userAgent: UA,
    locale: "en-US",
    viewport: { width: 1366, height: 900 },
    ...(proxy ? { proxy } : {}),
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  return ctx;
}

/**
 * Check stock using a warm CONTEXT but an EPHEMERAL page — created here, closed in
 * `finally`. This is the design that survives short intervals:
 *
 *  - Reusing the context keeps one stable session (cookies/fingerprint), and it turns
 *    out Lazada never throttled us by session anyway (plain curl always returns in ~2.8s;
 *    every "throttle" we saw was actually CPU starvation).
 *  - Closing the page each check is the load-bearing part: Lazada's PDP runs a lot of
 *    background JS (analytics, timers, polling). A page held OPEN between checks drains
 *    CPU continuously and, at a 5s cadence on a shared VM, snowballs into 45s+ timeouts.
 *    An ephemeral page bounds CPU to a short burst per check. (Measured 2026-07.)
 */
const MAX_PROXY_RETRIES = 4; // ~25% of residential IPs are burnt for Lazada; retry a fresh one

/**
 * Retry wrapper: a `blocked` result means we drew an IP that's already flagged on Lazada
 * (measured ~25% of the DataImpulse pool). A fresh context = a fresh IP, so just try
 * again. At ~75% clean, 4 tries clears >99%. Bandwidth from every attempt is summed so
 * the cost figure stays honest. No proxy → no retry (the Fly IP won't change).
 */
export async function checkStock(browser, url) {
  const attempts = PROXY_ENABLED ? MAX_PROXY_RETRIES : 1;
  let last, kb = 0;
  for (let i = 0; i < attempts; i++) {
    last = await checkStockOnce(browser, url);
    kb += last.kb ?? 0;
    if (last.status !== "blocked") break; // usable IP → done
  }
  return { ...last, kb };
}

async function checkStockOnce(browser, url) {
  const start = Date.now();
  let ctx;
  let page;
  let bytes = 0; // measured proxy bandwidth for this attempt → real $ cost, not a guess
  try {
    ctx = await createContext(browser); // fresh context = one sticky proxy IP for this attempt
    page = await ctx.newPage();
    // Block anything the stock check doesn't need. Every byte here is proxy bandwidth we
    // pay for, so we keep only what renders the buy box: the document, JS, and API calls.
    await page.route("**/*", (route) => {
      const t = route.request().resourceType();
      if (t === "image" || t === "font" || t === "media" || t === "stylesheet") return route.abort();
      return route.continue();
    });
    page.on("response", (res) => {
      const len = Number(res.headers()["content-length"]);
      if (!Number.isNaN(len)) bytes += len;
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

    // Alibaba/Lazada anti-bot: sustained high-frequency polling gets redirected to an
    // x5sec "punish" challenge (…/_____tmd_____/punish?x5secdata=…). It carries no product
    // data, so report it honestly as `blocked` (distinct from a genuine `unknown`) and let
    // the caller's error-backoff slow down until the IP is un-flagged.
    if (/_____tmd_____|\/punish\b|x5secdata=/.test(page.url())) {
      return { status: "blocked", latencyMs: Date.now() - start, kb: Math.round(bytes / 1024), error: "x5sec_anti_bot_challenge" };
    }

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
      kb: Math.round(bytes / 1024),
    };
  } catch (e) {
    return { status: "error", latencyMs: Date.now() - start, kb: Math.round(bytes / 1024), error: String(e).slice(0, 200) };
  } finally {
    await ctx?.close().catch(() => {}); // closes the page too
  }
}
