// Training → Week: the weekly dashboard. Next-race feature card, this week's
// sessions vs what actually happened (synced from Strava/Hevy), the volume
// progression across all generated weeks, and recent workouts.
//
// The once-a-week ritual: Sync now → review the week → Generate next week
// (rule engine + Claude in the tr-plan-week edge fn, pushed to Google
// Calendar when configured). Mid-week changes happen through the Telegram bot.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Sparkles, Check, X, CalendarDays } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Button, Card, CardHeader, StatCard, StatusBadge, EmptyState, cn } from "../../components/ui";
import {
  type TrPlanWeek, type TrRace, type TrSession, type TrWorkout, type TrWellness,
  RACE_TYPES, SPORT_EMOJI, BLOCK_LABELS, DAY_NAMES,
  mondayOf, addDaysISO, daysUntil, useTrSettings,
} from "./lib";

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
        supabase.from("tr_workouts").select("*").order("started_at", { ascending: false }).limit(60),
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
      return res as { intervals: number; wellness: number; strava: number; hevy: number; matched: number; errors: string[] };
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
    (w) => w.started_at.slice(0, 10) >= weekStart && w.started_at.slice(0, 10) <= addDaysISO(weekStart, 6),
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
                Synced — intervals.icu {sync.data.intervals ?? 0} · wellness {sync.data.wellness ?? 0} d · Hevy {sync.data.hevy} · matched {sync.data.matched}
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
          <ProgressionCard weeks={data?.allWeeks ?? []} workouts={data?.workouts ?? []} currentWeek={weekStart} />
          <RecentWorkoutsCard workouts={(data?.workouts ?? []).slice(0, 6)} />
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

/* ---------------- recent workouts ---------------- */
function RecentWorkoutsCard({ workouts }: { workouts: TrWorkout[] }) {
  return (
    <Card>
      <CardHeader title="Recent workouts" subtitle="Synced from intervals.icu + Hevy" />
      {workouts.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-slate-400">
          Nothing yet — connect intervals.icu/Hevy in Settings and hit Sync.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {workouts.map((w) => (
            <li key={w.id} className="flex items-center gap-3 px-5 py-2.5">
              <span className="text-base">{SPORT_EMOJI[w.sport] ?? "•"}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{w.name ?? w.sport}</p>
                <p className="font-mono text-[11px] text-slate-400">
                  {w.started_at.slice(0, 10)} · {w.source}
                  {w.distance_km ? ` · ${Number(w.distance_km).toFixed(1)} km` : ""}
                  {w.duration_min ? ` · ${Math.round(Number(w.duration_min))}′` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
