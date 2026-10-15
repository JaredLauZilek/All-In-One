// jb-mcp — a remote MCP server for the Job Search tracker, so claude.ai (and any
// MCP client) can read, write and summarise applications with purpose-built
// tools instead of raw SQL. Added as a "custom connector" in claude.ai.
//
// Transport: MCP Streamable HTTP — one endpoint, JSON-RPC 2.0 over POST,
// plain JSON responses (no SSE needed for request/response tools).
// Auth: deployed verify_jwt: FALSE (claude.ai can't send a Supabase JWT); the
// request must carry the key as the `X-MCP-Key` header (claude.ai stores custom
// connector headers secretly — preferred) or as ?key=… (fallback). The key lives in
// jb_private (a service-role-only table: RLS on, no policies — the browser can never read it).
// Rotate it with one UPDATE to revoke access. Single-user app: every write is
// pinned to the sole auth user (looked up once via the admin API), never to a
// caller-supplied id.
//
// Tools: pipeline_summary · list_applications · get_application ·
//        add_application · update_application · set_status · log_event
// Deliberately NO delete tool — deleting stays a human action in the app.
import { createClient } from "jsr:@supabase/supabase-js@2";

const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const STATUSES = ["saved", "applied", "screening", "interview", "offer", "rejected", "withdrawn", "ghosted"] as const;
const OPEN = ["saved", "applied", "screening", "interview", "offer"];
const KINDS = ["applied", "email", "call", "interview", "assessment", "offer", "rejection", "followup", "note"] as const;
const STATUS_EVENT: Record<string, string> = { applied: "applied", screening: "call", interview: "interview", offer: "offer", rejected: "rejection" };
const todayISO = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10); // MYT

let cachedKey: string | null = null;
async function mcpKey(): Promise<string | null> {
  if (cachedKey) return cachedKey;
  const { data } = await svc.from("jb_private").select("mcp_key").eq("id", 1).maybeSingle();
  cachedKey = data?.mcp_key ?? null;
  return cachedKey;
}
let cachedUser: string | null = null;
async function userId(): Promise<string> {
  if (cachedUser) return cachedUser;
  const { data, error } = await svc.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error || !data.users.length) throw new Error("no auth user");
  cachedUser = data.users[0].id;
  return cachedUser;
}

/* ---------------- tool definitions (JSON Schema for the client) ---------------- */
const str = (description: string) => ({ type: "string", description });
const TOOLS = [
  { name: "pipeline_summary", description: "Snapshot of the job search: counts per status, applications sent this month, response rate, what moved in the last 7 days, and applications that have sat in 'applied' with no activity for 14+ days (worth chasing).", inputSchema: { type: "object", properties: {} } },
  { name: "list_applications", description: "List applications, newest first. Filter by status and/or a free-text query over company, role, location, source and notes.", inputSchema: { type: "object", properties: { status: { ...str("One of " + STATUSES.join(", ")), enum: [...STATUSES] }, query: str("Case-insensitive text match, e.g. 'stripe'"), limit: { type: "integer", description: "Max rows (default 25)" } } } },
  { name: "get_application", description: "Full detail of one application plus its timeline of events. Give the id, or a company name (and optionally role) to look it up.", inputSchema: { type: "object", properties: { id: str("Application id (uuid)"), company: str("Company name if you don't have the id"), role: str("Role, to disambiguate several applications at one company") } } },
  { name: "add_application", description: "Record a new application. Logs an 'applied' event automatically unless status is 'saved'.", inputSchema: { type: "object", required: ["company", "role"], properties: { company: str("Company"), role: str("Role title"), status: { ...str("Default 'applied'"), enum: [...STATUSES] }, applied_on: str("YYYY-MM-DD (default today)"), location: str("City / remote"), url: str("Posting link"), source: str("LinkedIn, Company site, Referral, Recruiter, JobStreet, Indeed, Glassdoor, Other"), salary: str("Salary or range as text"), notes: str("Free notes") } } },
  { name: "update_application", description: "Change fields on an existing application (anything except files). A status change logs itself as the matching timeline event.", inputSchema: { type: "object", required: ["id"], properties: { id: str("Application id"), company: str(""), role: str(""), status: { ...str(""), enum: [...STATUSES] }, applied_on: str("YYYY-MM-DD"), location: str(""), url: str(""), source: str(""), salary: str(""), notes: str("Replaces the notes field") } } },
  { name: "set_status", description: "Move an application to a new status and log the matching event (e.g. a reply in Gmail → 'screening'). Optional note goes on the event.", inputSchema: { type: "object", required: ["id", "status"], properties: { id: str("Application id"), status: { ...str(""), enum: [...STATUSES] }, note: str("What happened, e.g. 'Recruiter replied, call Thursday'"), happened_on: str("YYYY-MM-DD (default today)") } } },
  { name: "log_event", description: "Append a timeline event to an application without changing its status (email received, call, interview, assessment, follow-up sent, note).", inputSchema: { type: "object", required: ["id", "kind"], properties: { id: str("Application id"), kind: { ...str("One of " + KINDS.join(", ")), enum: [...KINDS] }, notes: str("Details"), happened_on: str("YYYY-MM-DD (default today)") } } },
];

