// Training → Activities: intervals.icu-style weekly review, trimmed to what
// Jared actually reads — per activity: time, distance, avg HR, pace, steps
// (estimated from run cadence ×2 — Garmin sends no step total per workout)
// and an HR-zone mini-graph with the title below; per week (left rail):
// gym vs cardio totals with %-change against the previous week.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, RefreshCw } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Button, Card, EmptyState, cn } from "../../components/ui";
import { type TrWorkout, SPORT_EMOJI, localISO, addDaysISO, mondayOf, DAY_NAMES, useHrZoneVersions } from "./lib";

const WEEKS_SHOWN = 6;

/* Buckets for the weekly split. Lifts come from Hevy ('strength'). Garmin also logs
   gym sessions as a generic "Workout" (→ 'other'); a Garmin entry that overlaps a
   Hevy lift in time is dropped (dedupeGymShadows) so the session isn't counted twice. */
const CARDIO = ["run", "ride", "swim", "brick", "hyrox"];
const GYM = ["strength", "other"];

/* Zone bars mirror the athlete's ACTUAL intervals.icu HR-zone model — Jared's
   profile has 7 zones (ceilings in data.icu_hr_zones), so folding to 5 both
   exaggerated the red and mislabeled the middle (the bug he spotted).
   Colors follow intervals.icu's convention: grey/blue/green/yellow/orange/red/purple. */
const ZONE_COLORS_7 = ["bg-slate-300", "bg-sky-400", "bg-emerald-500", "bg-yellow-400", "bg-orange-500", "bg-red-500", "bg-purple-500"];
const ZONE_COLORS_5 = ["bg-slate-300", "bg-sky-400", "bg-emerald-500", "bg-orange-500", "bg-red-500"];
const zoneColor = (i: number, n: number) => (n <= 5 ? ZONE_COLORS_5 : ZONE_COLORS_7)[i] ?? "bg-red-500";
const fmtSecs = (s: number) => (s >= 60 ? `${Math.round(s / 60)}m` : `${Math.round(s)}s`);

