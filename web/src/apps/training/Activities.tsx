// Training → Activities: intervals.icu-style weekly review, trimmed to what
// Jared actually reads — per activity: time, distance, avg HR, pace, steps
// (estimated from run cadence ×2 — Garmin sends no step total per workout)
// and an HR-zone mini-graph with the title below; per week (left rail):
// gym vs cardio totals with %-change against the previous week.
import { useQuery } from "@tanstack/react-query";
import { CalendarRange } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Card, EmptyState, cn } from "../../components/ui";
import { type TrWorkout, SPORT_EMOJI, localISO, addDaysISO, mondayOf, DAY_NAMES } from "./lib";

const WEEKS_SHOWN = 6;

/* Buckets for the weekly split. Garmin logs Jared's gym sessions as generic
   "Workout" (→ sport 'other'), so 'other' counts as gym alongside Hevy lifts. */
const CARDIO = ["run", "ride", "swim", "brick", "hyrox"];
const GYM = ["strength", "other"];

// Z1..Z5+ (intervals.icu sends 7 zones; 6+7 fold into the last bucket)
const ZONE_COLORS = ["bg-slate-300", "bg-emerald-500", "bg-yellow-400", "bg-orange-500", "bg-red-500"];

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

interface Detail { icu_hr_zone_times?: number[]; average_cadence?: number }

const workoutDay = (w: TrWorkout) => localISO(new Date(w.started_at));
const stepsOf = (w: TrWorkout) => {
  const cad = (w.data as Detail).average_cadence;
  return w.sport === "run" && cad && w.duration_min ? Math.round(cad * 2 * Number(w.duration_min)) : null;
};

export default function Activities() {
  const { data: workouts } = useQuery({
    queryKey: ["tr-activities"],
    queryFn: async () => {
      const oldest = addDaysISO(mondayOf(), -7 * (WEEKS_SHOWN - 1));
      const { data, error } = await supabase.from("tr_workouts").select("*")
        .gte("started_at", oldest + "T00:00:00+08:00").order("started_at");
      if (error) throw error;
      return data as TrWorkout[];
    },
  });

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
      <Card>
        <EmptyState icon={<CalendarRange className="h-5 w-5" />} title="No activities yet"
          subtitle="Connect intervals.icu in Settings and hit Sync on the Week tab — everything Garmin records shows up here." />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {weekStarts.map((start, i) => (
        <WeekRow key={start}
          weekStart={start}
          isCurrent={i === 0}
          workouts={weekWorkouts(start)}
          prevWorkouts={i < WEEKS_SHOWN - 1 ? weekWorkouts(addDaysISO(start, -7)) : null}
          byDay={byDay}
        />
      ))}
    </div>
  );
}

/* ---------------- one week: summary rail + 7-day grid ---------------- */
function WeekRow({ weekStart, isCurrent, workouts, prevWorkouts, byDay }: {
  weekStart: string; isCurrent: boolean; workouts: TrWorkout[];
  prevWorkouts: TrWorkout[] | null; byDay: Map<string, TrWorkout[]>;
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
                    {todays.map((w) => <ActivityCard key={w.id} w={w} />)}
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
function ActivityCard({ w }: { w: TrWorkout }) {
  const zonesRaw = (w.data as Detail).icu_hr_zone_times;
  // fold Z6/Z7 into the 5th bucket; hide the graph when there's no HR time
  const zones = Array.isArray(zonesRaw) && zonesRaw.length >= 5
    ? [...zonesRaw.slice(0, 4), zonesRaw.slice(4).reduce((a, b) => a + (b || 0), 0)]
    : null;
  const zoneTotal = zones ? zones.reduce((a, b) => a + b, 0) : 0;
  const maxZone = zones ? Math.max(...zones) : 0;
  const steps = stepsOf(w);
  const pace = w.sport === "run" && w.distance_km && w.duration_min
    ? Number(w.duration_min) / Number(w.distance_km) : null;

  return (
    <div className="rounded-xl bg-slate-50 p-2 text-[11px] leading-tight dark:bg-slate-100">
      <p className="font-mono font-semibold text-slate-900">
        {SPORT_EMOJI[w.sport] ?? "•"} {w.duration_min ? fmtDur(Number(w.duration_min)) : "—"}
        {w.distance_km ? ` · ${Number(w.distance_km).toFixed(1)} km` : ""}
      </p>
      <div className="mt-1 space-y-0.5 font-mono text-slate-500">
        {w.avg_hr != null && <p>❤ {Math.round(Number(w.avg_hr))} bpm</p>}
        {pace != null && <p>{fmtPace(pace)} /km</p>}
        {steps != null && <p>≈{steps.toLocaleString()} steps</p>}
      </div>
      {zones && zoneTotal > 60 && (
        <div className="mt-1.5 flex h-7 items-end gap-[3px]" title="Time in HR zones Z1–Z5+">
          {zones.map((secs, i) => (
            <div
              key={i}
              className={cn("flex-1 rounded-sm", secs > 0 ? ZONE_COLORS[i] : "bg-slate-200/70")}
              style={{ height: `${secs > 0 ? Math.max(6, (secs / (maxZone || 1)) * 26) : 3}px` }}
            />
          ))}
        </div>
      )}
      <p className="mt-1.5 truncate font-sans text-[11px] font-medium text-slate-600" title={w.name ?? ""}>
        {w.name ?? w.sport}
      </p>
    </div>
  );
}
