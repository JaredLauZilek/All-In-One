// Training → Overview (renamed from "Week" 2026-09-07): next-race feature card,
// this week's sessions vs what actually happened (synced from intervals.icu/Hevy),
// weekly run-km and weight-lifted line charts (last 8 weeks), sets per muscle
// group (Hevy exercise library), and the volume progression across plan weeks.
//
// The once-a-week ritual: Sync now → review the week → Generate next week
// (rule engine + Claude in the tr-plan-week edge fn, pushed to Google
// Calendar when configured). Mid-week changes happen through the Telegram bot.
import { useState } from "react";
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

/* ---------------- weekly totals: line charts ---------------- */
/* Headline = LAST COMPLETED week (Jared: a Monday showing "0 km" is
   discouraging); the in-progress week is a small "so far" note instead. */
interface WeekPoint { label: string; start: string; value: number }
function weeklySeries(workouts: TrWorkout[], endWeek: string, n: number, keep: (w: TrWorkout) => boolean, pick: (w: TrWorkout) => number): WeekPoint[] {
  return Array.from({ length: n }, (_, i) => {
    const start = addDaysISO(endWeek, -7 * (n - 1 - i)), end = addDaysISO(start, 6);
    const value = workouts.filter((w) => keep(w) && workoutDay(w) >= start && workoutDay(w) <= end)
      .reduce((a, w) => a + pick(w), 0);
    return { label: start.slice(5), start, value };
  });
}
const weekLabel = (start: string) => {
  const a = new Date(start + "T00:00:00"), b = new Date(addDaysISO(start, 6) + "T00:00:00");
  const f = (d: Date) => `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })}`;
  return `${f(a)} – ${f(b)}`;
};

/* Shared hover maths: nearest week index from a mouse/touch x within the SVG. */
function useNearest(count: number, L: number, R: number, W: number) {
  const [hover, setHover] = useState<number | null>(null);
  const onMove = (e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0]?.clientX ?? 0 : e.clientX;
    const px = ((clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - L) / (W - L - R)) * (count - 1));
    setHover(Math.max(0, Math.min(count - 1, i)));
  };
  return { hover, onMove, clear: () => setHover(null) };
}

/* One series, weekly totals, last point emphasised. Hover/touch anywhere → crosshair
   + tooltip with that week's value; direct labels only on the last point and the peak. */
function WeeklyLineChart({ series, fmt, unit, lineClass, areaClass, dotClass }: {
  series: WeekPoint[]; fmt: (v: number) => string; unit: string; lineClass: string; areaClass: string; dotClass: string;
}) {
  // B leaves clear air between the area's baseline and the week labels.
  const W = 320, H = 126, L = 10, R = 10, T = 16, B = 24;
  const { hover, onMove, clear } = useNearest(series.length, L, R, W);
  const max = Math.max(...series.map((s) => s.value), 1) * 1.15;
  const x = (i: number) => L + (i * (W - L - R)) / (series.length - 1);
  const y = (v: number) => H - B - (v / max) * (H - T - B);
  const pts = series.map((s, i) => `${x(i).toFixed(1)},${y(s.value).toFixed(1)}`);
  const last = series.length - 1;
  const peak = series.reduce((m, s, i) => (s.value > series[m].value ? i : m), 0);
  const hp = hover != null ? series[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-none select-none"
        onMouseMove={onMove} onMouseLeave={clear} onTouchStart={onMove} onTouchMove={onMove} onTouchEnd={clear}>
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="stroke-slate-200" strokeWidth={1} />
        <path d={`M${x(0).toFixed(1)},${H - B}L${pts.join("L")}L${x(last).toFixed(1)},${H - B}Z`} className={areaClass} stroke="none" />
        <path d={`M${pts.join("L")}`} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className={lineClass} />
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T - 4} y2={H - B} className="stroke-slate-300" strokeWidth={1} />}
        {series.map((s, i) => (
          <g key={s.start}>
            <circle cx={x(i)} cy={y(s.value)} r={i === hover ? 5 : i === last ? 4.5 : 3} strokeWidth={2} className={cn(dotClass, "stroke-surface")} />
            {hover == null && (i === last || (i === peak && peak !== last && s.value > 0)) && (
              <text x={x(i)} y={y(s.value) - 8} textAnchor={i === last ? "end" : "middle"} fontSize={9}
                className="fill-slate-700 font-mono font-semibold">{fmt(s.value)}</text>
            )}
            <text x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"} fontSize={8}
              className={cn("font-mono", i === last ? "fill-slate-700 font-semibold" : "fill-slate-400")}>{s.label}</text>
          </g>
        ))}
      </svg>
      {hp && (
        <div className="pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2 py-1 font-mono text-[10px] text-white shadow-sm"
          style={{ left: `${(x(hover!) / W) * 100}%` }}>
          {weekLabel(hp.start)} · <b>{fmt(hp.value)} {unit}</b>
        </div>
      )}
    </div>
  );
}

