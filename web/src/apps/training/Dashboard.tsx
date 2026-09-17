// Training → Overview (renamed from "Week" 2026-09-07): next-race feature card,
// this week's sessions vs what actually happened (synced from intervals.icu/Hevy),
// weekly run-km and weight-lifted line charts (last 8 weeks), sets per muscle
// group (Hevy exercise library), and the volume progression across plan weeks.
//
// The once-a-week ritual: Sync now → review the week → plan next week with the
// AI chat in the popup (no auto-planning — Jared's choice 2026-09-16)
// (rule engine + Claude in the tr-plan-week edge fn, pushed to Google
// Calendar when configured). Mid-week changes happen through the Telegram bot.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, CalendarDays, Pencil, Plus, Trash2, RotateCcw, CalendarPlus, CalendarX, ChevronLeft, ChevronRight, MessageSquare, Send } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Button, Card, CardHeader, StatCard, StatusBadge, Modal, Input, Select, Textarea, cn } from "../../components/ui";
import {
  type TrPlanWeek, type TrRace, type TrSession, type TrWorkout, type TrHevyExercise,
  RACE_TYPES, SPORT_EMOJI, BLOCK_LABELS, DAY_NAMES,
  mondayOf, addDaysISO, daysUntil, localISO, useTrSettings,
  hevyExercises, workingSets, tonnageKg, muscleLabel, dedupeGymShadows,
} from "./lib";

const CHART_WEEKS = 8;
const workoutDay = (w: TrWorkout) => localISO(new Date(w.started_at)); // fixed MYT
// A workout of sport X can count as executing a planned session of these sports
// (mirror of tr-sync's MATCHES — keep the two in step).
const SPORT_MATCH: Record<string, string[]> = {
  run: ["run", "hyrox", "brick"], ride: ["ride", "brick"], swim: ["swim", "brick"],
  strength: ["strength", "hyrox"], other: ["other", "hyrox", "mobility"],
};

function useWeekData(weekStart: string) {
  return useQuery({
    queryKey: ["tr-week", weekStart],
    queryFn: async () => {
      const weekEnd = addDaysISO(weekStart, 6);
      const [race, week, sessions, weeks, workouts] = await Promise.all([
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
      ]);
      return {
        race: race.data as TrRace | null,
        week: week.data as TrPlanWeek | null,
        sessions: (sessions.data ?? []) as TrSession[],
        allWeeks: (weeks.data ?? []) as TrPlanWeek[],
        workouts: (workouts.data ?? []) as TrWorkout[],
      };
    },
  });
}

/* Every plan edit — from the week popup — goes through tr-plan-edit, the single
   write path shared with the Telegram bot (mirrors Google Calendar). */
export interface PlanAction {
  op: "set_status" | "move" | "update" | "add_session" | "delete" | "push_week" | "clear_week";
  id?: string; status?: string; date?: string; title?: string; detail?: string | null;
  planned_minutes?: number | null; planned_km?: number | null; session_date?: string; sport?: string; week_start?: string;
}
async function planEdit(actions: PlanAction[]) {
  const { data, error } = await supabase.functions.invoke("tr-plan-edit", { body: { actions } });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as { applied: string[] };
}

/* The plan for one week (any week) — what the Week card and popup browse. */
function usePlanWeek(weekStart: string) {
  return useQuery({
    queryKey: ["tr-plan", weekStart],
    queryFn: async () => {
      const [week, sessions] = await Promise.all([
        supabase.from("tr_plan_weeks").select("*").eq("week_start", weekStart).maybeSingle(),
        supabase.from("tr_planned_sessions").select("*")
          .gte("session_date", weekStart).lte("session_date", addDaysISO(weekStart, 6)).order("session_date"),
      ]);
      return { week: week.data as TrPlanWeek | null, sessions: (sessions.data ?? []) as TrSession[] };
    },
  });
}

