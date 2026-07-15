// Standalone check of the real stock detector — no DB, no secrets.
//   node src/selftest.js [url ...]
// Defaults exercise a known OOS product, a known in-stock product, and a delisted one.
import { chromium } from "playwright";
import { checkStock } from "./lazada.js";

const urls = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "https://www.lazada.com.my/products/pokemon-tcg-booster-box-1000-original-i3967555066.html",
      "https://www.lazada.com.my/products/pokemon-tcg-booster-pack-1000-original-i3892201953.html",
      "https://www.lazada.com.my/products/pe-bb-pokemon-tcg-sv02-paldea-evolved-booster-box-i4067895288.html",
    ];

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
for (const u of urls) {
  const r = await checkStock(browser, u);
  console.log(
    `${r.status.padEnd(13)} ${String(r.latencyMs).padStart(6)}ms  ` +
      `${r.price !== undefined ? (r.currency ?? "MYR") + " " + r.price : "no price"}  ` +
      `${(r.title ?? "").slice(0, 45)}${r.error ? "  ERR:" + r.error : ""}`,
  );
}
await browser.close();
