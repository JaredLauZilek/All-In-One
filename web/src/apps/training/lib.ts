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
  id: string; source: "strava" | "hevy" | "manual" | "intervals"; sport: string; name: string | null;
  custom_name: string | null; // app-side rename (0007) — survives sync; null = source name
  started_at: string; duration_min: number | null; distance_km: number | null;
  avg_hr: number | null; data: Record<string, unknown>;
  // custom zone results (columns — survive the sync's data upsert)
  hr_zone_secs: number[] | null; hr_zones: number[] | null; hr_zones_key: string | null;
}

/* ---- Hevy lift detail as stored by tr-sync in tr_workouts.data.exercises ---- */
export interface HevySet { weight_kg?: number | null; reps?: number | null; type?: string | null }
export interface HevyExercise { name: string; template_id?: string | null; sets: HevySet[] }
export const hevyExercises = (w: TrWorkout): HevyExercise[] => {
  const ex = (w.data as { exercises?: unknown }).exercises;
  return Array.isArray(ex) ? (ex as HevyExercise[]) : [];
};
/* Working sets = everything Hevy didn't tag as a warm-up. */
export const workingSets = (sets: HevySet[]) => sets.filter((st) => st.type !== "warmup").length;
/* Volume the way Hevy shows it: Σ weight × reps over EVERY set (warm-ups included). */
export const tonnageKg = (exs: HevyExercise[]) =>
  exs.reduce((t, ex) => t + ex.sets.reduce((a, st) => a + (st.weight_kg ?? 0) * (st.reps ?? 0), 0), 0);

/* tr_hevy_exercises (0011) — Hevy's exercise library, cached by tr-sync. */
export interface TrHevyExercise {
  template_id: string; title: string; type: string | null;
  primary_muscle_group: string | null; secondary_muscle_groups: string[]; equipment: string | null;
}
export const muscleLabel = (g: string) => g.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export interface TrWellness {
  day: string; resting_hr: number | null; hrv: number | null;
  sleep_secs: number | null; sleep_score: number | null; weight_kg: number | null;
  steps: number | null; // Garmin daily total (0008)
}

export interface TrSettings {
  user_id: string; telegram_chat_id: string | null; pairing_code: string;
  hevy_api_key: string | null; intervals_athlete_id: string | null; intervals_api_key: string | null;
  weekly_hours: number; days_per_week: number;
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
  brick: "🧱", mobility: "🧘", rest: "😴",
  // Garmin logs Jared's gym sessions as generic "Workout" → sport 'other';
  // a ✅ here read like a done-tick, so it wears the gym emoji too.
  other: "🏋️",
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

// Dated HR-zone versions: each set applies from effective_from until the next
// version; activities older than the earliest version use the earliest.
export interface TrHrZones {
  id: string; effective_from: string; ceilings: number[]; note: string | null;
}

export function useHrZoneVersions() {
  return useQuery({
    queryKey: ["tr-hr-zones"],
    queryFn: async (): Promise<TrHrZones[]> => {
      const { data, error } = await supabase.from("tr_hr_zones").select("*")
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return data as TrHrZones[];
    },
    refetchInterval: false,
  });
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
