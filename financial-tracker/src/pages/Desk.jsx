import { useState, useRef } from "react";
import { Activity, TrendingDown, CalendarClock, Newspaper } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Card, CardHeader, StatCard, StatusBadge, EmptyState, DataRow, Textarea, cn } from "../components/ui";
import { cycleRead, NAMES, fmtMoney } from "../lib/signal";

export default function Desk({ snap, log, cats, cfg }) {
  const prices = snap?.prices || {};
  const read = cycleRead(log.map((l) => l.direction), log[0]?.note);
  const pending = cats.filter((c) => !c.done);
  const verdict = snap?.verdict ?? "none";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Today's verdict"
          value={snap ? VERDICT_LABELS[snap.verdict] ?? snap.verdict : "—"}
          accent={STAT_ACCENTS[verdict] ?? STAT_ACCENTS.none}
          icon={<Activity className="h-5 w-5" />}
        />
        <StatCard
          label="Cycle position"
          value={read.short}
          accent={read.tone === "bad" ? "bg-red-50 text-red-600" : read.tone === "warn" ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"}
          icon={<TrendingDown className="h-5 w-5" />}
        />
        <StatCard
          label="Contract prints logged"
          value={log.length}
          accent="bg-indigo-50 text-indigo-600"
          icon={<Newspaper className="h-5 w-5" />}
        />
        <StatCard
          label="Catalysts pending"
          value={pending.length}
          accent="bg-amber-50 text-amber-600"
          icon={<CalendarClock className="h-5 w-5" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <VerdictCard snap={snap} />
          <PricesCard snap={snap} prices={prices} />
          <ContractCard read={read} log={log} intel={snap?.intel} />
        </div>

        <div className="space-y-6">
          <CycleCard read={read} />
          <CatalystsCard pending={pending} />
          <JournalCard initial={cfg?.journal} />
        </div>
      </div>
    </div>
  );
}

const VERDICT_LABELS = { HOLD: "Hold", WATCH: "Watch", ENTRY: "Entry", CAUTION: "Caution" };

const STAT_ACCENTS = {
  HOLD: "bg-emerald-50 text-emerald-600",
  WATCH: "bg-amber-50 text-amber-600",
  ENTRY: "bg-indigo-50 text-indigo-600",
  CAUTION: "bg-red-50 text-red-600",
  none: "bg-slate-100 text-slate-400",
};

/* ---------------- verdict ---------------- */

function VerdictCard({ snap }) {
  if (!snap) {
    return (
      <Card>
        <CardHeader title="Today's verdict" subtitle="One verdict a day — the system defaults to Hold and only escalates" />
        <EmptyState
          icon={<Activity className="h-5 w-5" />}
          title="No snapshot yet"
          subtitle="Hit “Refresh now” to compute today's verdict. Everything below is driven by your log and works without it."
        />
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader
        title="Today's verdict"
        subtitle="One verdict a day — the system defaults to Hold and only escalates"
        action={<StatusBadge status={snap.verdict} />}
      />
      <div className="px-5 py-4">
        <p className="text-sm font-medium text-slate-800">{snap.headline}</p>
        <p className="mt-1 text-xs text-slate-400">Snapshot {snap.snapshot_date}</p>
        {snap.reasons?.length > 0 && (
          <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4">
            {snap.reasons.map((r, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-slate-600">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                {r}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/* ---------------- prices ---------------- */

function PricesCard({ snap, prices }) {
  const entries = Object.entries(prices);
  return (
    <Card>
      <CardHeader title="Prices & drawdown from peak" subtitle="Peak is the 52-week high, auto-tracked and ratcheted" />
      {!snap || entries.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-slate-400">
          Prices load once the daily snapshot runs.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-b-xl bg-slate-100 sm:grid-cols-2">
          {entries.map(([t, d]) => <PriceCell key={t} t={t} d={d} />)}
        </div>
      )}
    </Card>
  );
}

// Drawdown thresholds carry the meaning here: the historical memory-cycle
// bottom zone is roughly −40/−60%, so the colour ramps toward it.
function ddTone(dd) {
  if (dd >= 40) return { text: "text-red-600", bar: "bg-red-500" };
  if (dd >= 25) return { text: "text-amber-600", bar: "bg-amber-500" };
  if (dd >= 12) return { text: "text-yellow-600", bar: "bg-yellow-500" };
  return { text: "text-emerald-600", bar: "bg-emerald-500" };
}

function PriceCell({ t, d }) {
  const name = NAMES[t];
  if (d.error) {
    return (
      <div className="bg-white px-5 py-4">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold text-slate-900">{t}</span>
          {name && <span className="truncate text-xs text-slate-400">{name}</span>}
        </div>
        <p className="mt-2 text-sm text-slate-400">Unavailable</p>
      </div>
    );
  }
  const dd = d.drawdown ?? 0;
  const tone = ddTone(dd);
  const up = (d.dayChangePct ?? 0) >= 0;
  return (
    <div className="bg-white px-5 py-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-sm font-semibold text-slate-900">{t}</span>
            {name && <span className="truncate text-xs text-slate-400">{name}</span>}
          </div>
          <p className="mt-1 font-mono text-xl font-semibold text-slate-900">
            {fmtMoney(d.price, d.currency)}
          </p>
        </div>
        <div className="text-right">
          <p className={cn("font-mono text-sm font-semibold", tone.text)}>−{dd.toFixed(0)}%</p>
          <p className={cn("mt-0.5 font-mono text-xs", up ? "text-emerald-600" : "text-red-600")}>
            {up ? "▲" : "▼"} {Math.abs(d.dayChangePct ?? 0).toFixed(2)}%
          </p>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${Math.min(100, dd)}%` }} />
      </div>
      <p className="mt-2 font-mono text-[11px] text-slate-400">
        peak {fmtMoney(d.peak, d.currency)} · −40/−60% avg zone
      </p>
    </div>
  );
}

/* ---------------- cycle meter ---------------- */

function CycleCard({ read }) {
  const tone = read.tone === "bad" ? "text-red-600" : read.tone === "warn" ? "text-amber-600" : "text-emerald-600";
  const marker = read.tone === "bad" ? "bg-red-500" : read.tone === "warn" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <Card>
      <CardHeader title="Cycle position" subtitle="Derived from your contract log" />
      <div className="px-5 py-4">
        <p className={cn("text-lg font-semibold", tone)}>{read.name}</p>
        <p className="mt-1 text-sm text-slate-500">{read.note}</p>
        <div className="relative mt-5 h-2 rounded-full bg-gradient-to-r from-emerald-200 via-amber-200 to-red-200">
          <div
            className={cn("absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white", marker)}
            style={{ left: `${read.pos}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-[10px] font-medium text-slate-400">
          <span>Rising</span><span>Decelerating</span><span>Cooling</span><span>Downturn</span>
        </div>
      </div>
    </Card>
  );
}

/* ---------------- contract trigger ---------------- */

const TRIGGER_TEXT = {
  bad: "Trigger fired · two consecutive declines",
  warn: "Watch · momentum fading — one more Down print confirms the trigger",
  good: "Safe · no bear trigger — contract prices firm",
};

const TRIGGER_STYLE = {
  bad: "bg-red-50 text-red-700 ring-red-600/20",
  warn: "bg-amber-50 text-amber-700 ring-amber-600/20",
  good: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
};

function ContractCard({ read, log, intel }) {
  return (
    <Card>
      <CardHeader title="DDR5 contract trigger" subtitle="Trigger = two consecutive Down prints. Add prints in Settings." />
      <div className="space-y-4 px-5 py-4">
        <div className={cn("rounded-lg px-3.5 py-2.5 text-xs font-semibold ring-1 ring-inset", TRIGGER_STYLE[read.tone])}>
          {TRIGGER_TEXT[read.tone]}
        </div>
        <MarketRead intel={intel} />
      </div>
      {log.length > 0 && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {log.map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-5 py-3">
              <span className="w-24 shrink-0 font-mono text-xs text-slate-500">{l.period}</span>
              <StatusBadge status={l.direction} />
              {l.note && <span className="truncate text-xs text-slate-400">{l.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// "Fri, 10 Jul 2026 06:31:21 GMT" -> "10 Jul"
function fmtNewsDate(d) {
  if (!d) return "";
  const m = d.replace(/^\w+,\s*/, "").match(/^(\d{1,2}\s+\w{3})/);
  return m ? m[1] : d.slice(0, 11);
}

const READ_LABELS = { up: "Prices rising", down: "Prices softening", flat: "Flat", mixed: "Mixed signals" };

// Auto-crawled DDR5/DRAM news read (advisory — does NOT set the verdict/trigger).
function MarketRead({ intel }) {
  if (!intel?.headlines?.length) return null;
  const v = intel.votes || {};
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3.5 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Auto market read</span>
        <StatusBadge status={intel.read} />
        <span className="ml-auto font-mono text-[11px] text-slate-400">
          {v.up || 0} ▲ · {v.down || 0} ▼ · {v.flat || 0} –
        </span>
      </div>
      <ul className="divide-y divide-slate-200/70">
        {intel.headlines.map((h, i) => (
          <li key={i}>
            <a
              href={h.url}
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-white"
            >
              <StatusBadge status={h.dir} dot={false} />
              <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{h.title}</span>
              <span className="shrink-0 font-mono text-[11px] text-slate-400">{fmtNewsDate(h.date)}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-400">
        Auto-crawled from news ({intel.source}) — a market read, not the contract print itself. Log the actual
        TrendForce/DRAMeXchange direction; your manual log is the trigger.
      </p>
    </div>
  );
}

/* ---------------- catalysts ---------------- */

function CatalystsCard({ pending }) {
  return (
    <Card>
      <CardHeader title="Catalysts" subtitle="Upcoming events worth watching" />
      {pending.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-slate-400">Nothing pending</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {pending.map((c) => (
            <li key={c.id} className="px-5 py-3.5">
              <div className="flex items-baseline gap-2.5">
                <span className="shrink-0 font-mono text-[11px] text-slate-400">{c.event_date || "TBC"}</span>
                <span className="text-sm font-medium text-slate-800">{c.label}</span>
              </div>
              {c.detail && <p className="mt-1 text-xs text-slate-500">{c.detail}</p>}
              {c.note && (
                <p className="mt-1.5 rounded-md bg-indigo-50 px-2.5 py-1.5 text-xs text-indigo-700">{c.note}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ---------------- journal ---------------- */

// Debounced autosave to the single config row. Lives on the Desk (not Settings)
// on purpose — it's used at the desk, in the moment.
function JournalCard({ initial }) {
  const [val, setVal] = useState(initial || "");
  const [status, setStatus] = useState("idle");
  const timer = useRef();

  function onChange(e) {
    const v = e.target.value;
    setVal(v);
    setStatus("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const { error } = await supabase.from("fin_app_config")
        .update({ journal: v, updated_at: new Date() }).eq("id", 1);
      setStatus(error ? "error" : "saved");
    }, 600);
  }

  return (
    <Card>
      <CardHeader title="Decision journal" subtitle="Autosaves to Supabase" />
      <div className="space-y-2 px-5 py-4">
        <Textarea
          rows={7}
          value={val}
          onChange={onChange}
          placeholder="Your thesis, entry rules, and what would change your mind. e.g. 'Scale in 1/3 now, 1/3 if MU holds $900, hold the last third until a contract-price print confirms direction.'"
        />
        <DataRow
          label="Status"
          value={
            status === "saving" ? "Saving…"
              : status === "saved" ? "Saved"
              : status === "error" ? "Save failed — apply the 0002 migration"
              : "Autosaves"
          }
          tone={status === "error" ? "bad" : status === "saved" ? "good" : undefined}
        />
      </div>
    </Card>
  );
}
