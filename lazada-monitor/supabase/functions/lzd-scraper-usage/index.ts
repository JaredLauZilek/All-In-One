// lzd-scraper-usage — called by the web app (JWT-verified).
// Proxies ScraperAPI's account endpoint so the API key never reaches the browser.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: secrets, error } = await admin.rpc("lzd_get_secrets");
  if (error || !secrets?.LZD_SCRAPER_API_KEY) {
    return json({ error: "scraper_api_key_unavailable" }, 500);
  }

  try {
    const res = await fetch(
      `https://api.scraperapi.com/account?api_key=${secrets.LZD_SCRAPER_API_KEY}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) return json({ error: `scraperapi_http_${res.status}` }, 502);
    const acc = await res.json();
    return json({
      request_count: acc.requestCount ?? 0,
      request_limit: acc.requestLimit ?? 0,
      credits_left: acc.creditsLeft ?? Math.max(0, (acc.requestLimit ?? 0) - (acc.requestCount ?? 0)),
      failed_request_count: acc.failedRequestCount ?? 0,
      next_billing_date: acc.nextBillingDate ?? null,
    });
  } catch (e) {
    return json({ error: String(e) }, 502);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
