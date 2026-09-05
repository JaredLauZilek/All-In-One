// tr-telegram-webhook — the Training app's Telegram bot.
//
// Deployed verify_jwt: FALSE (Telegram cannot send a Supabase JWT). Security:
// every request must carry X-Telegram-Bot-Api-Secret-Token matching the
// TELEGRAM_WEBHOOK_SECRET secret (set when registering the webhook), and a chat
// only works after pairing via /link <code> (code shown in the app's Settings).
//
// Fast built-in commands: /today /week /sync /help. Anything else goes to
// Claude with the plan + recent workouts as context; Claude replies AND may
// return structured actions (skip/move/update/add sessions) which are applied
// to the DB and mirrored to Google Calendar when configured.
import { createClient } from "jsr:@supabase/supabase-js@2";

const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const DAY = 86400_000;
const ok = () => new Response("ok"); // always 200 — Telegram retries anything else

const mytNow = () => new Date(Date.now() + 8 * 3600_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const monday = (d: Date) => addDays(d, -((d.getUTCDay() + 6) % 7));

async function send(chatId: string | number, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch(() => {});
}

const EMOJI: Record<string, string> = {
  run: "🏃", ride: "🚴", swim: "🏊", strength: "🏋️", hyrox: "🔥",
  brick: "🧱", mobility: "🧘", rest: "😴", other: "✅",
};
const fmtSession = (s: Record<string, unknown>) => {
  const status = s.status === "done" ? " ✓" : s.status === "skipped" ? " ✗" : "";
  const bits = [s.planned_km ? `${s.planned_km} km` : null, s.planned_minutes ? `${s.planned_minutes} min` : null]
    .filter(Boolean).join(" · ");
  return `${EMOJI[String(s.sport)] ?? "•"} ${s.title}${bits ? ` (${bits})` : ""}${status}`;
};

/* ---------- Google Calendar mirror for bot actions ---------- */
async function gcalToken(): Promise<string | null> {
  const id = Deno.env.get("GOOGLE_CLIENT_ID"), secret = Deno.env.get("GOOGLE_CLIENT_SECRET"), refresh = Deno.env.get("GOOGLE_REFRESH_TOKEN");
  if (!id || !secret || !refresh) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  return r.ok ? (await r.json()).access_token ?? null : null;
}
const calId = () => encodeURIComponent(Deno.env.get("GOOGLE_CALENDAR_ID") ?? "primary");
async function gcalPatch(access: string, eventId: string, patch: Record<string, unknown>) {
  await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId()}/events/${eventId}`, {
    method: "PATCH", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).catch(() => {});
}
async function gcalDelete(access: string, eventId: string) {
  await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId()}/events/${eventId}`, {
    method: "DELETE", headers: { Authorization: `Bearer ${access}` },
  }).catch(() => {});
}

/* ---------- Claude with plan-editing actions ---------- */
interface Action { op: string; id?: string; status?: string; date?: string; title?: string;
  detail?: string; planned_minutes?: number; planned_km?: number; session_date?: string; sport?: string; }

