// ============================================================
//  evs-scan — Earnings Volatility Scanner (mini-app "evs")
//
//  POST { ticker, portfolio_value?, thresholds? }
//    -> { spot, earnings, filters, verdict, trade, termStructure, warnings }
//
//  Implements the three-filter model from the strategy guide
//  (docs/earnings-volatility-strategy-guide.md at the repo root):
//    1. term-structure slope (front -> 45d) must be <= TS_SLOPE_THRESHOLD
//    2. 30-day average share volume must be >= VOLUME_THRESHOLD
//    3. IV30 / RV30 (Yang-Zhang) must be >= IV_RV_THRESHOLD
//  Verdict: all 3 = RECOMMEND · slope + one other = CONSIDER · slope fails = AVOID.
//
//  Data source: Yahoo Finance unofficial endpoints (free, ~15min delayed).
//  The v7 options endpoint needs Yahoo's cookie+crumb dance from some hosts;
//  yahooSession() does it best-effort and every fetch falls back to crumbless.
//  Swap fetchOptionChain/fetchChart to move to a paid API (Polygon/ORATS).
// ============================================================

// Defaults from the strategy guide's backtest. The frontend passes the user's
// tuned values from evs_settings; these apply when it doesn't.
const TS_SLOPE_THRESHOLD = -0.00406;
const VOLUME_THRESHOLD = 1_500_000;
const IV_RV_THRESHOLD = 1.25;
const KELLY_FRACTION = 0.06; // 10% Kelly ≈ 6% of portfolio per calendar debit

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/* ---------------- Yahoo session (cookie + crumb) ---------------- */

let session: { cookie: string; crumb: string } | null = null;

async function yahooSession(): Promise<typeof session> {
  if (session) return session;
  try {
    const r = await fetch("https://fc.yahoo.com/", {
      redirect: "manual",
      headers: { "user-agent": UA },
    });
    const cookie = r.headers.get("set-cookie")?.split(";")[0] ?? "";
    if (!cookie) return null;
    const cr = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { cookie, "user-agent": UA },
    });
    const crumb = (await cr.text()).trim();
    if (!cr.ok || !crumb || crumb.includes("{")) return null;
    session = { cookie, crumb };
    return session;
  } catch {
    return null;
  }
}

async function yahooGet(url: string): Promise<any> {
  const s = await yahooSession();
  const sep = url.includes("?") ? "&" : "?";
  const attempts = s ? [`${url}${sep}crumb=${encodeURIComponent(s.crumb)}`, url] : [url];
  let lastErr = "";
  for (const u of attempts) {
    try {
      const r = await fetch(u, {
        headers: { "user-agent": UA, ...(s ? { cookie: s.cookie } : {}) },
      });
      if (r.ok) return await r.json();
      lastErr = `HTTP ${r.status}`;
    } catch (e) {
      lastErr = String(e);
    }
  }
  throw new Error(`Yahoo fetch failed (${lastErr}) for ${url.split("?")[0]}`);
}

