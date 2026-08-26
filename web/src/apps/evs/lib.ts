// Shared types + formatters for the Earnings Vol Scanner mini-app.
// The scan itself runs in the evs-scan edge function (evs-scanner/supabase/);
// this file mirrors its response shape.

export interface ScanFilters {
  tsSlope: { value: number | null; threshold: number; pass: boolean };
  avgVolume30: { value: number; threshold: number; pass: boolean };
  ivRv: { value: number; iv30: number; rv30: number; rvMethod: string; threshold: number; pass: boolean };
}

export interface ScanTrade {
  structure: string;
  side: "call" | "put";
  strike: number;
  frontExpiry: string;
  backExpiry: string;
  frontDte: number;
  backDte: number;
  debit: number;
  impliedMovePct: number | null;
  budget: number;
  contracts: number;
  outlayPerContract: number;
  totalOutlay: number | null;
  backtest: { meanPct: number; sdPct: number; winRatePct: number; expectedPnl: number | null };
  totalLossRisk: {
    probPct: number;
    moveUpPct: number | null;
    moveDownPct: number | null;
    assumption: string;
  } | null;
  entryHint: string;
  exitHint: string;
}

export interface ScanResult {
  ticker: string;
  spot: number;
  asOf: string;
  dataSource: string;
  earnings: { ts: number; inDays: number; upcoming: boolean } | null;
  filters: ScanFilters;
  verdict: "RECOMMEND" | "CONSIDER" | "AVOID";
  trade: ScanTrade | null;
  termStructure: { dte: number; iv: number }[];
  warnings: string[];
}

export interface EvsSettings {
  user_id: string;
  portfolio_value: number;
  kelly_fraction: number;
  ts_slope_threshold: number;
  volume_threshold: number;
  iv_rv_threshold: number;
}

export interface EvsTrade {
  id: string;
  user_id: string;
  ticker: string;
  earnings_date: string | null;
  verdict: string | null;
  structure: string;
  strike: number | null;
  front_expiry: string | null;
  back_expiry: string | null;
  debit: number | null;
  contracts: number | null;
  ts_slope: number | null;
  avg_volume_30d: number | null;
  iv_rv: number | null;
  implied_move_pct: number | null;
  status: "open" | "closed";
  exit_debit: number | null;
  pnl: number | null;
  pnl_pct: number | null;
  note: string | null;
  entered_at: string;
  closed_at: string | null;
}

export function fmtVolume(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(Math.round(v));
}

// Earnings timestamps shown in both US-market time and Jared's local time —
// "15 min before the US close" is ~3:45 AM in Malaysia, worth making explicit.
export function fmtZoned(tsSec: number, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(tsSec * 1000));
}
