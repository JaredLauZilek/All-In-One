import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { NotebookPen, TrendingUp, Target, Percent, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Button, Card, CardHeader, Input, StatCard, StatusBadge, Spinner, EmptyState, Modal, cn } from "../../components/ui";
import type { EvsTrade } from "./lib";

export default function Trades() {
  const qc = useQueryClient();
  const [closing, setClosing] = useState<EvsTrade | null>(null);

  const { data: trades, isLoading } = useQuery({
    queryKey: ["evs-trades"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("evs_trades").select("*").order("entered_at", { ascending: false });
      if (error) throw error;
      return data as EvsTrade[];
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("evs_trades").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["evs-trades"] }),
  });

  if (isLoading) return <Spinner />;

  const closed = (trades ?? []).filter((t) => t.status === "closed" && t.pnl_pct !== null);
  const open = (trades ?? []).filter((t) => t.status === "open");
  const wins = closed.filter((t) => (t.pnl_pct ?? 0) > 0).length;
  const winRate = closed.length ? Math.round((wins / closed.length) * 100) : null;
  const expectancy = closed.length
    ? closed.reduce((a, t) => a + (t.pnl_pct ?? 0), 0) / closed.length
    : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Plays logged" value={trades?.length ?? 0} accent="bg-indigo-50 text-indigo-600" icon={<NotebookPen className="h-5 w-5" />} />
        <StatCard label="Open" value={open.length} accent="bg-amber-50 text-amber-600" icon={<Target className="h-5 w-5" />} />
        <StatCard label="Win rate" value={winRate === null ? "—" : `${winRate}%`} accent="bg-emerald-50 text-emerald-600" icon={<TrendingUp className="h-5 w-5" />} />
        <StatCard label="Avg P&L / trade" value={expectancy === null ? "—" : `${expectancy > 0 ? "+" : ""}${expectancy.toFixed(1)}%`} accent="bg-slate-100 text-slate-600" icon={<Percent className="h-5 w-5" />} />
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="Trade log"
          subtitle="Backtest profile to beat: ~66% win rate, +7.3% mean per trade (sd 28%). Divergence over many trades = the edge may be gone."
        />
        {!trades?.length ? (
          <EmptyState
            icon={<NotebookPen className="h-5 w-5" />}
            title="No plays logged yet"
            subtitle="Scan a ticker and hit “Log this trade” when you take the setup."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs text-slate-500">
                  <th className="px-5 py-3 font-medium">Ticker</th>
                  <th className="px-3 py-3 font-medium">Entered</th>
                  <th className="px-3 py-3 font-medium">Verdict</th>
                  <th className="px-3 py-3 font-medium">Spread</th>
                  <th className="px-3 py-3 font-medium">Debit × qty</th>
                  <th className="px-3 py-3 font-medium">P&L</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {trades.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/60">
                    <td className="px-5 py-3 font-mono font-semibold text-slate-900">{t.ticker}</td>
                    <td className="px-3 py-3 text-xs text-slate-500">{format(new Date(t.entered_at), "d MMM HH:mm")}</td>
                    <td className="px-3 py-3">{t.verdict ? <StatusBadge status={t.verdict} dot={false} /> : "—"}</td>
                    <td className="px-3 py-3 text-xs text-slate-600">
                      {t.structure} @ {t.strike ?? "—"}
                      <span className="block text-slate-400">{t.front_expiry} → {t.back_expiry}</span>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-600">
                      {t.debit != null ? `$${Number(t.debit).toFixed(2)}` : "—"} × {t.contracts ?? "—"}
                    </td>
                    <td className={cn("px-3 py-3 font-mono text-sm font-semibold",
                      t.pnl_pct == null ? "text-slate-400" : t.pnl_pct > 0 ? "text-emerald-600" : "text-red-600")}>
                      {t.pnl_pct == null ? "—" : `${t.pnl_pct > 0 ? "+" : ""}${Number(t.pnl_pct).toFixed(1)}% ($${Number(t.pnl).toFixed(0)})`}
                    </td>
                    <td className="px-3 py-3">
                      {t.status === "open" ? (
                        <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setClosing(t)}>Close…</Button>
                      ) : (
                        <StatusBadge status="closed" dot={false} />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <button
                        title="Delete"
                        onClick={() => { if (confirm(`Delete ${t.ticker} log entry?`)) remove.mutate(t.id); }}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {closing && <CloseModal trade={closing} onClose={() => setClosing(null)} />}
    </div>
  );
}

function CloseModal({ trade, onClose }: { trade: EvsTrade; onClose: () => void }) {
  const qc = useQueryClient();
  const [exit, setExit] = useState("");
  const exitNum = parseFloat(exit);
  const debit = Number(trade.debit ?? 0);
  const contracts = trade.contracts ?? 1;
  const valid = Number.isFinite(exitNum) && exitNum >= 0 && debit > 0;
  const pnl = valid ? (exitNum - debit) * contracts * 100 : null;
  const pnlPct = valid ? ((exitNum - debit) / debit) * 100 : null;

  const close = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("evs_trades").update({
        status: "closed",
        exit_debit: exitNum,
        pnl: pnl,
        pnl_pct: pnlPct,
        closed_at: new Date().toISOString(),
      }).eq("id", trade.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["evs-trades"] }); onClose(); },
  });

  return (
    <Modal open onClose={onClose} title={`Close ${trade.ticker} calendar`}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Entered at <b>${debit.toFixed(2)}</b> × {contracts}. Enter the price you sold the spread for
          (~15 min after the open).
        </p>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">Exit price per spread ($)</label>
          <Input inputMode="decimal" value={exit} onChange={(e) => setExit(e.target.value)} placeholder="e.g. 4.90" autoFocus className="font-mono" />
        </div>
        {valid && (
          <p className={cn("rounded-lg px-3 py-2 text-sm font-medium", (pnlPct ?? 0) >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>
            P&L: {pnlPct! > 0 ? "+" : ""}{pnlPct!.toFixed(1)}% · ${pnl!.toFixed(0)}
          </p>
        )}
        <Button onClick={() => close.mutate()} loading={close.isPending} disabled={!valid} className="w-full">
          Close trade
        </Button>
      </div>
    </Modal>
  );
}
