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

  // 5) DDR5 market intel (advisory only) --------------------------
  const intel = await fetchDdr5Intel();

  // 6) Write the daily snapshot -----------------------------------
  const today = new Date().toISOString().slice(0, 10);
  const headline = HEADLINES[verdict];
  const { error: wErr } = await supabase.from("fin_snapshots").upsert({
    snapshot_date: today, prices, verdict, headline, reasons, intel: intel ?? {},
  }, { onConflict: "snapshot_date" });
  if (wErr) return json({ error: wErr.message }, 500);

  return json({ date: today, verdict, headline, reasons, prices, intel });
});
