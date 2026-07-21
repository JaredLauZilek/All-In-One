// On-demand network capture. Loads a product page in the real browser and records every
// XHR/fetch — URL, method, status, content-type, and a JSON body preview — so the
// dashboard can show exactly where the page gets its data (and flag the stock source).
import { createContext } from "./lazada.js";

// A response is "stockish" if its body or URL looks like it carries inventory/detail data.
const STOCK_BODY = /"operation"|"skuInfos"|"stock|soldOut|"buyable|sellable|"quantity"|inWishlist/i;
const STOCK_URL = /getdetailinfo|\/pdp\/|detail|sku|stock|cart|quantity/i;

export async function captureNetwork(browser, url) {
  const ctx = await createContext(browser); // plain Fly IP (proxy, if any, is per-request)
  const page = await ctx.newPage();
  await page.route("**/*", (r) => {
    const t = r.request().resourceType();
    if (t === "image" || t === "font" || t === "media") return r.abort();
    return r.continue();
  });

  const requests = [];
  const seen = new Set();
  page.on("response", async (res) => {
    const req = res.request();
    const t = req.resourceType();
    if (t !== "xhr" && t !== "fetch") return; // only the calls the page makes for data
    const u = res.url();
    const key = req.method() + " " + u;
    if (seen.has(key) || requests.length >= 150) return;
    seen.add(key);

    const mime = (res.headers()["content-type"] || "").split(";")[0].trim();
    const isJson = /json/.test(mime);
    let bodyPreview = null;
    let stockish = STOCK_URL.test(u);
    if (isJson) {
      try {
        const txt = await res.text();
        if (STOCK_BODY.test(txt)) stockish = true;
        bodyPreview = txt.slice(0, 6000); // cap so the row stays sane
      } catch { /* body already consumed / streamed */ }
    }
    requests.push({ url: u, method: req.method(), resourceType: t, status: res.status(), mimeType: mime, isJson, stockish, bodyPreview });
  });

  let finalUrl = url;
  let error = null;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(15000); // give client-side XHRs time to fire
    finalUrl = page.url();
  } catch (e) {
    error = String(e).slice(0, 200);
  }
  await ctx.close().catch(() => {});

  const stockReqs = requests.filter((r) => r.stockish);
  return {
    requests,
    summary: {
      total: requests.length,
      jsonCount: requests.filter((r) => r.isJson).length,
      stockSources: stockReqs.map((r) => r.url).slice(0, 5),
      blocked: /_____tmd_____|\/punish|x5secdata=/.test(finalUrl),
      finalUrl,
    },
    error,
  };
}
