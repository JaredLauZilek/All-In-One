// ============================================================
//  fin-daily-signal — Supabase Edge Function (Deno)
//  Live price (Finnhub) + 52-week-high peak (Yahoo) + auto DDR5
//  market intel (Bing News RSS). Reads config + contract log,
//  computes ONE verdict, writes a daily snapshot row. Cron runs
//  it daily; "Refresh now" triggers it on demand.
//
//  The DDR5 market intel is ADVISORY ONLY — it enriches the
//  contract section and suggests a direction, but never sets the
//  verdict or the manual fin_contract_log trigger (which is sacred).
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FINNHUB = "https://finnhub.io/api/v1";
const DAY_MS = 86_400_000;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

const HEADLINES: Record<string, string> = {
  HOLD:    "Hold — no signal change. Sit on your hands.",
  WATCH:   "Watch — a level you set is close, or an event is near.",
  ENTRY:   "Entry level hit — a stock reached your pre-set buy zone. Check the thesis, then decide.",
  CAUTION: "Caution — DDR5 contract prices turned. The bear trigger fired; reassess before adding.",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status, headers: { "Content-Type": "application/json" },
  });
}
const daysBetween = (a: number, b: number) => Math.floor((a - b) / DAY_MS);

// ---- Yahoo quote (peak source + price fallback + currency; free, no key) ----
//
// Yahoo is the ONLY source for the non-US names: Finnhub's free tier returns
// {c:0} for the Korean listings (000660.KS, 005930.KS) and the OTC ADRs
// (HXSCL, SSNLF) — verified 2026-07. It's also the only source of `currency`,
// which the UI needs so it never renders a KRW price behind a "$".
type YahooQuote = { price: number | null; prevClose: number | null; high52: number | null; currency: string };

