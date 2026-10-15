// aio-passcode — the suite's login. The browser posts { passcode }; we compare its
// sha256 against aio_private (service-role-only table), and on a match mint a real
// Supabase session for the sole auth user: admin.generateLink(magiclink) gives a
// hashed token that the client redeems with auth.verifyOtp({ token_hash }). So RLS,
// `authenticated` role and every owner check keep working exactly as before — only
// the front door changed (Jared, 2026-10-15: "remove the login email and password,
// ask for a passcode instead").
//
// A 4-digit code is guessable in 10k tries, so: 5 wrong attempts → 15-minute lockout
// (global — single-user app), and the token is single-use with Supabase's OTP expiry.
// Deployed verify_jwt: FALSE (the caller isn't signed in yet). Rotate the passcode
// with one UPDATE on aio_private (see web/supabase/migrations/0001_aio_passcode.sql).
import { createClient } from "jsr:@supabase/supabase-js@2";

const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const MAX_FAILS = 5;
const LOCK_MIN = 15;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  let passcode = "";
  try { passcode = String((await req.json()).passcode ?? "").trim(); } catch { /* fallthrough */ }
  if (!passcode) return json({ error: "Enter the passcode." }, 400);

  const { data: row } = await svc.from("aio_private").select("passcode_hash, fails, locked_until").eq("id", 1).maybeSingle();
  if (!row) return json({ error: "Passcode login is not set up." }, 500);
  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 60_000);
    return json({ error: `Too many attempts. Try again in ${mins} min.` }, 429);
  }

  if ((await sha256(passcode)) !== row.passcode_hash) {
    const fails = (row.fails ?? 0) + 1;
    const lock = fails >= MAX_FAILS;
    await svc.from("aio_private").update({
      fails: lock ? 0 : fails,
      locked_until: lock ? new Date(Date.now() + LOCK_MIN * 60_000).toISOString() : null,
    }).eq("id", 1);
    return json({ error: lock ? `Too many attempts. Locked for ${LOCK_MIN} min.` : `Wrong passcode (${MAX_FAILS - fails} left).` }, 401);
  }

  // Correct → reset the counter and mint a session token for the one account.
  await svc.from("aio_private").update({ fails: 0, locked_until: null }).eq("id", 1);
  const { data: users, error: uErr } = await svc.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (uErr || !users.users.length) return json({ error: "No account to sign in to." }, 500);
  const email = users.users[0].email!;
  const { data: link, error: lErr } = await svc.auth.admin.generateLink({ type: "magiclink", email });
  if (lErr || !link?.properties?.hashed_token) return json({ error: lErr?.message ?? "Could not create a session." }, 500);
  return json({ token_hash: link.properties.hashed_token, email });
});