export default function Dashboard() {
  const qc = useQueryClient();
  useTrSettings(); // ensures the settings row exists (pairing code, sync targets)
  const weekStart = mondayOf();
  const { data } = useWeekData(weekStart);
  // The Week card + popup browse weeks (◀ ▶); stats and charts stay on the current week.
  // "Plan next week" jumps the view to next week so the result is visible at once.
  const [viewWeek, setViewWeek] = useState(weekStart);
  const plan = usePlanWeek(viewWeek);
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["tr-week"] }); qc.invalidateQueries({ queryKey: ["tr-plan"] }); };
  const [planOpen, setPlanOpen] = useState(false);

  const sessions = data?.sessions ?? [];
  const allWorkouts = dedupeGymShadows(data?.workouts ?? []);
  const weekWorkouts = allWorkouts.filter(
    (w) => workoutDay(w) >= weekStart && workoutDay(w) <= addDaysISO(weekStart, 6),
  );
  // Sessions done = what was EXECUTED, planned or not (Jared, 2026-09-17):
  // planned sessions ticked done + real workouts that no planned session
  // covers. Those extras join the denominator too, so 3 unplanned runs on a
  // 7-session plan read "3/10", not "0/7". "Covers" = the session was matched
  // by tr-sync to this workout, or is a done session on the same day with a
  // compatible sport (same vocabulary as tr-sync's matcher).
  const nonRest = sessions.filter((s) => s.sport !== "rest");
  const doneSessions = nonRest.filter((s) => s.status === "done");
  const covered = (w: TrWorkout) =>
    nonRest.some((s) => s.matched_workout_id === w.id) ||
    doneSessions.some((s) => s.session_date === workoutDay(w) && (SPORT_MATCH[w.sport] ?? [w.sport]).includes(s.sport));
  const unplanned = weekWorkouts.filter((w) => !covered(w));
  const doneCount = doneSessions.length + unplanned.length;
  const totalCount = nonRest.length + unplanned.length;
  const actualKm = weekWorkouts.filter((w) => w.sport === "run")
    .reduce((a, w) => a + (Number(w.distance_km) || 0), 0);
  // Plan km = the km on the run sessions Jared planned this week (skipped ones
  // excluded) — HE controls it via the editor/chat, not the old rule engine's number.
  const plannedRunKm = sessions.filter((s) => s.sport === "run" && s.status !== "skipped")
    .reduce((a, s) => a + (Number(s.planned_km) || 0), 0);
  const actualHours = weekWorkouts.reduce((a, w) => a + (Number(w.duration_min) || 0), 0) / 60;
  const race = data?.race ?? null;
  const dTo = race?.race_date ? daysUntil(race.race_date) : null;

  return (
    <div className="space-y-6">
      {/* Row 1: compact race card + four half-width stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-6">
        <RaceMiniCard race={race} week={data?.week ?? null} />
        <StatCard label="Next race" value={dTo != null ? `${dTo} days` : race ? "date TBC" : "—"}
          accent="bg-indigo-50 text-indigo-600" icon={<CalendarDays className="h-5 w-5" />} />
        <StatCard label="Sessions done" value={`${doneCount}/${totalCount || "—"}`}
          accent="bg-emerald-50 text-emerald-600" icon={<Check className="h-5 w-5" />} />
        <RunKmStat actualKm={actualKm} derivedKm={plannedRunKm} week={data?.week ?? null} weekStart={weekStart} onSaved={invalidate} />
        <StatCard label="Hours this week" value={actualHours.toFixed(1)}
          accent="bg-slate-100 text-slate-600" icon={<span className="text-base">⏱️</span>} />
      </div>

      {/* Row 2: the week, full width (day columns) — click → popup editor */}
      <WeekCard weekStart={viewWeek} currentWeek={weekStart} week={plan.data?.week ?? null} sessions={plan.data?.sessions ?? []}
        workouts={allWorkouts.filter((w) => workoutDay(w) >= viewWeek && workoutDay(w) <= addDaysISO(viewWeek, 6))}
        onPrev={() => setViewWeek(addDaysISO(viewWeek, -7))} onNext={() => setViewWeek(addDaysISO(viewWeek, 7))}
        onOpen={() => setPlanOpen(true)} />

      {/* Row 3: the three charts, equal height */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <LiftedCard workouts={data?.workouts ?? []} currentWeek={weekStart} />
        <MuscleGroupCard workouts={data?.workouts ?? []} currentWeek={weekStart} />
        <RunKmCard workouts={data?.workouts ?? []} currentWeek={weekStart} />
      </div>

      {planOpen && (
        <WeekPlanModal weekStart={viewWeek} currentWeek={weekStart} week={plan.data?.week ?? null} sessions={plan.data?.sessions ?? []}
          workouts={allWorkouts.filter((w) => workoutDay(w) >= viewWeek && workoutDay(w) <= addDaysISO(viewWeek, 6))}
          onPrev={() => setViewWeek(addDaysISO(viewWeek, -7))} onNext={() => setViewWeek(addDaysISO(viewWeek, 7))}
          onClose={() => setPlanOpen(false)} onChanged={invalidate}
          />
      )}
    </div>
  );
}

/* ---------------- row-1: run km with an editable target ---------------- */
/* Denominator = tr_plan_weeks.target_km when Jared has set one (click the
   pencil), else the sum of planned_km on this week's run sessions. Upserts the
   week row directly (owner RLS; user_id defaults to auth.uid()). */
