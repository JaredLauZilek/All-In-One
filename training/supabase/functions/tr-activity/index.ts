// tr-activity — on-demand detail for ONE workout: downsampled heart-rate + pace
// streams and the device laps, pulled from intervals.icu the first time a run
// card is opened and cached in tr_workouts.detail (0009). tr-sync never writes
// that column, so the cache survives every sync. Pass { id, refresh: true } to
// refetch (e.g. after intervals.icu re-analyses an activity).
//
// HR-zone time is deliberately NOT here: the Activities popup reads
// hr_zone_secs / hr_zones (Jared's DATED zone versions, bucketed by tr-sync
// from the raw stream) — never intervals.icu's own zone model.
//
// Auth mirrors tr-sync: verify_jwt true; browser session JWT → getUser; the
// anon JWT falls back to the sole tr_settings owner (single-user app).
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// A 90-minute run is ~5,400 one-second samples; the popup chart is ~600px
// wide, so bucket-average down to this many points (≈25 KB cached per run).
const MAX_POINTS = 600;
const MIN_MOVING_MPS = 0.5; // (laps) below this = standing still; pace would explode
// Pace floor, like Garmin's chart: standing / walking samples are drawn AT the
// floor (20:00/km) instead of becoming gaps, so rest intervals read as dips.
const PACE_FLOOR = 1200;
// Bump when the cached shape/semantics change — stale caches refetch themselves.
const DETAIL_VERSION = 2;

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
    const id = String(body.id ?? "");
    if (!id) return json({ error: "id required" }, 400);

    const { data: w } = await svc.from("tr_workouts")
      .select("id, source, external_id, detail").eq("id", id).eq("user_id", userId).maybeSingle();
    if (!w) return json({ error: "workout not found" }, 404);
    if (w.detail && (w.detail as { v?: number }).v === DETAIL_VERSION && !body.refresh) return json(w.detail);
    if (w.source !== "intervals") return json({ error: "no stream source for this workout" }, 400);

    const { data: settings } = await svc.from("tr_settings")
      .select("intervals_api_key").eq("user_id", userId).maybeSingle();
    if (!settings?.intervals_api_key) return json({ error: "intervals.icu not connected" }, 400);
    const auth = "Basic " + btoa(`API_KEY:${settings.intervals_api_key}`);
    const base = `https://intervals.icu/api/v1/activity/${encodeURIComponent(w.external_id)}`;

    const [sr, ir] = await Promise.all([
      fetch(`${base}/streams?types=time,heartrate,velocity_smooth,distance`, { headers: { Authorization: auth } }),
      fetch(`${base}/intervals`, { headers: { Authorization: auth } }),
    ]);
    if (!sr.ok) throw new Error(`streams HTTP ${sr.status}`);
    const streams = (await sr.json()) as { type: string; data: (number | null)[] }[];
    const col = (t: string) => streams.find((s) => s.type === t)?.data ?? null;
    const time = col("time"), hr = col("heartrate"), vel = col("velocity_smooth"), dist = col("distance");
    if (!time || time.length < 2) throw new Error("no time stream");

    /* ---- downsample: bucket-average HR and per-sample pace (s/km, floored) ---- */
    const n = time.length, k = Math.max(1, Math.ceil(n / MAX_POINTS));
    const points: { t: number; hr: number | null; pace: number | null; d: number | null }[] = [];
    for (let i = 0; i < n; i += k) {
      let hs = 0, hc = 0, ps = 0, pc = 0;
      for (let j = i; j < Math.min(n, i + k); j++) {
        const h = hr?.[j]; if (h != null && h > 0) { hs += h; hc++; }
        const v = vel?.[j];
        if (v != null) { ps += Math.min(PACE_FLOOR, v > 0 ? 1000 / v : PACE_FLOOR); pc++; }
      }
      points.push({
        t: Number(time[i]),
        hr: hc ? Math.round(hs / hc) : null,
        pace: pc ? Math.round(ps / pc) : null,
        d: dist?.[i] != null ? Math.round(Number(dist[i])) : null,
      });
    }

    /* ---- laps: intervals.icu's icu_intervals ARE the device laps (Garmin
            autolap + lap-button presses; count matches icu_lap_count) ---- */
    let laps: Record<string, unknown>[] = [];
    if (ir.ok) {
      const iv = await ir.json();
      laps = ((iv?.icu_intervals ?? []) as Record<string, unknown>[]).map((l, i) => {
        const v = Number(l.average_speed ?? 0);
        return {
          n: i + 1, type: l.type ?? null,
          start: Number(l.start_time ?? 0),
          secs: Number(l.moving_time ?? l.elapsed_time ?? 0),
          m: Math.round(Number(l.distance ?? 0)),
          avg_hr: l.average_heartrate ?? null, max_hr: l.max_heartrate ?? null,
          pace: v > MIN_MOVING_MPS ? Math.round(1000 / v) : null,
        };
      });
    }

    const detail = { v: DETAIL_VERSION, points, laps, samples: n, pace_floor: PACE_FLOOR, fetched_at: new Date().toISOString() };
    const { error } = await svc.from("tr_workouts").update({ detail }).eq("id", id);
    if (error) throw new Error(error.message);
    return json(detail);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
