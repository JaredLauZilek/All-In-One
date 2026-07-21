// Capture the FULL successful getdetailinfo request (url + params) so we can replicate it.
import { chromium } from "playwright";
const url = process.argv[2];
const proxy = process.env.PROXY_SERVER
  ? { server: process.env.PROXY_SERVER, username: process.env.PROXY_USERNAME, password: process.env.PROXY_PASSWORD }
  : undefined;

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  ...(proxy ? { proxy } : {}),
});
const page = await ctx.newPage();
await page.route("**/*", (r) => {
  const t = r.request().resourceType();
  if (t === "image" || t === "font" || t === "media" || t === "stylesheet") return r.abort();
  return r.continue();
});

page.on("request", (req) => {
  if (req.url().includes("getdetailinfo")) {
    const u = new URL(req.url());
    const p = Object.fromEntries(u.searchParams);
    console.log("--- getdetailinfo REQUEST ---");
    console.log("appKey:", p.appKey, "| t:", p.t, "| sign:", p.sign);
    console.log("data:", decodeURIComponent(p.data || ""));
    console.log("headers.cookie has _m_h5_tc:", /(_m_h5_tc)/.test(req.headers().cookie || ""));
  }
});
page.on("response", async (res) => {
  if (res.url().includes("getdetailinfo")) {
    try {
      const j = JSON.parse(await res.text());
      const ret = j.ret?.[0] || "ok";
      // find stock-ish fields in the module blob
      const blob = typeof j.data?.module === "string" ? j.data.module : JSON.stringify(j.data || {});
      const stock = [...blob.matchAll(/"(\w*(?:stock|sold|quantity|buyable|available|addToCart|sellable|globalStock)\w*)"\s*:\s*("?[^",}\]]{0,25})/gi)]
        .slice(0, 10).map((m) => `${m[1]}=${m[2]}`);
      console.log(`--- RESPONSE ret=${ret} moduleLen=${blob.length}`);
      if (stock.length) console.log("    stock fields:", stock.join("  "));
    } catch (e) { console.log("resp parse err", String(e).slice(0, 60)); }
  }
});

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 });
  await page.waitForTimeout(15000);
} catch (e) { console.log("err", String(e).slice(0, 80)); }
await browser.close();