function RunKmStat({ actualKm, derivedKm, week, weekStart, onSaved }: {
  actualKm: number; derivedKm: number; week: TrPlanWeek | null; weekStart: string; onSaved: () => void;
}) {
  const manual = week?.target_km != null ? Number(week.target_km) : null;
  const target = manual ?? (derivedKm > 0 ? derivedKm : null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const save = useMutation({
    mutationFn: async (value: number | null) => {
      const { error } = await supabase.from("tr_plan_weeks")
        .upsert({ week_start: weekStart, block: week?.block ?? "base", target_km: value }, { onConflict: "user_id,week_start" });
      if (error) throw error;
    },
    onSuccess: () => { setEditing(false); onSaved(); },
  });
  const commit = () => {
    const v = draft.trim();
    if (v === "") { save.mutate(null); return; } // blank = back to the derived sum
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) save.mutate(Math.round(n * 10) / 10); else setEditing(false);
  };
  return (
    <Card className="flex h-full items-center p-4 sm:p-5">
      <div className="flex w-full items-center gap-3 sm:gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 sm:h-11 sm:w-11"><span className="text-base">🏃</span></div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-slate-500">Run km (actual/plan)</p>
          {editing ? (
            <div className="mt-0.5 flex items-center gap-1 font-mono text-xl font-semibold text-slate-900">
              <span>{actualKm.toFixed(0)}/</span>
              <input autoFocus type="number" step="0.5" min="0" value={draft} onChange={(e) => setDraft(e.target.value)}
                onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
                placeholder={derivedKm > 0 ? derivedKm.toFixed(0) : "km"}
                className="w-16 rounded-md border border-slate-300 bg-surface px-1.5 py-0.5 text-lg outline-none ring-indigo-500 focus:ring-2" />
            </div>
          ) : (
            <button type="button" onClick={() => { setDraft(target != null ? String(target) : ""); setEditing(true); }}
              title={manual != null ? "Your target — click to change (blank = use the planned sessions' km)" : "Sum of this week's planned run km — click to set your own target"}
              className="group mt-0.5 flex items-center gap-1.5 truncate text-left text-xl font-semibold text-slate-900 sm:text-2xl">
              {actualKm.toFixed(0)}/{target != null ? target.toFixed(0) : "—"}
              <Pencil className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-600" />
            </button>
          )}
          {save.isError && <p className="text-[10px] text-red-500">{String(save.error)}</p>}
        </div>
      </div>
    </Card>
  );
}

/* ---------------- row-1 race card (compact) ---------------- */
function RaceMiniCard({ race, week }: { race: TrRace | null; week: TrPlanWeek | null }) {
  const dTo = race?.race_date ? daysUntil(race.race_date) : null;
  return (
    <div className="col-span-2 flex flex-col justify-between rounded-3xl bg-gradient-to-br from-forest-600 to-forest-950 p-4 text-white shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium text-white/50">
          Training for{race ? ` · ${RACE_TYPES[race.race_type] ?? race.race_type} · priority ${race.priority}` : ""}
        </p>
        {week && <StatusBadge status={week.block === "race" ? "ENTRY" : "open"} dot={false} />}
      </div>
      {race ? (
        <div className="mt-2">
          <p className="truncate text-lg font-extrabold leading-tight tracking-tight text-accent" title={race.name}>{race.name}</p>
          <p className="mt-0.5 font-mono text-[11px] text-white/60">
            {dTo != null ? `${dTo} days out · ${race.race_date}` : "date TBC — set it in Races"}
            {week ? ` · ${BLOCK_LABELS[week.block] ?? week.block} block` : ""}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-sm text-white/70">No upcoming race — add one in the <b className="text-white">Races</b> tab.</p>
      )}
    </div>
  );
}

/* ---------------- week card (compact) → popup editor ---------------- */
const SESSION_SPORTS = ["run", "ride", "swim", "strength", "hyrox", "brick", "mobility", "rest", "other"];
const sessionMeta = (s: TrSession) =>
  [s.planned_km ? `${s.planned_km} km` : null, s.planned_minutes ? `${s.planned_minutes}′` : null].filter(Boolean).join(" · ");

const weekTag = (weekStart: string, currentWeek: string) => {
  const diff = Math.round((new Date(weekStart + "T00:00:00Z").getTime() - new Date(currentWeek + "T00:00:00Z").getTime()) / (7 * 86400_000));
  return diff === 0 ? "this week" : diff === 1 ? "next week" : diff === -1 ? "last week" : diff > 0 ? `in ${diff} weeks` : `${-diff} weeks ago`;
};
function WeekNav({ weekStart, currentWeek, onPrev, onNext }: { weekStart: string; currentWeek: string; onPrev: () => void; onNext: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 p-0.5" onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={onPrev} title="Previous week" className="rounded-full p-1 text-slate-500 hover:bg-surface hover:text-slate-900"><ChevronLeft className="h-3.5 w-3.5" /></button>
      <span className="px-1 font-mono text-[11px] text-slate-600">{weekStart} · {weekTag(weekStart, currentWeek)}</span>
      <button type="button" onClick={onNext} title="Next week" className="rounded-full p-1 text-slate-500 hover:bg-surface hover:text-slate-900"><ChevronRight className="h-3.5 w-3.5" /></button>
    </span>
  );
}

