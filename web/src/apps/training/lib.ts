// Shared types + helpers for the Training mini-app (tr_ namespace).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";

export interface TrRace {
  id: string; name: string; race_type: string; race_date: string | null;
  location: string | null; priority: "A" | "B" | "C";
  status: "upcoming" | "done" | "cancelled"; result: string | null; notes: string | null;
}

export interface TrPlanWeek {
  id: string; race_id: string | null; week_start: string; block: string;
  focus: string | null; planned_km: number | null; planned_minutes: number | null;
  generated_by: string; notes: string | null;
}

export interface TrSession {
  id: string; race_id: string | null; session_date: string; sport: string;
  title: string; detail: string | null; planned_minutes: number | null;
  planned_km: number | null; intensity: string | null;
  status: "planned" | "done" | "skipped" | "moved";
  matched_workout_id: string | null; gcal_event_id: string | null;
}

export interface TrWorkout {
  id: string; source: "strava" | "hevy" | "manual"; sport: string; name: string | null;
  started_at: string; duration_min: number | null; distance_km: number | null;
  avg_hr: number | null; data: Record<string, unknown>;
}

export interface TrSettings {
  user_id: string; telegram_chat_id: string | null; pairing_code: string;
  hevy_api_key: string | null; weekly_hours: number; days_per_week: number;
  long_run_day: string; session_time: string; last_synced_at: string | null;
}

export const RACE_TYPES: Record<string, string> = {
  hyrox: "Hyrox",
  half_marathon: "Half marathon",
  marathon: "Marathon",
  half_ironman: "Half Ironman 70.3",
  ironman: "Ironman",
  other: "Other",
};

export const SPORT_EMOJI: Record<string, string> = {
  run: "🏃", ride: "🚴", swim: "🏊", strength: "🏋️", hyrox: "🔥",
  brick: "🧱", mobility: "🧘", rest: "😴", other: "✅",
};

export const BLOCK_LABELS: Record<string, string> = {
  base: "Base", build: "Build", peak: "Peak", taper: "Taper",
  deload: "Deload", race: "Race week", recovery: "Recovery",
};

// Monday of the week containing d, as YYYY-MM-DD (local time — Jared is MYT).
export function mondayOf(d = new Date()): string {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return localISO(x);
}
export function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function addDaysISO(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localISO(d);
}
export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr + "T00:00:00").getTime() - Date.now()) / 86400_000);
}

// Settings row created lazily on first read (same pattern as evs_settings).
export function useTrSettings() {
  return useQuery({
    queryKey: ["tr-settings"],
    queryFn: async (): Promise<TrSettings> => {
      const { data, error } = await supabase.from("tr_settings").select("*").maybeSingle();
      if (error) throw error;
      if (data) return data as TrSettings;
      const uid = (await supabase.auth.getUser()).data.user!.id;
      const { data: inserted, error: insErr } = await supabase
        .from("tr_settings").insert({ user_id: uid }).select().single();
      if (insErr) throw insErr;
      return inserted as TrSettings;
    },
    refetchInterval: false,
  });
}
