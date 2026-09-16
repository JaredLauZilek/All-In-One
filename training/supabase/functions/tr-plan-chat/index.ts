// tr-plan-chat — the chat inside the app's week editor. Jared spells out the
// week he wants (this week or next); Claude turns it into concrete session
// PROPOSALS in the same action vocabulary the editor and the Telegram bot use
// (set_status / move / update / add_session / delete), validated against the
// viewed week. NOTHING is applied here — the popup shows the proposal with
// Apply / Discard and Apply goes through tr-plan-edit.
//
// POST { week_start: "YYYY-MM-DD", message: string, history?: [{role, content}] }
// → { reply, actions, lines }
// verify_jwt: true — browser session JWT → getUser; anon JWT falls back to the
// sole tr_settings owner (single-user app). Read-only on everything.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const DAY = 86400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const SPORTS = new Set(["run", "ride", "swim", "strength", "hyrox", "brick", "mobility", "rest", "other"]);
const STATUS_WORD: Record<string, string> = { skipped: "Skip", done: "Mark done", planned: "Re-open" };
const EMOJI: Record<string, string> = { run: "🏃", ride: "🚴", swim: "🏊", strength: "🏋️", hyrox: "🔥", brick: "🧱", mobility: "🧘", rest: "😴", other: "✅" };
const mytDay = (ts: string) => new Date(new Date(ts).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(new Date(d + "T00:00:00Z").getTime() + n * DAY).toISOString().slice(0, 10);

interface Action { op: string; id?: string; status?: string; date?: string; title?: string; detail?: string | null;
  planned_minutes?: number | null; planned_km?: number | null; session_date?: string; sport?: string; }
interface Sess { id: string; session_date: string; sport: string; title: string; detail: string | null;
  planned_minutes: number | null; planned_km: number | null; status: string }

/* Validate against the viewed week only; render the lines Jared approves. */
function describe(actions: Action[], sessions: Sess[], weekStart: string, weekEnd: string) {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const inWeek = (d?: string) => !!d && ISO_DAY.test(d) && d >= weekStart && d <= weekEnd;
  const valid: Action[] = [], lines: string[] = [];
  for (const a of actions.slice(0, 20)) {
    const s = a.id ? byId.get(a.id) : undefined;
    if (a.op === "set_status" && s && a.status && STATUS_WORD[a.status]) {
      lines.push(`${STATUS_WORD[a.status]} ${s.session_date.slice(5)} ${s.title}`); valid.push(a);
    } else if (a.op === "move" && s && inWeek(a.date)) {
      lines.push(`Move ${s.title}: ${s.session_date.slice(5)} → ${a.date!.slice(5)}`); valid.push(a);
    } else if (a.op === "update" && s) {
      const rec = a as unknown as Record<string, unknown>;
      const changes = ["title", "sport", "planned_minutes", "planned_km"].filter((k) => rec[k] != null).map((k) => `${k.replace("planned_", "")} → ${rec[k]}`);
      if (a.detail !== undefined) changes.push("detail rewritten");
      if (!changes.length) continue;
      if (a.sport && !SPORTS.has(a.sport)) delete a.sport;
      lines.push(`Update ${s.session_date.slice(5)} ${s.title}: ${changes.join(", ")}`); valid.push(a);
    } else if (a.op === "add_session" && inWeek(a.session_date) && a.sport && SPORTS.has(a.sport) && a.title?.trim()) {
      const size = a.planned_km ? ` ${a.planned_km} km` : a.planned_minutes ? ` ${a.planned_minutes} min` : "";
      lines.push(`Add ${a.session_date!.slice(5)} ${EMOJI[a.sport]} ${a.title}${size}`); valid.push(a);
    } else if (a.op === "delete" && s) {
      lines.push(`Delete ${s.session_date.slice(5)} ${s.title}`); valid.push(a);
    }
  }
  return { valid, lines };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    const { data: userData } = await svc.auth.getUser(jwt);
    let userId = userData?.user?.id ?? null;
    if (!userId) {
      const { data: s } = await svc.from("tr_settings").select("user_id").limit(1).maybeSingle();
      userId = s?.user_id ?? null;
    }
    if (!userId) return json({ error: "No user" }, 401);
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY isn't set — chat planning is off." }, 400);

    const body = await req.json().catch(() => ({}));
    const weekStart = String(body.week_start ?? "");
    const message = String(body.message ?? "").trim();
    if (!ISO_DAY.test(weekStart) || !message) return json({ error: "week_start (Monday) and message required" }, 400);
    const weekEnd = addDays(weekStart, 6);
    const history = (Array.isArray(body.history) ? body.history : []).slice(-10)
      .filter((h: { role?: string; content?: string }) => (h.role === "user" || h.role === "assistant") && typeof h.content === "string");

    const since = new Date(new Date(weekStart + "T00:00:00Z").getTime() - 21 * DAY).toISOString();
    const [{ data: sessions }, { data: week }, { data: races }, { data: settings }, { data: workouts }, { data: wellness }] = await Promise.all([
      svc.from("tr_planned_sessions").select("id, session_date, sport, title, detail, planned_minutes, planned_km, status")
        .eq("user_id", userId).gte("session_date", weekStart).lte("session_date", weekEnd).order("session_date"),
      svc.from("tr_plan_weeks").select("block, focus, planned_km").eq("user_id", userId).eq("week_start", weekStart).maybeSingle(),
      svc.from("tr_races").select("name, race_type, race_date, priority").eq("user_id", userId).eq("status", "upcoming").order("race_date", { ascending: true, nullsFirst: false }).limit(2),
      svc.from("tr_settings").select("session_time, long_run_day, days_per_week, weekly_hours").eq("user_id", userId).maybeSingle(),
      svc.from("tr_workouts").select("source, sport, name, custom_name, started_at, duration_min, distance_km, avg_hr, data")
        .eq("user_id", userId).gte("started_at", since).order("started_at", { ascending: false }).limit(40),
      svc.from("tr_wellness").select("day, resting_hr, hrv, sleep_secs, sleep_score").eq("user_id", userId).order("day", { ascending: false }).limit(7),
    ]);

    // compact context: last 3 weeks of lifts (weights × reps) and runs
    const reference_lifts = (workouts ?? []).filter((w) => w.source === "hevy").map((w) => ({
      day: mytDay(w.started_at), title: w.name, minutes: w.duration_min,
      exercises: (((w.data as { exercises?: { name: string; sets: { weight_kg?: number | null; reps?: number | null; type?: string | null }[] }[] })?.exercises) ?? []).map((e) => ({
        name: e.name,
        sets: e.sets.filter((s) => s.type !== "warmup").map((s) => `${s.weight_kg ?? 0}×${s.reps ?? 0}`).join(" "),
      })),
    }));
    const recent_runs = (workouts ?? []).filter((w) => w.sport === "run").map((w) => ({
      day: mytDay(w.started_at), name: w.custom_name ?? w.name, km: w.distance_km, min: w.duration_min, avg_hr: w.avg_hr,
      pace_min_per_km: w.distance_km && w.duration_min ? Math.round((Number(w.duration_min) / Number(w.distance_km)) * 100) / 100 : null,
    }));
    const today = mytDay(new Date().toISOString());

    const system = `You are Jared's training planner, living inside the week editor of his app (Hyrox + endurance racing). He is looking at the week ${weekStart} → ${weekEnd} (today is ${today}, MYT). He tells you the week he wants — in his own words, for this week or next — and you turn it into concrete sessions. Be a concise, direct coach; plain text, no markdown.

WHAT YOU RETURN: ONLY JSON {"reply": string, "actions": Action[]}. Actions are PROPOSALS — nothing is applied until Jared taps Apply — so write the reply as a proposal ("Here's the week I'd set up — Apply if it fits"), never as done. Action = {"op":"set_status","id":uuid,"status":"skipped|done|planned"} | {"op":"move","id":uuid,"date":"YYYY-MM-DD"} | {"op":"update","id":uuid,"title"?,"detail"?,"planned_minutes"?,"planned_km"?,"sport"?} | {"op":"add_session","session_date":"YYYY-MM-DD","sport":"run|ride|swim|strength|hyrox|brick|mobility|rest|other","title","detail"?,"planned_minutes"?,"planned_km"?} | {"op":"delete","id":uuid}. Dates must be inside the viewed week. Use ONLY ids from context.sessions — never invent one. Prefer UPDATING an existing session over delete+add. Max 20 actions. If his request is ambiguous, ask ONE question and return no actions.

JARED'S RULES (apply unless he says otherwise):
- Lifts progress on a rep ladder at the SAME weight: 8 → 10 → 12 reps; once every working set hits 12, weight +5% (round to 2.5 kg ≥30 kg, else 1 kg) back to 8. "Achieved" = the LOWEST reps across working sets; a missed rung repeats. Compute from context.reference_lifts (most recent session of that split) and write the exercise list in detail, one per line: "Bench Press (Barbell): 3 × 8 @ 70 kg". Title strength sessions "<Split> (Hevy)".
- Easy long run: +12 min on his last long run; an absorb week (~70%) every 4th week. Tempo/intervals: no fixed method — give ONE concrete suggestion from context.recent_runs, he finalises.
- Weekly structure: gym days carry a short easy post-gym Z2 run the SAME day (intentional); the tempo/quality run goes the day AFTER legs; long run on ${settings?.long_run_day ?? "saturday"}; never a hard run + lift on the same day unless he asks; easy after hard.
- Session detail must be concrete (what exactly to do). Keep total sessions 3–9 per week.`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5",
        max_tokens: 6000,
        system,
        messages: [
          ...history,
          { role: "user", content: JSON.stringify({
            message,
            week: { start: weekStart, end: weekEnd, block: week?.block ?? null, focus: week?.focus ?? null },
            sessions: sessions ?? [],
            races, settings, reference_lifts, recent_runs,
            recent_wellness: (wellness ?? []).map((w) => ({ day: w.day, resting_hr: w.resting_hr, hrv: w.hrv,
              sleep_h: w.sleep_secs != null ? Math.round(Number(w.sleep_secs) / 360) / 10 : null, sleep_score: w.sleep_score })),
          }) },
        ],
      }),
    });
    if (!r.ok) return json({ error: `Claude HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}` }, 502);
    const data = await r.json();
    const text = ((data.content ?? []) as { type: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    let parsed: { reply?: string; actions?: Action[] };
    try { parsed = JSON.parse(text.replace(/^```json?\s*|```\s*$/g, "")); }
    catch { return json({ reply: text || "I glitched — try again.", actions: [], lines: [] }); }
    const { valid, lines } = describe(parsed.actions ?? [], (sessions ?? []) as Sess[], weekStart, weekEnd);
    return json({ reply: parsed.reply ?? "Here's what I'd do.", actions: valid, lines });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
