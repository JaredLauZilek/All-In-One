// tr-plan-edit — THE write path for the planned week (tr_planned_sessions).
// Used by the app's "Week of …" popup (edit / move / add / delete / done / skip)
// and, after Jared taps Apply, by the Telegram bot. Mirrors Google Calendar
// when the GOOGLE_* secrets are set, so the calendar never drifts from the plan.
//
// verify_jwt: true — browser session JWT → getUser; the anon JWT (bot) falls back
// to the sole tr_settings owner (single-user app). Every write is eq user_id.
//
// Body: { actions: Action[] } (≤ 20), Action =
//   { op:"set_status", id, status:"planned"|"done"|"skipped" }
//   { op:"move",       id, date:"YYYY-MM-DD" }
//   { op:"update",     id, title?, detail?, planned_minutes?, planned_km?, sport? }
//   { op:"add_session", session_date, sport, title, detail?, planned_minutes?, planned_km? }
//   { op:"delete",     id }
//   { op:"push_week",  week_start }   → calendar: create missing events, UPDATE existing (never duplicates)
//   { op:"clear_week", week_start }   → calendar: delete the week's events (sessions stay)
// Returns { applied: string[] }.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const SPORTS = new Set(["run", "ride", "swim", "strength", "hyrox", "brick", "mobility", "rest", "other"]);
const STATUSES = new Set(["planned", "done", "skipped"]);

interface Action { op: string; id?: string; status?: string; date?: string; title?: string; detail?: string | null;
  planned_minutes?: number | null; planned_km?: number | null; session_date?: string; sport?: string; week_start?: string; }

