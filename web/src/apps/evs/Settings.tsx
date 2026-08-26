import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { Button, Card, CardHeader, Input, Spinner } from "../../components/ui";
import { useEvsSettings } from "./Scanner";

// All thresholds are the strategy guide's backtest defaults; tune with care —
// loosening them trades more events with less edge.
const FIELDS = [
  { key: "portfolio_value", label: "Portfolio value ($)", hint: "Position sizing base. Debit budget = portfolio × sizing fraction.", step: "100" },
  { key: "kelly_fraction", label: "Sizing fraction", hint: "0.06 = 6% of portfolio per trade (≈10% Kelly). Full Kelly (0.60) eventually goes bankrupt — don't.", step: "0.01" },
  { key: "ts_slope_threshold", label: "Term-slope threshold", hint: "Pass if slope ≤ this. Backtest default −0.00406; more negative = stricter.", step: "0.0005" },
  { key: "volume_threshold", label: "Volume threshold (shares/day)", hint: "Pass if 30-day average volume ≥ this. Default 1,500,000.", step: "100000" },
  { key: "iv_rv_threshold", label: "IV30/RV30 threshold", hint: "Pass if the ratio ≥ this. Default 1.25.", step: "0.05" },
] as const;

export default function Settings() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useEvsSettings();
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (settings) {
      setForm(Object.fromEntries(FIELDS.map((f) => [f.key, String(settings[f.key])])));
    }
  }, [settings]);

  const save = useMutation({
    mutationFn: async () => {
      const patch: Record<string, number> = {};
      for (const f of FIELDS) {
        const n = parseFloat(form[f.key]);
        if (Number.isFinite(n)) patch[f.key] = n;
      }
      const { error } = await supabase.from("evs_settings")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("user_id", settings!.user_id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["evs-settings"] }),
  });

  if (isLoading || !settings) return <Spinner />;

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader
          title="Scanner settings"
          subtitle="Sizing and filter thresholds — the defaults are the backtest's values"
          action={<Button onClick={() => save.mutate()} loading={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>}
        />
        <div className="divide-y divide-slate-100">
          {FIELDS.map((f) => (
            <div key={f.key} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="sm:max-w-sm">
                <p className="text-sm font-medium text-slate-700">{f.label}</p>
                <p className="mt-0.5 text-xs text-slate-500">{f.hint}</p>
              </div>
              <Input
                inputMode="decimal"
                step={f.step}
                value={form[f.key] ?? ""}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                className="font-mono sm:max-w-[10rem]"
              />
            </div>
          ))}
        </div>
      </Card>
      <p className="text-xs leading-relaxed text-slate-400">
        These values come from one creator's backtest (2007–present, ~72,500 earnings events) and are not
        independently verified. Selling earnings volatility carries substantial tail risk — the calendar
        caps loss at the debit, but the edge itself may decay. Not financial advice.
      </p>
    </div>
  );
}