const fmtDur = (min: number) => {
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m` : `${m}m`;
};
const fmtPace = (minPerKm: number) => {
  const s = Math.round(minPerKm * 60);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
function isoWeekNo(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); // nearest Thursday
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - jan1.getTime()) / 86400_000 + 1) / 7);
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (dateStr: string) => {
  const d = new Date(dateStr + "T00:00:00");
  return `${DAY_NAMES[(d.getDay() + 6) % 7]} ${String(d.getDate()).padStart(2, "0")}`;
};
const rangeLabel = (weekStart: string) => {
  const a = new Date(weekStart + "T00:00:00"), b = new Date(addDaysISO(weekStart, 6) + "T00:00:00");
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${b.getDate()} ${MONTHS[a.getMonth()]}`
    : `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
};

interface HevySet { weight_kg?: number | null; reps?: number | null; type?: string }
interface Detail {
  icu_hr_zone_times?: number[]; icu_hr_zones?: number[];
  average_cadence?: number;
  exercises?: { name: string; sets: HevySet[] }[]; // Hevy lifts (tr-sync stores every set)
}

/* "×3 Barbell Bench Press" — working sets only (Hevy tags warm-ups); hover shows
   each set as weight × reps. Warm-ups/drop-sets are listed in the tooltip too. */
const setLabel = (st: HevySet) => {
  const core = st.weight_kg != null && st.weight_kg > 0 ? `${st.weight_kg} kg × ${st.reps ?? "?"}` : `${st.reps ?? "?"} reps`;
  return st.type && st.type !== "normal" ? `${core} (${st.type})` : core;
};
const workingSets = (sets: HevySet[]) => sets.filter((st) => st.type !== "warmup").length;
/* Volume the way Hevy shows it: Σ weight × reps over EVERY set (warm-ups included),
   so the card's number matches the one in the Hevy app. Bodyweight sets add 0. */
const tonnageKg = (exs: Detail["exercises"]) =>
  (exs ?? []).reduce((t, ex) => t + ex.sets.reduce((a, st) => a + (st.weight_kg ?? 0) * (st.reps ?? 0), 0), 0);

const workoutDay = (w: TrWorkout) => localISO(new Date(w.started_at));
const stepsOf = (w: TrWorkout) => {
  const cad = (w.data as Detail).average_cadence;
  return w.sport === "run" && cad && w.duration_min ? Math.round(cad * 2 * Number(w.duration_min)) : null;
};

/* Hevy (Pro) is the source of truth for lifts. Jared still wears his Garmin in
   the gym, so the SAME session can also arrive from intervals.icu as a generic
   "Workout" (sport 'other') or a Strength activity. Left alone, the gym bucket
   counts it twice — the exact duplicates he was deleting by hand. A Garmin
   gym-bucket entry is a shadow only when its recording window OVERLAPS a Hevy
   lift (±20 min slack — the two timers never start together). A same-day test
   was too blunt: it hid a 36-second morning Garmin walk because of an evening
   Pull session (27 Jul 2026). No overlapping lift = the Garmin entry stays, so a
   forgotten Hevy log still counts as gym. DB rows are untouched (Garmin's HR data). */
const SHADOW_SLACK_MS = 20 * 60_000;
const spanOf = (w: TrWorkout): [number, number] => {
  const start = new Date(w.started_at).getTime();
  return [start, start + Number(w.duration_min ?? 0) * 60_000];
};
function dedupeGymShadows(list: TrWorkout[]): TrWorkout[] {
  const lifts = list.filter((w) => w.source === "hevy").map(spanOf);
  return list.filter((w) => {
    if (w.source !== "intervals" || !(GYM as readonly string[]).includes(w.sport)) return true;
    const [s, e] = spanOf(w);
    return !lifts.some(([ls, le]) => s < le + SHADOW_SLACK_MS && ls < e + SHADOW_SLACK_MS);
  });
}

export default function Activities() {
  // With custom zone versions configured, cards NEVER fall back to
  // intervals.icu's model (mixing zone models across cards misleads).
  const { data: zoneVersions } = useHrZoneVersions();
  const customOnly = (zoneVersions ?? []).length > 0;
  const { data: workouts } = useQuery({
    queryKey: ["tr-activities"],
    queryFn: async () => {
      const oldest = addDaysISO(mondayOf(), -7 * (WEEKS_SHOWN - 1));
      const { data, error } = await supabase.from("tr_workouts").select("*")
        .gte("started_at", oldest + "T00:00:00+08:00").order("started_at");
      if (error) throw error;
      return dedupeGymShadows(data as TrWorkout[]);
    },
  });

  // Manual "pull everything now". tr-sync fetches intervals.icu (runs + wellness)
  // AND Hevy (lifts) in one call and reconciles deletions, so one button covers
  // both sources. Same wiring as the Week tab's button.
  const qc = useQueryClient();
  const sync = useMutation({
    mutationFn: async () => {
      const { data: res, error } = await supabase.functions.invoke("tr-sync", { body: {} });
      if (error) throw error;
      return res as { intervals: number; removed: number; wellness: number; hevy: number; matched: number; errors: string[] };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tr-activities"] });
      qc.invalidateQueries({ queryKey: ["tr-week"] }); // the Week tab reads the same rows
    },
  });
  const syncBar = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-slate-500">Runs from intervals.icu · lifts from Hevy</p>
      <div className="flex flex-wrap items-center gap-3">
        {sync.isSuccess && (
          <span className="font-mono text-[11px] text-slate-500">
            Synced — intervals.icu {sync.data.intervals ?? 0} · Hevy {sync.data.hevy ?? 0}
            {sync.data.removed ? ` · removed ${sync.data.removed}` : ""}
            {sync.data.errors?.length ? ` · ⚠ ${sync.data.errors.join("; ")}` : ""}
          </span>
        )}
        {sync.isError && <span className="text-[11px] text-red-500">{String(sync.error)}</span>}
        <Button variant="secondary" onClick={() => sync.mutate()} loading={sync.isPending}>
          <RefreshCw className="h-4 w-4" /> Sync
        </Button>
      </div>
    </div>
  );

  const currentMonday = mondayOf();
  const weekStarts = Array.from({ length: WEEKS_SHOWN }, (_, i) => addDaysISO(currentMonday, -7 * i));
  const byDay = new Map<string, TrWorkout[]>();
  for (const w of workouts ?? []) {
    const day = workoutDay(w);
    byDay.set(day, [...(byDay.get(day) ?? []), w]);
  }
  const weekWorkouts = (start: string) =>
    (workouts ?? []).filter((w) => workoutDay(w) >= start && workoutDay(w) <= addDaysISO(start, 6));

  if ((workouts ?? []).length === 0) {
    return (
      <div className="space-y-6">
        {syncBar}
        <Card>
          <EmptyState icon={<CalendarRange className="h-5 w-5" />} title="No activities yet"
            subtitle="Connect intervals.icu and Hevy in Settings, then hit Sync — runs and lifts show up here." />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {syncBar}
      {weekStarts.map((start, i) => (
        <WeekRow key={start}
          weekStart={start}
          isCurrent={i === 0}
          workouts={weekWorkouts(start)}
          prevWorkouts={i < WEEKS_SHOWN - 1 ? weekWorkouts(addDaysISO(start, -7)) : null}
          byDay={byDay}
          customOnly={customOnly}
        />
      ))}
    </div>
  );
}

/* ---------------- one week: summary rail + 7-day grid ---------------- */
function WeekRow({ weekStart, isCurrent, workouts, prevWorkouts, byDay, customOnly }: {
  weekStart: string; isCurrent: boolean; workouts: TrWorkout[];
  prevWorkouts: TrWorkout[] | null; byDay: Map<string, TrWorkout[]>; customOnly: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-1 md:grid-cols-[13.5rem_1fr]">
        <WeekSummary weekStart={weekStart} isCurrent={isCurrent} workouts={workouts} prevWorkouts={prevWorkouts} />
        <div className="overflow-x-auto">
          <div className="grid min-w-[52rem] grid-cols-7 divide-x divide-slate-100">
            {Array.from({ length: 7 }, (_, d) => {
              const day = addDaysISO(weekStart, d);
              const todays = byDay.get(day)?.filter((w) => workouts.includes(w)) ?? [];
              const isToday = day === localISO(new Date());
              return (
                <div key={day} className={cn("min-h-[7rem] px-2 py-2.5", isToday && "bg-indigo-50/40")}>
                  <p className={cn("mb-2 text-center text-[11px] font-semibold",
                    isToday ? "text-indigo-600" : "text-slate-400")}>
                    {dayLabel(day)}
                  </p>
                  <div className="space-y-2">
                    {todays.map((w) => <ActivityCard key={w.id} w={w} customOnly={customOnly} />)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

function pct(cur: number, prev: number): string | null {
  if (!prev || cur === prev) return prev && cur === prev ? "±0%" : null;
  const p = Math.round(((cur - prev) / prev) * 100);
  return `${p > 0 ? "+" : ""}${p}%`;
}

function Delta({ cur, prev }: { cur: number; prev: number | null }) {
  if (prev === null || (cur === 0 && !prev)) return null;
  const label = pct(cur, prev);
  if (!label) return <span className="font-mono text-[11px] text-slate-400">new</span>;
  const up = cur >= prev;
  return (
    <span className={cn("font-mono text-[11px] font-semibold", up ? "text-emerald-600" : "text-red-500")}>
      {up ? "▲" : "▼"} {label.replace("+", "").replace("-", "")}
    </span>
  );
}

function WeekSummary({ weekStart, isCurrent, workouts, prevWorkouts }: {
  weekStart: string; isCurrent: boolean; workouts: TrWorkout[]; prevWorkouts: TrWorkout[] | null;
}) {
  const sum = (list: TrWorkout[], sports: string[], field: "duration_min" | "distance_km") =>
    list.filter((w) => sports.includes(w.sport)).reduce((a, w) => a + (Number(w[field]) || 0), 0);
  const cardioMin = sum(workouts, CARDIO, "duration_min");
  const cardioKm = sum(workouts, CARDIO, "distance_km");
  const gymMin = sum(workouts, GYM, "duration_min");
  const totalMin = cardioMin + gymMin;
  const prev = prevWorkouts && {
    cardioMin: sum(prevWorkouts, CARDIO, "duration_min"),
    cardioKm: sum(prevWorkouts, CARDIO, "distance_km"),
    gymMin: sum(prevWorkouts, GYM, "duration_min"),
  };

  return (
    <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3.5 md:border-b-0 md:border-r">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-bold text-slate-900">Week {isoWeekNo(weekStart)}</h3>
        <span className="text-[11px] text-slate-400">{rangeLabel(weekStart)}</span>
        {isCurrent && <span className="rounded-full bg-ink px-1.5 py-0.5 text-[10px] font-semibold text-accent dark:bg-accent dark:text-ink">now</span>}
      </div>

      {workouts.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">No activities</p>
      ) : (
        <div className="mt-3 space-y-2.5">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-slate-500">Total</span>
            <span className="font-mono text-sm font-semibold text-slate-900">
              {fmtDur(totalMin)}{cardioKm > 0 && <span className="text-slate-400"> · {cardioKm.toFixed(1)} km</span>}
            </span>
          </div>
          <div className="border-t border-slate-200/60 pt-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-slate-500">🏃 Cardio</span>
              <span className="font-mono text-xs font-semibold text-slate-800">
                {fmtDur(cardioMin)} · {cardioKm.toFixed(1)} km
              </span>
            </div>
            {prev && <div className="mt-0.5 text-right">
              <Delta cur={cardioMin} prev={prev.cardioMin} />
              {prev.cardioKm > 0 && cardioKm > 0 && (
                <span className="ml-2 font-mono text-[11px] text-slate-400">
                  ({pct(cardioKm, prev.cardioKm) ?? "±0%"} km)
                </span>
              )}
            </div>}
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-slate-500">🏋️ Gym</span>
              <span className="font-mono text-xs font-semibold text-slate-800">{fmtDur(gymMin)}</span>
            </div>
            {prev && <div className="mt-0.5 text-right"><Delta cur={gymMin} prev={prev.gymMin} /></div>}
          </div>
          {prev && <p className="pt-1 text-[10px] text-slate-400">vs week {isoWeekNo(addDaysISO(weekStart, -7))}</p>}
        </div>
      )}
    </div>
  );
}

/* ---------------- one activity mini-card ---------------- */
function ActivityCard({ w, customOnly }: { w: TrWorkout; customOnly: boolean }) {
  const d = w.data as Detail;
  // Custom zone seconds (bucketed by tr-sync from the raw HR stream against
  // Jared's dated zone versions — real columns) win; the intervals.icu model
  // is only a fallback while no custom zone versions exist.
  const custom = Array.isArray(w.hr_zone_secs) && w.hr_zone_secs.length >= 3
    ? w.hr_zone_secs : null;
  const zones = custom ?? (() => {
    if (customOnly) return null;
    const t = d.icu_hr_zone_times;
    return Array.isArray(t) && t.length >= 3 ? t : null;
  })();
  const ceilings = custom ? w.hr_zones : d.icu_hr_zones;
  const zoneTotal = zones ? zones.reduce((a, b) => a + b, 0) : 0;
  const maxZone = zones ? Math.max(...zones) : 0;
  const zoneTip = (i: number) => {
    const time = fmtSecs(zones![i]);
    if (!Array.isArray(ceilings) || ceilings.length !== zones!.length) return `Z${i + 1} · ${time}`;
    const range = i === 0 ? `≤${ceilings[0]}` : `${ceilings[i - 1] + 1}–${ceilings[i]}`;
    return `Z${i + 1} (${range} bpm) · ${time}`;
  };
  const steps = stepsOf(w);
  const tonnage = tonnageKg(d.exercises);
  const pace = w.sport === "run" && w.distance_km && w.duration_min
    ? Number(w.duration_min) / Number(w.distance_km) : null;

  return (
    <div className="rounded-xl bg-slate-50 p-2 text-[11px] leading-tight dark:bg-slate-100">
      <p className="mb-1 truncate font-sans text-[11px] font-semibold text-slate-900" title={w.name ?? ""}>
        {w.name ?? w.sport}
      </p>
      <p className="font-mono font-semibold text-slate-900">
        {SPORT_EMOJI[w.sport] ?? "•"} {w.duration_min ? fmtDur(Number(w.duration_min)) : "—"}
        {w.distance_km ? ` · ${Number(w.distance_km).toFixed(1)} km` : ""}
        {tonnage > 0 ? ` · ${Math.round(tonnage).toLocaleString()} kg` : ""}
      </p>
      <div className="mt-1 space-y-0.5 font-mono text-slate-500">
        {w.avg_hr != null && <p>❤ {Math.round(Number(w.avg_hr))} bpm</p>}
        {pace != null && <p>{fmtPace(pace)} /km</p>}
        {steps != null && <p>≈{steps.toLocaleString()} steps</p>}
      </div>
      {Array.isArray(d.exercises) && d.exercises.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 font-sans text-slate-600">
          {d.exercises.map((ex, i) => (
            <li key={i} className="truncate" title={ex.sets.map(setLabel).join(" · ")}>
              <span className="font-mono text-slate-500">×{workingSets(ex.sets)}</span> {ex.name}
            </li>
          ))}
        </ul>
      )}
      {zones && zoneTotal > 60 && (
        <div className="mt-1.5 flex h-7 items-end gap-[2px]">
          {zones.map((secs, i) => (
            <div
              key={i}
              title={zoneTip(i)}
              className={cn("flex-1 rounded-sm", secs > 0 ? zoneColor(i, zones.length) : "bg-slate-200/70")}
              style={{ height: `${secs > 0 ? Math.max(6, (secs / (maxZone || 1)) * 26) : 3}px` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
