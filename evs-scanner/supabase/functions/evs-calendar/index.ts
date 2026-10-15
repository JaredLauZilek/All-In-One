// evs-calendar — upcoming US earnings for the Scanner's calendar panel.
//
// Source: Finnhub /calendar/earnings (free tier; FINNHUB_API_KEY is already a
// project secret for fin-daily-signal). Finnhub lists EVERY reporter incl.
// micro-caps, so entries are kept only when the revenue estimate is ≥ $1B — a
// liquidity proxy for "has options worth selling" — and capped per day.
// Logos are resolved client-side (no API: financialmodelingprep image-stock).
//
// POST { days?: number (default 14, max 30) }
// → { from, to, days: [{ date, events: [{ symbol, hour, epsEstimate, revenueEstimate }] }] }
// Deployed verify_jwt: true. Response cached in-isolate for 30 min.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MIN_REVENUE = 1_000_000_000;
const PER_DAY = 12;
const TTL_MS = 30 * 60_000;
const cache = new Map<string, { at: number; body: unknown }>();

interface FhEvent { date: string; symbol: string; hour?: string; epsEstimate?: number | null; revenueEstimate?: number | null }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const key = Deno.env.get("FINNHUB_API_KEY");
    if (!key) return json({ error: "FINNHUB_API_KEY not set" }, 500);
    const body = await req.json().catch(() => ({}));
    const days = Math.min(30, Math.max(1, Number(body.days) || 14));
    // US calendar days; from = today (US-ish: UTC date is close enough for a list)
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
    const ck = `${from}:${to}`;
    const hit = cache.get(ck);
    if (hit && Date.now() - hit.at < TTL_MS) return json(hit.body);

    const r = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${key}`);
    if (!r.ok) return json({ error: `Finnhub HTTP ${r.status}` }, 502);
    const data = await r.json();
    const all = ((data.earningsCalendar ?? []) as FhEvent[])
      .filter((e) => e.symbol && !e.symbol.includes(".") && (e.revenueEstimate ?? 0) >= MIN_REVENUE);
    const byDate = new Map<string, FhEvent[]>();
    for (const e of all) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
    const out = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => ({
      date,
      events: list.sort((a, b) => (b.revenueEstimate ?? 0) - (a.revenueEstimate ?? 0)).slice(0, PER_DAY)
        .map((e) => ({ symbol: e.symbol, hour: e.hour ?? null, epsEstimate: e.epsEstimate ?? null, revenueEstimate: e.revenueEstimate ?? null })),
    }));
    const result = { from, to, days: out, source: "Finnhub earnings calendar · revenue est ≥ $1B" };
    cache.set(ck, { at: Date.now(), body: result });
    return json(result);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