async function askClaude(userId: string, text: string): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return "I can only do commands right now (/today /week /sync) — the ANTHROPIC_API_KEY secret isn't set, so free-form chat is off.";

  const today = mytNow(); const wk = monday(today);
  const [{ data: races }, { data: sessions }, { data: workouts }, { data: history }] = await Promise.all([
    svc.from("tr_races").select("name, race_type, race_date, priority").eq("user_id", userId).eq("status", "upcoming"),
    svc.from("tr_planned_sessions").select("id, session_date, sport, title, detail, planned_minutes, planned_km, status")
      .eq("user_id", userId).gte("session_date", iso(wk)).lte("session_date", iso(addDays(wk, 13))).order("session_date"),
    svc.from("tr_workouts").select("sport, name, started_at, duration_min, distance_km")
      .eq("user_id", userId).order("started_at", { ascending: false }).limit(10),
    svc.from("tr_chat_log").select("role, content").eq("user_id", userId).order("created_at", { ascending: false }).limit(12),
  ]);

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5",
      max_tokens: 1500,
      system:
        `You are Jared's training assistant, living in a Telegram bot attached to his All-In-One training app (Hyrox + endurance racing). Today (MYT) is ${iso(today)}. Be a concise, direct coach — Telegram-length replies, plain text, no markdown. When he reports a change (can't train, session missed, feeling cooked, wants to move things), update the plan via actions and confirm briefly. Never invent session ids. Respond with ONLY JSON: {"reply": string, "actions": [{"op":"set_status","id":uuid,"status":"skipped|done|planned"} | {"op":"move","id":uuid,"date":"YYYY-MM-DD"} | {"op":"update","id":uuid,"title"?,"detail"?,"planned_minutes"?,"planned_km"?} | {"op":"add_session","session_date":"YYYY-MM-DD","sport":"run|ride|swim|strength|hyrox|brick|mobility|rest|other","title","detail"?,"planned_minutes"?,"planned_km"?}]} — actions may be empty.`,
      messages: [
        ...((history ?? []).reverse().map((h) => ({ role: h.role === "assistant" ? "assistant" : "user", content: h.content }))),
        {
          role: "user",
          content: JSON.stringify({
            message: text,
            races, this_and_next_week_sessions: sessions, recent_workouts: workouts,
          }),
        },
      ],
    }),
  });
  if (!r.ok) return `Claude call failed (HTTP ${r.status}) — try again in a bit.`;
  const data = await r.json();
  let parsed: { reply?: string; actions?: Action[] };
  try {
    parsed = JSON.parse((data.content?.[0]?.text ?? "").replace(/^```json?\s*|```\s*$/g, ""));
  } catch { return data.content?.[0]?.text ?? "Hmm, I glitched — try again."; }

  const applied: string[] = [];
  const actions = (parsed.actions ?? []).slice(0, 10);
  const access = actions.length ? await gcalToken() : null;
  for (const a of actions) {
    try {
      if (a.op === "set_status" && a.id && a.status) {
        const { data: s } = await svc.from("tr_planned_sessions").update({ status: a.status, updated_at: new Date().toISOString() })
          .eq("id", a.id).eq("user_id", userId).select("title, gcal_event_id").single();
        if (s) {
          applied.push(`${a.status}: ${s.title}`);
          if (access && s.gcal_event_id && a.status === "skipped") { await gcalDelete(access, s.gcal_event_id);
            await svc.from("tr_planned_sessions").update({ gcal_event_id: null }).eq("id", a.id); }
        }
      } else if (a.op === "move" && a.id && a.date) {
        const { data: s } = await svc.from("tr_planned_sessions")
          .update({ session_date: a.date, status: "planned", updated_at: new Date().toISOString() })
          .eq("id", a.id).eq("user_id", userId).select("title, gcal_event_id, planned_minutes").single();
        if (s) {
          applied.push(`moved to ${a.date}: ${s.title}`);
          if (access && s.gcal_event_id) {
            const start = `${a.date}T06:30:00+08:00`;
            const end = new Date(new Date(start).getTime() + (s.planned_minutes ?? 60) * 60_000).toISOString();
            await gcalPatch(access, s.gcal_event_id, { start: { dateTime: start }, end: { dateTime: end } });
          }
        }
      } else if (a.op === "update" && a.id) {
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        for (const k of ["title", "detail", "planned_minutes", "planned_km"] as const) if (a[k] != null) patch[k] = a[k];
        const { data: s } = await svc.from("tr_planned_sessions").update(patch)
          .eq("id", a.id).eq("user_id", userId).select("title, detail, gcal_event_id").single();
        if (s) {
          applied.push(`updated: ${s.title}`);
          if (access && s.gcal_event_id) await gcalPatch(access, s.gcal_event_id,
            { summary: `🏋️ ${s.title}`, description: `${s.detail ?? ""}\n\n— All-In-One Training` });
        }
      } else if (a.op === "add_session" && a.session_date && a.sport && a.title) {
        await svc.from("tr_planned_sessions").insert({
          user_id: userId, session_date: a.session_date, sport: a.sport, title: a.title,
          detail: a.detail ?? null, planned_minutes: a.planned_minutes ?? null, planned_km: a.planned_km ?? null,
        });
        applied.push(`added ${a.session_date}: ${a.title}`);
      }
    } catch { /* skip bad action, keep the rest */ }
  }
  return parsed.reply ?? (applied.length ? `Done: ${applied.join("; ")}` : "Noted.");
}

