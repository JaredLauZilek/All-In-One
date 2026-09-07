// tr-plan-week — generate (or regenerate) one training week.
//
// Pipeline: deterministic rule engine builds the skeleton (periodized block from
// weeks-to-race, run-volume progression from recent ACTUAL volume, a race-type
// session template) → optional Claude pass adapts it to what really happened
// (missed sessions, big fatigue) within guardrails → rows written to
// tr_plan_weeks / tr_planned_sessions → non-rest sessions pushed to Google
// Calendar when the google secrets are configured.
//
// POST {week_start?: "YYYY-MM-DD" (Monday; default = next Monday MYT),
//       use_claude?: boolean (default true), dry_run?: boolean (compute only)}
// Deployed verify_jwt: true — browser session only.
//
// ── Jared's progression rules (2026-09-07) — applied by the rule engine, kept
//    verbatim by the Claude pass; Jared then edits the week by hand in the app:
//  LIFTS  Each exercise done last week (Hevy) progresses on a rep ladder at the
//         SAME weight: 8 → 10 → 12 reps; once 12 is hit on every working set,
//         weight +5% (rounded to the plate step) and back to 8. "Achieved" = the
//         LOWEST reps across working sets (every set must hit the rung); a
//         missed rung repeats, so stagnation is handled naturally.
//  LONG RUN  Easy long run +12 min/week (rounded to 5); every 4th loading week is
//         the existing deload → ~70% of last week's long run (absorb week).
//  TEMPO / INTERVALS  No fixed method — Jared designs these weekly; the engine +
//         Claude only give a preliminary suggestion from last week's actuals.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const DAY = 86400_000;
const mytToday = () => new Date(new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
function nextMonday(): Date {
  const t = mytToday();
  const dow = (t.getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(t, 7 - dow);
}

type Sport = "run" | "ride" | "swim" | "strength" | "hyrox" | "brick" | "mobility" | "rest" | "other";
const mytDay = (isoTs: string) => new Date(new Date(isoTs).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
const round5 = (n: number) => Math.round(n / 5) * 5;

/* ---------------- progression: lifts (Hevy) ---------------- */
interface HevySet { weight_kg?: number | null; reps?: number | null; type?: string | null }
interface HevyEx { name: string; template_id?: string | null; sets: HevySet[] }
interface LiftRx { name: string; sets: number; reps: number; weight_kg: number | null; last: string }

function progressLift(ex: HevyEx): LiftRx | null {
  const work = ex.sets.filter((s) => s.type !== "warmup" && (s.reps ?? 0) > 0);
  if (!work.length) return null;
  // the weight he actually worked at = the most common working weight
  const freq = new Map<number, number>();
  for (const s of work) freq.set(s.weight_kg ?? 0, (freq.get(s.weight_kg ?? 0) ?? 0) + 1);
  const W = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  const achieved = Math.min(...work.map((s) => s.reps ?? 0)); // every set must hit the rung
  const repsDone = work.map((s) => s.reps ?? 0).join("/");
  let reps: number, weight: number | null;
  if (W <= 0) { // bodyweight: reps ladder only, caps at 12 (add load by hand)
    weight = null; reps = achieved >= 10 ? 12 : achieved >= 8 ? 10 : 8;
  } else if (achieved >= 12) {
    const step = W >= 30 ? 2.5 : 1;
    weight = Math.round((W * 1.05) / step) * step; if (weight <= W) weight = W + step;
    reps = 8;
  } else if (achieved >= 10) { weight = W; reps = 12; }
  else if (achieved >= 8) { weight = W; reps = 10; }
  else { weight = W; reps = 8; }
  return { name: ex.name, sets: work.length, reps, weight_kg: weight, last: `${W > 0 ? `${W} kg × ` : ""}${repsDone}` };
}
const rxLine = (r: LiftRx) => `${r.name}: ${r.sets} × ${r.reps}${r.weight_kg != null ? ` @ ${r.weight_kg} kg` : " (bodyweight)"}  (last ${r.last})`;

/* Last week's Hevy sessions → next week's strength sessions on the same weekdays,
   each exercise progressed. Replaces the template's generic strength days. */
function strengthFromHevy(lifts: { name: string | null; started_at: string; duration_min: number | null; data: unknown }[], weekStart: Date): Sess[] {
  const out: Sess[] = [];
  for (const w of lifts) {
    const exs = ((w.data as { exercises?: HevyEx[] })?.exercises ?? []).map(progressLift).filter((x): x is LiftRx => !!x);
    if (!exs.length) continue;
    const dow = (new Date(mytDay(w.started_at) + "T00:00:00Z").getUTCDay() + 6) % 7;
    out.push({
      session_date: iso(addDays(weekStart, dow)), sport: "strength",
      title: `${w.name ?? "Lift"} (Hevy)`,
      detail: `Progression from your last ${w.name ?? "lift"} session — same weight, next rung (8 → 10 → 12, then +5%):\n${exs.map(rxLine).join("\n")}`,
      planned_minutes: w.duration_min ? round5(Number(w.duration_min)) : 60, planned_km: null, intensity: "steady",
    });
  }
  return out;
}
interface Sess { session_date: string; sport: Sport; title: string; detail: string;
  planned_minutes: number | null; planned_km: number | null; intensity: string | null; }

/* ---------------- block from weeks-to-race ---------------- */
function blockFor(raceType: string, weeksOut: number | null): string {
  if (weeksOut === null) return "base";
  if (weeksOut <= 0) return "race";
  const short = raceType === "hyrox" || raceType === "half_marathon";
  if (weeksOut <= (short ? 1 : 2)) return "taper";
  if (weeksOut <= (short ? 4 : 6)) return "peak";
  if (weeksOut <= (short ? 10 : 14)) return "build";
  return "base";
}

const BLOCK_FOCUS: Record<string, string> = {
  base: "Aerobic base — easy volume, consistent strength, no heroics.",
  build: "Build — volume climbs ~8%/wk and race-specific work enters.",
  peak: "Peak — highest specificity; hold volume, sharpen intensity.",
  taper: "Taper — cut volume hard, keep small touches of intensity, sleep.",
  deload: "Deload — planned recovery week: ~60% volume, easy everything.",
  race: "Race week — short openers only. Trust the training.",
  recovery: "Post-race recovery — easy movement only.",
};

/* ---------------- session templates per race type ----------------
   dayIdx: 0=Mon … 6=Sun. Long session lands on settings.long_run_day. */
const DOW: Record<string, number> = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };

function skeleton(raceType: string, block: string, weekStart: Date, runKm: number, longDay: number, daysPerWeek: number): Sess[] {
  const d = (i: number) => iso(addDays(weekStart, i));
  const easyPace = "conversational pace, nose-breathing easy";
  const s: Sess[] = [];
  const push = (i: number, sport: Sport, title: string, detail: string, min: number | null, km: number | null, intensity: string | null) =>
    s.push({ session_date: d(i), sport, title, detail, planned_minutes: min, planned_km: km, intensity });

  const longKm = Math.round(runKm * 0.4);
  const qualityKm = Math.round(runKm * 0.22);
  const easyKm = Math.max(4, runKm - longKm - qualityKm);
  const hardOk = block !== "deload" && block !== "taper" && block !== "race" && block !== "recovery";

  if (block === "race") {
    push(1, "run", "Opener run", `20 min easy + 4×20s strides. Legs awake, nothing more.`, 25, 4, "easy");
    push(3, "mobility", "Mobility + walk", "30 min mobility, stay loose.", 30, null, "easy");
    push(5, "hyrox", "RACE DAY", "Execute the plan. Even pacing on the runs, steady stations.", null, null, "race");
    return s;
  }

  if (raceType === "hyrox") {
    push(0, "rest", "Rest", "Full rest day.", null, null, null);
    push(1, "run", hardOk ? "Interval run" : "Easy run",
      hardOk ? `6×3 min hard (RPE 8) / 2 min jog. Total ~${qualityKm} km with warm-up/down.` : `${qualityKm} km ${easyPace}.`,
      50, qualityKm, hardOk ? "intervals" : "easy");
    push(2, "strength", "Strength (Hevy) — lower + pull",
      "Squat/hinge focus + rows. Log it in Hevy as usual; it syncs in.", 60, null, "steady");
    push(3, "hyrox", "Compromised session",
      hardOk
        ? "4 rounds: 1 km run @ race effort + station work (sled push/pull, walking lunges, wall balls). Run tired — that's the point."
        : "2 easy rounds: 800 m jog + light station technique. No burn.",
      55, 5, hardOk ? "tempo" : "easy");
    if (daysPerWeek >= 6) push(4, "mobility", "Mobility", "30 min hips/ankles/thoracic + easy spin or walk.", 30, null, "easy");
    push(longDay, "run", "Long run", `${longKm} km ${easyPace}. Fuel it; last 10 min steady if feeling good.`, longKm * 7, longKm, "easy");
    if (daysPerWeek >= 6) push(longDay === 5 ? 6 : 5, "strength", "Strength (Hevy) — full body + core",
      "Press + carries + core. Leave 2 reps in reserve everywhere.", 60, null, "steady");
    // remaining easy km rolled into the compromised/long sessions — keep the week honest
    if (easyKm > 6 && daysPerWeek >= 7) push(4, "run", "Easy run", `${easyKm} km ${easyPace}.`, easyKm * 7, easyKm, "easy");
  } else if (raceType === "half_marathon" || raceType === "marathon") {
    push(0, "rest", "Rest", "Full rest day.", null, null, null);
    push(1, "run", hardOk ? "Interval run" : "Easy run",
      hardOk ? `Intervals: e.g. 6×800 m @ 5K effort / 400 m jog (~${qualityKm} km total).` : `${qualityKm} km ${easyPace}.`,
      55, qualityKm, hardOk ? "intervals" : "easy");
    push(2, "strength", "Strength (Hevy)", "Runner's strength: hinge, single-leg, calves, core.", 55, null, "steady");
    push(3, "run", hardOk ? "Tempo run" : "Easy run",
      hardOk ? `${Math.round(runKm * 0.18)} km with 20–30 min @ threshold (comfortably hard).` : `${Math.round(runKm * 0.18)} km easy.`,
      50, Math.round(runKm * 0.18), hardOk ? "tempo" : "easy");
    if (daysPerWeek >= 6) push(4, "mobility", "Mobility", "30 min mobility + strides.", 30, null, "easy");
    push(longDay, "run", "Long run",
      `${longKm} km ${easyPace}.${raceType === "marathon" && hardOk ? " Practice race fueling every 30 min." : ""}`,
      longKm * 7, longKm, "easy");
    if (daysPerWeek >= 6) push(6, "run", "Recovery run", `${easyKm} km very easy.`, easyKm * 7, easyKm, "easy");
  } else { // half_ironman / ironman / other → triathlon-flavoured week
    push(0, "rest", "Rest", "Full rest day.", null, null, null);
    push(1, "swim", "Swim", hardOk ? "Main set: 10×100 m strong / 20s rest + drills." : "Easy technique swim.", 50, 2, hardOk ? "intervals" : "easy");
    push(2, "ride", hardOk ? "Bike intervals" : "Easy spin", hardOk ? "4×8 min @ FTP-ish / 4 min easy." : "60 min easy spin.", 70, null, hardOk ? "intervals" : "easy");
    push(3, "run", hardOk ? "Tempo run" : "Easy run", `${qualityKm} km${hardOk ? " with 20 min @ threshold" : ` ${easyPace}`}.`, 50, qualityKm, hardOk ? "tempo" : "easy");
    push(4, "strength", "Strength (Hevy)", "Full-body maintenance + core.", 50, null, "steady");
    push(longDay, "brick", "Long ride + brick run", `Long ride, then ${Math.round(longKm * 0.4)} km run straight off the bike.`, 150, null, "easy");
    push(6, "run", "Long run", `${longKm} km ${easyPace}.`, longKm * 7, longKm, "easy");
  }
  return s;
}

/* ---------------- Google Calendar (optional) ---------------- */
async function gcalToken(): Promise<string | null> {
  const id = Deno.env.get("GOOGLE_CLIENT_ID"), secret = Deno.env.get("GOOGLE_CLIENT_SECRET"), refresh = Deno.env.get("GOOGLE_REFRESH_TOKEN");
  if (!id || !secret || !refresh) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  if (!r.ok) return null;
  return (await r.json()).access_token ?? null;
}

async function gcalInsert(access: string, sess: Sess, sessionTime: string): Promise<string | null> {
  const calId = encodeURIComponent(Deno.env.get("GOOGLE_CALENDAR_ID") ?? "primary");
  const start = `${sess.session_date}T${sessionTime}:00+08:00`;
  const mins = sess.planned_minutes ?? 60;
  const end = new Date(new Date(start).getTime() + mins * 60_000).toISOString();
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: `🏋️ ${sess.title}`,
      description: `${sess.detail}\n\n— All-In-One Training`,
      start: { dateTime: start }, end: { dateTime: end },
    }),
  });
  if (!r.ok) return null;
  return (await r.json()).id ?? null;
}

