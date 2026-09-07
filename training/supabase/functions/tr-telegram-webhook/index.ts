// tr-telegram-webhook — the Training app's Telegram bot.
//
// Deployed verify_jwt: FALSE (Telegram cannot send a Supabase JWT). Security:
// every request must carry X-Telegram-Bot-Api-Secret-Token matching the
// TELEGRAM_WEBHOOK_SECRET secret (set when registering the webhook), and a chat
// only works after pairing via /link <code> (code shown in the app's Settings).
//
// Fast built-in commands: /today /week /sync /help. Anything else goes to
// Claude with the plan + recent workouts as context.
//
// ── WRITE POLICY (Jared, 2026-09-07) ─────────────────────────────────────────
// The bot and Claude are READ-ONLY on activities (tr_workouts), races
// (tr_races) and settings (tr_settings) — they only ever read those. The single
// write path the bot has is the planned week (tr_planned_sessions + its Google
// Calendar mirror), and even that is gated: Claude's actions are stored as a
// PROPOSAL (tr_bot_proposals, 0010), shown with ✅ Apply / ✗ Discard buttons,
// and applied only when Jared taps Apply (or replies "yes"). Exceptions that
// are not "edits": /link stores the chat id in tr_settings (pairing), /sync
// triggers tr-sync (mirrors intervals.icu/Hevy — the same as the app's button),
// and the chat log is written for context.
import { createClient } from "jsr:@supabase/supabase-js@2";

const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const DAY = 86400_000;
const ok = () => new Response("ok"); // always 200 — Telegram retries anything else