/* Compact record of one executed activity — the Activities tab's card, minus
   the zone bars and popups (open the Activities tab for those). */
function MiniActivity({ w }: { w: TrWorkout }) {
  const exs = hevyExercises(w);
  const pace = w.sport === "run" && w.distance_km && w.duration_min ? Number(w.duration_min) / Number(w.distance_km) : null;
  return (
    <div className="rounded-xl bg-slate-50 px-2 py-1.5 text-[11px] leading-tight dark:bg-slate-100">
      <p className="truncate font-sans font-semibold text-slate-900" title={w.custom_name ?? w.name ?? w.sport}>{w.custom_name ?? w.name ?? w.sport}</p>
      <p className="font-mono font-semibold text-slate-800">
        {SPORT_EMOJI[w.sport] ?? "•"} {w.duration_min ? fmtMin(Number(w.duration_min)) : "—"}
        {w.distance_km ? ` · ${Number(w.distance_km).toFixed(1)} km` : ""}
        {exs.length ? ` · ${Math.round(tonnageKg(exs)).toLocaleString()} kg` : ""}
      </p>
      {(w.avg_hr != null || pace != null) && (
        <p className="font-mono text-[10px] text-slate-500">
          {w.avg_hr != null && <span>HR <b className="text-red-500">{Math.round(Number(w.avg_hr))}</b></span>}
          {w.avg_hr != null && pace != null && " · "}
          {pace != null && <span>pace <b className="text-indigo-600">{fmtPaceMin(pace)}</b></span>}
        </p>
      )}
      {exs.length > 0 && <p className="truncate font-sans text-[10px] text-slate-500">{exs.map((e) => e.name).join(" · ")}</p>}
    </div>
  );
}