function WeekDelta({ cur, prev, fmt, unit }: { cur: number; prev: number; fmt: (v: number) => string; unit: string }) {
  if (!prev && !cur) return <p className="text-[11px] text-slate-400">No data yet</p>;
  const diff = cur - prev;
  const pct = prev > 0 ? Math.round((diff / prev) * 100) : null;
  return (
    <p className={cn("font-mono text-[11px] font-semibold", diff > 0 ? "text-emerald-600" : diff < 0 ? "text-red-500" : "text-slate-400")}>
      {diff > 0 ? "▲" : diff < 0 ? "▼" : "±"} {pct != null ? `${Math.abs(pct)}% · ` : ""}{diff >= 0 ? "+" : "−"}{fmt(Math.abs(diff))} {unit}
      <span className="font-normal text-slate-400"> vs the week before</span>
    </p>
  );
}

function WeeklyTotalCard({ title, subtitle, unit, fmt, workouts, currentWeek, keep, pick, lineClass, areaClass, dotClass }: {
  title: string; subtitle: string; unit: string; fmt: (v: number) => string; workouts: TrWorkout[]; currentWeek: string;
  keep: (w: TrWorkout) => boolean; pick: (w: TrWorkout) => number; lineClass: string; areaClass: string; dotClass: string;
}) {
  const lastWeek = addDaysISO(currentWeek, -7);
  const series = weeklySeries(workouts, lastWeek, CHART_WEEKS, keep, pick);
  const cur = series[series.length - 1].value, prev = series[series.length - 2].value;
  const soFar = weeklySeries(workouts, currentWeek, 1, keep, pick)[0].value;
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle}
        action={
          <div className="text-right">
            <p className="font-mono text-lg font-bold leading-tight text-slate-900">{fmt(cur)} {unit}</p>
            <p className="text-[10px] text-slate-400">last week · this week so far {fmt(soFar)}</p>
          </div>
        } />
      <div className="px-5 pb-4 pt-4">
        <WeekDelta cur={cur} prev={prev} fmt={fmt} unit={unit} />
        <div className="mt-2">
          <WeeklyLineChart series={series} fmt={fmt} unit={unit} lineClass={lineClass} areaClass={areaClass} dotClass={dotClass} />
        </div>
      </div>
    </Card>
  );
}

function RunKmCard({ workouts, currentWeek }: { workouts: TrWorkout[]; currentWeek: string }) {
  return (
    <WeeklyTotalCard title="Run km" subtitle={`Weekly total · last ${CHART_WEEKS} completed weeks`} unit="km"
      fmt={(v) => v.toFixed(1)} workouts={workouts} currentWeek={currentWeek}
      keep={(w) => w.sport === "run"} pick={(w) => Number(w.distance_km) || 0}
      lineClass="stroke-indigo-600" areaClass="fill-indigo-600/10" dotClass="fill-indigo-600" />
  );
}

function LiftedCard({ workouts, currentWeek }: { workouts: TrWorkout[]; currentWeek: string }) {
  return (
    <WeeklyTotalCard title="Weight lifted" subtitle={`Weekly volume (Σ weight × reps, Hevy) · last ${CHART_WEEKS} completed weeks`} unit="kg"
      fmt={(v) => Math.round(v).toLocaleString()} workouts={workouts} currentWeek={currentWeek}
      keep={(w) => w.source === "hevy"} pick={(w) => tonnageKg(hevyExercises(w))}
      lineClass="stroke-slate-700" areaClass="fill-slate-700/10" dotClass="fill-slate-700" />
  );
}

/* ---------------- sets per muscle group (Hevy-style) ---------------- */
/* Hevy's convention: a working set counts 1 for the exercise's primary muscle
   and 0.5 for each secondary muscle (hence totals like 27.5). Weekly buckets,
   one line per muscle, legend rows toggle lines, totals over the period.
   Colours are assigned in a FIXED order per muscle (never by rank), so a muscle
   keeps its colour whatever else is shown. */
