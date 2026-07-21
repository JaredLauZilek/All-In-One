// Real-browser stock check.
//
// WHY A BROWSER: Lazada's server-rendered HTML is stock-INDEPENDENT — the JSON-LD
// `offers.availability` is always "InStock", every SKU's `operation` is always
// "Add to Cart", and the module list always includes add-to-cart, regardless of real
// stock. True availability is applied client-side after hydration. The only reliable
// signal is whether a real "Add to Cart" / "Buy Now" button exists in the loaded page.
// Verified 2026-07: OOS box -> no cart button; in-stock pack -> cart button present.

import { randomBytes } from "node:crypto";
import { ProxyAgent } from "undici";

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
// Ceiling for the stock answer to arrive. We return the instant the getdetailinfo API
// responds — ~1-3s on the plain Fly IP — so this only bites on a slow/dud IP. Kept
// generous enough that a working-but-slow proxy IP still yields the API answer rather
// than falling through to the much slower DOM render.
const HYDRATE_TIMEOUT_MS = 18000;

const GOTO_TIMEOUT_MS = 18000;

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
 * The page's own stock API — `mtop.global.detail.web.getdetailinfo` on acs-m.lazada.* —
 * returns the exact data the buy box renders from, in ~2KB of JSON that arrives early in
 * the load. Reading it directly is the whole game: no waiting on a 10MB DOM render.
 *
 * The stock signal is the SKU's CTA operation. Lazada swaps the primary button between
 * "Add to Cart" (buyable) and "Add to Wishlist" (out of stock) — verified 2026-07 on a
 * genuinely OOS product whose live `operation` was {type:"wishlist"}.
 */
