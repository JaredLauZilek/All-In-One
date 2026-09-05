import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_KEY;

if (!url || !key) {
  console.warn("Missing VITE_SUPABASE_URL / VITE_SUPABASE_KEY — see .env.example");
}

// One client for the whole All-In-One app. Uses the publishable key + Supabase
// Auth; every tool section reads/writes through it, so every request runs as
// the signed-in user (authenticated role under RLS).
// Fall back to harmless placeholders so the app still mounts before .env is
// configured instead of throwing a blank screen.
export const supabase = createClient(
  url || "https://placeholder.supabase.co",
  key || "placeholder-key",
);

/* ================= financial-tracker (fin_) ================= */

// Invoke fin-daily-signal on demand (the pg_cron job also runs it daily).
// The function is deployed with verify_jwt, which needs a REAL JWT — the
// publishable key is not one, so this deliberately sends the legacy anon JWT
// (public by design; it also appears in migration 0003).
const anonJwt = import.meta.env.VITE_SUPABASE_ANON_KEY;

export async function refreshNow() {
  const bearer =
    anonJwt || (await supabase.auth.getSession()).data.session?.access_token;
  const res = await fetch(`${url}/functions/v1/fin-daily-signal`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
  });
  return res.json();
}

/* ============================================================
   The lazada-monitor (lzd_) types and helpers that used to live
   below were removed 2026-08-29 with the Restock Monitor app.
   ============================================================ */
