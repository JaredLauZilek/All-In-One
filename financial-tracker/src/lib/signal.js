// Display-only signal helpers.
//
// cycleRead() mirrors the edge function's contract-trigger dimension and adds
// finer cycle positioning for the meter. The VERDICT still comes ONLY from
// fin-daily-signal — nothing here decides it. Keep it that way.

// Display names under each ticker. DRAM is Roundhill's US-listed memory ETF,
// so it should resolve on Finnhub despite the "not an equity" caveat.
export const NAMES = {
  MU: "Micron Technology",
  SNDK: "SanDisk",
  WDC: "Western Digital",
  DRAM: "Roundhill Memory ETF",
};

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

// Settings edits levels as strings; the DB stores numbers.
export function numObj(o) {
  const out = {};
  for (const k in o) {
    const n = parseFloat(o[k]);
    if (!isNaN(n)) out[k] = n;
  }
  return out;
}
