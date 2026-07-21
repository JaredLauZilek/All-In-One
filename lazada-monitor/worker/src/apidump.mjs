import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
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
let saved = false;
page.on("response", async (res) => {
  if (saved || !res.url().includes("getdetailinfo")) return;
  try {
    const j = JSON.parse(await res.text());
    if (j.ret?.[0]?.includes("SUCCESS")) {
      const mod = typeof j.data.module === "string" ? JSON.parse(j.data.module) : j.data.module;
      writeFileSync("/tmp/module.json", JSON.stringify(mod, null, 1));
      saved = true;
      console.log("saved module. top keys:", Object.keys(mod).join(", "));
    }
  } catch (e) { console.log("err", String(e).slice(0, 60)); }
});
try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 }); await page.waitForTimeout(15000); }
catch (e) { console.log("nav err", String(e).slice(0, 80)); }
await browser.close();
