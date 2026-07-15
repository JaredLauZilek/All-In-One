// Display-only signal helpers.
//
// cycleRead() mirrors the edge function's contract-trigger dimension and adds
// finer cycle positioning for the meter. The VERDICT still comes ONLY from
// fin-daily-signal — nothing here decides it. Keep it that way.

// Display names under each ticker. DRAM is Roundhill's US-listed memory ETF,
// so it should resolve on Finnhub despite the "not an equity" caveat.
//
// The two Korean names are the PRIMARY listings and price only via Yahoo —
// Finnhub's free tier doesn't cover them. Their US OTC ADRs were deliberately
// not added: SK Hynix's (HXSCL/HXSCY/SKHYF) return no data at all, and
// Samsung's (SSNLF) is stale to the point of being wrong (price == prevClose
// == 52w high). Don't "helpfully" add them back without checking a live quote.
export const NAMES = {
  MU: "Micron Technology",
  SNDK: "SanDisk",
  WDC: "Western Digital",
  DRAM: "Roundhill Memory ETF",
  "000660.KS": "SK Hynix · Seoul",
  "005930.KS": "Samsung Electronics · Seoul",
};

// Prices are shown in each listing's OWN currency — there is no FX conversion
// anywhere in this app, so a KRW price must never render behind a "$".
// Intl handles the per-currency decimal rules (USD 2dp, KRW 0dp).
export function fmtMoney(v, currency = "USD") {
  const n = Number(v);
  if (!isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {
    return `${n.toLocaleString()} ${currency}`;
  }
}

// `dirs` is newest-first. `tone` maps onto the shared design-system colours:
// good = emerald, warn = amber, bad = red. `short` is for the stat tile, which
// has room for one word; `name` + `note` carry the nuance on the cycle card.
export function cycleRead(dirs, latestNote = "") {
  const last = dirs[0] ?? "up";
  const prev = dirs[1] ?? "up";

  if (last === "down" && prev === "down")
    return {
      pos: 88, name: "Downturn confirmed", short: "Downturn", tone: "bad",
      note: "Two straight down prints — the classic tell for a cycle turn. Bear thesis validated.",
    };
  if (last === "down")
    return {
      pos: 66, name: "Cooling — watch", short: "Cooling", tone: "warn",
      note: "First down print. One more consecutive decline fires the trigger.",
    };
  if (last === "flat")
    return {
      pos: 48, name: "Deceleration", short: "Flattening", tone: "warn",
      note: "Prices flattening — momentum fading but not yet negative.",
    };
  if (/decel/i.test(latestNote || ""))
    return {
      pos: 30, name: "Rising, decelerating", short: "Rising", tone: "good",
      note: "Prices still up but the pace is slowing — mid-cycle, no turn yet.",
    };
  return {
    pos: 15, name: "Rising", short: "Rising", tone: "good",
    note: "Contract prices climbing — no cooling signal.",
  };
}

// "Fri, 10 Jul 2026 06:31:21 GMT" -> "10 Jul". Used by the Desk's intel panel,
// where a compact absolute date is what fits.
export function fmtNewsDate(d) {
  if (!d) return "";
  const m = d.replace(/^\w+,\s*/, "").match(/^(\d{1,2}\s+\w{3})/);
  return m ? m[1] : d.slice(0, 11);
}

// News cards want recency at a glance instead. Every item in the daily feed is
// usually <24h old, so "15 Jul" on all ten cards conveys nothing.
export function fmtAgo(ts) {
  const n = Number(ts);
  if (!isFinite(n) || !n) return "—";
  const mins = Math.floor((Date.now() - n) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  const d = Math.floor(mins / 1440);
  return d === 1 ? "Yesterday" : `${d}d ago`;
}

// Settings edits levels as strings; the DB stores numbers.
export function numObj(o) {
  const out = {};
  for (const k in o) {
    const n = parseFloat(o[k]);
    if (!isNaN(n)) out[k] = n;
  }
  return out;
}
