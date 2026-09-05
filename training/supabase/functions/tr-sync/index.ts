// tr-sync — pull actual workouts from Strava + Hevy into tr_workouts, then
// auto-match them against planned sessions (same MYT day + compatible sport)
// and mark those sessions done.
//
// Deployed verify_jwt: true. Two caller shapes:
//   - the browser (session JWT → getUser resolves) — normal path
//   - the Telegram webhook using the project anon JWT (valid JWT, no user) —
//     single-user app, so we fall back to the sole tr_settings row's owner.
// Missing integrations are skipped silently — the function reports per-source
// counts and errors instead of failing.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// Malaysia has no DST — a fixed +8h shift is safe for "what day was this".
const mytDate = (iso: string | Date) =>
  new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 10);

const STRAVA_SPORT: Record<string, string> = {
  Run: "run", TrailRun: "run", VirtualRun: "run",
  Ride: "ride", VirtualRide: "ride", GravelRide: "ride", MountainBikeRide: "ride", EBikeRide: "ride",
  Swim: "swim",
  WeightTraining: "strength", Crossfit: "strength", Workout: "other",
};
// A workout of sport X can complete a planned session of these sports.
const MATCHES: Record<string, string[]> = {
  run: ["run", "hyrox", "brick"],
  ride: ["ride", "brick"],
  swim: ["swim", "brick"],
  strength: ["strength", "hyrox"],
  other: ["other", "hyrox", "mobility"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    const { data: userData } = await svc.auth.getUser(jwt);
    let userId = userData?.user?.id ?? null;
    if (!userId) {
      // anon-JWT caller (Telegram webhook): single-user fallback
      const { data: s } = await svc.from("tr_settings").select("user_id").limit(1).maybeSingle();
      userId = s?.user_id ?? null;
    }
    if (!userId) return json({ error: "No user" }, 401);

    const body = await req.json().catch(() => ({}));
    const days = Math.min(120, Number(body.days) || 45);
    const since = new Date(Date.now() - days * 86400_000);
    const errors: string[] = [];
    let stravaCount = 0, hevyCount = 0;

    /* ---------- Strava ---------- */
    const { data: tok } = await svc.from("tr_tokens").select("*").eq("user_id", userId).eq("provider", "strava").maybeSingle();
    if (tok?.refresh_token) {
      try {
        let access = tok.access_token as string | null;
        if (!access || !tok.expires_at || new Date(tok.expires_at).getTime() < Date.now() + 300_000) {
          const r = await fetch("https://www.strava.com/oauth/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: Deno.env.get("STRAVA_CLIENT_ID") ?? "",
              client_secret: Deno.env.get("STRAVA_CLIENT_SECRET") ?? "",
              grant_type: "refresh_token", refresh_token: tok.refresh_token,
            }),
          });
          const t = await r.json();
          if (!r.ok) throw new Error(`token refresh: ${JSON.stringify(t)}`);
          access = t.access_token;
          await svc.from("tr_tokens").update({
            access_token: t.access_token, refresh_token: t.refresh_token,
            expires_at: new Date(t.expires_at * 1000).toISOString(), updated_at: new Date().toISOString(),
          }).eq("user_id", userId).eq("provider", "strava");
        }
        for (let page = 1; page <= 3; page++) {
          const r = await fetch(
            `https://www.strava.com/api/v3/athlete/activities?after=${Math.floor(since.getTime() / 1000)}&per_page=100&page=${page}`,
            { headers: { Authorization: `Bearer ${access}` } },
          );
          if (!r.ok) throw new Error(`activities: HTTP ${r.status}`);
          const acts = await r.json();
          if (!Array.isArray(acts) || acts.length === 0) break;
          const rows = acts.map((a: Record<string, unknown>) => ({
            user_id: userId, source: "strava", external_id: String(a.id),
            sport: STRAVA_SPORT[String(a.sport_type ?? a.type)] ?? "other",
            name: a.name ?? null, started_at: a.start_date,
            duration_min: a.moving_time ? Math.round(Number(a.moving_time) / 6) / 10 : null,
            distance_km: a.distance ? Math.round(Number(a.distance) / 10) / 100 : null,
            avg_hr: a.average_heartrate ?? null, elev_m: a.total_elevation_gain ?? null,
            data: { type: a.sport_type ?? a.type, avg_speed: a.average_speed, suffer_score: a.suffer_score },
          }));
          const { error } = await svc.from("tr_workouts").upsert(rows, { onConflict: "user_id,source,external_id" });
          if (error) throw new Error(error.message);
          stravaCount += rows.length;
          if (acts.length < 100) break;
        }
      } catch (e) { errors.push(`Strava: ${String(e)}`); }
    }

    /* ---------- Hevy ---------- */
    const { data: settings } = await svc.from("tr_settings").select("hevy_api_key").eq("user_id", userId).maybeSingle();
    if (settings?.hevy_api_key) {
      try {
        for (let page = 1; page <= 5; page++) {
          const r = await fetch(`https://api.hevyapp.com/v1/workouts?page=${page}&pageSize=10`, {
            headers: { "api-key": settings.hevy_api_key, "Content-Type": "application/json" },
          });
          if (!r.ok) throw new Error(`HTTP ${r.status} (bad API key? Hevy Pro required)`);
          const data = await r.json();
          const workouts = data.workouts ?? [];
          if (workouts.length === 0) break;
          const rows = workouts.map((w: Record<string, unknown>) => {
            const start = new Date(String(w.start_time)), end = new Date(String(w.end_time));
            const exercises = ((w.exercises as Record<string, unknown>[]) ?? []).map((e) => ({
              name: e.title,
              sets: ((e.sets as Record<string, unknown>[]) ?? []).map((s) => ({
                weight_kg: s.weight_kg ?? null, reps: s.reps ?? null, type: s.type ?? null,
              })),
            }));
            return {
              user_id: userId, source: "hevy", external_id: String(w.id),
              sport: "strength", name: w.title ?? "Lift", started_at: start.toISOString(),
              duration_min: Math.round((end.getTime() - start.getTime()) / 6000) / 10,
              distance_km: null, avg_hr: null, elev_m: null, data: { exercises },
            };
          });
          const { error } = await svc.from("tr_workouts").upsert(rows, { onConflict: "user_id,source,external_id" });
          if (error) throw new Error(error.message);
          hevyCount += rows.length;
          const oldest = workouts[workouts.length - 1];
          if (new Date(String(oldest.start_time)) < since || page >= (data.page_count ?? 1)) break;
        }
      } catch (e) { errors.push(`Hevy: ${String(e)}`); }
    }

    /* ---------- match workouts → planned sessions ---------- */
    let matched = 0;
    const sinceDay = mytDate(since);
    const [{ data: workouts }, { data: sessions }] = await Promise.all([
      svc.from("tr_workouts").select("id, sport, started_at").eq("user_id", userId).gte("started_at", since.toISOString()),
      svc.from("tr_planned_sessions").select("id, sport, session_date, status").eq("user_id", userId)
        .eq("status", "planned").gte("session_date", sinceDay),
    ]);
    const open = [...(sessions ?? [])];
    for (const w of workouts ?? []) {
      const day = mytDate(w.started_at);
      const ok = MATCHES[w.sport] ?? [w.sport];
      // exact sport first, then compatible (e.g. a run can tick a hyrox session)
      const idx = (() => {
        let i = open.findIndex((s) => s.session_date === day && s.sport === w.sport);
        if (i === -1) i = open.findIndex((s) => s.session_date === day && ok.includes(s.sport));
        return i;
      })();
      if (idx !== -1) {
        const s = open.splice(idx, 1)[0];
        await svc.from("tr_planned_sessions").update({
          status: "done", matched_workout_id: w.id, updated_at: new Date().toISOString(),
        }).eq("id", s.id);
        matched++;
      }
    }

    await svc.from("tr_settings").update({ last_synced_at: new Date().toISOString() }).eq("user_id", userId);
    return json({ strava: stravaCount, hevy: hevyCount, matched, errors });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