const mytNow = () => new Date(Date.now() + 8 * 3600_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const monday = (d: Date) => addDays(d, -((d.getUTCDay() + 6) % 7));
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const SPORTS = new Set(["run", "ride", "swim", "strength", "hyrox", "brick", "mobility", "rest", "other"]);

async function tg(method: string, body: Record<string, unknown>) {
  return await fetch(`https://api.telegram.org/bot${BOT}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).catch(() => null);
}
const send = (chatId: string | number, text: string, replyMarkup?: Record<string, unknown>) =>
  tg("sendMessage", { chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });

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

/* ---------- Google Calendar mirror for applied actions ---------- */
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

/* ---------- actions: the ONLY thing the bot may change, and only after Apply ---------- */
interface Action { op: string; id?: string; status?: string; date?: string; title?: string;
  detail?: string; planned_minutes?: number; planned_km?: number; session_date?: string; sport?: string; }

const STATUS_WORD: Record<string, string> = { skipped: "Skip", done: "Mark done", planned: "Re-open" };

/* Validate Claude's actions against the DB (drop hallucinated ids, bad dates,
   unknown sports) and render the human-readable list Jared confirms. */
async function describeActions(userId: string, actions: Action[]): Promise<{ valid: Action[]; lines: string[] }> {
  const ids = [...new Set(actions.map((a) => a.id).filter((x): x is string => !!x))];
  const { data: rows } = ids.length
    ? await svc.from("tr_planned_sessions").select("id, title, session_date").eq("user_id", userId).in("id", ids)
    : { data: [] as { id: string; title: string; session_date: string }[] };
  const byId = new Map((rows ?? []).map((r) => [r.id, r]));
  const valid: Action[] = [], lines: string[] = [];
  for (const a of actions) {
    const s = a.id ? byId.get(a.id) : undefined;
    if (a.op === "set_status" && s && a.status && STATUS_WORD[a.status]) {
      lines.push(`${STATUS_WORD[a.status]} ${s.session_date.slice(5)} ${s.title}`); valid.push(a);
    } else if (a.op === "move" && s && a.date && ISO_DAY.test(a.date)) {
      lines.push(`Move ${s.title}: ${s.session_date.slice(5)} → ${a.date.slice(5)}`); valid.push(a);
    } else if (a.op === "update" && s) {
      const rec = a as unknown as Record<string, unknown>;
      const changes = ["title", "detail", "planned_minutes", "planned_km"]
        .filter((k) => rec[k] != null).map((k) => `${k.replace("planned_", "")} → ${rec[k]}`);
      if (!changes.length) continue;
      lines.push(`Update ${s.title}: ${changes.join(", ")}`); valid.push(a);
    } else if (a.op === "add_session" && a.session_date && ISO_DAY.test(a.session_date) && a.sport && SPORTS.has(a.sport) && a.title) {
      const size = a.planned_km ? ` ${a.planned_km} km` : a.planned_minutes ? ` ${a.planned_minutes} min` : "";
      lines.push(`Add ${a.session_date.slice(5)} ${EMOJI[a.sport]} ${a.title}${size}`); valid.push(a);
    }
  }
  return { valid, lines };
}

/* Apply a CONFIRMED proposal. Every write is scoped eq user_id and touches
   tr_planned_sessions only (+ the calendar mirror). */
async function applyActions(userId: string, actions: Action[]): Promise<string[]> {
  const applied: string[] = [];
  const access = actions.length ? await gcalToken() : null;
  for (const a of actions.slice(0, 10)) {
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
  return applied;
}

/* Resolve a pending proposal (button tap or "yes"/"no" reply). */
async function resolveProposal(userId: string, proposalId: string, apply: boolean): Promise<{ short: string; text: string }> {
  const { data: p } = await svc.from("tr_bot_proposals").select("id, summary, actions")
    .eq("id", proposalId).eq("user_id", userId).eq("status", "pending").maybeSingle();
  if (!p) return { short: "Already handled", text: "That proposal was already handled (or expired)." };
  const now = new Date().toISOString();
  if (!apply) {
    await svc.from("tr_bot_proposals").update({ status: "discarded", resolved_at: now }).eq("id", p.id);
    await svc.from("tr_chat_log").insert({ user_id: userId, role: "assistant", content: `Discarded proposal — plan unchanged:\n${p.summary}` });
    return { short: "Discarded", text: "✗ Discarded — your plan is unchanged." };
  }
  const applied = await applyActions(userId, (p.actions ?? []) as Action[]);
  await svc.from("tr_bot_proposals").update({ status: "applied", resolved_at: now }).eq("id", p.id);
  const text = applied.length
    ? `✅ Applied to your plan and calendar:\n${applied.map((l) => `• ${l}`).join("\n")}`
    : "Nothing could be applied — the sessions may have changed since. Ask me again.";
  await svc.from("tr_chat_log").insert({ user_id: userId, role: "assistant", content: text });
  return { short: applied.length ? "Applied ✅" : "Nothing applied", text };
}

/* ---------- Claude: reads everything, proposes plan changes only ---------- */
async function askClaude(userId: string, text: string): Promise<{ reply: string; actions: Action[] }> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return { reply: "I can only do commands right now (/today /week /sync) — the ANTHROPIC_API_KEY secret isn't set, so free-form chat is off.", actions: [] };

  const today = mytNow(); const wk = monday(today);
  const [{ data: races }, { data: sessions }, { data: workouts }, { data: history }, { data: wellness }] = await Promise.all([
    svc.from("tr_races").select("name, race_type, race_date, priority").eq("user_id", userId).eq("status", "upcoming"),
    svc.from("tr_planned_sessions").select("id, session_date, sport, title, detail, planned_minutes, planned_km, status")
      .eq("user_id", userId).gte("session_date", iso(wk)).lte("session_date", iso(addDays(wk, 13))).order("session_date"),
    svc.from("tr_workouts").select("sport, name, custom_name, started_at, duration_min, distance_km, avg_hr")
      .eq("user_id", userId).order("started_at", { ascending: false }).limit(10),
    svc.from("tr_chat_log").select("role, content").eq("user_id", userId).order("created_at", { ascending: false }).limit(12),
    svc.from("tr_wellness").select("day, resting_hr, hrv, sleep_secs, sleep_score, steps")
      .eq("user_id", userId).order("day", { ascending: false }).limit(7),
  ]);

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5",
      max_tokens: 6000,
      system:
        `You are Jared's training assistant, living in a Telegram bot attached to his All-In-One training app (Hyrox + endurance racing). Today (MYT) is ${iso(today)}. Be a concise, direct coach — Telegram-length replies, plain text, no markdown.

PERMISSIONS: You are READ-ONLY on his activities, races, wellness and settings — read them, reason about them, never try to change them. The ONLY thing you may change is the planned week (calendar sessions), and even that is a PROPOSAL: any actions you return are shown to Jared with Apply / Discard buttons and applied ONLY if he taps Apply. So phrase changes as recommendations ("I'd move Thursday's intervals to Friday — tap Apply if you agree"), never say a change has been made, and don't propose actions for vague messages — ask first. When he asks how his week is going, give a short assessment from the plan, recent workouts and wellness. Never invent session ids.

Respond with ONLY JSON: {"reply": string, "actions": [{"op":"set_status","id":uuid,"status":"skipped|done|planned"} | {"op":"move","id":uuid,"date":"YYYY-MM-DD"} | {"op":"update","id":uuid,"title"?,"detail"?,"planned_minutes"?,"planned_km"?} | {"op":"add_session","session_date":"YYYY-MM-DD","sport":"run|ride|swim|strength|hyrox|brick|mobility|rest|other","title","detail"?,"planned_minutes"?,"planned_km"?}]} — actions may be empty.`,
      messages: [
        ...((history ?? []).reverse().map((h) => ({ role: h.role === "assistant" ? "assistant" : "user", content: h.content }))),
        {
          role: "user",
          content: JSON.stringify({
            message: text,
            races, this_and_next_week_sessions: sessions,
            recent_workouts: (workouts ?? []).map((w) => ({ ...w, name: w.custom_name ?? w.name, custom_name: undefined })),
            recent_wellness: (wellness ?? []).map((w) => ({
              day: w.day, resting_hr: w.resting_hr, hrv: w.hrv,
              sleep_h: w.sleep_secs != null ? Math.round(Number(w.sleep_secs) / 360) / 10 : null,
              sleep_score: w.sleep_score, steps: w.steps,
            })),
          }),
        },
      ],
    }),
  });
  if (!r.ok) return { reply: `Claude call failed (HTTP ${r.status}) — try again in a bit.`, actions: [] };
  const data = await r.json();
  // The model may emit thinking blocks before the text block — join all text.
  const text2 = ((data.content ?? []) as { type: string; text?: string }[])
    .filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  try {
    const parsed = JSON.parse(text2.replace(/^```json?\s*|```\s*$/g, "")) as { reply?: string; actions?: Action[] };
    return { reply: parsed.reply ?? "Noted.", actions: (parsed.actions ?? []).slice(0, 10) };
  } catch { return { reply: text2 || "Hmm, I glitched — try again.", actions: [] }; }
}

const YES = /^(yes|y|ok|okay|yep|yup|sure|apply|confirm|do it|go ahead)[.!]?$/i;
const NO = /^(no|n|nope|cancel|discard|don't|dont|leave it)[.!]?$/i;

/* ---------- main ---------- */
Deno.serve(async (req) => {
  const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const update = await req.json();

    /* ---- inline button tap: ✅ Apply / ✗ Discard on a proposal ---- */
    const cq = update.callback_query;
    if (cq) {
      const chatId = cq.message?.chat?.id;
      const m = String(cq.data ?? "").match(/^p:(apply|discard):([0-9a-f-]{36})$/);
      const answer = (t: string) => tg("answerCallbackQuery", { callback_query_id: cq.id, text: t });
      if (!chatId || !m) { await answer("?"); return ok(); }
      const { data: linked } = await svc.from("tr_settings").select("user_id").eq("telegram_chat_id", String(chatId)).maybeSingle();
      if (!linked) { await answer("This chat isn't linked."); return ok(); }
      const out = await resolveProposal(linked.user_id, m[2], m[1] === "apply");
      await answer(out.short);
      // Replace the buttons with the outcome so a second tap can't re-apply.
      await tg("editMessageText", { chat_id: chatId, message_id: cq.message.message_id, text: `${cq.message.text ?? ""}\n\n${out.text}` });
      return ok();
    }

    const msg = update.message ?? update.edited_message;
    const chatId = msg?.chat?.id;
    const text: string = (msg?.text ?? "").trim();
    if (!chatId || !text) return ok();

    const { data: linked } = await svc.from("tr_settings").select("user_id")
      .eq("telegram_chat_id", String(chatId)).maybeSingle();

    /* pairing — the one tr_settings write, and only the chat id */
    if (!linked) {
      const m = text.match(/^\/link\s+(\S+)/);
      if (m) {
        const { data: match } = await svc.from("tr_settings").select("user_id").eq("pairing_code", m[1]).maybeSingle();
        if (match) {
          await svc.from("tr_settings").update({ telegram_chat_id: String(chatId) }).eq("user_id", match.user_id);
          await send(chatId, "Linked ✅ — I can read your plan, activities and recovery and suggest changes. Nothing in your plan changes unless you tap Apply.\n\nTry /today, /week, or just talk to me (\"can't make tomorrow's run, shift it to Friday\").");
        } else await send(chatId, "That code doesn't match. Grab the current pairing code from Training → Settings in the app.");
      } else {
        await send(chatId, "This chat isn't linked yet. In the app, open Training → Settings and send me:\n/link <your pairing code>");
      }
      return ok();
    }
    const userId = linked.user_id;

    /* built-in commands (fast, no Claude) */
    if (/^\/(start|help)/.test(text)) {
      await send(chatId, "Your training bot 🏋️\n\n/today — today's session(s)\n/week — this week's plan\n/sync — pull latest intervals.icu + Hevy\n\nOr just talk: \"skip tomorrow's intervals, knee is sore\" / \"how's my week going?\" — I'll suggest plan changes and apply them only after you tap Apply. I never edit your activities, races or settings.");
      return ok();
    }
    if (/^\/today/.test(text)) {
      const today = iso(mytNow());
      const { data } = await svc.from("tr_planned_sessions").select("*").eq("user_id", userId).eq("session_date", today).order("created_at");
      await send(chatId, data?.length
        ? `Today (${today}):\n${data.map(fmtSession).join("\n")}${data[0]?.detail ? `\n\n${data.map((s) => s.detail).filter(Boolean).join("\n")}` : ""}`
        : `Nothing planned today (${today}). Rest up or ask me to suggest something.`);
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
        : "No plan generated for this week yet — open the dashboard and hit Generate week.");
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
        ? `Synced ✅ intervals.icu: ${res.intervals ?? 0} · wellness: ${res.wellness ?? 0} days · Hevy: ${res.hevy ?? 0} · matched to plan: ${res.matched ?? 0}${res.errors?.length ? `\n⚠️ ${res.errors.join("; ")}` : ""}`
        : "Sync failed — check the Settings page connections.");
      return ok();
    }

    /* "yes" / "no" typed instead of tapping the buttons */
    if (YES.test(text) || NO.test(text)) {
      const { data: p } = await svc.from("tr_bot_proposals").select("id").eq("user_id", userId).eq("status", "pending")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (p) {
        const out = await resolveProposal(userId, p.id, YES.test(text));
        await send(chatId, out.text);
        return ok();
      }
      // no pending proposal → treat as normal chat
    }

    /* conversational path: Claude reads, replies, and may PROPOSE plan changes */
    await svc.from("tr_chat_log").insert({ user_id: userId, role: "user", content: text });
    const { reply, actions } = await askClaude(userId, text);
    let outText = reply;
    let markup: Record<string, unknown> | undefined;
    if (actions.length) {
      const { valid, lines } = await describeActions(userId, actions);
      if (valid.length) {
        const now = new Date().toISOString();
        // one live proposal at a time — a newer one supersedes older pending ones
        await svc.from("tr_bot_proposals").update({ status: "expired", resolved_at: now })
          .eq("user_id", userId).eq("status", "pending");
        const { data: p } = await svc.from("tr_bot_proposals")
          .insert({ user_id: userId, chat_id: String(chatId), summary: lines.join("\n"), actions: valid })
          .select("id").single();
        if (p) {
          outText = `${reply}\n\nProposed changes (nothing applied yet):\n${lines.map((l) => `• ${l}`).join("\n")}\n\nApply these to your plan and calendar?`;
          markup = { inline_keyboard: [[
            { text: "✅ Apply", callback_data: `p:apply:${p.id}` },
            { text: "✗ Discard", callback_data: `p:discard:${p.id}` },
          ]] };
        }
      }
    }
    await svc.from("tr_chat_log").insert({ user_id: userId, role: "assistant", content: outText });
    await send(chatId, outText, markup);
    return ok();
  } catch {
    return ok();
  }
});