export function parseDetailModule(mod) {
  const out = { status: "unknown" };
  try {
    const sk = mod.skuInfos || {};
    const pk = mod.primaryKey || {};
    const sid = String(pk.skuId ?? pk.defaultSkuId ?? Object.keys(sk)[0] ?? "");
    const sku = sk[sid] || Object.values(sk)[0] || {};

    const ops = [sku.operation, ...(Array.isArray(sku.operations) ? sku.operations : [])].filter(Boolean);
    const opText = ops.map((o) => `${o.text || ""} ${o.type || ""}`).join(" ").toLowerCase();
    const hasCart =
      /add to cart|buy now|add to basket|pre-?order/.test(opText) ||
      ops.some((o) => ["default", "cart", "addtocart", "buynow", "presale"].includes(String(o.type).toLowerCase()));
    const primaryType = String(sku.operation?.type ?? ops[0]?.type ?? "").toLowerCase();

    if (hasCart) out.status = "in_stock";
    else if (primaryType === "wishlist" || /wishlist|out of stock|sold out|no longer/.test(opText)) out.status = "out_of_stock";

    const v = sku.price?.salePrice?.value;
    if (typeof v === "number") out.price = v;
    if (mod.product?.title) out.title = mod.product.title;
    if (sku.image) out.image = sku.image;
  } catch {
    /* leave status unknown on any shape surprise */
  }
  return out;
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
/**
 * An undici dispatcher that egresses through ONE sticky residential IP for this check
 * (random sessid), or null when no proxy is configured. We attach it per-request only to
 * Lazada's own hosts — see the inverse split in checkStockOnce.
 */
function perCheckAgent() {
  const base = proxyFromEnv();
  if (!base) return null;
  const country = process.env.PROXY_COUNTRY || "sg";
  const sessid = randomBytes(6).toString("hex");
  const u = new URL(base.server);
  const auth = `${encodeURIComponent(`${base.username}__cr.${country};sessid.${sessid}`)}:${encodeURIComponent(base.password)}`;
  return new ProxyAgent(`${u.protocol}//${auth}@${u.host}`);
}

/** The browser always egresses on the plain (Fly) IP; the proxy is applied per-request. */
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

/**
 * Only Lazada's own hosts (the page document and the stock/API XHRs) carry the x5sec
 * anti-bot check, so only they route through the residential IP. Everything else — above
 * all the ~5MB of JS on `g.lazcdn.com` — is plain static CDN traffic that no one IP-checks
 * and that we let load fast on the Fly IP. Defaults to TRUE on a parse failure: proxying
 * an extra request only costs a little bandwidth, whereas routing a checked one around the
 * proxy would get us blocked.
 */
function isLazadaHost(url) {
  try {
    return /(^|\.)lazada\./.test(new URL(url).hostname);
  } catch {
    return true;
  }
}

/** Turn a fetch response's Set-Cookie list into Playwright addCookies() entries. */
function setCookiesToEntries(list, reqUrl) {
  const host = new URL(reqUrl).hostname;
  const domain = "." + host.split(".").slice(-2).join(".");
  return (list || []).map((sc) => {
    const [pair] = sc.split(";");
    const i = pair.indexOf("=");
    return i > 0 ? { name: pair.slice(0, i).trim(), value: pair.slice(i + 1).trim(), domain, path: "/" } : null;
  }).filter(Boolean);
}

/**
 * In-memory cache for the CDN assets we fetch directly. Lazada's JS bundles live at
 * versioned URLs (…/pdp-modules/2.0.21/pc-v2-mod.js) so they're immutable — but every
 * check uses a FRESH context (needed for a fresh proxy IP), which means an empty browser
 * cache and a re-download of ~8MB each time. Serving them from RAM removes that entirely.
 * Bounded so it can't grow into the 1GB VM's headroom.
 */
const cdnCache = new Map();
let cdnCacheBytes = 0;
const CDN_CACHE_MAX_BYTES = 96 * 1024 * 1024;

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
// A burnt IP is rejected in ~0.5s, so extra attempts are nearly free — while each one
// multiplies our odds of drawing a clean IP. Measured 2026-07-17: 4 attempts still left
// ~20% of checks blocked, implying ~65% of the pool is burnt for Lazada (a rate we made
// worse ourselves by hammering one URL). 8 attempts takes that ~20% down to ~4%.
const MAX_PROXY_RETRIES = 8;

/**
 * Retry wrapper. Residential IPs are a lottery: ~25% are already burnt for Lazada
 * (→ `blocked`) and some are simply too slow to serve the document (→ `error`). Both mean
 * "bad draw, take another" — a fresh context gets a fresh IP. Combined with the short
 * GOTO/HYDRATE timeouts, a dud costs ~12s instead of 45s, so retrying is cheap.
 * Bandwidth from every attempt is summed so the cost figure stays honest.
 * No proxy → no retry (the Fly IP won't change, so a retry would just repeat itself).
 */
export async function checkStock(browser, url) {
  const started = Date.now();
  const attempts = PROXY_ENABLED ? MAX_PROXY_RETRIES : 1;
  let last, kb = 0, directKb = 0, tries = 0;
  for (let i = 0; i < attempts; i++) {
    last = await checkStockOnce(browser, url);
    kb += last.kb ?? 0;
    directKb += last.directKb ?? 0;
    tries++;
    if (last.status !== "blocked" && last.status !== "error") break; // good IP → done
  }
  // Report time across ALL attempts, not just the last one: what matters (and what the
  // dashboard's median speed should reflect) is how long the check took to yield an
  // answer, retries included.
  return { ...last, kb, directKb, tries, latencyMs: Date.now() - started };
}

async function checkStockOnce(browser, url) {
  const start = Date.now();
  let ctx;
  let page;
  let agent = null; // per-check residential dispatcher (undici)
  let bytes = 0; // PROXY bytes only → the number we actually pay per GB
  let directBytes = 0; // CDN etc on the Fly IP is free; kept for the dashboard field
  try {
    ctx = await createContext(browser); // browser egresses on the plain Fly IP
    agent = perCheckAgent(); // one sticky residential IP for this attempt (null if no proxy)
    page = await ctx.newPage();

    // FAST PATH: read stock straight from the page's own getdetailinfo API as it passes.
    let apiResult = null;

    await page.route("**/*", async (route) => {
      const req = route.request();
      const t = req.resourceType();
      // Never needed to find a buy button, and pure cost if proxied.
      if (t === "image" || t === "font" || t === "media" || t === "stylesheet") return route.abort();

      // CDN / non-Lazada: load normally on the Fly IP. Fast, free, and — crucially — the
      // page's JS runs intact, so it actually FIRES the getdetailinfo call. (Node-fetching
      // and re-injecting CDN JS subtly broke execution and the call never fired.)
      if (!isLazadaHost(req.url()) || !agent) return route.continue();

      // INVERSE SPLIT: tunnel this one x5sec-checked request through the sticky residential
      // IP. That's what beats the per-IP rate block — a fresh IP each check — while the
      // heavy JS above stays on the fast Fly pipe.
      try {
        const res = await fetch(req.url(), {
          method: req.method(),
          headers: req.headers(),
          body: req.postData() || undefined,
          dispatcher: agent,
          redirect: "manual",
        });
        const body = Buffer.from(await res.arrayBuffer());
        bytes += body.length; // this is metered proxy bandwidth
        // Relay Set-Cookie so the browser's mtop token handshake completes through the tunnel.
        const setC = res.headers.getSetCookie?.() || [];
        if (setC.length) await ctx.addCookies(setCookiesToEntries(setC, req.url())).catch(() => {});
        // Read the stock answer straight from the API response passing through.
        if (!apiResult && req.url().includes("getdetailinfo")) {
          try {
            const j = JSON.parse(body.toString());
            if (j?.ret?.[0]?.includes("SUCCESS") && j?.data?.module) {
              const mod = typeof j.data.module === "string" ? JSON.parse(j.data.module) : j.data.module;
              const parsed = parseDetailModule(mod);
              if (parsed.status !== "unknown") apiResult = parsed;
            }
          } catch { /* token step / non-JSON — ignore */ }
        }
        const headers = {};
        for (const [k, v] of res.headers) {
          if (k === "content-encoding" || k === "content-length" || k === "set-cookie") continue;
          headers[k] = v;
        }
        return route.fulfill({ status: res.status, headers, body });
      } catch {
        return route.abort();
      }
    });

    // API interception for the NO-PROXY path: those requests go via route.continue (no
    // tunnel to parse them inline), so read getdetailinfo off the real response here. Also
    // a safety net for the proxy path. Guarded by !apiResult so we never double-count.
    page.on("response", async (res) => {
      if (apiResult || !res.url().includes("getdetailinfo")) return;
      try {
        const j = JSON.parse(await res.text());
        if (j?.ret?.[0]?.includes("SUCCESS") && j?.data?.module) {
          const mod = typeof j.data.module === "string" ? JSON.parse(j.data.module) : j.data.module;
          const parsed = parseDetailModule(mod);
          if (parsed.status !== "unknown") apiResult = parsed;
        }
      } catch { /* ignore */ }
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: GOTO_TIMEOUT_MS });

    // Wait for the API answer (usually a few seconds), watching for the anti-bot redirect.
    const deadline = Date.now() + HYDRATE_TIMEOUT_MS;
    while (!apiResult && Date.now() < deadline) {
      // Alibaba/Lazada x5sec punish page (…/_____tmd_____/punish?x5secdata=…): no product
      // data. Report `blocked` so the retry draws a fresh IP and the backoff can slow down.
      if (/_____tmd_____|\/punish\b|x5secdata=/.test(page.url())) {
        return { status: "blocked", latencyMs: Date.now() - start, kb: Math.round(bytes / 1024), directKb: Math.round(directBytes / 1024), error: "x5sec_anti_bot_challenge" };
      }
      await page.waitForTimeout(120);
    }

    if (apiResult) {
      return {
        ...apiResult,
        latencyMs: Date.now() - start,
        kb: Math.round(bytes / 1024),
        directKb: Math.round(directBytes / 1024),
        via: "api",
      };
    }

    // FALLBACK: API didn't arrive in time — read the DOM the slow way (still correct).
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
    await agent?.close().catch(() => {}); // free the proxy sockets
  }
}