/* ---------------- tool implementations ---------------- */
const compact = (a: Record<string, unknown>) => ({
  id: a.id, company: a.company, role: a.role, status: a.status, applied_on: a.applied_on, location: a.location,
  source: a.source, salary: a.salary, url: a.url, files: [a.resume_name && "resume", a.cover_name && "cover letter"].filter(Boolean),
  updated_at: String(a.updated_at).slice(0, 10),
});

async function findOne(uid: string, args: Record<string, unknown>) {
  if (args.id) {
    const { data } = await svc.from("jb_applications").select("*").eq("user_id", uid).eq("id", String(args.id)).maybeSingle();
    if (!data) throw new Error(`No application with id ${args.id}`);
    return data;
  }
  if (!args.company) throw new Error("Give an id or a company name");
  let q = svc.from("jb_applications").select("*").eq("user_id", uid).ilike("company", `%${String(args.company)}%`);
  if (args.role) q = q.ilike("role", `%${String(args.role)}%`);
  const { data } = await q.order("updated_at", { ascending: false }).limit(5);
  if (!data?.length) throw new Error(`No application matching company '${args.company}'`);
  if (data.length > 1) throw new Error(`Several match — give the id: ${data.map((d) => `${d.id} (${d.role}, ${d.status})`).join("; ")}`);
  return data[0];
}

async function logEvent(uid: string, appId: string, kind: string, happened_on: string | undefined, notes: string | null) {
  const { error } = await svc.from("jb_events").insert({ user_id: uid, application_id: appId, kind, happened_on: happened_on ?? todayISO(), notes });
  if (error) throw new Error(error.message);
  await svc.from("jb_applications").update({ updated_at: new Date().toISOString() }).eq("id", appId);
}

