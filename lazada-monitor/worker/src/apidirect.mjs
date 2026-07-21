// Can we call getdetailinfo directly in Node — no browser? mtop h5 signing:
//   sign = md5(token + "&" + t + "&" + appKey + "&" + data)
//   token = value before "_" in the _m_h5_tc cookie (seeded by a first, tokenless call)
import { createHash } from "node:crypto";

const md5 = (s) => createHash("md5").update(s).digest("hex");
const APPKEY = "24677475";
const API = "mtop.global.detail.web.getdetailinfo";
const url = process.argv[2] || "https://www.lazada.sg/products/pdp-i13696744288-s124594658123.html";
const host = new URL(url).host.replace(/^www\./, ""); // lazada.sg
const gw = `https://acs-m.${host}/h5/${API}/1.0/`;

// Try a few data shapes — the browser call sent empty data and relied on Referer.
const m = url.match(/-i(\d+)/);
const itemId = m ? m[1] : "";
const dataVariants = ["", JSON.stringify({ itemNumId: itemId }), JSON.stringify({ itemId })];

async function call(data, jar, extra = {}) {
  const t = String(Date.now());
  const token = (jar._m_h5_tc || "").split("_")[0];
  const sign = md5(`${token}&${t}&${APPKEY}&${data}`);
  const qs = new URLSearchParams({
    jsv: "2.6.1", appKey: APPKEY, t, sign, api: API, v: "1.0",
    type: "originaljson", dataType: "json", H5Request: "true", data,
  });
  const res = await fetch(`${gw}?${qs}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      Referer: url,
      Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "),
      ...extra,
    },
  });
  // capture Set-Cookie token
  const sc = res.headers.get("set-cookie") || "";
  const tc = sc.match(/_m_h5_tc=([^;]+)/);
  if (tc) jar._m_h5_tc = tc[1];
  const body = await res.text();
  return body;
}

for (const data of dataVariants) {
  const jar = {};
  await call(data, jar);          // seed token
  const r2 = await call(data, jar); // signed retry
  let verdict = r2.slice(0, 90);
  try {
    const j = JSON.parse(r2);
    verdict = j.ret?.[0] + (j.data?.module ? " | module len=" + JSON.stringify(j.data.module).length : "");
  } catch {}
  console.log(`data=${data || "(empty)"} -> ${verdict}`);
}