async function yahooQuote(sym: string): Promise<YahooQuote | null> {
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d`,
      { headers: { "User-Agent": UA, "Accept": "application/json" } },
    );
    if (!r.ok) return null;
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    const meta = res?.meta;
    if (!meta) return null;

    let high52 = Number(meta.fiftyTwoWeekHigh) || 0;
    if (!high52) {
      const highs = (res?.indicators?.quote?.[0]?.high ?? []).filter((x: number) => typeof x === "number");
      high52 = highs.length ? Math.round(Math.max(...highs) * 100) / 100 : 0;
    }

    // NOT meta.chartPreviousClose — that is the close *before the requested
    // range* (i.e. a year ago at range=1y), which turns the day-change into a
    // ~+600% nonsense figure. Use the real previous close, or failing that the
    // second-to-last daily candle (the last one is today).
    const closes = (res?.indicators?.quote?.[0]?.close ?? []).filter((x: number) => typeof x === "number");
    const prevClose = Number(meta.regularMarketPreviousClose) ||
      (closes.length >= 2 ? closes[closes.length - 2] : null);

    return {
      price: Number(meta.regularMarketPrice) || null,
      prevClose: prevClose || null,
      high52: high52 || null,
      currency: String(meta.currency ?? "USD").toUpperCase(),
    };
  } catch { return null; }
}

// ---- DDR5 market intel (Bing News RSS; advisory only) ----
// substring tokens (space-padded text); tuned to avoid collisions like
// "incr[ease]" or "a[gain]st" that would flip the wrong way.
const UP_WORDS = ["rising", "rise", "risen", "rises", "rose", "increas", "surg", "jump", "higher", "climb", "soar", "rally", "rallie", "spike", "spik", "hike", " gain", "quadrupl", "costlier", "shortage", "bullish", "record high", " up "];
const DN_WORDS = ["falling", "fall ", "falls", "fell", "drop", "declin", "lower", " down", " cut", "soften", "weaken", "slump", "plunge", "cooling", "correction", "oversupply", "glut", "bearish", "cheaper", "slowdown", "easing", "eased"];

function dirOf(text: string): "up" | "down" | "flat" {
  const t = " " + text.toLowerCase() + " ";
  let up = 0, dn = 0;
  for (const w of UP_WORDS) if (t.includes(w)) up++;
  for (const w of DN_WORDS) if (t.includes(w)) dn++;
  if (up > dn) return "up";
  if (dn > up) return "down";
  return "flat";
}
function stripTags(s: string): string { return s.replace(/<[^>]*>/g, ""); }
function clean(s: string): string {
  let x = s.replaceAll("<![CDATA[", "").replaceAll("]]>", "");
  x = stripTags(x);
  return x.replaceAll("&amp;", "&").replaceAll("&#39;", "'").replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&nbsp;", " ").trim();
}
function between(s: string, open: string, close: string): string {
  const i = s.indexOf(open); if (i < 0) return "";
  const j = s.indexOf(close, i + open.length); if (j < 0) return "";
  return s.slice(i + open.length, j);
}
async function fetchDdr5Intel() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(
      "https://www.bing.com/news/search?q=DDR5+DRAM+contract+price&format=rss",
      { headers: { "User-Agent": UA, "Accept": "application/rss+xml,application/xml" }, signal: ctrl.signal },
    );
    clearTimeout(timer);
    if (!r.ok) return null;
    const body = await r.text();
    const segs = body.split("<item>").slice(1);
    const items = segs.map((raw) => {
      const seg = raw.split("</item>")[0];
      const title = clean(between(seg, "<title>", "</title>"));
      const desc = clean(between(seg, "<description>", "</description>"));
      const date = clean(between(seg, "<pubDate>", "</pubDate>"));
      const url = between(seg, "<link>", "</link>").replaceAll("&amp;", "&").trim();
      const ts = Date.parse(date) || 0;
      return { title, url, date, ts, dir: dirOf(title + " " + desc) };
    }).filter((x) => x.title);
    if (!items.length) return null;
    items.sort((a, b) => b.ts - a.ts);
    const top = items.slice(0, 6);
    const votes = { up: 0, down: 0, flat: 0 };
    for (const it of top) votes[it.dir]++;
    let read = "flat";
    if (votes.up > votes.down) read = "up";
    else if (votes.down > votes.up) read = "down";
    else if (votes.up > 0 && votes.up === votes.down) read = "mixed";
    return {
      asOf: new Date().toISOString(),
      source: "Bing News",
      read,
      votes,
      headlines: top.map((it) => ({ title: it.title, url: it.url, date: it.date, dir: it.dir })),
    };
  } catch { return null; }
}

// ---- Semiconductor news reading list (Bing News RSS; INERT) ----
//
// Deliberately distinct from fetchDdr5Intel() above: that one infers a
// direction (dirOf) and feeds an advisory read + logging suggestion. This one
// infers NOTHING. It is a reading list for the News tab and must never
// influence the verdict, the trigger, or fin_contract_log. Do not reuse
// dirOf() here — its absence is what makes "inert" structurally true.
//
// mkt=en-us is PINNED. Without it Bing geolocates by CALLER IP, and this runs
// on the Seoul edge (ap-northeast-2) — unpinned it serves a non-US feed.
const NEWS_QUERIES = ["semiconductor industry", "DRAM memory chip prices", "chip stocks"];
const NEWS_IMG = "&w=640&h=360&c=14"; // fills Bing's News:ImageSize template (w={0}&h={1}&c=14)

// <link> is a Bing redirect wrapper; the publisher URL is its `url` param.
// Dedupe MUST use this, not the wrapper — the wrapper carries a per-request
// `tid`, so the same article from two queries yields two different wrappers.
function realUrl(link: string): string {
  try {
    const real = new URL(link).searchParams.get("url"); // URLSearchParams decodes
    return real && /^https?:\/\//i.test(real) ? real : link;
  } catch { return link; }
}

// News:Image is served over http:// — the app is https, so the browser blocks
// it as mixed content and every thumbnail silently vanishes. Rewrite it.
function newsImage(raw: string): string | null {
  if (!raw) return null;
  const base = raw.trim().replace(/^http:\/\//i, "https://");
  return /^https:\/\//i.test(base) ? base + NEWS_IMG : null;
}

const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Near-duplicate guard. Exact-title dedupe is not enough: the same event gets
// four different headlines ("Oregon lands $160M award" / "Oregon secures $160M
// to cement its future" / ...), which ate 3 of 10 slots on the first live run.
// Jaccard over significant tokens collapses those to one.
const STOP = new Set(["the","a","an","and","for","to","of","in","on","as","is","at","by","with","from","its","it","this","that","will","be","are","was","new","says","after","amid","into","out","up","down"]);
const titleTokens = (t: string) =>
  new Set(normTitle(t).split(" ").filter((w) => w.length > 2 && !STOP.has(w)));

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

async function fetchBingNews(q: string) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(
      `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&mkt=en-us`,
      { headers: { "User-Agent": UA, "Accept": "application/rss+xml,application/xml" }, signal: ctrl.signal },
    );
    clearTimeout(timer);
    if (!r.ok) return [];
    const body = await r.text();
    return body.split("<item>").slice(1).map((raw) => {
      const seg = raw.split("</item>")[0];
      const date = clean(between(seg, "<pubDate>", "</pubDate>"));
      return {
        title: clean(between(seg, "<title>", "</title>")),
        url: realUrl(between(seg, "<link>", "</link>").replaceAll("&amp;", "&").trim()),
        image: newsImage(between(seg, "<News:Image>", "</News:Image>").replaceAll("&amp;", "&")),
        source: clean(between(seg, "<News:Source>", "</News:Source>")),
        date,
        ts: Date.parse(date) || 0,
      };
    }).filter((x) => x.title && x.url);
  } catch { return []; } // one dead query must not kill the merge
}

async function fetchSemiNews() {
  try {
    // Each query's results, newest-first within the query.
    const perQuery = (await Promise.all(NEWS_QUERIES.map(fetchBingNews)))
      .map((list) => list.sort((a, b) => b.ts - a.ts));

    // ROUND-ROBIN across queries, not a flat recency sort. A flat sort lets
    // whichever query happens to be freshest flood the list — the first live
    // run returned 4/10 Oregon funding stories from the broad query alone.
    // Interleaving guarantees each query contributes ~a third of the reading
    // list, which is the whole point of blending industry + memory + stocks.
    const seenUrl = new Set<string>();
    const keptTokens: Set<string>[] = [];
    const items: Awaited<ReturnType<typeof fetchBingNews>> = [];
    const depth = Math.max(0, ...perQuery.map((l) => l.length));

    for (let i = 0; i < depth && items.length < 10; i++) {
      for (const list of perQuery) {
        if (items.length >= 10) break;
        const it = list[i];
        if (!it) continue;

        const uk = it.url.split("#")[0].toLowerCase();
        if (seenUrl.has(uk)) continue;
        const tk = titleTokens(it.title);
        if (keptTokens.some((k) => jaccard(tk, k) >= 0.5)) continue; // same story, new headline

        seenUrl.add(uk);
        keptTokens.push(tk);
        items.push(it);
      }
    }

    items.sort((a, b) => b.ts - a.ts); // display order: newest first
    return items.length
      ? { asOf: new Date().toISOString(), source: "Bing News", queries: NEWS_QUERIES, items }
      : null;
  } catch { return null; }
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const key = Deno.env.get("FINNHUB_API_KEY");
  if (!key) return json({ error: "FINNHUB_API_KEY not set" }, 500);

  // 1) Config -----------------------------------------------------
  const { data: cfg, error: cErr } = await supabase
    .from("fin_app_config").select("*").eq("id", 1).maybeSingle();
  if (cErr || !cfg) return json({ error: cErr?.message ?? "no fin_app_config row" }, 500);

  const tickers: string[] = cfg.tickers ?? ["MU", "SNDK", "WDC", "DRAM"];
  const peaks = cfg.peaks ?? {};
  const entryLevels = cfg.entry_levels ?? {};
  const watchLevels = cfg.watch_levels ?? {};

  const reasons: string[] = [];
  let verdict = "HOLD";
  const rank: Record<string, number> = { HOLD: 0, WATCH: 1, ENTRY: 2, CAUTION: 3 };
  const escalate = (to: string) => { if (rank[to] > rank[verdict]) verdict = to; };

  // 2) Quotes -> prices jsonb + level checks ----------------------
  const prices: Record<string, any> = {};
  const trackedPeaks: Record<string, number> = { ...peaks };
  let peaksChanged = false;
  for (const t of tickers) {
    try {
      // Finnhub stays primary for the US names (it's the live intraday feed).
      // Yahoo is always fetched too: it carries the 52-week high and currency,
      // and is the price fallback for anything Finnhub's free tier misses.
      const q = await fetch(`${FINNHUB}/quote?symbol=${encodeURIComponent(t)}&token=${key}`)
        .then((r) => r.json())
        .catch(() => null);
      const y = await yahooQuote(t);

      const finnhubPrice = q && typeof q.c === "number" && q.c !== 0 ? q.c : null;
      const price = finnhubPrice ?? y?.price ?? null;
      if (!price) { prices[t] = { error: true }; continue; }

      const source = finnhubPrice ? "finnhub" : "yahoo";
      const currency = y?.currency ?? "USD";
      const prevClose = (finnhubPrice ? Number(q.pc) : y?.prevClose) || null;
      const dayChangePct = finnhubPrice
        ? (typeof q.dp === "number" ? q.dp : 0)
        : (prevClose ? ((price - prevClose) / prevClose) * 100 : 0);

      const prevPeak = Number(peaks[t]) || 0;
      const peak = Math.max(prevPeak, y?.high52 ?? 0, price);
      if (peak !== prevPeak) { trackedPeaks[t] = peak; peaksChanged = true; }
      const drawdown = peak > 0 ? ((peak - price) / peak) * 100 : 0;

      prices[t] = { price, peak, drawdown, prevClose, dayChangePct, currency, source };

      // Levels are stored in each ticker's own listing currency — no FX
      // conversion anywhere, so a KRW level only ever compares to a KRW price.
      const entry = Number(entryLevels[t]) || 0;
      const watch = Number(watchLevels[t]) || 0;
      if (entry && price <= entry) {
        reasons.push(`${t} at ${price} ${currency} — at/below your entry level ${entry}.`);
        escalate("ENTRY");
      } else if (watch && price <= watch) {
        reasons.push(`${t} at ${price} ${currency} — nearing your watch level ${watch}.`);
        escalate("WATCH");
      }
    } catch (_) { prices[t] = { error: true }; }
  }

  if (peaksChanged) {
    await supabase.from("fin_app_config").update({ peaks: trackedPeaks }).eq("id", 1);
  }

  // 3) Catalysts within 3 days ------------------------------------
  const now = Date.now();
  const { data: cats } = await supabase
    .from("fin_catalysts").select("*").eq("done", false).not("event_date", "is", null);
  for (const c of cats ?? []) {
    const d = daysBetween(new Date(c.event_date).getTime(), now);
    if (d >= 0 && d <= 3) {
      reasons.push(`${c.label} in ${d === 0 ? "today" : d + " day(s)"} (${c.event_date}).`);
      escalate("WATCH");
    }
  }

  // 4) Contract log: staleness + the bear trigger -----------------
  const { data: log } = await supabase
    .from("fin_contract_log").select("direction, logged_at")
    .order("logged_at", { ascending: false }).limit(2);
  if (log?.length) {
    const stale = daysBetween(now, new Date(log[0].logged_at).getTime());
    if (stale > (cfg.stale_days ?? 40)) {
      reasons.push(`No contract-price print logged in ${stale} days — check TrendForce.`);
      escalate("WATCH");
    }
  }
  if (log?.length === 2 && log[0].direction === "down" && log[1].direction === "down") {
    reasons.push("DDR5 contract prices: two consecutive DOWN prints — bear trigger fired.");
    escalate("CAUTION");
  }

  // 5) DDR5 market intel (advisory) + news reading list (inert) ---
  // Sequential, not Promise.all'd together: fetchSemiNews already puts 3
  // requests on Bing at once, and 4 concurrent from one IP invites throttling.
  const intel = await fetchDdr5Intel();
  const news = await fetchSemiNews();

  // 6) Write the daily snapshot -----------------------------------
  const today = new Date().toISOString().slice(0, 10);
  const headline = HEADLINES[verdict];
  const { error: wErr } = await supabase.from("fin_snapshots").upsert({
    snapshot_date: today, prices, verdict, headline, reasons,
    intel: intel ?? {},
    // Omit `news` entirely when the fetch failed, rather than writing {}.
    // PostgREST builds ON CONFLICT DO UPDATE SET from the keys present, so an
    // absent key preserves the stored blob. Writing {} would let one failed
    // "Refresh now" blank the whole News tab until tomorrow's cron.
    ...(news ? { news } : {}),
  }, { onConflict: "snapshot_date" });
  if (wErr) return json({ error: wErr.message }, 500);

  return json({ date: today, verdict, headline, reasons, prices, intel, news });
});
