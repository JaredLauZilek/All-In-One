// Diagnostic: log every Lazada/Alibaba API response during a page load, to find the
// call that carries real stock. If we can hit it directly, we skip the ~10MB render.
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

// Block images/fonts/media/css only — keep XHR/fetch/scripts so the stock call fires.
await page.route("**/*", (r) => {
  const t = r.request().resourceType();
  if (t === "image" || t === "font" || t === "media" || t === "stylesheet") return r.abort();
  return r.continue();
});

const interesting = /mtop|\/pdp\/|detail|sku|stock|buy|cart|quantity|acs-m\.lazada/i;
page.on("response", async (res) => {
  const u = res.url();
  const rt = res.request().resourceType();
  if ((rt !== "xhr" && rt !== "fetch") || !interesting.test(u)) return;
  let hint = "";
  try {
    const txt = (await res.text()).slice(0, 600);
    // Surface any stock-ish keys we can see in the body
    const keys = [...txt.matchAll(/"(\w*(?:stock|sold|quantity|buyable|available|addToCart|sellable)\w*)"\s*:\s*([^,}\]]{0,30})/gi)]
      .slice(0, 6).map((m) => `${m[1]}=${m[2].trim()}`).join("  ");
    hint = keys || txt.slice(0, 120).replace(/\s+/g, " ");
  } catch {}
  console.log(`[${res.status()}] ${u.slice(0, 110)}`);
  if (hint) console.log(`      ↳ ${hint}`);
});

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 });
  await page.waitForTimeout(20000); // let the client-side stock calls fire
} catch (e) {
  console.log("goto/wait error:", String(e).slice(0, 100));
}
await browser.close();
