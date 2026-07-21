// PROTOTYPE — inverse split. Browser egresses on the Fly IP (JS loads fast & intact →
// fires getdetailinfo). Only Lazada's own requests are tunnelled through a per-check
// sticky residential IP via undici, so no single IP is over-polled. We read stock from
// the getdetailinfo response as it passes through the tunnel and return immediately.
import { chromium } from "playwright";
import { ProxyAgent } from "undici";
import { randomBytes } from "node:crypto";
import { parseDetailModule } from "./lazada.js";

const url = process.argv[2] || "https://www.lazada.sg/products/pdp-i13696744288-s124594658123.html";
const USER = process.env.PROXY_USERNAME, PASS = process.env.PROXY_PASSWORD;
// MINIMAL TUNNEL: only the mtop API host (acs-m.lazada.*) goes through the proxy. The
// document (www) and CDN load on the fast Fly IP. Tests whether spreading just the API
// call across IPs is enough to beat the block, while keeping the page load fast.
const isLazada = (u) => { try { return /acs-m\.lazada\./.test(new URL(u).hostname); } catch { return false; } };

function parseSetCookies(arr, reqUrl) {
  const host = new URL(reqUrl).hostname;
  const domain = "." + host.split(".").slice(-2).join("."); // .lazada.sg
  return (arr || []).map((sc) => {
    const [pair] = sc.split(";");
    const i = pair.indexOf("=");
    return { name: pair.slice(0, i).trim(), value: pair.slice(i + 1).trim(), domain, path: "/" };
  }).filter((c) => c.name);
}

async function oneCheck(browser) {
  const start = Date.now();
  const sessid = randomBytes(6).toString("hex");
  const agent = new ProxyAgent(`http://${USER}__cr.sg;sessid.${sessid}:${PASS}@gw.dataimpulse.com:823`);
  const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" });
  const page = await ctx.newPage();
  let apiResult = null, proxyBytes = 0;

  await page.route("**/*", async (route) => {
    const req = route.request();
    const t = req.resourceType();
    if (t === "image" || t === "font" || t === "media" || t === "stylesheet") return route.abort();
    if (!isLazada(req.url())) return route.continue(); // CDN etc → Fly IP, JS intact

    try {
      const res = await fetch(req.url(), {
        method: req.method(), headers: req.headers(), body: req.postData() || undefined,
        dispatcher: agent, redirect: "manual",
      });
      const body = Buffer.from(await res.arrayBuffer());
      proxyBytes += body.length;
      const setC = res.headers.getSetCookie?.() || [];
      if (setC.length) await ctx.addCookies(parseSetCookies(setC, req.url())).catch(() => {});
      if (!apiResult && req.url().includes("getdetailinfo")) {
        try {
          const j = JSON.parse(body.toString());
          if (j?.ret?.[0]?.includes("SUCCESS") && j?.data?.module) {
            const mod = typeof j.data.module === "string" ? JSON.parse(j.data.module) : j.data.module;
            const p = parseDetailModule(mod);
            if (p.status !== "unknown") apiResult = p;
          } else if (j?.ret?.[0]) { /* token step or validate */ }
        } catch {}
      }
      const headers = {};
      for (const [k, v] of res.headers) { if (k === "content-encoding" || k === "content-length" || k === "set-cookie") continue; headers[k] = v; }
      return route.fulfill({ status: res.status, headers, body });
    } catch (e) { return route.abort(); }
  });

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    const deadline = Date.now() + 18000;
    while (!apiResult && Date.now() < deadline) {
      if (/_____tmd_____|\/punish|x5secdata=/.test(page.url())) { await ctx.close(); return { status: "blocked", ms: Date.now() - start, proxyBytes }; }
      await page.waitForTimeout(100);
    }
  } catch (e) { await ctx.close(); return { status: "error", ms: Date.now() - start, err: String(e).slice(0, 50) }; }
  await ctx.close();
  return { status: apiResult?.status || "unknown", price: apiResult?.price, ms: Date.now() - start, proxyBytes };
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
// Poll FAST (every 8s) to see if rotating IPs avoid the block that killed the plain IP.
for (let i = 0; i < 6; i++) {
  const r = await oneCheck(browser);
  console.log(`#${i + 1}  ${String(r.status).padEnd(12)} ${String(r.ms).padStart(6)}ms  proxy=${Math.round((r.proxyBytes || 0) / 1024)}kb  ${r.price ? "$" + r.price : ""}${r.err ? " " + r.err : ""}`);
  await new Promise((res) => setTimeout(res, 8000));
}
await browser.close();
