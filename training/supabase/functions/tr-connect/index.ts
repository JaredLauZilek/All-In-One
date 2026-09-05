// tr-connect — integration plumbing for the Training app.
// ops (POST {op}):
//   status            → which integrations are configured/connected (drives the
//                       Settings page checklist; also returns the Strava client id
//                       so the browser can build the authorize URL)
//   strava_exchange   → {code} from Strava's OAuth redirect → tokens into tr_tokens
//   strava_disconnect → drop the Strava token row
//
// Deployed verify_jwt: true — caller is always the logged-in browser session.
// Secrets used (all optional except for their own feature): STRAVA_CLIENT_ID,
// STRAVA_CLIENT_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET,
// ANTHROPIC_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
// GOOGLE_REFRESH_TOKEN, GOOGLE_CALENDAR_ID.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    const { data: userData } = await svc.auth.getUser(jwt);
    const user = userData?.user;
    if (!user) return json({ error: "Not signed in" }, 401);

    const body = await req.json().catch(() => ({}));
    const op = body.op ?? "status";

    if (op === "status") {
      const [{ data: settings }, { data: stravaTok }] = await Promise.all([
        svc.from("tr_settings").select("hevy_api_key, telegram_chat_id, pairing_code, last_synced_at").eq("user_id", user.id).maybeSingle(),
        svc.from("tr_tokens").select("meta, updated_at").eq("user_id", user.id).eq("provider", "strava").maybeSingle(),
      ]);
      return json({
        strava: {
          app_configured: !!(Deno.env.get("STRAVA_CLIENT_ID") && Deno.env.get("STRAVA_CLIENT_SECRET")),
          client_id: Deno.env.get("STRAVA_CLIENT_ID") ?? null,
          connected: !!stravaTok,
          athlete: (stravaTok?.meta as { athlete?: string })?.athlete ?? null,
        },
        hevy: { key_set: !!settings?.hevy_api_key },
        telegram: {
          bot_configured: !!(Deno.env.get("TELEGRAM_BOT_TOKEN") && Deno.env.get("TELEGRAM_WEBHOOK_SECRET")),
          linked: !!settings?.telegram_chat_id,
          pairing_code: settings?.pairing_code ?? null,
        },
        claude: { key_set: !!Deno.env.get("ANTHROPIC_API_KEY") },
        google: {
          configured: !!(Deno.env.get("GOOGLE_CLIENT_ID") && Deno.env.get("GOOGLE_CLIENT_SECRET") && Deno.env.get("GOOGLE_REFRESH_TOKEN")),
          calendar_id: Deno.env.get("GOOGLE_CALENDAR_ID") ?? "primary",
        },
        last_synced_at: settings?.last_synced_at ?? null,
      });
    }

    if (op === "strava_exchange") {
      const id = Deno.env.get("STRAVA_CLIENT_ID"), secret = Deno.env.get("STRAVA_CLIENT_SECRET");
      if (!id || !secret) return json({ error: "Strava app not configured (STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET secrets)" }, 400);
      if (!body.code) return json({ error: "Missing code" }, 400);
      const res = await fetch("https://www.strava.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: id, client_secret: secret, code: body.code, grant_type: "authorization_code" }),
      });
      const tok = await res.json();
      if (!res.ok || !tok.refresh_token) return json({ error: `Strava exchange failed: ${JSON.stringify(tok)}` }, 400);
      const athlete = tok.athlete ? `${tok.athlete.firstname ?? ""} ${tok.athlete.lastname ?? ""}`.trim() : null;
      const { error } = await svc.from("tr_tokens").upsert({
        user_id: user.id, provider: "strava",
        access_token: tok.access_token, refresh_token: tok.refresh_token,
        expires_at: new Date(tok.expires_at * 1000).toISOString(),
        meta: { athlete, athlete_id: tok.athlete?.id ?? null },
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,provider" });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, athlete });
    }

    if (op === "strava_disconnect") {
      await svc.from("tr_tokens").delete().eq("user_id", user.id).eq("provider", "strava");
      return json({ ok: true });
    }

    return json({ error: `Unknown op ${op}` }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