/* ---------------- optional Claude adjustment pass ---------------- */
async function claudeAdjust(ctx: Record<string, unknown>, sessions: Sess[]): Promise<{ sessions?: Sess[]; focus?: string; error?: string }> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return { error: "no ANTHROPIC_API_KEY" };
  const model = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model, max_tokens: 8000,
      system:
        "You are the training-plan adjuster inside a personal training app. You receive a rule-generated week skeleton plus what actually happened recently. Adjust the skeleton ONLY where the data justifies it (missed key sessions → don't stack fatigue; strong compliance → keep the plan; a hard race soon → protect the taper). Keep every session_date within the same week, keep 3–9 sessions, keep total minutes within ±20% of the skeleton, and keep sports within: run, ride, swim, strength, hyrox, brick, mobility, rest, other. HARD RULES: any 'strength' session whose title ends in '(Hevy)' and any long-run session carry Jared's own progression rules (see context.progression_rules) — return them UNCHANGED (same date, title, detail, minutes, km). For tempo/interval runs give a concrete preliminary suggestion built from context.last_week_runs; Jared will redesign those by hand. Sharpen other 'detail' text into concrete, personal prescriptions. Respond with ONLY a JSON object: {\"focus\": string, \"sessions\": [{\"session_date\",\"sport\",\"title\",\"detail\",\"planned_minutes\",\"planned_km\",\"intensity\"}]} — no markdown fences, no commentary.",
      messages: [{ role: "user", content: JSON.stringify({ context: ctx, skeleton: sessions }) }],
    }),
  });
  if (!r.ok) {
    const errBody = await r.text().catch(() => "");
    return { error: `Anthropic HTTP ${r.status}: ${errBody.slice(0, 300)}` };
  }
  const data = await r.json();
  // The model may emit thinking blocks before the text block — join all text.
  const text = ((data.content ?? []) as { type: string; text?: string }[])
    .filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  try {
    const parsed = JSON.parse(text.replace(/^```json?\s*|```\s*$/g, ""));
    const ok = Array.isArray(parsed.sessions) && parsed.sessions.length >= 3 && parsed.sessions.length <= 9 &&
      parsed.sessions.every((x: Sess) =>
        typeof x.session_date === "string" && typeof x.title === "string" &&
        ["run", "ride", "swim", "strength", "hyrox", "brick", "mobility", "rest", "other"].includes(x.sport));
    if (!ok) return { error: `Claude output failed validation: ${text.slice(0, 200)}` };
    return { sessions: parsed.sessions, focus: typeof parsed.focus === "string" ? parsed.focus : undefined };
  } catch {
    return { error: `Claude output not JSON (stop: ${data.stop_reason}): ${text.slice(0, 200) || JSON.stringify(data.content ?? []).slice(0, 200)}` };
  }
}

