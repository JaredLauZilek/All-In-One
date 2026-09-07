// Training → Overview (renamed from "Week" 2026-09-07): next-race feature card,
// this week's sessions vs what actually happened (synced from intervals.icu/Hevy),
// weekly run-km and weight-lifted line charts (last 8 weeks), sets per muscle
// group (Hevy exercise library), and the volume progression across plan weeks.
//
// The once-a-week ritual: Sync now → review the week → Generate next week
// (rule engine + Claude in the tr-plan-week edge fn, pushed to Google
// Calendar when configured). Mid-week changes happen through the Telegram bot.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Sparkles, Check, X, CalendarDays } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Button, Card, CardHeader, StatCard, StatusBadge, EmptyState, cn } from "../../components/ui";
import {
  type TrPlanWeek, type TrRace, type TrSession, type TrWorkout, type TrWellness, type TrHevyExercise,
  RACE_TYPES, SPORT_EMOJI, BLOCK_LABELS, DAY_NAMES,
  mondayOf, addDaysISO, daysUntil, localISO, useTrSettings,
  hevyExercises, workingSets, tonnageKg, muscleLabel,
} from "./lib";

const CHART_WEEKS = 8;
const workoutDay = (w: TrWorkout) => localISO(new Date(w.started_at)); // fixed MYT

function useWeekData(weekStart: string) {
  return useQuery({
    queryKey: ["tr-week", weekStart],
    queryFn: async () => {
      const weekEnd = addDaysISO(weekStart, 6);
      const [race, week, sessions, weeks, workouts, wellness] = await Promise.all([
        supabase.from("tr_races").select("*").eq("status", "upcoming")
          .order("race_date", { ascending: true, nullsFirst: false }).limit(1).maybeSingle(),
        supabase.from("tr_plan_weeks").select("*").eq("week_start", weekStart).maybeSingle(),
        supabase.from("tr_planned_sessions").select("*")
          .gte("session_date", weekStart).lte("session_date", weekEnd).order("session_date"),
        supabase.from("tr_plan_weeks").select("*").order("week_start"),
        // enough history for the 8-week charts and the 10-week progression bars
        supabase.from("tr_workouts").select("*")
          .gte("started_at", addDaysISO(weekStart, -7 * 11) + "T00:00:00+08:00")
          .order("started_at", { ascending: false }),
        supabase.from("tr_wellness").select("*").order("day", { ascending: false }).limit(14),
      ]);
      return {
        race: race.data as TrRace | null,
        week: week.data as TrPlanWeek | null,
        sessions: (sessions.data ?? []) as TrSession[],
        allWeeks: (weeks.data ?? []) as TrPlanWeek[],
        workouts: (workouts.data ?? []) as TrWorkout[],
        wellness: (wellness.data ?? []) as TrWellness[],
      };
    },
  });
}