const pick = (args: Record<string, unknown>, keys: string[]) => {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (args[k] !== undefined) out[k] = args[k] === "" ? null : args[k];
  return out;
};

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const uid = await userId();
  switch (name) {
    case "pipeline_summary": {
      const { data: apps } = await svc.from("jb_applications").select("*").eq("user_id", uid);
      const list = apps ?? [];
      const month = todayISO().slice(0, 7);
      const since7 = new Date(Date.now() - 7 * 86400_000).toISOString();
      const { data: recent } = await svc.from("jb_events").select("application_id, kind, happened_on, notes").eq("user_id", uid)
        .gte("created_at", since7).order("happened_on", { ascending: false }).limit(30);
      const byId = new Map(list.map((a) => [a.id, a]));
      const sent = list.filter((a) => a.status !== "saved");
      const responded = sent.filter((a) => !["applied", "ghosted"].includes(a.status));
      const stale = list.filter((a) => a.status === "applied" && a.applied_on && a.applied_on < new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10)
        && !(recent ?? []).some((e) => e.application_id === a.id));
      const counts: Record<string, number> = {};
      for (const s of STATUSES) counts[s] = list.filter((a) => a.status === s).length;
      return {
        today: todayISO(), total: list.length, active: list.filter((a) => OPEN.includes(a.status) && a.status !== "saved").length,
        by_status: counts, sent_this_month: list.filter((a) => a.applied_on?.startsWith(month)).length,
        response_rate_pct: sent.length ? Math.round((responded.length / sent.length) * 100) : null,
        last_7_days: (recent ?? []).map((e) => ({ company: byId.get(e.application_id)?.company, role: byId.get(e.application_id)?.role, kind: e.kind, on: e.happened_on, notes: e.notes })),
        stale_applied_14d: stale.map(compact),
      };
    }
    case "list_applications": {
      let q = svc.from("jb_applications").select("*").eq("user_id", uid);
      if (args.status) q = q.eq("status", String(args.status));
      if (args.query) { const t = `%${String(args.query)}%`; q = q.or(`company.ilike.${t},role.ilike.${t},location.ilike.${t},source.ilike.${t},notes.ilike.${t}`); }
      const { data, error } = await q.order("applied_on", { ascending: false, nullsFirst: false }).order("updated_at", { ascending: false }).limit(Math.min(100, Number(args.limit) || 25));
      if (error) throw new Error(error.message);
      return (data ?? []).map(compact);
    }
    case "get_application": {
      const a = await findOne(uid, args);
      const { data: events } = await svc.from("jb_events").select("kind, happened_on, notes").eq("application_id", a.id).order("happened_on", { ascending: false }).order("created_at", { ascending: false });
      return { ...compact(a), notes: a.notes, resume_file: a.resume_name, cover_letter_file: a.cover_name, timeline: events ?? [] };
    }
    case "add_application": {
      const status = String(args.status ?? "applied");
      if (!STATUSES.includes(status as typeof STATUSES[number])) throw new Error(`status must be one of ${STATUSES.join(", ")}`);
      const row = { user_id: uid, company: String(args.company).trim(), role: String(args.role).trim(), status,
        applied_on: args.applied_on ? String(args.applied_on) : (status === "saved" ? null : todayISO()),
        ...pick(args, ["location", "url", "source", "salary", "notes"]) };
      const { data, error } = await svc.from("jb_applications").insert(row).select("*").single();
      if (error) throw new Error(error.message);
      if (status !== "saved") await logEvent(uid, data.id, STATUS_EVENT[status] ?? "note", data.applied_on ?? undefined, status in STATUS_EVENT ? null : `Status → ${status}`);
      return compact(data);
    }
    case "update_application": {
      const a = await findOne(uid, { id: args.id });
      const patch = pick(args, ["company", "role", "status", "applied_on", "location", "url", "source", "salary", "notes"]);
      if (patch.status && !STATUSES.includes(patch.status as typeof STATUSES[number])) throw new Error(`status must be one of ${STATUSES.join(", ")}`);
      if (!Object.keys(patch).length) throw new Error("nothing to update");
      const { data, error } = await svc.from("jb_applications").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", a.id).select("*").single();
      if (error) throw new Error(error.message);
      if (patch.status && patch.status !== a.status) {
        const kind = STATUS_EVENT[String(patch.status)] ?? "note";
        await logEvent(uid, a.id, kind, undefined, kind === "note" ? `Status → ${patch.status}` : null);
      }
      return compact(data);
    }
    case "set_status": {
      const a = await findOne(uid, { id: args.id });
      const status = String(args.status);
      if (!STATUSES.includes(status as typeof STATUSES[number])) throw new Error(`status must be one of ${STATUSES.join(", ")}`);
      const { error } = await svc.from("jb_applications").update({ status, updated_at: new Date().toISOString() }).eq("id", a.id);
      if (error) throw new Error(error.message);
      const kind = STATUS_EVENT[status] ?? "note";
      const note = args.note ? String(args.note) : (kind === "note" ? `Status → ${status}` : null);
      await logEvent(uid, a.id, kind, args.happened_on ? String(args.happened_on) : undefined, note);
      return { id: a.id, company: a.company, role: a.role, from: a.status, to: status, logged: kind };
    }
    case "log_event": {
      const a = await findOne(uid, { id: args.id });
      const kind = String(args.kind);
      if (!KINDS.includes(kind as typeof KINDS[number])) throw new Error(`kind must be one of ${KINDS.join(", ")}`);
      await logEvent(uid, a.id, kind, args.happened_on ? String(args.happened_on) : undefined, args.notes ? String(args.notes) : null);
      return { id: a.id, company: a.company, role: a.role, logged: kind };
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

/* ---------------- JSON-RPC / MCP plumbing ---------------- */
type Rpc = { jsonrpc: "2.0"; id?: number | string | null; method: string; params?: Record<string, unknown> };
const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(msg: Rpc): Promise<unknown | null> {
  const id = msg.id ?? null;
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return ok(id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "All-In-One Job Search", version: "1.0.0" },
        instructions: "Jared's job-search tracker. Use pipeline_summary first for an overview; list_applications / get_application to read; set_status + log_event to record what you find (e.g. a reply in Gmail). Statuses: saved → applied → screening → interview → offer; closed: rejected / withdrawn / ghosted. Dates are YYYY-MM-DD in Malaysia time.",
      });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null; // notifications get no response
    case "ping": return ok(id, {});
    case "tools/list": return ok(id, { tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await callTool(name, args);
        return ok(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false });
      } catch (e) {
        return ok(id, { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true });
      }
    }
    default:
      return msg.id === undefined ? null : fail(id, -32601, `Method not found: ${msg.method}`);
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const secret = await mcpKey();
  const presented = req.headers.get("x-mcp-key") ?? url.searchParams.get("key");
  if (!secret || presented !== secret) return new Response("unauthorized", { status: 401 });
  if (req.method === "GET") return new Response("jb-mcp: POST JSON-RPC here (MCP Streamable HTTP)", { status: 405, headers: { Allow: "POST" } });
  if (req.method === "DELETE") return new Response(null, { status: 204 }); // session close — we're stateless
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json(fail(null, -32700, "Parse error"), { status: 400 }); }
  const msgs = (Array.isArray(body) ? body : [body]) as Rpc[];
  const replies = (await Promise.all(msgs.map(handle))).filter((r) => r !== null);
  if (!replies.length) return new Response(null, { status: 202 }); // notification(s) only
  return Response.json(Array.isArray(body) ? replies : replies[0], { headers: { "MCP-Protocol-Version": PROTOCOLS[0] } });
});