/* ---------- Google Calendar mirror ---------- */
async function gcalToken(): Promise<string | null> {
  const id = Deno.env.get("GOOGLE_CLIENT_ID"), secret = Deno.env.get("GOOGLE_CLIENT_SECRET"), refresh = Deno.env.get("GOOGLE_REFRESH_TOKEN");
  if (!id || !secret || !refresh) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }),
  }).catch(() => null);
  return r?.ok ? (await r.json()).access_token ?? null : null;
}
const calId = () => encodeURIComponent(Deno.env.get("GOOGLE_CALENDAR_ID") ?? "primary");
const span = (date: string, time: string, mins: number | null) => {
  const start = `${date}T${time}:00+08:00`;
  return { start: { dateTime: start }, end: { dateTime: new Date(new Date(start).getTime() + (mins ?? 60) * 60_000).toISOString() } };
};
async function gcalInsert(access: string, s: { session_date: string; title: string; detail: string | null; planned_minutes: number | null }, time: string) {
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId()}/events`, {
    method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify({ summary: `🏋️ ${s.title}`, description: `${s.detail ?? ""}\n\n— All-In-One Training`, ...span(s.session_date, time, s.planned_minutes) }),
  }).catch(() => null);
  return r?.ok ? ((await r.json()).id as string | undefined) ?? null : null;
}
async function gcalPatch(access: string, eventId: string, patch: Record<string, unknown>) {
  await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId()}/events/${eventId}`, {
    method: "PATCH", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" }, body: JSON.stringify(patch),
  }).catch(() => {});
}
async function gcalDelete(access: string, eventId: string) {
  await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId()}/events/${eventId}`, {
    method: "DELETE", headers: { Authorization: `Bearer ${access}` },
  }).catch(() => {});
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

    const body = await req.json().catch(() => ({}));
    const actions = (Array.isArray(body.actions) ? body.actions : []).slice(0, 20) as Action[];
    if (!actions.length) return json({ error: "no actions" }, 400);

    const { data: settings } = await svc.from("tr_settings").select("session_time").eq("user_id", userId).maybeSingle();
    const time = settings?.session_time ?? "06:30";
    const access = await gcalToken();
    const applied: string[] = [];
    const now = () => new Date().toISOString();
    const own = (id: string) => svc.from("tr_planned_sessions").select("*").eq("id", id).eq("user_id", userId).maybeSingle();

    for (const a of actions) {
      try {
        if (a.op === "set_status" && a.id && a.status && STATUSES.has(a.status)) {
          const { data: s } = await own(a.id);
          if (!s) continue;
          await svc.from("tr_planned_sessions").update({ status: a.status, updated_at: now() }).eq("id", s.id);
          if (access) {
            if (a.status === "skipped" && s.gcal_event_id) {
              await gcalDelete(access, s.gcal_event_id);
              await svc.from("tr_planned_sessions").update({ gcal_event_id: null }).eq("id", s.id);
            } else if (a.status === "planned" && !s.gcal_event_id) {
              const ev = await gcalInsert(access, s, time);
              if (ev) await svc.from("tr_planned_sessions").update({ gcal_event_id: ev }).eq("id", s.id);
            }
          }
          applied.push(`${a.status}: ${s.title}`);
        } else if (a.op === "move" && a.id && a.date && ISO_DAY.test(a.date)) {
          const { data: s } = await own(a.id);
          if (!s) continue;
          await svc.from("tr_planned_sessions").update({ session_date: a.date, updated_at: now() }).eq("id", s.id);
          if (access && s.gcal_event_id) await gcalPatch(access, s.gcal_event_id, span(a.date, time, s.planned_minutes));
          applied.push(`moved to ${a.date}: ${s.title}`);
        } else if (a.op === "update" && a.id) {
          const { data: s } = await own(a.id);
          if (!s) continue;
          const patch: Record<string, unknown> = { updated_at: now() };
          if (typeof a.title === "string" && a.title.trim()) patch.title = a.title.trim();
          if (a.detail !== undefined) patch.detail = a.detail === null || a.detail === "" ? null : String(a.detail);
          if (a.planned_minutes !== undefined) patch.planned_minutes = a.planned_minutes === null ? null : Number(a.planned_minutes);
          if (a.planned_km !== undefined) patch.planned_km = a.planned_km === null ? null : Number(a.planned_km);
          if (a.sport && SPORTS.has(a.sport)) patch.sport = a.sport;
          await svc.from("tr_planned_sessions").update(patch).eq("id", s.id);
          if (access && s.gcal_event_id) {
            const title = (patch.title as string) ?? s.title, detail = (patch.detail as string | null) ?? s.detail;
            const mins = (patch.planned_minutes as number | null | undefined) === undefined ? s.planned_minutes : (patch.planned_minutes as number | null);
            await gcalPatch(access, s.gcal_event_id, { summary: `🏋️ ${title}`, description: `${detail ?? ""}\n\n— All-In-One Training`, ...span(s.session_date, time, mins) });
          }
          applied.push(`updated: ${(patch.title as string) ?? s.title}`);
        } else if (a.op === "add_session" && a.session_date && ISO_DAY.test(a.session_date) && a.sport && SPORTS.has(a.sport) && a.title?.trim()) {
          const row = {
            user_id: userId, session_date: a.session_date, sport: a.sport, title: a.title.trim(),
            detail: a.detail ? String(a.detail) : null,
            planned_minutes: a.planned_minutes == null ? null : Number(a.planned_minutes),
            planned_km: a.planned_km == null ? null : Number(a.planned_km),
            status: "planned",
          };
          const { data: ins, error } = await svc.from("tr_planned_sessions").insert(row).select("id").single();
          if (error) throw new Error(error.message);
          if (access && ins && a.sport !== "rest") {
            const ev = await gcalInsert(access, row, time);
            if (ev) await svc.from("tr_planned_sessions").update({ gcal_event_id: ev }).eq("id", ins.id);
          }
          applied.push(`added ${a.session_date}: ${row.title}`);
        } else if ((a.op === "push_week" || a.op === "clear_week") && a.week_start && ISO_DAY.test(a.week_start)) {
          if (!access) { applied.push("⚠ Google Calendar isn't configured (GOOGLE_* secrets)"); continue; }
          const end = new Date(new Date(a.week_start + "T00:00:00Z").getTime() + 6 * 86400_000).toISOString().slice(0, 10);
          const { data: list } = await svc.from("tr_planned_sessions").select("*").eq("user_id", userId)
            .gte("session_date", a.week_start).lte("session_date", end);
          let created = 0, updated = 0, removed = 0;
          for (const s of list ?? []) {
            if (a.op === "clear_week") {
              if (s.gcal_event_id) { await gcalDelete(access, s.gcal_event_id); await svc.from("tr_planned_sessions").update({ gcal_event_id: null }).eq("id", s.id); removed++; }
              continue;
            }
            if (s.sport === "rest" || s.status === "skipped") continue;
            if (s.gcal_event_id) {
              await gcalPatch(access, s.gcal_event_id, { summary: `🏋️ ${s.title}`, description: `${s.detail ?? ""}\n\n— All-In-One Training`, ...span(s.session_date, time, s.planned_minutes) });
              updated++;
            } else {
              const ev = await gcalInsert(access, s, time);
              if (ev) { await svc.from("tr_planned_sessions").update({ gcal_event_id: ev }).eq("id", s.id); created++; }
            }
          }
          applied.push(a.op === "clear_week" ? `calendar cleared: ${removed} events removed` : `calendar: ${created} created · ${updated} updated`);
        } else if (a.op === "delete" && a.id) {
          const { data: s } = await own(a.id);
          if (!s) continue;
          if (access && s.gcal_event_id) await gcalDelete(access, s.gcal_event_id);
          const { error } = await svc.from("tr_planned_sessions").delete().eq("id", s.id);
          if (error) throw new Error(error.message);
          applied.push(`deleted: ${s.title}`);
        }
      } catch (e) { applied.push(`⚠ ${a.op} failed: ${String(e)}`); }
    }
    return json({ applied });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
