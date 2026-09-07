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
import { RefreshCw, Sparkles, Check, X, CalendarDays, Plus, Trash2, RotateCcw, CalendarPlus, CalendarX } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Button, Card, CardHeader, StatCard, StatusBadge, Modal, Input, Select, Textarea, cn } from "../../components/ui";
import {
  type TrPlanWeek, type TrRace, type TrSession, type TrWorkout, type TrHevyExercise,
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

export default function Dashboard() {
  const qc = useQueryClient();
  useTrSettings(); // ensures the settings row exists (pairing code, sync targets)
  const weekStart = mondayOf();
  const { data } = useWeekData(weekStart);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["tr-week"] });
  const [planOpen, setPlanOpen] = useState(false);

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
      {/* Row 1: compact race card + four half-width stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-6">
        <RaceMiniCard race={race} week={data?.week ?? null} />
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

      {/* Row 2: the week, full width (day columns) — click → popup editor */}
      <WeekCard weekStart={weekStart} week={data?.week ?? null} sessions={sessions}
        onOpen={() => setPlanOpen(true)} onSync={() => sync.mutate()} syncing={sync.isPending}
        syncResult={sync.isSuccess ? sync.data : null} syncError={sync.isError ? String(sync.error) : null} />

      {/* Row 3: the three charts, equal height */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <LiftedCard workouts={data?.workouts ?? []} currentWeek={weekStart} />
        <MuscleGroupCard workouts={data?.workouts ?? []} currentWeek={weekStart} />
        <RunKmCard workouts={data?.workouts ?? []} currentWeek={weekStart} />
      </div>

      {planOpen && (
        <WeekPlanModal weekStart={weekStart} week={data?.week ?? null} sessions={sessions}
          onClose={() => setPlanOpen(false)} onChanged={invalidate}
          onSync={() => sync.mutate()} syncing={sync.isPending}
          onGenerate={() => generate.mutate(data?.week ? "next" : "this")} generating={generate.isPending}
          generateLabel={data?.week ? "Plan next week" : "Generate this week"}
          error={generate.isError ? String(generate.error) : null} />
      )}
    </div>
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

function WeekCard({ weekStart, week, sessions, onOpen, onSync, syncing, syncResult, syncError }: {
  weekStart: string; week: TrPlanWeek | null; sessions: TrSession[]; onOpen: () => void;
  onSync: () => void; syncing: boolean;
  syncResult: { intervals: number; wellness: number; hevy: number; matched: number; removed: number; errors: string[] } | null;
  syncError: string | null;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));
  const today = localISO(new Date());
  return (
    <Card className="cursor-pointer transition hover:border-slate-300">
      <div onClick={onOpen}>
        <CardHeader title={`Week of ${weekStart}`}
          subtitle={week ? `${BLOCK_LABELS[week.block] ?? week.block} · ${week.generated_by}${week.focus ? ` · ${week.focus}` : ""}` : "No plan yet — open to generate the week"}
          action={
            <Button variant="secondary" onClick={(e) => { e.stopPropagation(); onSync(); }} loading={syncing}>
              <RefreshCw className="h-4 w-4" /> Sync
            </Button>
          } />
        {syncError && <p className="mx-5 mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{syncError}</p>}
        {syncResult && (
          <p className="mx-5 mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            Synced — intervals.icu {syncResult.intervals ?? 0} · Hevy {syncResult.hevy ?? 0} · matched {syncResult.matched}
            {syncResult.removed ? ` · removed ${syncResult.removed}` : ""}{syncResult.errors?.length ? ` · ⚠ ${syncResult.errors.join("; ")}` : ""}
          </p>
        )}
        <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4 lg:grid-cols-7">
          {days.map((d) => {
            const dt = new Date(d + "T00:00:00");
            const list = sessions.filter((x) => x.session_date === d);
            return (
              <div key={d} className={cn("min-h-[6.5rem] bg-surface px-3 py-2.5", d === today && "bg-indigo-50/40")}>
                <p className={cn("mb-1.5 text-[10px] font-semibold uppercase", d === today ? "text-indigo-600" : "text-slate-400")}>
                  {DAY_NAMES[(dt.getDay() + 6) % 7]} <span className="font-mono">{d.slice(8)}</span>
                </p>
                {list.length === 0 ? <p className="text-[11px] text-slate-300">—</p> : list.map((x) => (
                  <div key={x.id} className="mb-1.5">
                    <p className={cn("text-xs leading-snug", x.status === "skipped" ? "text-slate-400 line-through" : "font-medium text-slate-800")}>
                      {SPORT_EMOJI[x.sport] ?? "•"} {x.title}
                      {x.status === "done" && <span className="ml-1 text-emerald-600">✓</span>}
                      {x.status === "skipped" && <span className="ml-1 text-red-500">✗</span>}
                    </p>
                    {sessionMeta(x) && <p className="font-mono text-[10px] text-slate-400">{sessionMeta(x)}</p>}
                  </div>
                ))}
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
function WeekPlanModal({ weekStart, week, sessions, onClose, onChanged, onSync, syncing, onGenerate, generating, generateLabel, error }: {
  weekStart: string; week: TrPlanWeek | null; sessions: TrSession[]; onClose: () => void; onChanged: () => void;
  onSync: () => void; syncing: boolean; onGenerate: () => void; generating: boolean; generateLabel: string; error: string | null;
}) {
  const [editing, setEditing] = useState<string | null>(null); // session id being edited, "new:<date>" for a draft
  const edit = useMutation({ mutationFn: planEdit, onSuccess: () => { onChanged(); setEditing(null); } });
  // Week-level calendar controls: push = create missing + UPDATE existing events
  // (never a duplicate); clear = remove the week's events, keep the sessions.
  const calendar = useMutation({ mutationFn: planEdit, onSuccess: onChanged });
  const withEvents = sessions.filter((s) => s.gcal_event_id).length;
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));
  const byDay = (d: string) => sessions.filter((s) => s.session_date === d);

  return (
    <Modal open onClose={onClose} title={`Week of ${weekStart}${week ? ` · ${BLOCK_LABELS[week.block] ?? week.block}` : ""}`} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">{week?.focus ?? "No plan generated for this week yet."}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onSync} loading={syncing}><RefreshCw className="h-4 w-4" /> Sync</Button>
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
            <Button onClick={onGenerate} loading={generating}><Sparkles className="h-4 w-4" /> {generateLabel}</Button>
          </div>
        </div>
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
          <b className="text-slate-700">Progression guide</b> (applied by {generateLabel.toLowerCase()}, then edit freely):
          lifts repeat last week's weight on a rep ladder 8 → 10 → 12, then +5% weight back to 8, every set must hit the rung ·
          easy long run +12 min per week, every 4th week shorter to absorb · tempo and intervals are a preliminary suggestion — design them here.
          Edits, done/skip and delete update Google Calendar; "Push to Calendar" creates what's missing and updates the rest.
        </p>
        {calendar.isSuccess && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{calendar.data.applied.join(" · ")}</p>}
        {(error || edit.isError || calendar.isError) && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error ?? String(edit.error ?? calendar.error)}</p>}

        <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200/60">
          {days.map((d) => {
            const dt = new Date(d + "T00:00:00");
            const isToday = d === localISO(new Date());
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
                  {editing === `new:${d}` ? (
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