export default function Dashboard() {
  const qc = useQueryClient();
  useTrSettings(); // ensures the settings row exists (pairing code, sync targets)
  const weekStart = mondayOf();
  const { data } = useWeekData(weekStart);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["tr-week"] });

  const sync = useMutation({
    mutationFn: async () => {
      const { data: res, error } = await supabase.functions.invoke("tr-sync", { body: {} });
      if (error) throw error;
      return res as { intervals: number; removed: number; wellness: number; strava: number; hevy: number; matched: number; errors: string[] };
    },
    onSuccess: invalidate,
  });

  const generate = useMutation({
    mutationFn: async (which: "this" | "next") => {
      const target = which === "this" ? weekStart : addDaysISO(weekStart, 7);
      const { data: res, error } = await supabase.functions.invoke("tr-plan-week", {
        body: { week_start: target },
      });
      if (error) throw error;
      if ((res as { error?: string })?.error) throw new Error((res as { error: string }).error);
      return res;
    },
    onSuccess: invalidate,
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("tr_planned_sessions")
        .update({ status, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const sessions = data?.sessions ?? [];
  const done = sessions.filter((s) => s.status === "done").length;
  const nonRest = sessions.filter((s) => s.sport !== "rest");
  const weekWorkouts = (data?.workouts ?? []).filter(
    (w) => workoutDay(w) >= weekStart && workoutDay(w) <= addDaysISO(weekStart, 6),
  );
  const actualKm = weekWorkouts.filter((w) => w.sport === "run")
    .reduce((a, w) => a + (Number(w.distance_km) || 0), 0);
  const actualHours = weekWorkouts.reduce((a, w) => a + (Number(w.duration_min) || 0), 0) / 60;
  const race = data?.race ?? null;
  const dTo = race?.race_date ? daysUntil(race.race_date) : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Next race" value={dTo != null ? `${dTo} days` : race ? "date TBC" : "—"}
          accent="bg-indigo-50 text-indigo-600" icon={<CalendarDays className="h-5 w-5" />} />
        <StatCard label="Sessions done" value={`${done}/${nonRest.length || "—"}`}
          accent="bg-emerald-50 text-emerald-600" icon={<Check className="h-5 w-5" />} />
        <StatCard label="Run km (actual/plan)"
          value={`${actualKm.toFixed(0)}/${data?.week?.planned_km ?? "—"}`}
          accent="bg-amber-50 text-amber-600" icon={<span className="text-base">🏃</span>} />
        <StatCard label="Hours this week" value={actualHours.toFixed(1)}
          accent="bg-slate-100 text-slate-600" icon={<span className="text-base">⏱️</span>} />
      </div>

      <RaceCard race={race} week={data?.week ?? null} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card>
            <CardHeader
              title={`Week of ${weekStart}`}
              subtitle={data?.week ? `${BLOCK_LABELS[data.week.block] ?? data.week.block} · generated by ${data.week.generated_by}` : "No plan generated yet"}
              action={
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" onClick={() => sync.mutate()} loading={sync.isPending}>
                    <RefreshCw className="h-4 w-4" /> Sync
                  </Button>
                  <Button onClick={() => generate.mutate(data?.week ? "next" : "this")} loading={generate.isPending}>
                    <Sparkles className="h-4 w-4" /> {data?.week ? "Plan next week" : "Generate this week"}
                  </Button>
                </div>
              }
            />
            {(sync.isError || generate.isError) && (
              <p className="mx-5 mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                {String((sync.error ?? generate.error as Error))}
              </p>
            )}
            {sync.isSuccess && (
              <p className="mx-5 mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                Synced — intervals.icu {sync.data.intervals ?? 0} · wellness {sync.data.wellness ?? 0} d · Hevy {sync.data.hevy} · matched {sync.data.matched}{sync.data.removed ? ` · removed ${sync.data.removed}` : ""}
                {sync.data.errors?.length ? ` · ⚠ ${sync.data.errors.join("; ")}` : ""}
              </p>
            )}
            {sessions.length === 0 ? (
              <EmptyState
                icon={<CalendarDays className="h-5 w-5" />}
                title="No sessions this week"
                subtitle="Hit Generate — the rule engine builds the week from your race calendar and recent volume, Claude fine-tunes it, and it lands in Google Calendar."
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {sessions.map((s) => (
                  <SessionRow key={s.id} s={s}
                    onDone={() => setStatus.mutate({ id: s.id, status: "done" })}
                    onSkip={() => setStatus.mutate({ id: s.id, status: "skipped" })}
                  />
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <RecoveryCard wellness={data?.wellness ?? []} />
          <RunKmCard workouts={data?.workouts ?? []} currentWeek={weekStart} />
          <LiftedCard workouts={data?.workouts ?? []} currentWeek={weekStart} />
          <MuscleGroupCard workouts={data?.workouts ?? []} currentWeek={weekStart} />
          <ProgressionCard weeks={data?.allWeeks ?? []} workouts={data?.workouts ?? []} currentWeek={weekStart} />
        </div>
      </div>
    </div>
  );
}

/* ---------------- the dark feature card: next race ---------------- */
function RaceCard({ race, week }: { race: TrRace | null; week: TrPlanWeek | null }) {
  if (!race) {
    return (
      <Card className="p-5">
        <p className="text-sm text-slate-500">
          No upcoming race — add one in the <b>Races</b> tab and plans will aim at it.
        </p>
      </Card>
    );
  }
  const dTo = race.race_date ? daysUntil(race.race_date) : null;
  return (
    <div className="rounded-3xl bg-gradient-to-br from-forest-600 to-forest-950 text-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-5">
        <div>
          <h3 className="text-sm font-bold">Training for</h3>
          <p className="mt-0.5 text-xs text-white/50">{RACE_TYPES[race.race_type] ?? race.race_type} · priority {race.priority}</p>
        </div>
        {week && <StatusBadge status={week.block === "race" ? "ENTRY" : "open"} dot={false} />}
      </div>
      <div className="px-6 py-5">
        <p className="text-2xl font-extrabold tracking-tight text-accent">
          {race.name}{dTo != null ? ` — ${dTo} days out` : " — date TBC"}
        </p>
        <p className="mt-1 text-xs text-white/40">
          {race.race_date ?? "Set the race date in the Races tab so the plan can periodize toward it."}
        </p>
        {week?.focus && (
          <p className="mt-4 flex gap-2.5 border-t border-white/10 pt-4 text-sm text-white/80">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <span><b className="text-white">{BLOCK_LABELS[week.block] ?? week.block} block.</b> {week.focus}</span>
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------------- one planned session row ---------------- */
function SessionRow({ s, onDone, onSkip }: { s: TrSession; onDone: () => void; onSkip: () => void }) {
  const day = new Date(s.session_date + "T00:00:00");
  const isToday = s.session_date === new Date().toISOString().slice(0, 10);
  return (
    <li className={cn("flex items-start gap-3 px-5 py-3", isToday && "bg-indigo-50/40")}>
      <div className="w-10 shrink-0 pt-0.5 text-center">
        <p className="text-[10px] font-semibold uppercase text-slate-400">{DAY_NAMES[(day.getDay() + 6) % 7]}</p>
        <p className="font-mono text-xs text-slate-500">{s.session_date.slice(8)}</p>
      </div>
      <span className="pt-0.5 text-base">{SPORT_EMOJI[s.sport] ?? "•"}</span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-semibold", s.status === "skipped" ? "text-slate-400 line-through" : "text-slate-900")}>
          {s.title}
          {(s.planned_km || s.planned_minutes) && (
            <span className="ml-2 font-mono text-[11px] font-normal text-slate-400">
              {[s.planned_km ? `${s.planned_km} km` : null, s.planned_minutes ? `${s.planned_minutes}′` : null].filter(Boolean).join(" · ")}
            </span>
          )}
        </p>
        {s.detail && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{s.detail}</p>}
      </div>
      {s.sport !== "rest" && (
        s.status === "planned" ? (
          <div className="flex shrink-0 gap-1 pt-0.5">
            <button title="Mark done" onClick={onDone}
              className="rounded-full p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600">
              <Check className="h-4 w-4" />
            </button>
            <button title="Skip" onClick={onSkip}
              className="rounded-full p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <StatusBadge status={s.status === "done" ? "PASS" : "FAIL"} dot={false} />
        )
      )}
    </li>
  );
}

/* ---------------- recovery (Garmin wellness via intervals.icu) ---------------- */
function RecoveryCard({ wellness }: { wellness: TrWellness[] }) {
  if (wellness.length === 0) return null; // feed not connected / no data yet
  const latest = wellness[0];
  const avg = (pick: (w: TrWellness) => number | null) => {
    const vals = wellness.map(pick).filter((v): v is number => v != null).map(Number);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const avgHrv = avg((w) => w.hrv), avgRhr = avg((w) => w.resting_hr);
  const metric = (label: string, value: string, tone?: "good" | "bad") => (
    <div>
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className={cn("mt-0.5 font-mono text-lg font-semibold",
        tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-red-600" : "text-slate-900")}>{value}</p>
    </div>
  );
  const hrvTone = latest.hrv != null && avgHrv != null
    ? (Number(latest.hrv) >= avgHrv * 0.95 ? "good" : "bad") : undefined;
  const rhrTone = latest.resting_hr != null && avgRhr != null
    ? (Number(latest.resting_hr) <= avgRhr * 1.05 ? "good" : "bad") : undefined;
  return (
    <Card>
      <CardHeader title="Recovery" subtitle={`Garmin wellness · latest ${latest.day} (vs 14-day avg)`} />
      <div className="grid grid-cols-3 gap-3 px-5 py-4">
        {metric("HRV", latest.hrv != null ? `${Math.round(Number(latest.hrv))} ms` : "—", hrvTone)}
        {metric("Resting HR", latest.resting_hr != null ? `${Math.round(Number(latest.resting_hr))} bpm` : "—", rhrTone)}
        {metric("Sleep", latest.sleep_secs != null ? `${(Number(latest.sleep_secs) / 3600).toFixed(1)} h` : "—")}
      </div>
    </Card>
  );
}

/* ---------------- volume progression bars ---------------- */
function ProgressionCard({ weeks, workouts, currentWeek }: {
  weeks: TrPlanWeek[]; workouts: TrWorkout[]; currentWeek: string;
}) {
  const shown = weeks.slice(-10);
  const maxKm = Math.max(10, ...shown.map((w) => Number(w.planned_km) || 0));
  const actualFor = (weekStart: string) => {
    const end = addDaysISO(weekStart, 6);
    return workouts.filter((w) => w.sport === "run" &&
      w.started_at.slice(0, 10) >= weekStart && w.started_at.slice(0, 10) <= end)
      .reduce((a, w) => a + (Number(w.distance_km) || 0), 0);
  };
  return (
    <Card>
      <CardHeader title="Volume progression" subtitle="Run km per plan week — bar = planned, lime = actually run" />
      {shown.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-slate-400">Generate your first week to start the graph.</p>
      ) : (
        <div className="space-y-2.5 px-5 py-4">
          {shown.map((w) => {
            const planned = Number(w.planned_km) || 0;
            const actual = actualFor(w.week_start);
            const isCurrent = w.week_start === currentWeek;
            return (
              <div key={w.id}>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className={cn("font-mono text-[11px]", isCurrent ? "font-bold text-slate-900" : "text-slate-400")}>
                    {w.week_start.slice(5)}{isCurrent && " ← now"}
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">
                    {actual > 0 ? `${actual.toFixed(0)}/` : ""}{planned} km · {BLOCK_LABELS[w.block] ?? w.block}
                  </span>
                </div>
                <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-slate-300"
                    style={{ width: `${Math.min(100, (planned / maxKm) * 100)}%` }} />
                  <div className="absolute inset-y-0 left-0 rounded-full bg-accent"
                    style={{ width: `${Math.min(100, (actual / maxKm) * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* ---------------- weekly totals: line charts (last 8 weeks) ---------------- */
interface WeekPoint { label: string; start: string; value: number }
function weeklySeries(workouts: TrWorkout[], currentWeek: string, keep: (w: TrWorkout) => boolean, pick: (w: TrWorkout) => number): WeekPoint[] {
  return Array.from({ length: CHART_WEEKS }, (_, i) => {
    const start = addDaysISO(currentWeek, -7 * (CHART_WEEKS - 1 - i)), end = addDaysISO(start, 6);
    const value = workouts.filter((w) => keep(w) && workoutDay(w) >= start && workoutDay(w) <= end)
      .reduce((a, w) => a + pick(w), 0);
    return { label: start.slice(5), start, value };
  });
}

/* One series, weekly totals, current week emphasised. Direct labels only on the
   current week and the peak (never every point); every dot has a hover title. */
function WeeklyLineChart({ series, fmt, unit, lineClass, areaClass, dotClass }: {
  series: WeekPoint[]; fmt: (v: number) => string; unit: string; lineClass: string; areaClass: string; dotClass: string;
}) {
  const W = 320, H = 120, L = 10, R = 10, T = 16, B = 18;
  const max = Math.max(...series.map((s) => s.value), 1) * 1.15;
  const x = (i: number) => L + (i * (W - L - R)) / (series.length - 1);
  const y = (v: number) => H - B - (v / max) * (H - T - B);
  const pts = series.map((s, i) => `${x(i).toFixed(1)},${y(s.value).toFixed(1)}`);
  const last = series.length - 1;
  const peak = series.reduce((m, s, i) => (s.value > series[m].value ? i : m), 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="stroke-slate-200" strokeWidth={1} />
      <path d={`M${x(0).toFixed(1)},${H - B}L${pts.join("L")}L${x(last).toFixed(1)},${H - B}Z`} className={areaClass} stroke="none" />
      <path d={`M${pts.join("L")}`} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className={lineClass} />
      {series.map((s, i) => (
        <g key={s.start}>
          <circle cx={x(i)} cy={y(s.value)} r={i === last ? 4.5 : 3} strokeWidth={2} className={cn(dotClass, "stroke-surface")}>
            <title>{`Week of ${s.start}: ${fmt(s.value)} ${unit}`}</title>
          </circle>
          {(i === last || (i === peak && peak !== last && s.value > 0)) && (
            <text x={x(i)} y={y(s.value) - 8} textAnchor={i === last ? "end" : "middle"} fontSize={9}
              className="fill-slate-700 font-mono font-semibold">{fmt(s.value)}</text>
          )}
          <text x={x(i)} y={H - 5} textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"} fontSize={8}
            className={cn("font-mono", i === last ? "fill-slate-700 font-semibold" : "fill-slate-400")}>{s.label}</text>
        </g>
      ))}
    </svg>
  );
}

function WeekDelta({ cur, prev, fmt, unit }: { cur: number; prev: number; fmt: (v: number) => string; unit: string }) {
  if (!prev && !cur) return <p className="text-[11px] text-slate-400">No data yet</p>;
  const diff = cur - prev;
  const pct = prev > 0 ? Math.round((diff / prev) * 100) : null;
  return (
    <p className={cn("font-mono text-[11px] font-semibold", diff > 0 ? "text-emerald-600" : diff < 0 ? "text-red-500" : "text-slate-400")}>
      {diff > 0 ? "▲" : diff < 0 ? "▼" : "±"} {pct != null ? `${Math.abs(pct)}% · ` : ""}{diff >= 0 ? "+" : "−"}{fmt(Math.abs(diff))} {unit}
      <span className="font-normal text-slate-400"> vs last week</span>
    </p>
  );
}

function RunKmCard({ workouts, currentWeek }: { workouts: TrWorkout[]; currentWeek: string }) {
  const series = weeklySeries(workouts, currentWeek, (w) => w.sport === "run", (w) => Number(w.distance_km) || 0);
  const cur = series[series.length - 1].value, prev = series[series.length - 2].value;
  const fmt = (v: number) => v.toFixed(1);
  return (
    <Card>
      <CardHeader title="Run km" subtitle={`Weekly total · last ${CHART_WEEKS} weeks`}
        action={<span className="font-mono text-lg font-bold text-slate-900">{fmt(cur)} km</span>} />
      <div className="px-5 pb-4">
        <WeekDelta cur={cur} prev={prev} fmt={fmt} unit="km" />
        <div className="mt-2">
          <WeeklyLineChart series={series} fmt={fmt} unit="km" lineClass="stroke-indigo-600" areaClass="fill-indigo-600/10" dotClass="fill-indigo-600" />
        </div>
      </div>
    </Card>
  );
}

function LiftedCard({ workouts, currentWeek }: { workouts: TrWorkout[]; currentWeek: string }) {
  const series = weeklySeries(workouts, currentWeek, (w) => w.source === "hevy", (w) => tonnageKg(hevyExercises(w)));
  const cur = series[series.length - 1].value, prev = series[series.length - 2].value;
  const fmt = (v: number) => Math.round(v).toLocaleString();
  return (
    <Card>
      <CardHeader title="Weight lifted" subtitle={`Weekly volume (Σ weight × reps, Hevy) · last ${CHART_WEEKS} weeks`}
        action={<span className="font-mono text-lg font-bold text-slate-900">{fmt(cur)} kg</span>} />
      <div className="px-5 pb-4">
        <WeekDelta cur={cur} prev={prev} fmt={fmt} unit="kg" />
        <div className="mt-2">
          <WeeklyLineChart series={series} fmt={fmt} unit="kg" lineClass="stroke-slate-700" areaClass="fill-slate-700/10" dotClass="fill-slate-700" />
        </div>
      </div>
    </Card>
  );
}

/* ---------------- sets per muscle group (Hevy exercise library) ---------------- */
/* Each logged exercise carries Hevy's template_id (stored by tr-sync since 0011);
   the library row gives its primary + secondary muscle groups. Working sets are
   counted in full for the primary group and shown separately for secondaries. */
function MuscleGroupCard({ workouts, currentWeek }: { workouts: TrWorkout[]; currentWeek: string }) {
  const inWeek = (start: string) => workouts.filter((w) => w.source === "hevy" && workoutDay(w) >= start && workoutDay(w) <= addDaysISO(start, 6));
  const thisWeek = inWeek(currentWeek), lastWeek = inWeek(addDaysISO(currentWeek, -7));
  const ids = [...new Set([...thisWeek, ...lastWeek].flatMap((w) => hevyExercises(w).map((e) => e.template_id)).filter((x): x is string => !!x))].sort();
  const catalog = useQuery({
    queryKey: ["tr-hevy-exercises", ids.join(",")],
    enabled: ids.length > 0,
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("tr_hevy_exercises").select("*").in("template_id", ids);
      if (error) throw error;
      return new Map((data as TrHevyExercise[]).map((r) => [r.template_id, r]));
    },
  });
  const tally = (list: TrWorkout[]) => {
    const primary = new Map<string, number>(), secondary = new Map<string, number>();
    let unmapped = 0;
    for (const w of list) for (const ex of hevyExercises(w)) {
      const n = workingSets(ex.sets);
      const row = ex.template_id ? catalog.data?.get(ex.template_id) : undefined;
      if (!row?.primary_muscle_group) { unmapped += n; continue; }
      primary.set(row.primary_muscle_group, (primary.get(row.primary_muscle_group) ?? 0) + n);
      for (const g of row.secondary_muscle_groups ?? []) secondary.set(g, (secondary.get(g) ?? 0) + n);
    }
    return { primary, secondary, unmapped };
  };
  const cur = tally(thisWeek), prev = tally(lastWeek);
  const groups = [...new Set([...cur.primary.keys(), ...cur.secondary.keys()])]
    .map((g) => ({ g, p: cur.primary.get(g) ?? 0, s: cur.secondary.get(g) ?? 0, prevP: prev.primary.get(g) ?? 0 }))
    .sort((a, b) => b.p - a.p || b.s - a.s);
  const max = Math.max(1, ...groups.map((r) => r.p + r.s));
  const totalSets = thisWeek.reduce((a, w) => a + hevyExercises(w).reduce((b, e) => b + workingSets(e.sets), 0), 0);

  return (
    <Card>
      <CardHeader title="Sets per muscle group" subtitle="This week · working sets · Hevy exercise library"
        action={<span className="font-mono text-lg font-bold text-slate-900">{totalSets} sets</span>} />
      {thisWeek.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-slate-400">No lifts logged this week yet.</p>
      ) : catalog.isPending && ids.length > 0 ? (
        <p className="px-5 py-6 text-center text-sm text-slate-400">Loading exercise library…</p>
      ) : (
        <div className="px-5 py-4">
          <div className="mb-2 flex justify-between text-[10px] font-medium uppercase tracking-wide text-slate-400">
            <span>Muscle</span><span>Sets · +secondary · vs last wk</span>
          </div>
          <div className="space-y-1.5">
            {groups.map((r) => {
              const d = r.p - r.prevP;
              return (
                <div key={r.g} className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="w-24 truncate font-sans font-medium text-slate-700" title={muscleLabel(r.g)}>{muscleLabel(r.g)}</span>
                  <div className="flex h-3 flex-1 overflow-hidden rounded-full bg-slate-100" title={`${r.p} primary + ${r.s} secondary sets`}>
                    <div className="h-full bg-indigo-600" style={{ width: `${(r.p / max) * 100}%` }} />
                    <div className="h-full bg-indigo-600/30" style={{ width: `${(r.s / max) * 100}%` }} />
                  </div>
                  <span className="w-6 text-right font-semibold text-slate-900">{r.p}</span>
                  <span className="w-8 text-right text-slate-400">{r.s ? `+${r.s}` : ""}</span>
                  <span className={cn("w-8 text-right", d > 0 ? "text-emerald-600" : d < 0 ? "text-red-500" : "text-slate-300")}>
                    {d > 0 ? `+${d}` : d < 0 ? `${d}` : "="}
                  </span>
                </div>
              );
            })}
          </div>
          {cur.unmapped > 0 && (
            <p className="mt-3 text-[11px] text-slate-400">
              {cur.unmapped} sets from exercises not yet in the library — hit Sync to map them.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
