import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, CalendarClock, TrendingDown, BarChart3, Percent, NotebookPen, AlertTriangle, Check } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Button, Card, CardHeader, Input, StatusBadge, DataRow, EmptyState, cn } from "../../components/ui";
import { fmtVolume, fmtZoned, type ScanResult, type EvsSettings } from "./lib";

// Settings row is created lazily with defaults on first read (same pattern as
// the Restock Monitor's settings page).
export function useEvsSettings() {
  return useQuery({
    queryKey: ["evs-settings"],
    queryFn: async (): Promise<EvsSettings> => {
      const { data, error } = await supabase.from("evs_settings").select("*").maybeSingle();
      if (error) throw error;
      if (data) return data as EvsSettings;
      const uid = (await supabase.auth.getUser()).data.user!.id;
      const { data: inserted, error: insErr } = await supabase
        .from("evs_settings").insert({ user_id: uid }).select().single();
      if (insErr) throw insErr;
      return inserted as EvsSettings;
    },
    refetchInterval: false,
  });
}

export default function Scanner() {
  const qc = useQueryClient();
  const { data: settings } = useEvsSettings();
  const [ticker, setTicker] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [logged, setLogged] = useState(false);

  const scan = useMutation({
    mutationFn: async (t: string): Promise<ScanResult> => {
      const { data, error } = await supabase.functions.invoke("evs-scan", {
        body: {
          ticker: t,
          portfolio_value: settings?.portfolio_value ?? 10000,
          thresholds: settings && {
            ts_slope: settings.ts_slope_threshold,
            volume: settings.volume_threshold,
            iv_rv: settings.iv_rv_threshold,
            kelly: settings.kelly_fraction,
          },
        },
      });
      if (error) {
        // supabase-js wraps non-2xx responses; surface the function's message.
        const ctx = (error as any)?.context;
        let msg = error.message;
        try { msg = (await ctx?.json())?.error ?? msg; } catch { /* keep msg */ }
        throw new Error(msg);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as ScanResult;
    },
    onSuccess: (r) => { setResult(r); setLogged(false); },
  });

  const logTrade = useMutation({
    mutationFn: async () => {
      if (!result?.trade) return;
      const t = result.trade;
      const { error } = await supabase.from("evs_trades").insert({
        ticker: result.ticker,
        earnings_date: result.earnings ? new Date(result.earnings.ts * 1000).toISOString().slice(0, 10) : null,
        verdict: result.verdict,
        structure: `${t.side} ${t.structure}`,
        strike: t.strike,
        front_expiry: t.frontExpiry,
        back_expiry: t.backExpiry,
        debit: t.debit,
        contracts: Math.max(1, t.contracts),
        ts_slope: result.filters.tsSlope.value,
        avg_volume_30d: result.filters.avgVolume30.value,
        iv_rv: result.filters.ivRv.value,
        implied_move_pct: t.impliedMovePct,
      });
      if (error) throw error;
    },
    onSuccess: () => { setLogged(true); qc.invalidateQueries({ queryKey: ["evs-trades"] }); },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    if (t) scan.mutate(t);
  }

  return (
    <div className="space-y-6">
      <Card>
        <form onSubmit={onSubmit} className="flex flex-col gap-3 p-5 sm:flex-row">
          <Input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="Ticker with upcoming earnings — e.g. NVDA"
            className="font-mono uppercase sm:max-w-xs"
            autoFocus
          />
          <Button type="submit" loading={scan.isPending} disabled={!ticker.trim()}>
            <Search className="h-4 w-4" /> {scan.isPending ? "Scanning…" : "Scan"}
          </Button>
          {result && (
            <p className="self-center text-xs text-slate-400">
              {result.dataSource} · spot ${result.spot}
            </p>
          )}
        </form>
      </Card>

      {scan.isError && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{(scan.error as Error).message}</p>
      )}

      {!result && !scan.isError && (
        <Card>
          <EmptyState
            icon={<CalendarClock className="h-5 w-5" />}
            title="Scan a ticker"
            subtitle="Checks the next earnings date and whether the three filters (term-structure slope, volume, IV30/RV30) say this is a playable setup."
          />
        </Card>
      )}

      {result && (
        <>
          <VerdictCard result={result} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FilterCard
              icon={<TrendingDown className="h-5 w-5" />}
              label="Term-structure slope"
              hint="front → 45d · most important — failing this alone means AVOID"
              value={result.filters.tsSlope.value?.toFixed(5) ?? "n/a"}
              threshold={`≤ ${result.filters.tsSlope.threshold}`}
              pass={result.filters.tsSlope.pass}
            />
            <FilterCard
              icon={<BarChart3 className="h-5 w-5" />}
              label="30-day avg volume"
              hint="liquidity — price-insensitive flow"
              value={fmtVolume(result.filters.avgVolume30.value)}
              threshold={`≥ ${fmtVolume(result.filters.avgVolume30.threshold)}`}
              pass={result.filters.avgVolume30.pass}
            />
            <FilterCard
              icon={<Percent className="h-5 w-5" />}
              label="IV30 / RV30"
              hint={`IV ${(result.filters.ivRv.iv30 * 100).toFixed(1)}% vs RV ${(result.filters.ivRv.rv30 * 100).toFixed(1)}% (${result.filters.ivRv.rvMethod})`}
              value={result.filters.ivRv.value.toFixed(2)}
              threshold={`≥ ${result.filters.ivRv.threshold}`}
              pass={result.filters.ivRv.pass}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div className="xl:col-span-2">
              {result.trade && (
                <TradeCard
                  result={result}
                  onLog={() => logTrade.mutate()}
                  logging={logTrade.isPending}
                  logged={logged}
                />
              )}
            </div>
            <TermStructureCard points={result.termStructure} />
          </div>

          {result.warnings.length > 0 && (
            <Card>
              <ul className="space-y-2 p-5">
                {result.warnings.map((w, i) => (
                  <li key={i} className="flex gap-2 text-xs leading-relaxed text-amber-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

const VERDICT_COPY: Record<string, string> = {
  RECOMMEND: "All three filters pass — this is the setup the strategy trades.",
  CONSIDER: "Slope passes plus one other filter — marginal setup; the author only trades RECOMMEND.",
  AVOID: "Do not trade this event — the term-structure filter (or too many others) failed.",
};

function VerdictCard({ result }: { result: ScanResult }) {
  const e = result.earnings;
  return (
    <Card>
      <CardHeader
        title={`${result.ticker} — verdict`}
        subtitle={VERDICT_COPY[result.verdict]}
        action={<StatusBadge status={result.verdict} />}
      />
      <div className="space-y-2 px-5 py-4">
        {e ? (
          <>
            <DataRow
              label="Next earnings"
              value={`${e.inDays >= 0 ? `in ${e.inDays} day${e.inDays === 1 ? "" : "s"}` : "just reported"} · ${e.upcoming ? "playable window" : "outside the ~3-week window"}`}
              tone={e.upcoming ? "good" : "warn"}
            />
            <DataRow label="US market time" value={fmtZoned(e.ts, "America/New_York") + " ET"} />
            <DataRow label="Your time (MYT)" value={fmtZoned(e.ts, "Asia/Kuala_Lumpur")} />
          </>
        ) : (
          <DataRow label="Next earnings" value="Unknown — Yahoo has no date" tone="warn" />
        )}
      </div>
    </Card>
  );
}

function FilterCard({ icon, label, hint, value, threshold, pass }: {
  icon: React.ReactNode; label: string; hint: string; value: string; threshold: string; pass: boolean;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", pass ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500")}>
          {icon}
        </div>
        <StatusBadge status={pass ? "PASS" : "FAIL"} />
      </div>
      <p className="mt-3 text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 font-mono text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-[11px] text-slate-400">needs {threshold} · {hint}</p>
    </Card>
  );
}

function TradeCard({ result, onLog, logging, logged }: {
  result: ScanResult; onLog: () => void; logging: boolean; logged: boolean;
}) {
  const t = result.trade!;
  return (
    <Card>
      <CardHeader
        title="Suggested calendar spread"
        subtitle="Sell the front expiration, buy the back — profit from the front's IV crush"
        action={
          logged ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
              <Check className="h-4 w-4" /> Logged
            </span>
          ) : (
            <Button variant="secondary" onClick={onLog} loading={logging} disabled={result.verdict === "AVOID"}>
              <NotebookPen className="h-4 w-4" /> Log this trade
            </Button>
          )
        }
      />
      <div className="grid grid-cols-1 gap-x-8 gap-y-2 px-5 py-4 sm:grid-cols-2">
        <DataRow label="Structure" value={`${t.side} calendar @ ${t.strike}`} />
        <DataRow label="Est. debit / spread" value={`$${t.debit.toFixed(2)} (×100)`} />
        <DataRow label="Sell (front)" value={`${t.frontExpiry} · ${t.frontDte}d`} />
        <DataRow label="Implied move" value={t.impliedMovePct != null ? `${t.impliedMovePct}%` : "—"} />
        <DataRow label="Buy (back)" value={`${t.backExpiry} · ${t.backDte}d`} />
        <DataRow
          label={`Size @ budget $${t.budget}`}
          value={t.contracts > 0 ? `${t.contracts} contract${t.contracts === 1 ? "" : "s"}` : "0 — over budget, skip"}
          tone={t.contracts > 0 ? undefined : "bad"}
        />
      </div>
      <div className="grid grid-cols-1 gap-x-8 gap-y-2 border-t border-slate-100 px-5 py-4 sm:grid-cols-2">
        <DataRow
          label="Money in (max loss)"
          value={t.totalOutlay != null ? `$${t.totalOutlay}` : `$${t.outlayPerContract} / contract`}
        />
        <DataRow
          label={`Backtest avg (+${t.backtest.meanPct}%, ${t.backtest.winRatePct}% win)`}
          value={t.backtest.expectedPnl != null ? `≈ +$${t.backtest.expectedPnl} / trade` : "—"}
          tone="good"
        />
        <DataRow
          label="Chance debit → ~0"
          value={
            t.totalLossRisk
              ? `~${t.totalLossRisk.probPct}% · needs ${t.totalLossRisk.moveDownPct != null ? `−${t.totalLossRisk.moveDownPct}%` : "n/a"} / ${t.totalLossRisk.moveUpPct != null ? `+${t.totalLossRisk.moveUpPct}%` : "n/a"} gap`
              : "n/a"
          }
          tone={t.totalLossRisk && t.totalLossRisk.probPct >= 5 ? "bad" : t.totalLossRisk ? "warn" : undefined}
        />
        <DataRow label={`One trade can swing (±${t.backtest.sdPct}%)`} value={
          t.totalOutlay != null ? `≈ ±$${Math.round((t.backtest.sdPct / 100) * t.totalOutlay)}` : "—"
        } />
      </div>
      <div className="space-y-1.5 border-t border-slate-100 px-5 py-4">
        <p className="text-xs text-slate-500">▸ {t.entryHint}</p>
        <p className="text-xs text-slate-500">▸ {t.exitHint}</p>
        {t.totalLossRisk && (
          <p className="text-[11px] leading-relaxed text-slate-400">
            Total-loss estimate: {t.totalLossRisk.assumption} Expected-result line is the backtest's
            claimed average applied to your outlay — not a promise; the whole debit is always at risk.
          </p>
        )}
      </div>
    </Card>
  );
}

// Deliberately a table, not a chart: four-to-eight points read fine as numbers,
// and the shape (falling = backwardation) is obvious from the trend column.
function TermStructureCard({ points }: { points: { dte: number; iv: number }[] }) {
  return (
    <Card>
      <CardHeader title="IV term structure" subtitle="ATM implied vol by expiration — falling = backwardation" />
      <ul className="divide-y divide-slate-100">
        {points.map((p, i) => {
          const prev = points[i - 1];
          const dir = prev ? (p.iv < prev.iv ? "▼" : p.iv > prev.iv ? "▲" : "–") : "";
          return (
            <li key={p.dte} className="flex items-center justify-between px-5 py-2">
              <span className="font-mono text-xs text-slate-500">{p.dte}d</span>
              <span className="font-mono text-sm text-slate-800">{(p.iv * 100).toFixed(1)}%</span>
              <span className={cn("w-4 text-right font-mono text-xs", dir === "▼" ? "text-emerald-600" : dir === "▲" ? "text-red-500" : "text-slate-400")}>
                {dir}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