function WeekCard({ weekStart, currentWeek, week, sessions, workouts, onPrev, onNext, onOpen }: {
  weekStart: string; currentWeek: string; week: TrPlanWeek | null; sessions: TrSession[]; workouts: TrWorkout[];
  onPrev: () => void; onNext: () => void; onOpen: () => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));
  const today = localISO(new Date());
  return (
    <Card className="cursor-pointer transition hover:border-slate-300">
      <div onClick={onOpen}>
        <CardHeader title={`Week of ${weekStart}`}
          subtitle={week ? `${BLOCK_LABELS[week.block] ?? week.block} · ${week.generated_by}${week.focus ? ` · ${week.focus}` : ""}` : "No plan for this week yet — open and plan it with AI"}
          action={<WeekNav weekStart={weekStart} currentWeek={currentWeek} onPrev={onPrev} onNext={onNext} />} />
        <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4 lg:grid-cols-7">
          {days.map((d) => {
            const dt = new Date(d + "T00:00:00");
            const list = sessions.filter((x) => x.session_date === d);
            const acts = workouts.filter((w) => workoutDay(w) === d);
            return (
              <div key={d} className={cn("min-h-[9rem] bg-surface px-3 py-2.5", d === today && "bg-indigo-50/40")}>
                <p className={cn("mb-1.5 text-[10px] font-semibold uppercase", d === today ? "text-indigo-600" : "text-slate-400")}>
                  {DAY_NAMES[(dt.getDay() + 6) % 7]} <span className="font-mono">{d.slice(8)}</span>
                </p>
                {/* planner area */}
                {list.length === 0 ? <p className="text-[11px] text-slate-300">no plan</p> : list.map((x) => (
                  <div key={x.id} className="mb-1.5">
                    <p className={cn("text-xs leading-snug", x.status === "skipped" ? "text-slate-400 line-through" : "font-medium text-slate-800")}>
                      {SPORT_EMOJI[x.sport] ?? "•"} {x.title}
                      {x.status === "done" && <span className="ml-1 text-emerald-600">✓</span>}
                      {x.status === "skipped" && <span className="ml-1 text-red-500">✗</span>}
                    </p>
                    {sessionMeta(x) && <p className="font-mono text-[10px] text-slate-400">{sessionMeta(x)}</p>}
                  </div>
                ))}
                {/* executed area — what actually happened, Activities-tab style */}
                {(acts.length > 0 || d <= today) && (
                  <div className="mt-2 space-y-1.5 border-t border-dashed border-slate-200 pt-2">
                    {acts.length === 0
                      ? <p className="text-[10px] text-slate-300">nothing recorded</p>
                      : acts.map((w) => <MiniActivity key={w.id} w={w} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="border-t border-slate-100 px-5 py-2 text-center text-[10px] text-slate-400">Click to open, edit and design the week</p>
      </div>
    </Card>
  );
}

/* The popup: structure and design this week. Every change is one tr-plan-edit
   action (same write path as the bot → Google Calendar stays in sync). */
function WeekPlanModal({ weekStart, currentWeek, week, sessions, workouts, onPrev, onNext, onClose, onChanged }: {
  weekStart: string; currentWeek: string; week: TrPlanWeek | null; sessions: TrSession[]; workouts: TrWorkout[];
  onPrev: () => void; onNext: () => void; onClose: () => void; onChanged: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null); // session id being edited, "new:<date>" for a draft
  const edit = useMutation({ mutationFn: planEdit, onSuccess: () => { onChanged(); setEditing(null); } });
  // Week-level calendar controls: push = create missing + UPDATE existing events
  // (never a duplicate); clear = remove the week's events, keep the sessions.
  const calendar = useMutation({ mutationFn: planEdit, onSuccess: onChanged });
  const withEvents = sessions.filter((s) => s.gcal_event_id).length;
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));
  const byDay = (d: string) => sessions.filter((s) => s.session_date === d);
  const todayIso = localISO(new Date());
  // Past days are history: no "add session"; instead what was ACTUALLY done
  // (synced workouts, same records the Activities tab shows).
  const actualsOn = (d: string) => workouts.filter((w) => workoutDay(w) === d);

  return (
    <Modal open onClose={onClose} title={`Week of ${weekStart}${week ? ` · ${BLOCK_LABELS[week.block] ?? week.block}` : ""}`} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <WeekNav weekStart={weekStart} currentWeek={currentWeek} onPrev={onPrev} onNext={onNext} />
          <p className="min-w-0 flex-1 text-xs text-slate-500">{week?.focus ?? "Nothing planned yet — describe the week below or add sessions by hand."}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" title="Create missing calendar events and update existing ones — never duplicates"
              onClick={() => calendar.mutate([{ op: "push_week", week_start: weekStart }])} loading={calendar.isPending}>
              <CalendarPlus className="h-4 w-4" /> Push to Calendar
            </Button>
            {withEvents > 0 && (
              <Button variant="ghost" title="Remove this week's events from Google Calendar (sessions stay here)"
                onClick={() => { if (confirm(`Remove ${withEvents} event(s) from Google Calendar? The sessions stay in the app.`)) calendar.mutate([{ op: "clear_week", week_start: weekStart }]); }}
                loading={calendar.isPending}>
                <CalendarX className="h-4 w-4" /> Clear
              </Button>
            )}
          </div>
        </div>
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
          <b className="text-slate-700">Progression guide</b> (the AI follows it when you plan below; edit anything freely):
          lifts repeat last week's weight on a rep ladder 8 → 10 → 12, then +5% weight back to 8, every set must hit the rung ·
          easy long run +12 min per week, every 4th week shorter to absorb · tempo and intervals are your call, the AI only suggests.
          Nothing touches Google Calendar until "Push to Calendar"; after that, edits, done/skip and delete keep the events in step.
        </p>
        {calendar.isSuccess && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{calendar.data.applied.join(" · ")}</p>}
        {(edit.isError || calendar.isError) && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{String(edit.error ?? calendar.error)}</p>}

        <PlanChat key={weekStart} weekStart={weekStart} onChanged={onChanged} />

        <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200/60">
          {days.map((d) => {
            const dt = new Date(d + "T00:00:00");
            const isToday = d === todayIso;
            const past = d < todayIso;
            return (
              <div key={d} className={cn("flex gap-3 px-4 py-3", isToday && "bg-indigo-50/40")}>
                <div className="w-10 shrink-0 pt-1 text-center">
                  <p className="text-[10px] font-semibold uppercase text-slate-400">{DAY_NAMES[(dt.getDay() + 6) % 7]}</p>
                  <p className="font-mono text-xs text-slate-500">{d.slice(8)}</p>
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  {byDay(d).map((s) => editing === s.id
                    ? <SessionForm key={s.id} initial={s} weekDays={days} busy={edit.isPending}
                        onCancel={() => setEditing(null)}
                        onSave={(v) => edit.mutate([
                          ...(v.session_date !== s.session_date ? [{ op: "move" as const, id: s.id, date: v.session_date }] : []),
                          { op: "update" as const, id: s.id, title: v.title, detail: v.detail, planned_minutes: v.planned_minutes, planned_km: v.planned_km, sport: v.sport },
                        ])} />
                    : <SessionLine key={s.id} s={s} busy={edit.isPending}
                        onEdit={() => setEditing(s.id)}
                        onStatus={(status) => edit.mutate([{ op: "set_status", id: s.id, status }])}
                        onDelete={() => { if (confirm(`Delete "${s.title}"?`)) edit.mutate([{ op: "delete", id: s.id }]); }} />
                  )}
                  {past ? (
                    <ActualBlock list={actualsOn(d)} />
                  ) : editing === `new:${d}` ? (
                    <SessionForm initial={{ session_date: d, sport: "run", title: "", detail: "", planned_minutes: null, planned_km: null }}
                      weekDays={days} busy={edit.isPending} onCancel={() => setEditing(null)}
                      onSave={(v) => edit.mutate([{ op: "add_session", session_date: v.session_date, sport: v.sport, title: v.title, detail: v.detail, planned_minutes: v.planned_minutes, planned_km: v.planned_km }])} />
                  ) : (
                    <button type="button" onClick={() => setEditing(`new:${d}`)}
                      className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-indigo-600">
                      <Plus className="h-3 w-3" /> add session
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-400">📅 = on Google Calendar. The Telegram bot proposes changes to this same plan; nothing applies without your OK.</p>
      </div>
    </Modal>
  );
}

/* ---------------- chat: spell out the week, get a proposal ---------------- */
/* Jared describes the week he wants; tr-plan-chat returns a reply + validated
   actions. Shown as a proposal with Apply / Discard — Apply goes through
   tr-plan-edit like every other edit. History lives in component state and
   resets when the viewed week changes (key={weekStart}). */
interface ChatMsg { role: "user" | "assistant"; content: string; actions?: PlanAction[]; lines?: string[]; state?: "pending" | "applied" | "discarded" }
function PlanChat({ weekStart, onChanged }: { weekStart: string; onChanged: () => void }) {
  const [open, setOpen] = useState(true);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const ask = useMutation({
    mutationFn: async (message: string) => {
      const history = msgs.slice(-8).map((m) => ({ role: m.role, content: m.content }));
      const { data, error } = await supabase.functions.invoke("tr-plan-chat", { body: { week_start: weekStart, message, history } });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data as { reply: string; actions: PlanAction[]; lines: string[] };
    },
    onSuccess: (res) => setMsgs((m) => [...m, { role: "assistant", content: res.reply, actions: res.actions, lines: res.lines, state: res.actions.length ? "pending" : undefined }]),
  });
  const apply = useMutation({
    mutationFn: async (i: number) => { const r = await planEdit(msgs[i].actions ?? []); return { i, r }; },
    onSuccess: ({ i }) => { setMsgs((m) => m.map((x, j) => (j === i ? { ...x, state: "applied" } : x))); onChanged(); },
  });
  const discard = (i: number) => setMsgs((m) => m.map((x, j) => (j === i ? { ...x, state: "discarded" } : x)));
  const send = () => {
    const t = text.trim(); if (!t || ask.isPending) return;
    setMsgs((m) => [...m, { role: "user", content: t }]); setText(""); ask.mutate(t);
  };
  return (
    <div className="rounded-2xl border border-slate-200/60">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-2.5 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-900"><MessageSquare className="h-4 w-4 text-indigo-600" /> Plan with AI</span>
        <span className="text-[11px] text-slate-400">{open ? "hide" : "spell out the week you want — it proposes the sessions, you Apply"}</span>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-4 py-3">
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {msgs.length === 0 && (
              <p className="text-xs text-slate-400">
                e.g. "Push Monday, Legs Wednesday, Pull Saturday with progression, tempo Thursday 6 km, long run Sunday" · "make this week lighter, I'm cooked" · "swap the interval run to Friday".
              </p>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed", m.role === "user" ? "bg-ink text-white dark:bg-accent dark:text-ink" : "bg-slate-50 text-slate-700")}>
                  <p className="whitespace-pre-line">{m.content}</p>
                  {m.lines && m.lines.length > 0 && (
                    <div className="mt-2 rounded-xl border border-slate-200/70 bg-surface p-2">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Proposed changes{m.state === "applied" ? " · applied ✓" : m.state === "discarded" ? " · discarded" : ""}</p>
                      <ul className="space-y-0.5">{m.lines.map((l, k) => <li key={k} className="text-[11px] text-slate-700">• {l}</li>)}</ul>
                      {m.state === "pending" && (
                        <div className="mt-2 flex gap-2">
                          <Button onClick={() => apply.mutate(i)} loading={apply.isPending}><Check className="h-3.5 w-3.5" /> Apply</Button>
                          <Button variant="ghost" onClick={() => discard(i)}><X className="h-3.5 w-3.5" /> Discard</Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {ask.isPending && <p className="text-[11px] text-slate-400">Thinking…</p>}
            {(ask.isError || apply.isError) && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{String(ask.error ?? apply.error)}</p>}
          </div>
          <div className="mt-3 flex items-end gap-2">
            <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Describe the week you want…"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <Button onClick={send} loading={ask.isPending}><Send className="h-4 w-4" /> Send</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* What actually happened on a past day — the synced records the Activities tab
   shows (runs from intervals.icu, lifts from Hevy), one line each. */
const fmtMin = (min: number) => { const m = Math.round(min); return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m` : `${m}m`; };
const fmtPaceMin = (minPerKm: number) => { const s = Math.round(minPerKm * 60); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
function ActualBlock({ list }: { list: TrWorkout[] }) {
  return (
    <div className="rounded-xl bg-emerald-50/60 px-3 py-2 dark:bg-emerald-50">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Actual</p>
      {list.length === 0 ? (
        <p className="text-[11px] text-slate-400">Nothing recorded — rest day, or not synced yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {list.map((w) => {
            const exs = hevyExercises(w);
            const pace = w.sport === "run" && w.distance_km && w.duration_min ? Number(w.duration_min) / Number(w.distance_km) : null;
            const bits = [
              w.duration_min ? fmtMin(Number(w.duration_min)) : null,
              w.distance_km ? `${Number(w.distance_km).toFixed(1)} km` : null,
              pace ? `${fmtPaceMin(pace)} /km` : null,
              w.avg_hr ? `${Math.round(Number(w.avg_hr))} bpm` : null,
              exs.length ? `${exs.length} exercises · ${Math.round(tonnageKg(exs)).toLocaleString()} kg` : null,
            ].filter(Boolean).join(" · ");
            return (
              <li key={w.id} className="text-xs text-slate-700">
                <span className="mr-1">{SPORT_EMOJI[w.sport] ?? "•"}</span>
                <span className="font-medium">{w.custom_name ?? w.name ?? w.sport}</span>
                {bits && <span className="ml-2 font-mono text-[11px] text-slate-500">{bits}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SessionLine({ s, busy, onEdit, onStatus, onDelete }: {
  s: TrSession; busy: boolean; onEdit: () => void; onStatus: (status: string) => void; onDelete: () => void;
}) {
  return (
    <div className="group flex items-start gap-2">
      <span className="pt-0.5 text-base">{SPORT_EMOJI[s.sport] ?? "•"}</span>
      <div className="min-w-0 flex-1 cursor-text" onClick={onEdit} title="Click to edit">
        <p className={cn("text-sm font-semibold", s.status === "skipped" ? "text-slate-400 line-through" : "text-slate-900")}>
          {s.title}
          {sessionMeta(s) && <span className="ml-2 font-mono text-[11px] font-normal text-slate-400">{sessionMeta(s)}</span>}
          {s.gcal_event_id && <span className="ml-2 text-[10px] font-normal text-slate-400" title="On Google Calendar">📅</span>}
        </p>
        {s.detail && <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-slate-500">{s.detail}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
        {s.sport !== "rest" && (s.status === "planned" ? (
          <>
            <button disabled={busy} title="Mark done" onClick={() => onStatus("done")} className="rounded-full p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"><Check className="h-4 w-4" /></button>
            <button disabled={busy} title="Skip" onClick={() => onStatus("skipped")} className="rounded-full p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"><X className="h-4 w-4" /></button>
          </>
        ) : (
          <>
            <StatusBadge status={s.status === "done" ? "PASS" : "FAIL"} dot={false} />
            <button disabled={busy} title="Re-open" onClick={() => onStatus("planned")} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><RotateCcw className="h-3.5 w-3.5" /></button>
          </>
        ))}
        <button disabled={busy} title="Delete" onClick={onDelete} className="rounded-full p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

interface SessionDraft { session_date: string; sport: string; title: string; detail: string | null; planned_minutes: number | null; planned_km: number | null }
function SessionForm({ initial, weekDays, busy, onSave, onCancel }: {
  initial: SessionDraft; weekDays: string[]; busy: boolean; onSave: (v: SessionDraft) => void; onCancel: () => void;
}) {
  const [v, setV] = useState<SessionDraft>({ ...initial, detail: initial.detail ?? "" });
  const set = <K extends keyof SessionDraft>(k: K, val: SessionDraft[K]) => setV((p) => ({ ...p, [k]: val }));
  const dayLabel = (d: string) => { const dt = new Date(d + "T00:00:00"); return `${DAY_NAMES[(dt.getDay() + 6) % 7]} ${d.slice(8)}`; };
  return (
    <form className="space-y-2 rounded-xl bg-slate-50 p-3" onSubmit={(e) => { e.preventDefault(); if (v.title.trim()) onSave({ ...v, title: v.title.trim(), detail: v.detail?.trim() || null }); }}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select value={v.session_date} onChange={(e) => set("session_date", e.target.value)}>
          {weekDays.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
        </Select>
        <Select value={v.sport} onChange={(e) => set("sport", e.target.value)}>
          {SESSION_SPORTS.map((sp) => <option key={sp} value={sp}>{SPORT_EMOJI[sp] ?? "•"} {sp}</option>)}
        </Select>
        <Input type="number" step="0.5" min="0" placeholder="km" value={v.planned_km ?? ""} onChange={(e) => set("planned_km", e.target.value === "" ? null : Number(e.target.value))} />
        <Input type="number" step="5" min="0" placeholder="minutes" value={v.planned_minutes ?? ""} onChange={(e) => set("planned_minutes", e.target.value === "" ? null : Number(e.target.value))} />
      </div>
      <Input autoFocus placeholder="Title — e.g. Interval run" value={v.title} onChange={(e) => set("title", e.target.value)} />
      <Textarea rows={2} placeholder="Detail — what exactly to do" value={v.detail ?? ""} onChange={(e) => set("detail", e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={busy}>Save</Button>
      </div>
    </form>
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
    <Card className="flex h-full flex-col">
      <CardHeader title={title} subtitle={subtitle}
        action={
          <div className="text-right">
            <p className="font-mono text-lg font-bold leading-tight text-slate-900">{fmt(cur)} {unit}</p>
            <p className="text-[10px] text-slate-400">last week · this week so far {fmt(soFar)}</p>
          </div>
        } />
      <div className="flex flex-1 flex-col justify-end px-5 pb-4 pt-4">
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
  const [pickerOpen, setPickerOpen] = useState(false);
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
  const totalSets = rows.reduce((a, r) => a + r.total, 0);

  // chart — same box as the other two cards
  const W = 320, H = 126, L = 22, R = 10, T = 14, B = 24;
  const { hover, onMove, clear } = useNearest(weeks, L, R, W);
  const maxV = Math.max(2, ...shown.flatMap((r) => r.arr)) * 1.1;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, weeks - 1);
  const y = (v: number) => H - B - (v / maxV) * (H - T - B);
  const gridStep = maxV > 20 ? 5 : 2;
  const grid: number[] = []; for (let v = 0; v <= maxV; v += gridStep) grid.push(v);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader title="Set count per muscle" subtitle="Weekly working sets · primary 1 · secondary ½"
        action={
          <div className="text-right">
            <p className="font-mono text-lg font-bold leading-tight text-slate-900">{fmtSets(totalSets)} sets</p>
            <p className="text-[10px] text-slate-400">last {weeks} weeks</p>
          </div>
        } />
      <div className="flex flex-1 flex-col justify-end px-5 pb-4 pt-4">
        {/* controls: muscle picker (scrollable dropdown) + range */}
        <div className="flex items-center justify-between gap-2">
          <div className="relative">
            <button type="button" onClick={() => setPickerOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-200">
              <span className="flex -space-x-1">
                {shown.slice(0, 4).map((r) => <span key={r.g} className={cn("inline-block h-2.5 w-2.5 rounded-full ring-1 ring-surface", muscleColor(r.g).bg)} />)}
              </span>
              {shown.length} of {rows.length} muscles ▾
            </button>
            {pickerOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} />
                <div className="absolute left-0 z-20 mt-1 max-h-56 w-60 overflow-y-auto rounded-2xl border border-slate-200/70 bg-surface p-1 shadow-lg">
                  {rows.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">No lifts in this range.</p>}
                  {rows.map((r) => {
                    const c = muscleColor(r.g), off = isHidden(r.g);
                    return (
                      <button key={r.g} type="button" onClick={() => toggle(r.g)}
                        className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left hover:bg-slate-50">
                        <span className={cn("flex h-4 w-4 items-center justify-center rounded-md border text-[10px] font-bold text-white",
                          off ? "border-slate-300 bg-transparent" : cn("border-transparent", c.bg))}>{off ? "" : "✓"}</span>
                        <span className={cn("flex-1 text-xs", off ? "text-slate-400" : "text-slate-800")}>{muscleLabel(r.g)}</span>
                        <span className={cn("font-mono text-xs font-semibold", off ? "text-slate-400" : "text-slate-900")}>{fmtSets(r.total)}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value) as (typeof RANGE_OPTIONS)[number])}
            className="rounded-full border border-slate-200 bg-surface px-2.5 py-1 text-[11px] font-medium text-slate-700">
            {RANGE_OPTIONS.map((n) => <option key={n} value={n}>Last {n} weeks</option>)}
          </select>
        </div>

        <div className="relative mt-2">
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
              <text key={d} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === weeks - 1 ? "end" : "middle"} fontSize={8} className="fill-slate-400 font-mono">{d.slice(5)}</text>
            ))}
            {lifts.length === 0 && <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={10} className="fill-slate-400">No lifts in this range</text>}
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
        </div>
        {unmapped > 0 && <p className="mt-1 text-[10px] text-slate-400">{unmapped} sets from exercises not yet in the library — hit Sync.</p>}
      </div>
    </Card>
  );
}
