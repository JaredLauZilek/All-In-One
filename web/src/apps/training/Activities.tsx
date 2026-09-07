// Training → Activities: intervals.icu-style weekly review, trimmed to what
// Jared actually reads — per activity: time, distance, avg HR, pace, steps
// (estimated from run cadence ×2 — Garmin sends no step total per workout)
// and an HR-zone mini-graph with the title below; per week (left rail):
// gym vs cardio totals with %-change against the previous week.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CalendarRange, RefreshCw, Pencil } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Button, Card, EmptyState, Modal, cn } from "../../components/ui";
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

/* Absolute change, signed: "+9.1 km", "−1,240 kg". Colour follows direction. */
function AbsDelta({ cur, prev, unit, decimals = 0 }: { cur: number; prev: number; unit: string; decimals?: number }) {
  const diff = cur - prev;
  if (!prev && !cur) return null;
  if (Math.abs(diff) < 0.05) return <span className="font-mono text-[11px] text-slate-400">±0 {unit}</span>;
  const num = Math.abs(diff).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (
    <span className={cn("font-mono text-[11px] font-semibold", diff > 0 ? "text-emerald-600" : "text-red-500")}>
      {diff > 0 ? "+" : "−"}{num} {unit}
    </span>
  );
}

/* One sport row: "🏃 Run   3h59m · 29.0 km" then, under it, the change in the
   headline quantity — distance for cardio, tonnage for gym — as a % AND an absolute
   number: "▲ 45% +9.0 km". Both refer to the same thing (Jared: a "▼ 3% time /
   +368 kg" pair read as a contradiction). Time isn't compared. */
function SportRow({ emoji, label, min, amount, unit, decimals, prev }: {
  emoji: string; label: string; min: number; amount: number; unit: string; decimals: number;
  prev: { min: number; amount: number } | null;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-slate-500">{emoji} {label}</span>
        <span className="font-mono text-xs font-semibold text-slate-800">
          {fmtDur(min)} · {amount.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} {unit}
        </span>
      </div>
      {prev && (amount > 0 || prev.amount > 0) && (
        <div className="mt-0.5 flex items-baseline justify-end gap-2">
          <Delta cur={amount} prev={prev.amount} />
          <AbsDelta cur={amount} prev={prev.amount} unit={unit} decimals={decimals} />
        </div>
      )}
    </div>
  );
}

function WeekSummary({ weekStart, isCurrent, workouts, prevWorkouts }: {
  weekStart: string; isCurrent: boolean; workouts: TrWorkout[]; prevWorkouts: TrWorkout[] | null;
}) {
  const sum = (list: TrWorkout[], sports: string[], field: "duration_min" | "distance_km") =>
    list.filter((w) => sports.includes(w.sport)).reduce((a, w) => a + (Number(w[field]) || 0), 0);
  const tonnage = (list: TrWorkout[]) =>
    list.filter((w) => GYM.includes(w.sport)).reduce((a, w) => a + tonnageKg((w.data as Detail).exercises), 0);
  // Per-sport buckets. All four rows always show — an empty sport reads "0m · 0.0 km"
  // (Jared wants the zero visible, not a hidden row).
  const stats = (list: TrWorkout[]) => ({
    run: { min: sum(list, ["run"], "duration_min"), amount: sum(list, ["run"], "distance_km") },
    swim: { min: sum(list, ["swim"], "duration_min"), amount: sum(list, ["swim"], "distance_km") },
    ride: { min: sum(list, ["ride"], "duration_min"), amount: sum(list, ["ride"], "distance_km") },
    gym: { min: sum(list, GYM, "duration_min"), amount: tonnage(list) },
    totalMin: sum(list, [...CARDIO, ...GYM], "duration_min"),
  });
  const cur = stats(workouts);
  const prev = prevWorkouts ? stats(prevWorkouts) : null;

  return (
    <div className="flex flex-col border-b border-slate-100 bg-slate-50/60 px-4 py-3.5 md:border-b-0 md:border-r">
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
            <span className="font-mono text-sm font-semibold text-slate-900">{fmtDur(cur.totalMin)}</span>
          </div>
          <div className="space-y-2.5 border-t border-slate-200/60 pt-2.5">
            <SportRow emoji="🏃" label="Run" unit="km" decimals={1} min={cur.run.min} amount={cur.run.amount} prev={prev && prev.run} />
            <SportRow emoji="🏊" label="Swim" unit="km" decimals={1} min={cur.swim.min} amount={cur.swim.amount} prev={prev && prev.swim} />
            <SportRow emoji="🚴" label="Cycle" unit="km" decimals={1} min={cur.ride.min} amount={cur.ride.amount} prev={prev && prev.ride} />
            <SportRow emoji="🏋️" label="Gym" unit="kg" decimals={0} min={cur.gym.min} amount={cur.gym.amount} prev={prev && prev.gym} />
          </div>
        </div>
      )}
      {prev && workouts.length > 0 && (
        <p className="mt-auto pt-4 text-[10px] text-slate-400">vs week {isoWeekNo(addDaysISO(weekStart, -7))}</p>
      )}
    </div>
  );
}