function optionsUrl(ticker: string, dateEpoch?: number): string {
  const base = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}`;
  return dateEpoch ? `${base}?date=${dateEpoch}` : base;
}

/* ---------------- math helpers ---------------- */

interface OptQuote {
  strike: number;
  bid?: number;
  ask?: number;
  lastPrice?: number;
  impliedVolatility?: number;
}

function validIv(iv: number | undefined): boolean {
  return typeof iv === "number" && iv > 0.01 && iv < 5; // filter stale/garbage IVs
}

function mid(o: OptQuote | undefined): number | null {
  if (!o) return null;
  if (o.bid && o.ask && o.ask > 0 && o.bid > 0) return (o.bid + o.ask) / 2;
  if (o.lastPrice && o.lastPrice > 0) return o.lastPrice;
  return null;
}

function spreadPct(o: OptQuote | undefined): number | null {
  if (!o?.bid || !o?.ask || o.bid <= 0 || o.ask <= 0) return null;
  const m = (o.bid + o.ask) / 2;
  return m > 0 ? ((o.ask - o.bid) / m) * 100 : null;
}

// ATM IV for one expiration chain: average call+put IV at the strike closest
// to spot that carries valid IVs; walk outward if the nearest strike is junk.
function atmIv(calls: OptQuote[], puts: OptQuote[], spot: number):
  { iv: number; strike: number; call: OptQuote | null; put: OptQuote | null } | null {
  const strikes = [...new Set([...calls, ...puts].map((o) => o.strike))]
    .sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot));
  for (const k of strikes.slice(0, 8)) {
    const c = calls.find((o) => o.strike === k);
    const p = puts.find((o) => o.strike === k);
    const ivs = [c?.impliedVolatility, p?.impliedVolatility].filter(validIv) as number[];
    if (ivs.length) {
      return { iv: ivs.reduce((a, b) => a + b, 0) / ivs.length, strike: k, call: c ?? null, put: p ?? null };
    }
  }
  return null;
}

// Linear interpolation of ATM IV at an arbitrary DTE (clamped to endpoints).
function interpIv(term: { dte: number; iv: number }[], t: number): number | null {
  if (!term.length) return null;
  const pts = [...term].sort((a, b) => a.dte - b.dte);
  if (t <= pts[0].dte) return pts[0].iv;
  if (t >= pts[pts.length - 1].dte) return pts[pts.length - 1].iv;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (t >= a.dte && t <= b.dte) {
      return b.dte === a.dte ? a.iv : a.iv + ((b.iv - a.iv) * (t - a.dte)) / (b.dte - a.dte);
    }
  }
  return null;
}

// Yang-Zhang 30-day realized volatility, annualized. Uses OHLC and handles
// overnight gaps; falls back to close-to-close if OHLC is incomplete.
function yangZhang(candles: { o: number; h: number; l: number; c: number }[]): number | null {
  const n = candles.length - 1; // need a prior close for the first overnight
  if (n < 10) return null;
  const on: number[] = [], oc: number[] = [], rs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1], cur = candles[i];
    if ([prev.c, cur.o, cur.h, cur.l, cur.c].some((v) => !v || v <= 0)) return null;
    on.push(Math.log(cur.o / prev.c));
    oc.push(Math.log(cur.c / cur.o));
    rs.push(
      Math.log(cur.h / cur.o) * Math.log(cur.h / cur.c) +
      Math.log(cur.l / cur.o) * Math.log(cur.l / cur.c),
    );
  }
  const varOf = (xs: number[]) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  };
  const k = 0.34 / (1.34 + (n + 1) / (n - 1));
  const v = varOf(on) + k * varOf(oc) + (1 - k) * (rs.reduce((a, b) => a + b, 0) / rs.length);
  return v > 0 ? Math.sqrt(v * 252) : null;
}

function closeToCloseVol(closes: number[]): number | null {
  if (closes.length < 11) return null;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > 0 && closes[i - 1] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (rets.length < 10) return null;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1));
  return sd * Math.sqrt(252);
}

/* ---------------- handler ---------------- */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const ticker = String(body?.ticker ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9.^-]{1,12}$/.test(ticker)) return json({ error: "Invalid ticker" }, 400);

  const portfolio = Number(body?.portfolio_value) > 0 ? Number(body.portfolio_value) : 10000;
  const th = {
    slope: Number.isFinite(Number(body?.thresholds?.ts_slope)) ? Number(body.thresholds.ts_slope) : TS_SLOPE_THRESHOLD,
    volume: Number(body?.thresholds?.volume) > 0 ? Number(body.thresholds.volume) : VOLUME_THRESHOLD,
    ivRv: Number(body?.thresholds?.iv_rv) > 0 ? Number(body.thresholds.iv_rv) : IV_RV_THRESHOLD,
    kelly: Number(body?.thresholds?.kelly) > 0 ? Number(body.thresholds.kelly) : KELLY_FRACTION,
  };

  const warnings: string[] = [
    "Model reflects one creator's backtest (2007–present); thresholds may be stale and the edge may decay.",
  ];

  try {
    /* ---- base option chain + quote ---- */
    const base = (await yahooGet(optionsUrl(ticker)))?.optionChain?.result?.[0];
    if (!base) return json({ error: `No options data for ${ticker} — is it optionable?` }, 404);
    const quote = base.quote ?? {};
    const spot: number = quote.regularMarketPrice;
    if (!spot || spot <= 0) return json({ error: `No price for ${ticker}` }, 404);
    const expirations: number[] = base.expirationDates ?? [];
    if (!expirations.length) return json({ error: `No listed expirations for ${ticker}` }, 404);

    const nowSec = Date.now() / 1000;
    const earningsTs: number | null =
      quote.earningsTimestampStart ?? quote.earningsTimestamp ?? null;
    const earningsInDays = earningsTs ? (earningsTs - nowSec) / 86400 : null;
    const upcoming = earningsInDays !== null && earningsInDays > -1 && earningsInDays <= 21;
    if (!earningsTs) warnings.push("Yahoo reports no earnings date for this ticker.");
    else if (!upcoming) warnings.push("Next earnings are not within the coming 3 weeks — this is a preview, not a live setup.");

    /* ---- fetch chains out to ~70 DTE (front + 45d interp + back ≈ front+30) ---- */
    const wanted = expirations.filter((e) => (e - nowSec) / 86400 <= 70).slice(0, 8);
    if (wanted.length < 2) return json({ error: "Not enough near-dated expirations to build a term structure." }, 422);

    const chains: { exp: number; dte: number; calls: OptQuote[]; puts: OptQuote[] }[] = [];
    for (const exp of wanted) {
      const isBase = base.options?.[0]?.expirationDate === exp;
      const data = isBase ? base : (await yahooGet(optionsUrl(ticker, exp)))?.optionChain?.result?.[0];
      const o = data?.options?.[0];
      if (!o) continue;
      chains.push({
        exp,
        dte: Math.max(0.5, (exp - nowSec) / 86400),
        calls: o.calls ?? [],
        puts: o.puts ?? [],
      });
    }

    const term = chains
      .map((c) => ({ ...c, atm: atmIv(c.calls, c.puts, spot) }))
      .filter((c) => c.atm !== null);
    if (term.length < 2) return json({ error: "Could not read enough valid ATM implied vols (illiquid chain?)." }, 422);
    const termStructure = term.map((c) => ({ dte: Math.round(c.dte * 10) / 10, iv: c.atm!.iv }));

    /* ---- price history: volume + realized vol ---- */
    const chart = (await yahooGet(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=3mo&interval=1d`,
    ))?.chart?.result?.[0];
    const q = chart?.indicators?.quote?.[0] ?? {};
    const candles: { o: number; h: number; l: number; c: number; v: number }[] =
      (chart?.timestamp ?? [])
        .map((_: number, i: number) => ({
          o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i], v: q.volume?.[i],
        }))
        .filter((x: any) => x.c > 0);
    if (candles.length < 20) return json({ error: "Not enough price history for realized vol / volume." }, 422);

    const vols = candles.slice(-30).map((x) => x.v).filter((v) => v > 0);
    const avgVolume30 = vols.reduce((a, b) => a + b, 0) / Math.max(1, vols.length);

    const last31 = candles.slice(-31);
    let rv30 = yangZhang(last31);
    let rvMethod = "yang-zhang";
    if (rv30 === null) {
      rv30 = closeToCloseVol(last31.map((x) => x.c));
      rvMethod = "close-to-close";
      warnings.push("OHLC data incomplete — realized vol fell back to close-to-close.");
    }
    if (rv30 === null) return json({ error: "Could not compute 30-day realized volatility." }, 422);

    /* ---- the three predictors ---- */
    // Front expiration = first expiry after the earnings event (or the nearest
    // expiry when no earnings date is known — preview mode).
    const front = (earningsTs ? term.find((c) => c.exp > earningsTs) : term[0]) ?? term[0];
    const iv45 = interpIv(termStructure, 45);
    const iv30 = interpIv(termStructure, 30);
    if (iv45 === null || iv30 === null) return json({ error: "Term structure interpolation failed." }, 422);

    let slope: number | null = null;
    if (front.dte < 44) slope = (iv45 - front.atm!.iv) / (45 - front.dte);
    else warnings.push("Front expiration is already ≥ 45 DTE — slope filter not meaningful.");

    const ivRv = iv30 / rv30;

    const slopePass = slope !== null && slope <= th.slope;
    const volumePass = avgVolume30 >= th.volume;
    const ivRvPass = ivRv >= th.ivRv;

    const verdict = slopePass && volumePass && ivRvPass
      ? "RECOMMEND"
      : slopePass && (volumePass || ivRvPass)
        ? "CONSIDER"
        : "AVOID"; // slope failing always means AVOID

    /* ---- calendar-spread construction ---- */
    let trade: any = null;
    const backTarget = front.dte + 30;
    const back = term
      .filter((c) => c.exp > front.exp)
      .sort((a, b) => Math.abs(a.dte - backTarget) - Math.abs(b.dte - backTarget))[0];

    if (back) {
      const strike = front.atm!.strike;
      const fCall = front.calls.find((o) => o.strike === strike);
      const bCall = back.calls.find((o) => o.strike === strike);
      const fPut = front.puts.find((o) => o.strike === strike);
      const bPut = back.puts.find((o) => o.strike === strike);

      // Pick the side (call vs put) where both legs quote and spreads are tighter.
      const side = (() => {
        const cOk = mid(fCall) !== null && mid(bCall) !== null;
        const pOk = mid(fPut) !== null && mid(bPut) !== null;
        if (cOk && !pOk) return "call";
        if (pOk && !cOk) return "put";
        if (!cOk && !pOk) return null;
        const cSpread = (spreadPct(fCall) ?? 99) + (spreadPct(bCall) ?? 99);
        const pSpread = (spreadPct(fPut) ?? 99) + (spreadPct(bPut) ?? 99);
        return cSpread <= pSpread ? "call" : "put";
      })();

      if (side) {
        const f = side === "call" ? fCall! : fPut!;
        const b = side === "call" ? bCall! : bPut!;
        const debit = (mid(b) ?? 0) - (mid(f) ?? 0);
        const straddle = (mid(fCall) ?? 0) + (mid(fPut) ?? 0);
        const budget = portfolio * th.kelly;
        const contracts = debit > 0 ? Math.floor(budget / (debit * 100)) : 0;

        for (const [leg, o] of [["front", f], ["back", b]] as const) {
          const sp = spreadPct(o);
          if (sp !== null && sp > 10) warnings.push(`Wide bid/ask on the ${leg} leg (${sp.toFixed(0)}% of mid) — slippage will eat the edge.`);
        }
        if (debit <= 0) warnings.push("Computed debit is zero/negative — quotes look unreliable; re-check near the close.");
        else if (debit * 100 > budget) warnings.push(`One contract ($${(debit * 100).toFixed(0)}) exceeds your ${(th.kelly * 100).toFixed(0)}% budget ($${budget.toFixed(0)}) — skip rather than oversize.`);

        trade = {
          structure: "calendar",
          side,
          strike,
          frontExpiry: new Date(front.exp * 1000).toISOString().slice(0, 10),
          backExpiry: new Date(back.exp * 1000).toISOString().slice(0, 10),
          frontDte: Math.round(front.dte * 10) / 10,
          backDte: Math.round(back.dte * 10) / 10,
          debit: Math.round(debit * 100) / 100,
          impliedMovePct: straddle > 0 ? Math.round((straddle / spot) * 1000) / 10 : null,
          budget: Math.round(budget),
          contracts,
          entryHint: "Enter ~15 min before the last US market close before the announcement.",
          exitHint: "Close the whole spread ~15 min after the first US open after earnings — win or lose.",
        };
      } else {
        warnings.push("No quotable ATM legs for a calendar at the moment (market closed or illiquid).");
      }
    } else {
      warnings.push("No suitable back-month expiration (~30d behind the front) found.");
    }

    return json({
      ticker,
      spot,
      asOf: new Date().toISOString(),
      dataSource: "Yahoo Finance (unofficial, ~15 min delayed)",
      earnings: earningsTs
        ? { ts: earningsTs, inDays: Math.round((earningsInDays ?? 0) * 10) / 10, upcoming }
        : null,
      filters: {
        tsSlope: { value: slope, threshold: th.slope, pass: slopePass },
        avgVolume30: { value: Math.round(avgVolume30), threshold: th.volume, pass: volumePass },
        ivRv: { value: Math.round(ivRv * 100) / 100, iv30, rv30, rvMethod, threshold: th.ivRv, pass: ivRvPass },
      },
      verdict,
      trade,
      termStructure,
      warnings,
    });
  } catch (e) {
    return json({ error: `Scan failed: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }
});