/* ---------------- main ---------------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    const { data: userData } = await svc.auth.getUser(jwt);
    let userId = userData?.user?.id ?? null;
    if (!userId) {
      const { data: s } = await svc.from("tr_settings").select("user_id").limit(1).maybeSingle();
      userId = s?.user_id ?? null; // anon-JWT caller (Telegram webhook), single-user app
    }
    if (!userId) return json({ error: "No user" }, 401);

    const body = await req.json().catch(() => ({}));
    const weekStart = body.week_start ? new Date(body.week_start) : nextMonday();
    if ((weekStart.getUTCDay() + 6) % 7 !== 0) return json({ error: "week_start must be a Monday" }, 400);
    const weekStartStr = iso(weekStart);

    const [{ data: settings }, { data: races }, { data: pastWeeks }] = await Promise.all([
      svc.from("tr_settings").select("*").eq("user_id", userId).maybeSingle(),
      svc.from("tr_races").select("*").eq("user_id", userId).eq("status", "upcoming")
        .order("race_date", { ascending: true, nullsFirst: false }),
      svc.from("tr_plan_weeks").select("week_start, block, planned_km").eq("user_id", userId)
        .lt("week_start", weekStartStr).order("week_start", { ascending: false }).limit(8),
    ]);
    const race = races?.[0] ?? null;
    const weeksOut = race?.race_date
      ? Math.ceil((new Date(race.race_date).getTime() - weekStart.getTime()) / (7 * DAY))
      : null;

    let block = blockFor(race?.race_type ?? "other", weeksOut);
    // planned deload every 4th consecutive loading week
    const loading = (pastWeeks ?? []).filter((w) => ["base", "build", "peak"].includes(w.block)).length;
    if (["base", "build"].includes(block) && loading > 0 && (loading + 1) % 4 === 0) block = "deload";

    // volume: progress from the larger of recent actuals and last planned week
    const { data: recent } = await svc.from("tr_workouts").select("sport, distance_km, started_at")
      .eq("user_id", userId).gte("started_at", new Date(Date.now() - 28 * DAY).toISOString());
    const actualWeeklyKm = (recent ?? []).filter((w) => w.sport === "run")
      .reduce((a, w) => a + (Number(w.distance_km) || 0), 0) / 4;
    const lastPlanned = Number(pastWeeks?.[0]?.planned_km) || 0;
    const baseKm = Math.max(15, actualWeeklyKm, lastPlanned);
    const factor: Record<string, number> = { base: 1.05, build: 1.08, peak: 1.0, deload: 0.6, taper: 0.5, race: 0.3, recovery: 0.4 };
    const runKm = Math.round(baseKm * (factor[block] ?? 1));

    const longDay = DOW[(settings?.long_run_day ?? "saturday").toLowerCase()] ?? 5;
    const daysPerWeek = settings?.days_per_week ?? 6;
    let sessions = skeleton(race?.race_type ?? "other", block, weekStart, runKm, longDay, daysPerWeek);

    /* ---------- Jared's progression rules, from the most recent actuals ----------
       Reference = the most recent week WITH data, looking back up to 3 weeks before
       the target (planning next week on a Monday must not see an empty "last week").
       Lifts and runs pick their reference week independently. */
    const lookback = addDays(weekStart, -21);
    const { data: recentWorkouts } = await svc.from("tr_workouts")
      .select("source, sport, name, custom_name, started_at, duration_min, distance_km, avg_hr, data")
      .eq("user_id", userId)
      .gte("started_at", lookback.toISOString()).lt("started_at", new Date(weekStart.getTime() - 8 * 3600_000).toISOString())
      .order("started_at");
    const weekOf = (w: { started_at: string }) =>
      Math.floor((new Date(mytDay(w.started_at) + "T00:00:00Z").getTime() - lookback.getTime()) / (7 * DAY)); // 0..2 (2 = week just before target)
    const latestWeek = (list: { started_at: string }[]) => (list.length ? Math.max(...list.map(weekOf)) : -1);
    const hevyAll = (recentWorkouts ?? []).filter((w) => w.source === "hevy");
    const runAll = (recentWorkouts ?? []).filter((w) => w.sport === "run");
    const liftWeek = latestWeek(hevyAll), runWeek = latestWeek(runAll);
    const lastLifts = hevyAll.filter((w) => weekOf(w) === liftWeek);
    const lastRuns = runAll.filter((w) => weekOf(w) === runWeek);
    const progression: Record<string, unknown> = {
      reference: {
        lifts_week: liftWeek >= 0 ? iso(addDays(lookback, 7 * liftWeek)) : null,
        runs_week: runWeek >= 0 ? iso(addDays(lookback, 7 * runWeek)) : null,
      },
    };
    // lifts: replace the template's generic strength days with Hevy-derived, progressed ones
    const liftSessions = strengthFromHevy(lastLifts, weekStart);
    if (liftSessions.length && block !== "race") {
      sessions = sessions.filter((s) => s.sport !== "strength").concat(liftSessions);
      progression.lifts = liftSessions.map((s) => ({ day: s.session_date, title: s.title, exercises: s.detail.split("\n").length - 1 }));
    }
    // long run: +12 min on last week's longest run; deload week = ~70% (absorb)
    const lastLong = lastRuns.filter((w) => w.duration_min).sort((a, b) => Number(b.duration_min) - Number(a.duration_min))[0];
    const longIdx = sessions.findIndex((s) => s.sport === "run" && /long/i.test(s.title));
    if (lastLong && longIdx !== -1 && block !== "race" && block !== "taper") {
      const D = Number(lastLong.duration_min), K = Number(lastLong.distance_km) || 0;
      const target = block === "deload" ? round5(D * 0.7) : round5(D + 12);
      const km = K > 0 ? Math.round((target * (K / D)) * 10) / 10 : null;
      const easyPace = "conversational pace, nose-breathing easy";
      sessions[longIdx] = {
        ...sessions[longIdx], planned_minutes: target, planned_km: km,
        title: block === "deload" ? "Long run (absorb week)" : "Easy long run",
        detail: block === "deload"
          ? `${target} min${km ? ` (~${km} km)` : ""} ${easyPace}. Absorb week: shorter than your last long run of ${Math.round(D)} min — let the last 3 weeks land.`
          : `${target} min${km ? ` (~${km} km)` : ""} ${easyPace}. +${target - Math.round(D)} min on your last long run of ${Math.round(D)} min${K ? ` / ${K} km` : ""}.`,
      };
      progression.long_run = { last_min: Math.round(D), next_min: target, deload: block === "deload" };
    }
    sessions.sort((a, b) => a.session_date.localeCompare(b.session_date));
    let focus = BLOCK_FOCUS[block];
    let generatedBy = "rules";
    let claudeError: string | null = null;

    if (body.use_claude !== false) {
      const [{ data: lastWeekSessions }, { data: wellness }] = await Promise.all([
        svc.from("tr_planned_sessions")
          .select("session_date, sport, title, status").eq("user_id", userId)
          .gte("session_date", iso(addDays(weekStart, -7))).lt("session_date", weekStartStr),
        svc.from("tr_wellness")
          .select("day, resting_hr, hrv, sleep_secs, sleep_score").eq("user_id", userId)
          .order("day", { ascending: false }).limit(14),
      ]);
      const adjusted = await claudeAdjust({
        week_start: weekStartStr, block, weeks_to_race: weeksOut,
        race: race ? { name: race.name, type: race.race_type, date: race.race_date } : null,
        run_km_target: runKm, weekly_hours: settings?.weekly_hours ?? 8,
        last_week: lastWeekSessions ?? [],
        // Jared's rules (see header). Strength + long-run sessions in the skeleton
        // already embody them — Claude must keep those verbatim.
        progression_rules: {
          lifts: "8 → 10 → 12 reps at the same weight, then +5% weight back to 8; every working set must hit the rung; already computed in the strength sessions — keep them exactly.",
          long_run: "+12 min per week; every 4th loading week (deload) ~70% — already computed in the long-run session — keep it exactly.",
          tempo_intervals: "No fixed method: Jared designs these weekly. Give ONE sensible preliminary suggestion each, derived from last week's actual runs below.",
        },
        last_week_runs: lastRuns.map((w) => ({
          day: mytDay(w.started_at), name: w.custom_name ?? w.name, km: w.distance_km, min: w.duration_min, avg_hr: w.avg_hr,
          pace_min_per_km: w.distance_km && w.duration_min ? Math.round((Number(w.duration_min) / Number(w.distance_km)) * 100) / 100 : null,
        })),
        recent_workouts: (recent ?? []).map((w) => ({ sport: w.sport, km: w.distance_km, at: w.started_at })),
        // Garmin wellness via intervals.icu — HRV/resting-HR trends and short
        // sleep justify easing a week; empty when the feed isn't connected.
        recent_wellness: (wellness ?? []).map((w) => ({
          day: w.day, resting_hr: w.resting_hr, hrv: w.hrv,
          sleep_h: w.sleep_secs != null ? Math.round(Number(w.sleep_secs) / 360) / 10 : null,
          sleep_score: w.sleep_score,
        })),
      }, sessions);
      if (adjusted.sessions) {
        sessions = adjusted.sessions;
        if (adjusted.focus) focus = adjusted.focus;
        generatedBy = "rules+claude";
      } else {
        claudeError = adjusted.error ?? "unknown"; // week still ships, rules-only
      }
    }

    const totalMin = sessions.reduce((a, s) => a + (s.planned_minutes ?? 0), 0);
    if (body.dry_run === true) {
      return json({ dry_run: true, week: { week_start: weekStartStr, block, focus, planned_km: runKm, planned_minutes: totalMin, generated_by: generatedBy },
        sessions, progression, claude_error: claudeError });
    }
    const { data: week, error: werr } = await svc.from("tr_plan_weeks").upsert({
      user_id: userId, race_id: race?.id ?? null, week_start: weekStartStr, block, focus,
      planned_km: runKm, planned_minutes: totalMin, generated_by: generatedBy,
    }, { onConflict: "user_id,week_start" }).select().single();
    if (werr) return json({ error: werr.message }, 500);

    // regenerate = replace still-planned sessions; completed/skipped rows stay
    const { data: old } = await svc.from("tr_planned_sessions").select("id, gcal_event_id")
      .eq("user_id", userId).eq("status", "planned")
      .gte("session_date", weekStartStr).lte("session_date", iso(addDays(weekStart, 6)));
    const access = await gcalToken();
    if (access) {
      const calId = encodeURIComponent(Deno.env.get("GOOGLE_CALENDAR_ID") ?? "primary");
      for (const o of old ?? []) {
        if (o.gcal_event_id) {
          await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${o.gcal_event_id}`, {
            method: "DELETE", headers: { Authorization: `Bearer ${access}` },
          }).catch(() => {});
        }
      }
    }
    if ((old ?? []).length) await svc.from("tr_planned_sessions").delete().in("id", (old ?? []).map((o) => o.id));

    let pushed = 0;
    const rows = [];
    for (const s of sessions) {
      let gcalId: string | null = null;
      if (access && s.sport !== "rest") {
        gcalId = await gcalInsert(access, s, settings?.session_time ?? "06:30");
        if (gcalId) pushed++;
      }
      rows.push({ ...s, user_id: userId, race_id: race?.id ?? null, gcal_event_id: gcalId });
    }
    const { data: inserted, error: serr } = await svc.from("tr_planned_sessions").insert(rows).select();
    if (serr) return json({ error: serr.message }, 500);

    return json({ week, sessions: inserted, calendar_pushed: pushed, generated_by: generatedBy, progression, claude_error: claudeError });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