/* ---------- main ---------- */
Deno.serve(async (req) => {
  const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const update = await req.json();
    const msg = update.message ?? update.edited_message;
    const chatId = msg?.chat?.id;
    const text: string = (msg?.text ?? "").trim();
    if (!chatId || !text) return ok();

    const { data: linked } = await svc.from("tr_settings").select("user_id")
      .eq("telegram_chat_id", String(chatId)).maybeSingle();

    /* pairing */
    if (!linked) {
      const m = text.match(/^\/link\s+(\S+)/);
      if (m) {
        const { data: match } = await svc.from("tr_settings").select("user_id").eq("pairing_code", m[1]).maybeSingle();
        if (match) {
          await svc.from("tr_settings").update({ telegram_chat_id: String(chatId) }).eq("user_id", match.user_id);
          await send(chatId, "Linked ✅ — this chat now controls your training plan.\n\nTry /today, /week, or just talk to me (\"can't make tomorrow's run, shift it to Friday\").");
        } else await send(chatId, "That code doesn't match. Grab the current pairing code from Training → Settings in the app.");
      } else {
        await send(chatId, "This chat isn't linked yet. In the app, open Training → Settings and send me:\n/link <your pairing code>");
      }
      return ok();
    }
    const userId = linked.user_id;

    /* built-in commands (fast, no Claude) */
    if (/^\/(start|help)/.test(text)) {
      await send(chatId, "Your training bot 🏋️\n\n/today — today's session(s)\n/week — this week's plan\n/sync — pull latest Strava + Hevy\n\nOr just talk: \"skip tomorrow's intervals, knee is sore\" / \"how's my week going?\" — I'll adjust the plan and your calendar.");
      return ok();
    }
    if (/^\/today/.test(text)) {
      const today = iso(mytNow());
      const { data } = await svc.from("tr_planned_sessions").select("*").eq("user_id", userId).eq("session_date", today).order("created_at");
      await send(chatId, data?.length
        ? `Today (${today}):\n${data.map(fmtSession).join("\n")}${data[0]?.detail ? `\n\n${data.map((s) => s.detail).filter(Boolean).join("\n")}` : ""}`
        : `Nothing planned today (${today}). Rest up or ask me to add something.`);
      return ok();
    }
    if (/^\/week/.test(text)) {
      const wk = monday(mytNow());
      const [{ data }, { data: w }] = await Promise.all([
        svc.from("tr_planned_sessions").select("*").eq("user_id", userId)
          .gte("session_date", iso(wk)).lte("session_date", iso(addDays(wk, 6))).order("session_date"),
        svc.from("tr_plan_weeks").select("block, focus").eq("user_id", userId).eq("week_start", iso(wk)).maybeSingle(),
      ]);
      await send(chatId, data?.length
        ? `Week of ${iso(wk)}${w ? ` — ${w.block.toUpperCase()}` : ""}\n${w?.focus ?? ""}\n\n${data.map((s) => `${s.session_date.slice(5)} ${fmtSession(s)}`).join("\n")}`
        : "No plan generated for this week yet — open the dashboard and hit Generate week, or ask me to plan it.");
      return ok();
    }
    if (/^\/sync/.test(text)) {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/tr-sync`, {
        method: "POST",
        headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`, "Content-Type": "application/json" },
        body: "{}",
      });
      const res = await r.json().catch(() => ({}));
      await send(chatId, r.ok
        ? `Synced ✅ Strava: ${res.strava ?? 0} · Hevy: ${res.hevy ?? 0} · matched to plan: ${res.matched ?? 0}${res.errors?.length ? `\n⚠️ ${res.errors.join("; ")}` : ""}`
        : "Sync failed — check the Settings page connections.");
      return ok();
    }

    /* conversational path */
    await svc.from("tr_chat_log").insert({ user_id: userId, role: "user", content: text });
    const reply = await askClaude(userId, text);
    await svc.from("tr_chat_log").insert({ user_id: userId, role: "assistant", content: reply });
    await send(chatId, reply);
    return ok();
  } catch {
    return ok();
  }
});
