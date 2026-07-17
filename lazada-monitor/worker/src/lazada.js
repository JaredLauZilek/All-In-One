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
// The wait POLLS and returns the instant a signal appears, and with the CDN split the JS
// now arrives over Fly's fast pipe, so hydration is quick. A tight ceiling matters here:
// a dud residential IP should be abandoned fast and RETRIED, not waited on.
const HYDRATE_TIMEOUT_MS = 12000;

// Deliberately short. A healthy residential IP returns the document in ~0.5-3s (measured
// by curl); anything slower is a dud worth re-drawing. Retrying a fresh IP after 12s beats
// waiting 45s for one that will likely fail anyway.
const GOTO_TIMEOUT_MS = 12000;

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
 * Only Lazada's own hosts (the page document and the stock/API XHRs) carry the x5sec
 * anti-bot check, so only they need to exit from the residential IP. Everything else —
 * above all the ~5MB of JS on `g.lazcdn.com` — is plain static CDN traffic that no one
 * IP-checks. Defaults to TRUE on a parse failure: routing something through the proxy
 * costs a little bandwidth, but routing a checked request around it would get us blocked.
 */
function isLazadaHost(url) {
  try {
    return /(^|\.)lazada\./.test(new URL(url).hostname);
  } catch {
    return true;
  }
}

/** Node's fetch rejects some browser-managed headers; drop them for the direct fetch. */
function headersForDirectFetch(h) {
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    if (k === "host" || k === "connection" || k.startsWith(":")) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Check stock with a fresh CONTEXT + EPHEMERAL page per attempt:
 *
 *  - Fresh context per check = one sticky residential IP for all of this check's Lazada
 *    requests, rotating to a new IP next check (see perCheckProxy).
 *  - Closing the page each check bounds CPU: Lazada's PDP runs a lot of background JS
 *    (analytics, timers, polling), and a page held open between checks drains CPU
 *    continuously — at a short cadence that snowballed into 45s+ timeouts. (Measured
 *    2026-07.)
 */
const MAX_PROXY_RETRIES = 4; // ~25% of residential IPs are burnt for Lazada; retry a fresh one

/**
 * Retry wrapper. Residential IPs are a lottery: ~25% are already burnt for Lazada
 * (→ `blocked`) and some are simply too slow to serve the document (→ `error`). Both mean
 * "bad draw, take another" — a fresh context gets a fresh IP. Combined with the short
 * GOTO/HYDRATE timeouts, a dud costs ~12s instead of 45s, so retrying is cheap.
 * Bandwidth from every attempt is summed so the cost figure stays honest.
 * No proxy → no retry (the Fly IP won't change, so a retry would just repeat itself).
 */
export async function checkStock(browser, url) {
  const attempts = PROXY_ENABLED ? MAX_PROXY_RETRIES : 1;
  let last, kb = 0, directKb = 0, tries = 0;
  for (let i = 0; i < attempts; i++) {
    last = await checkStockOnce(browser, url);
    kb += last.kb ?? 0;
    directKb += last.directKb ?? 0;
    tries++;
    if (last.status !== "blocked" && last.status !== "error") break; // good IP → done
  }
  return { ...last, kb, directKb, tries };
}

async function checkStockOnce(browser, url) {
  const start = Date.now();
  let ctx;
  let page;
  let bytes = 0; // PROXY bytes only → the number we actually pay per GB
  let directBytes = 0; // fetched on the Fly IP → free, tracked for insight only
  try {
    ctx = await createContext(browser); // fresh context = one sticky proxy IP for this attempt
    page = await ctx.newPage();

    await page.route("**/*", async (route) => {
      const req = route.request();
      const t = req.resourceType();
      // Never needed to find a buy button, and pure cost if proxied.
      if (t === "image" || t === "font" || t === "media" || t === "stylesheet") return route.abort();

      // THE SPLIT. Lazada's own requests keep the residential IP (they're the ones x5sec
      // inspects — and they're small). Everything else is fetched here in Node, which
      // egresses on Fly's fast IP instead of a home broadband line: it makes the page
      // render quickly AND keeps ~5MB of CDN JS off the metered proxy.
      if (isLazadaHost(req.url())) return route.continue();

      try {
        const res = await fetch(req.url(), {
          method: req.method(),
          headers: headersForDirectFetch(req.headers()),
          redirect: "follow",
        });
        const body = Buffer.from(await res.arrayBuffer());
        directBytes += body.length;
        const headers = {};
        for (const [k, v] of res.headers) {
          // fetch already decoded the body, so the original encoding/length would lie.
          if (k === "content-encoding" || k === "content-length") continue;
          headers[k] = v;
        }
        return route.fulfill({ status: res.status, headers, body });
      } catch {
        return route.abort(); // a dead CDN asset shouldn't fail the whole check
      }
    });

    page.on("response", (res) => {
      if (!isLazadaHost(res.url())) return; // direct traffic is free — don't bill it
      const len = Number(res.headers()["content-length"]);
      if (!Number.isNaN(len)) bytes += len;
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: GOTO_TIMEOUT_MS });

    // Alibaba/Lazada anti-bot: sustained high-frequency polling gets redirected to an
    // x5sec "punish" challenge (…/_____tmd_____/punish?x5secdata=…). It carries no product
    // data, so report it honestly as `blocked` (distinct from a genuine `unknown`) and let
    // the caller's error-backoff slow down until the IP is un-flagged.
    if (/_____tmd_____|\/punish\b|x5secdata=/.test(page.url())) {
      return { status: "blocked", latencyMs: Date.now() - start, kb: Math.round(bytes / 1024), directKb: Math.round(directBytes / 1024), error: "x5sec_anti_bot_challenge" };
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
      // Decide on the FULL page text, in-page. Previously this returned only the first
      // 4000 chars and matched against that, while the hydration wait matched the whole
      // document — so a page whose "out of stock" sat past char 4000 would satisfy the
      // wait and then be scored `unknown`. Same text, same regexes, one place.
      const fullText = (document.body.innerText || "").toLowerCase();
      const btns = buttons.join(" | ").toLowerCase();
      return {
        buttons,
        price,
        currency,
        title,
        image,
        hasBuyable: /add to cart|buy now|add to basket/.test(btns),
        hasOOS: /out of stock|sold out|currently unavailable|no longer available|notify me/.test(btns + " " + fullText),
        captchaish: /slider|captcha|punish|unusual traffic|verify to continue/.test(fullText.slice(0, 2000)),
      };
    });

    let status = "unknown";
    // Order matters: a live cart button is positive proof of buyability. Only if it is
    // absent do we look for OOS wording (the phrase also appears in static UI labels).
    if (info.hasBuyable) status = "in_stock";
    else if (info.hasOOS) status = "out_of_stock";
    else if (info.captchaish) status = "blocked";

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
      directKb: Math.round(directBytes / 1024),
    };
  } catch (e) {
    return { status: "error", latencyMs: Date.now() - start, kb: Math.round(bytes / 1024), directKb: Math.round(directBytes / 1024), error: String(e).slice(0, 200) };
  } finally {
    await ctx?.close().catch(() => {}); // closes the page too
  }
}
