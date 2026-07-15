import { useState, useRef } from "react";
import { Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Card, CardHeader, Button, Input, Select, Textarea, StatusBadge, Switch, cn } from "../components/ui";
import { numObj, fmtMoney } from "../lib/signal";

export default function Settings({ cfg, log, cats, reload, intel, prices }) {
  return (
    <div className="space-y-6">
      <LevelsCard cfg={cfg} reload={reload} prices={prices} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <PrintsCard log={log} reload={reload} intel={intel} />
        <CatalystsCard cats={cats} reload={reload} />
      </div>
    </div>
  );
}

/* ---------------- levels ---------------- */

function LevelsCard({ cfg, reload, prices }) {
  const peaks = cfg?.peaks || {}; // auto-tracked by the edge function; read-only here
  const [entry, setEntry] = useState(cfg?.entry_levels || {});
  const [watch, setWatch] = useState(cfg?.watch_levels || {});
  const [saving, setSaving] = useState(false);
  const tickers = cfg?.tickers || ["MU", "SNDK", "WDC", "DRAM"];

  async function saveLevels() {
    setSaving(true);
    await supabase.from("fin_app_config").update({
      entry_levels: numObj(entry), watch_levels: numObj(watch), updated_at: new Date(),
    }).eq("id", 1);
    setSaving(false);
    reload();
  }

  return (
    <Card>
      <CardHeader
        title="Your levels"
        subtitle="Pre-commit sober, once. The daily verdict fires off these mechanically."
        action={<Button onClick={saveLevels} loading={saving}>{saving ? "Saving…" : "Save levels"}</Button>}
      />
      <div className="px-5 py-4">
        <p className="mb-4 text-xs leading-relaxed text-slate-500">
          <b>Entry</b> = the price you'd consider a decision point. <b>Watch</b> = getting close.
          <b> Peak</b> is auto-tracked — the 52-week high (via Yahoo), ratcheted up on new highs. You don't set it.
          Enter levels in each listing's <b>own currency</b> (shown per row) — nothing is FX-converted.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] max-w-2xl text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left">
                <Th>Ticker</Th>
                <Th>Peak · auto</Th>
                <Th>Entry ≤</Th>
                <Th>Watch ≤</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tickers.map((t) => {
                const ccy = prices?.[t]?.currency ?? "USD";
                return (
                <tr key={t}>
                  <td className="py-2.5 pr-3">
                    <span className="font-mono text-sm font-semibold text-slate-900">{t}</span>
                    <span className="ml-1.5 font-mono text-[10px] text-slate-400">{ccy}</span>
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-sm text-slate-400">
                    {peaks[t] != null && peaks[t] !== "" ? fmtMoney(peaks[t], ccy) : "—"}
                  </td>
                  <td className="py-2.5 pr-3">
                    <Input
                      className="font-mono"
                      value={entry[t] ?? ""}
                      onChange={(e) => setEntry({ ...entry, [t]: e.target.value })}
                    />
                  </td>
                  <td className="py-2.5">
                    <Input
                      className="font-mono"
                      value={watch[t] ?? ""}
                      onChange={(e) => setWatch({ ...watch, [t]: e.target.value })}
                    />
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

function Th({ children }) {
  return <th className="pb-2 pr-3 text-xs font-medium text-slate-500">{children}</th>;
}

/* ---------------- contract prints ---------------- */

function PrintsCard({ log, reload, intel }) {
  const suggested = intel && ["up", "down", "flat"].includes(intel.read) ? intel.read : null;
  const [period, setPeriod] = useState("");
  const [dir, setDir] = useState(suggested || "up");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function addPrint() {
    if (!period.trim()) return;
    setBusy(true);
    await supabase.from("fin_contract_log").insert({
      period: period.trim(), direction: dir, note: note.trim() || null,
    });
    setPeriod(""); setNote(""); setBusy(false);
    reload();
  }

  async function delPrint(id) {
    await supabase.from("fin_contract_log").delete().eq("id", id);
    reload();
  }

  return (
    <Card>
      <CardHeader title="Log a contract-price print" subtitle="The single highest-signal input — logged by hand, on purpose" />
      <div className="space-y-3 px-5 py-4">
        {suggested && (
          <div className="rounded-lg bg-slate-50 px-3 py-2.5">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500">News auto-read suggests</span>
              <StatusBadge status={suggested} />
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              A hint from headlines, not the print. Confirm against TrendForce/DRAMeXchange before logging.
            </p>
          </div>
        )}
        <Input placeholder="Period (Aug 2026)" value={period} onChange={(e) => setPeriod(e.target.value)} />
        <div className="flex gap-3">
          <Select value={dir} onChange={(e) => setDir(e.target.value)} className="max-w-[8rem]">
            <option value="up">Up</option>
            <option value="flat">Flat</option>
            <option value="down">Down</option>
          </Select>
          <Input placeholder="Note (+5% QoQ, decelerating)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button onClick={addPrint} loading={busy}>Log</Button>
        </div>
      </div>
      {log.length > 0 && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {log.map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-5 py-3">
              <span className="w-24 shrink-0 font-mono text-xs text-slate-500">{l.period}</span>
              <StatusBadge status={l.direction} />
              {l.note && <span className="truncate text-xs text-slate-400">{l.note}</span>}
              <button
                onClick={() => delPrint(l.id)}
                className="ml-auto shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                aria-label={`Delete ${l.period}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ---------------- catalysts ---------------- */

function CatalystsCard({ cats, reload }) {
  return (
    <Card>
      <CardHeader title="Catalysts" subtitle="Mark done and record the outcome" />
      {cats.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-slate-400">No catalysts</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {cats.map((c) => <CatalystRow key={c.id} c={c} reload={reload} />)}
        </ul>
      )}
    </Card>
  );
}

// One catalyst: toggle done + editable outcome note (debounced autosave).
function CatalystRow({ c, reload }) {
  const [note, setNote] = useState(c.note || "");
  const [status, setStatus] = useState("idle");
  const timer = useRef();

  async function toggle() {
    await supabase.from("fin_catalysts").update({ done: !c.done }).eq("id", c.id);
    reload();
  }

  function onNote(e) {
    const v = e.target.value;
    setNote(v);
    setStatus("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const { error } = await supabase.from("fin_catalysts").update({ note: v || null }).eq("id", c.id);
      setStatus(error ? "error" : "saved");
    }, 600);
  }

  return (
    <li className="px-5 py-3.5">
      <div className="flex items-start gap-3">
        <div className="pt-0.5">
          <Switch checked={!!c.done} onChange={toggle} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2.5">
            <span className="shrink-0 font-mono text-[11px] text-slate-400">{c.event_date || "TBC"}</span>
            <span className={cn("text-sm font-medium", c.done ? "text-slate-400 line-through" : "text-slate-800")}>
              {c.label}
            </span>
          </div>
          {c.detail && <p className="mt-1 text-xs text-slate-500">{c.detail}</p>}
          <Textarea
            rows={2}
            className="mt-2"
            value={note}
            onChange={onNote}
            placeholder="Outcome / notes…"
          />
          {status !== "idle" && (
            <p className={cn("mt-1 text-[11px]", status === "error" ? "text-red-600" : "text-slate-400")}>
              {status === "saving" ? "Saving…"
                : status === "saved" ? "Saved"
                : "Save failed — apply the 0002 migration (adds fin_catalysts.note)"}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}