const MUSCLE_ORDER = ["chest", "triceps", "lats", "biceps", "shoulders", "upper_back", "forearms", "quadriceps",
  "hamstrings", "glutes", "abdominals", "calves", "lower_back", "traps", "adductors", "abductors", "cardio", "full_body", "neck", "other"];
// Warm/cool alternation so neighbouring series stay apart under colour-vision
// deficiency; the legend names every line, so colour is never the only cue.
const SERIES_COLORS = [
  { stroke: "stroke-sky-500", fill: "fill-sky-500", bg: "bg-sky-500" },
  { stroke: "stroke-orange-500", fill: "fill-orange-500", bg: "bg-orange-500" },
  { stroke: "stroke-violet-500", fill: "fill-violet-500", bg: "bg-violet-500" },
  { stroke: "stroke-emerald-500", fill: "fill-emerald-500", bg: "bg-emerald-500" },
  { stroke: "stroke-pink-500", fill: "fill-pink-500", bg: "bg-pink-500" },
  { stroke: "stroke-amber-400", fill: "fill-amber-400", bg: "bg-amber-400" },
  { stroke: "stroke-teal-500", fill: "fill-teal-500", bg: "bg-teal-500" },
  { stroke: "stroke-red-500", fill: "fill-red-500", bg: "bg-red-500" },
  { stroke: "stroke-indigo-600", fill: "fill-indigo-600", bg: "bg-indigo-600" },
  { stroke: "stroke-fuchsia-500", fill: "fill-fuchsia-500", bg: "bg-fuchsia-500" },
];
const muscleColor = (g: string) => {
  const i = MUSCLE_ORDER.indexOf(g);
  return i >= 0 && i < SERIES_COLORS.length ? SERIES_COLORS[i]
    : { stroke: "stroke-slate-400", fill: "fill-slate-400", bg: "bg-slate-400" };
};
const RANGE_OPTIONS = [4, 8, 12] as const;
const fmtSets = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function MuscleGroupCard({ workouts, currentWeek }: { workouts: TrWorkout[]; currentWeek: string }) {
  const [weeks, setWeeks] = useState<(typeof RANGE_OPTIONS)[number]>(4);
  const [hidden, setHidden] = useState<Set<string> | null>(null); // null = default (top 6 shown)
  const lastWeek = addDaysISO(currentWeek, -7);
  const rangeStart = addDaysISO(lastWeek, -7 * (weeks - 1));
  const lifts = workouts.filter((w) => w.source === "hevy" && workoutDay(w) >= rangeStart && workoutDay(w) <= addDaysISO(lastWeek, 6));
  const ids = [...new Set(lifts.flatMap((w) => hevyExercises(w).map((e) => e.template_id)).filter((x): x is string => !!x))].sort();
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

  // sets[muscle][weekIndex]
  const sets = new Map<string, number[]>();
  let unmapped = 0;
  const bump = (g: string, wi: number, n: number) => {
    if (!sets.has(g)) sets.set(g, new Array(weeks).fill(0));
    sets.get(g)![wi] += n;
  };
  for (const w of lifts) {
    const wi = Math.floor((new Date(workoutDay(w) + "T00:00:00Z").getTime() - new Date(rangeStart + "T00:00:00Z").getTime()) / (7 * 86400_000));
    if (wi < 0 || wi >= weeks) continue;
    for (const ex of hevyExercises(w)) {
      const n = workingSets(ex.sets);
      const row = ex.template_id ? catalog.data?.get(ex.template_id) : undefined;
      if (!row?.primary_muscle_group) { unmapped += n; continue; }
      bump(row.primary_muscle_group, wi, n);
      for (const g of row.secondary_muscle_groups ?? []) bump(g, wi, n * 0.5);
    }
  }
  const rows = [...sets.entries()].map(([g, arr]) => ({ g, total: arr.reduce((a, b) => a + b, 0), arr }))
    .sort((a, b) => b.total - a.total);
  const defaultHidden = new Set(rows.slice(6).map((r) => r.g));
  const isHidden = (g: string) => (hidden ?? defaultHidden).has(g);
  const toggle = (g: string) => {
    const next = new Set(hidden ?? defaultHidden);
    if (next.has(g)) next.delete(g); else next.add(g);
    setHidden(next);
  };
  const shown = rows.filter((r) => !isHidden(r.g));
  const labels = Array.from({ length: weeks }, (_, i) => addDaysISO(rangeStart, 7 * i));

  // chart
  const W = 320, H = 150, L = 22, R = 10, T = 10, B = 18;
  const { hover, onMove, clear } = useNearest(weeks, L, R, W);
  const maxV = Math.max(2, ...shown.flatMap((r) => r.arr)) * 1.1;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, weeks - 1);
  const y = (v: number) => H - B - (v / maxV) * (H - T - B);
  const gridStep = maxV > 20 ? 5 : 2;
  const grid: number[] = []; for (let v = 0; v <= maxV; v += gridStep) grid.push(v);

  return (
    <Card>
      <CardHeader title="Set count per muscle" subtitle="Working sets · primary 1 · secondary ½ (Hevy's counting)"
        action={
          <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value) as (typeof RANGE_OPTIONS)[number])}
            className="rounded-full border border-slate-200 bg-surface px-2.5 py-1 text-xs font-medium text-slate-700">
            {RANGE_OPTIONS.map((n) => <option key={n} value={n}>Last {n} weeks</option>)}
          </select>
        } />
      {lifts.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-slate-400">No lifts logged in this range.</p>
      ) : catalog.isPending && ids.length > 0 ? (
        <p className="px-5 py-6 text-center text-sm text-slate-400">Loading exercise library…</p>
      ) : (
        <>
          <div className="px-5 pt-2"><div className="relative">
            <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-none select-none"
              onMouseMove={onMove} onMouseLeave={clear} onTouchStart={onMove} onTouchMove={onMove} onTouchEnd={clear}>
              {grid.map((v) => (
                <g key={v}>
                  <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-slate-200" strokeWidth={1} strokeDasharray={v === 0 ? undefined : "3 3"} />
                  <text x={L - 4} y={y(v) + 3} textAnchor="end" fontSize={8} className="fill-slate-400 font-mono">{v}</text>
                </g>
              ))}
              {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="stroke-slate-300" strokeWidth={1} />}
              {shown.map((r) => {
                const c = muscleColor(r.g);
                const pts = r.arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
                return (
                  <g key={r.g}>
                    <path d={`M${pts.join("L")}`} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className={c.stroke} />
                    {r.arr.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={i === hover ? 4 : 3} strokeWidth={1.5} className={cn(c.fill, "stroke-surface")} />)}
                  </g>
                );
              })}
              {labels.map((d, i) => (
                <text key={d} x={x(i)} y={H - 5} textAnchor={i === 0 ? "start" : i === weeks - 1 ? "end" : "middle"} fontSize={8} className="fill-slate-400 font-mono">{d.slice(5)}</text>
              ))}
            </svg>
            {hover != null && shown.length > 0 && (
              <div className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 font-mono text-[10px] text-white shadow-sm"
                style={{ left: `${(x(hover) / W) * 100}%` }}>
                <p className="mb-0.5 font-semibold">{weekLabel(labels[hover])}</p>
                {shown.map((r) => (
                  <p key={r.g} className="flex items-center gap-1.5">
                    <span className={cn("inline-block h-2 w-2 rounded-full", muscleColor(r.g).bg)} />
                    <span className="text-white/70">{muscleLabel(r.g)}</span> <b>{fmtSets(r.arr[hover])}</b>
                  </p>
                ))}
              </div>
            )}
          </div></div>
          <div className="mt-2 border-t border-slate-100">
            <div className="flex justify-between px-5 py-2 text-[10px] font-medium uppercase tracking-wide text-slate-400">
              <span>Muscle</span><span>Sets · {weekLabel(rangeStart).split(" – ")[0]} – {weekLabel(lastWeek).split(" – ")[1]}</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {rows.map((r) => {
                const c = muscleColor(r.g), off = isHidden(r.g);
                return (
                  <li key={r.g}>
                    <button type="button" onClick={() => toggle(r.g)}
                      className="flex w-full items-center gap-3 px-5 py-2 text-left hover:bg-slate-50">
                      <span className={cn("flex h-4 w-4 items-center justify-center rounded-md border text-[10px] font-bold text-white",
                        off ? "border-slate-300 bg-transparent" : cn("border-transparent", c.bg))}>{off ? "" : "✓"}</span>
                      <span className={cn("flex-1 text-sm", off ? "text-slate-400" : "text-slate-800")}>{muscleLabel(r.g)}</span>
                      <span className={cn("font-mono text-sm font-semibold", off ? "text-slate-400" : "text-slate-900")}>{fmtSets(r.total)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {unmapped > 0 && (
              <p className="px-5 py-2 text-[11px] text-slate-400">{unmapped} sets from exercises not yet in the library — hit Sync to map them.</p>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