/* ---------------- lift detail popup ---------------- */
const SET_TYPE_TAG: Record<string, string> = { warmup: "W", dropset: "D", failure: "F" };
const fmtKg = (kg: number) => kg.toLocaleString(undefined, { maximumFractionDigits: kg < 100 ? 1 : 0 });
const startClock = (iso: string) => {
  const t = new Date(new Date(iso).getTime() + 8 * 3600_000); // fixed MYT
  return `${t.getUTCHours()}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
};

/* Everything Hevy gave us for one session, set by set. Data = what tr-sync stores
   (exercise name + per-set weight/reps/type) — see training/CLAUDE.md for the
   fields Hevy offers beyond that (notes, RPE, muscle groups…) if wanted later. */
function LiftDetail({ w, onClose }: { w: TrWorkout; onClose: () => void }) {
  const exs = (w.data as Detail).exercises ?? [];
  const all = exs.flatMap((e) => e.sets);
  const totalReps = all.reduce((a, st) => a + (st.reps ?? 0), 0);
  const volume = tonnageKg(exs);
  const Tile = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="font-mono text-base font-bold text-slate-900">{value}</p>
      {sub && <p className="font-mono text-[10px] text-slate-500">{sub}</p>}
    </div>
  );
  return (
    <Modal open onClose={onClose} title={`${w.custom_name ?? w.name ?? "Lift"} · ${dayLabel(workoutDay(w))} · ${startClock(w.started_at)}`} wide>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label="Time" value={w.duration_min ? fmtDur(Number(w.duration_min)) : "—"} />
          <Tile label="Sets" value={String(workingSets(all))} sub={all.length !== workingSets(all) ? `${all.length} incl. warm-ups` : undefined} />
          <Tile label="Reps" value={totalReps.toLocaleString()} />
          <Tile label="Volume" value={`${fmtKg(volume)} kg`} sub={`${exs.length} exercises`} />
        </div>

        <div className="space-y-4">
          {exs.map((ex, i) => {
            const vol = ex.sets.reduce((a, st) => a + (st.weight_kg ?? 0) * (st.reps ?? 0), 0);
            const best = ex.sets.reduce((m, st) => Math.max(m, st.weight_kg ?? 0), 0);
            return (
              <div key={i}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">{ex.name}</p>
                  <p className="shrink-0 font-mono text-[11px] text-slate-500">
                    {workingSets(ex.sets)} sets{vol > 0 && ` · ${fmtKg(vol)} kg`}{best > 0 && ` · top ${fmtKg(best)} kg`}
                  </p>
                </div>
                <table className="w-full font-mono text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                      <th className="w-10 py-1 text-left font-medium">Set</th>
                      <th className="py-1 text-right font-medium">Weight</th>
                      <th className="py-1 text-right font-medium">Reps</th>
                      <th className="py-1 text-right font-medium">Volume</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ex.sets.map((st, j) => (
                      <tr key={j} className={cn(st.type === "warmup" && "text-slate-400")}>
                        <td className="py-1 text-left">
                          {j + 1}
                          {st.type && SET_TYPE_TAG[st.type] && (
                            <span className="ml-1 rounded-full bg-slate-200 px-1.5 text-[9px] font-semibold text-slate-600" title={st.type}>
                              {SET_TYPE_TAG[st.type]}
                            </span>
                          )}
                        </td>
                        <td className="py-1 text-right">{st.weight_kg != null && st.weight_kg > 0 ? `${fmtKg(st.weight_kg)} kg` : "BW"}</td>
                        <td className="py-1 text-right">{st.reps ?? "—"}</td>
                        <td className="py-1 text-right text-slate-500">
                          {st.weight_kg && st.reps ? fmtKg(st.weight_kg * st.reps) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-400">W = warm-up · D = drop set · F = to failure · BW = bodyweight. Volume = weight × reps.</p>
      </div>
    </Modal>
  );
}

/* ---------------- one activity mini-card ---------------- */
function ActivityCard({ w, customOnly }: { w: TrWorkout; customOnly: boolean }) {
  const d = w.data as Detail;
  // Rename in place. Hover shows a pencil; the title becomes an input. Enter/blur
  // saves, Esc cancels, an empty value clears the rename (back to the source
  // title). Saved to custom_name — a column tr-sync never writes, so it outlives
  // every future sync, unlike `name` (rewritten from intervals.icu/Hevy each run).
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [detail, setDetail] = useState(false);
  const hasLiftDetail = Array.isArray(d.exercises) && d.exercises.length > 0;
  const shown = w.custom_name ?? w.name ?? w.sport;
  const rename = useMutation({
    mutationFn: async (value: string) => {
      const v = value.trim();
      const { error } = await supabase.from("tr_workouts")
        .update({ custom_name: v && v !== (w.name ?? "") ? v : null }).eq("id", w.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tr-activities"] });
      qc.invalidateQueries({ queryKey: ["tr-week"] });
    },
  });
  const startEdit = () => { setDraft(shown); setEditing(true); };
  const commit = () => { setEditing(false); if (draft.trim() !== shown) rename.mutate(draft); };
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
  const tonnage = tonnageKg(d.exercises);
  const pace = w.sport === "run" && w.distance_km && w.duration_min
    ? Number(w.duration_min) / Number(w.distance_km) : null;

  return (<>
    {/* Rendered OUTSIDE the card element: React click events bubble up the
        component tree, so a close click inside the popup would otherwise reach
        the card's onClick and reopen it. */}
    {detail && <LiftDetail w={w} onClose={() => setDetail(false)} />}
    <div
      className={cn("group relative rounded-xl bg-slate-50 p-2 text-[11px] leading-tight dark:bg-slate-100",
        hasLiftDetail && "cursor-pointer transition hover:bg-slate-100 dark:hover:bg-slate-200")}
      onClick={hasLiftDetail && !editing ? () => setDetail(true) : undefined}
      title={hasLiftDetail ? "Click for set-by-set detail" : undefined}
    >
      {!editing && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); startEdit(); }}
          aria-label="Rename"
          title="Rename"
          className="absolute right-1.5 top-1.5 rounded-full p-1 text-slate-400 opacity-0 transition hover:bg-slate-200/70 hover:text-slate-700 focus:opacity-100 group-hover:opacity-100"
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}
      {editing ? (
        <input
          autoFocus
          onClick={(e) => e.stopPropagation()}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setDraft(shown); setEditing(false); }
          }}
          placeholder={w.name ?? w.sport}
          className="mb-1 w-full rounded-md border border-slate-300 bg-surface px-1.5 py-0.5 font-sans text-[11px] font-semibold text-slate-900 outline-none ring-indigo-500 focus:ring-2"
        />
      ) : (
        <p
          className={cn("mb-1 truncate pr-5 font-sans text-[11px] font-semibold", rename.isPending ? "text-slate-400" : "text-slate-900")}
          title={w.custom_name ? `Source title: ${w.name ?? w.sport}` : shown}
        >
          {shown}
        </p>
      )}
      <p className="font-mono font-semibold text-slate-900">
        {SPORT_EMOJI[w.sport] ?? "•"} {w.duration_min ? fmtDur(Number(w.duration_min)) : "—"}
        {w.distance_km ? ` · ${Number(w.distance_km).toFixed(1)} km` : ""}
        {tonnage > 0 ? ` · ${Math.round(tonnage).toLocaleString()} kg` : ""}
      </p>
      <div className="mt-1 space-y-0.5 font-mono text-slate-500">
        {w.avg_hr != null && <p>Avg HR <span className="font-bold text-red-500">{Math.round(Number(w.avg_hr))} bpm</span></p>}
        {pace != null && <p>Avg Pace <span className="font-bold text-indigo-600">{fmtPace(pace)} /km</span></p>}
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
  </>);
}
