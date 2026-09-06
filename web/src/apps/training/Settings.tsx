// Training → Settings: integration checklist (Strava OAuth, Hevy key, Telegram
// pairing, Claude + Google Calendar secrets) and training preferences.
//
// Strava OAuth round-trip: Connect → strava.com/oauth/authorize → back here
// with ?code= → tr-connect {op: strava_exchange} stores tokens server-side
// (tr_tokens is edge-only; the browser never sees them).
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Minus, Trash2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Check, X, ExternalLink } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Button, Card, CardHeader, Input, Select, DataRow, cn } from "../../components/ui";
import { useTrSettings, useHrZoneVersions } from "./lib";

interface ConnStatus {
  intervals: { configured: boolean; athlete_id: string | null };
  strava: { app_configured: boolean; client_id: string | null; connected: boolean; athlete: string | null };
  hevy: { key_set: boolean };
  telegram: { bot_configured: boolean; linked: boolean; pairing_code: string | null };
  claude: { key_set: boolean };
  google: { configured: boolean; calendar_id: string };
  last_synced_at: string | null;
}

function useConnStatus() {
  return useQuery({
    queryKey: ["tr-conn-status"],
    queryFn: async (): Promise<ConnStatus> => {
      const { data, error } = await supabase.functions.invoke("tr-connect", { body: { op: "status" } });
      if (error) throw error;
      return data as ConnStatus;
    },
    refetchInterval: false,
  });
}

export default function Settings() {
  const qc = useQueryClient();
  const { data: status } = useConnStatus();
  const { data: settings } = useTrSettings();
  const [params, setParams] = useSearchParams();
  const [exchangeMsg, setExchangeMsg] = useState<string | null>(null);

  // Strava sends us back here with ?code= — finish the OAuth exchange once.
  useEffect(() => {
    const code = params.get("code");
    if (!code) return;
    setParams({}, { replace: true });
    (async () => {
      const { data, error } = await supabase.functions.invoke("tr-connect", {
        body: { op: "strava_exchange", code },
      });
      const err = error?.message ?? (data as { error?: string })?.error;
      setExchangeMsg(err ? `Strava connect failed: ${err}` : `Strava connected ✓ ${(data as { athlete?: string })?.athlete ?? ""}`);
      qc.invalidateQueries({ queryKey: ["tr-conn-status"] });
    })();
  }, [params, setParams, qc]);

  const disconnect = useMutation({
    mutationFn: async () => {
      await supabase.functions.invoke("tr-connect", { body: { op: "strava_disconnect" } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tr-conn-status"] }),
  });

  function connectStrava() {
    if (!status?.strava.client_id) return;
    const redirect = `${window.location.origin}/training/settings`;
    window.location.href =
      `https://www.strava.com/oauth/authorize?client_id=${status.strava.client_id}` +
      `&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&approval_prompt=auto&scope=activity:read_all`;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {exchangeMsg && (
        <p className={cn("rounded-lg px-4 py-3 text-sm",
          exchangeMsg.includes("failed") ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700")}>
          {exchangeMsg}
        </p>
      )}

      <Card>
        <CardHeader title="Connections" subtitle="Each integration works independently — missing ones are simply skipped" />
        <ul className="divide-y divide-slate-100">
          <ConnRow ok={!!status?.intervals.configured} name="intervals.icu" what="runs, rides, swims — free Garmin feed (Garmin → intervals.icu → here)">
            <IntervalsInputs configured={!!status?.intervals.configured} athleteId={status?.intervals.athlete_id ?? null} />
          </ConnRow>

          <ConnRow ok={!!status?.strava.connected} name="Strava" what="dormant — Strava's API now requires a paid Strava subscription; intervals.icu covers this">
            {status?.strava.app_configured ? (
              status.strava.connected ? (
                <div className="flex items-center gap-2">
                  {status.strava.athlete && <span className="text-xs text-slate-400">{status.strava.athlete}</span>}
                  <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => disconnect.mutate()}>Disconnect</Button>
                </div>
              ) : (
                <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={connectStrava}>Connect Strava</Button>
              )
            ) : (
              <span className="text-right text-[11px] leading-tight text-slate-400">
                Only worth wiring up if you ever subscribe to Strava
              </span>
            )}
          </ConnRow>

          <ConnRow ok={!!status?.hevy.key_set} name="Hevy" what="lifts with full set/rep detail (needs Hevy Pro)">
            <HevyKeyInput hasKey={!!status?.hevy.key_set} />
          </ConnRow>

          <ConnRow ok={!!status?.telegram.linked} name="Telegram bot" what="mid-week updates: skip / move / chat about the plan">
            {status?.telegram.bot_configured ? (
              status.telegram.linked ? (
                <span className="text-xs font-medium text-emerald-600">Linked</span>
              ) : (
                <span className="text-right text-[11px] leading-tight text-slate-500">
                  Message the bot: <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">/link {status.telegram.pairing_code}</code>
                </span>
              )
            ) : (
              <span className="text-right text-[11px] leading-tight text-slate-400">
                Create a bot with @BotFather, then set TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET and register the webhook
              </span>
            )}
          </ConnRow>

          <ConnRow ok={!!status?.claude.key_set} name="Claude" what="conversational bot + weekly plan fine-tuning">
            {status?.claude.key_set
              ? <span className="text-xs font-medium text-emerald-600">Key set</span>
              : <span className="text-right text-[11px] leading-tight text-slate-400">Set the ANTHROPIC_API_KEY edge-function secret</span>}
          </ConnRow>

          <ConnRow ok={!!status?.google.configured} name="Google Calendar" what="planned sessions land in your calendar">
            {status?.google.configured
              ? <span className="font-mono text-xs text-slate-400">{status.google.calendar_id}</span>
              : <span className="text-right text-[11px] leading-tight text-slate-400">Set GOOGLE_CLIENT_ID / SECRET / REFRESH_TOKEN (+ optional GOOGLE_CALENDAR_ID)</span>}
          </ConnRow>
        </ul>
        <p className="border-t border-slate-100 px-5 py-3 text-[11px] leading-relaxed text-slate-400">
          Edge-function secrets live in the Supabase dashboard → Edge Functions → Secrets{" "}
          <a className="inline-flex items-center gap-0.5 font-medium text-indigo-600 hover:underline"
            href="https://supabase.com/dashboard/project/vjqbircarzxcxrdzlyxj/settings/functions"
            target="_blank" rel="noreferrer noopener">open <ExternalLink className="h-3 w-3" /></a>
          . Last sync: {status?.last_synced_at ? new Date(status.last_synced_at).toLocaleString() : "never"}.
        </p>
      </Card>

      {settings && <ZonesCard />}
      {settings && <PrefsCard />}
    </div>
  );
}

/* ---------------- HR zones: dated versions ----------------
   Zones change when Jared re-tests (lactate / VO2max) — each saved set
   applies from its effective date until the next one, so past activities
   keep the zones that were true at the time. tr-sync re-buckets each
   activity's raw HR stream against the version in force on its day. */
function ZonesCard() {
  const qc = useQueryClient();
  const { data: versions } = useHrZoneVersions(); // newest first
  const latest = versions?.[0] ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const current = (versions ?? []).find((v) => v.effective_from <= today) ?? latest;

  const [date, setDate] = useState(today);
  const [rows, setRows] = useState<string[] | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const values = rows ?? latest?.ceilings.map(String) ?? ["140", "150", "160", "170", "190"];

  const resync = async () => {
    const { data: res, error } = await supabase.functions.invoke("tr-sync", { body: { days: 120 } });
    if (error) throw error;
    return res as { custom_zoned?: number; errors?: string[] };
  };
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tr-hr-zones"] });
    qc.invalidateQueries({ queryKey: ["tr-activities"] });
  };

  const add = useMutation({
    mutationFn: async (zones: number[]) => {
      const { error } = await supabase.from("tr_hr_zones")
        .insert({ effective_from: date, ceilings: zones, note: note.trim() || null });
      if (error) throw error;
      setMsg("Saved — re-bucketing the affected activities…");
      return resync();
    },
    onSuccess: (res) => {
      invalidate(); setRows(null); setNote("");
      setMsg(`Added ✓ zones effective ${date} — ${res.custom_zoned ?? 0} activities re-bucketed.${res.errors?.length ? ` (${res.errors.join("; ")})` : ""}`);
    },
    onError: (e) => setMsg(`Failed: ${String(e)}`),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tr_hr_zones").delete().eq("id", id);
      if (error) throw error;
      setMsg("Deleted — re-bucketing…");
      return resync();
    },
    onSuccess: (res) => {
      invalidate();
      setMsg(`Deleted ✓ ${res.custom_zoned ?? 0} activities re-bucketed to the remaining versions.`);
    },
    onError: (e) => setMsg(`Failed: ${String(e)}`),
  });

  function submit() {
    const nums = values.map((v) => Number(v.trim()));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setMsg("Pick an effective date."); return; }
    if ((versions ?? []).some((v) => v.effective_from === date)) {
      setMsg("A zone set already exists for that date — delete it first."); return;
    }
    if (nums.some((n) => !Number.isFinite(n) || n <= 0)) { setMsg("Every ceiling must be a number."); return; }
    if (nums.some((n, i) => i > 0 && n <= nums[i - 1])) { setMsg("Ceilings must strictly increase from Z1 to max."); return; }
    add.mutate(nums.map(Math.round));
  }

  const fmtVersionDate = (d: string) => (d <= "2000-01-01" ? "Baseline (all history)" : `From ${d}`);

  return (
    <Card>
      <CardHeader
        title="Heart-rate zones"
        subtitle="Dated versions — a new set applies from its date; older activities keep the zones that were true at the time"
      />

      {(versions ?? []).length > 0 && (
        <ul className="divide-y divide-slate-100 border-b border-slate-100">
          {(versions ?? []).map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
              <span className="text-xs font-semibold text-slate-800">{fmtVersionDate(v.effective_from)}</span>
              <span className="font-mono text-xs text-slate-500">{v.ceilings.join(" / ")}</span>
              {v.id === current?.id && (
                <span className="rounded-full bg-ink px-1.5 py-0.5 text-[10px] font-semibold text-accent dark:bg-accent dark:text-ink">current</span>
              )}
              {v.note && <span className="text-[11px] text-slate-400">{v.note}</span>}
              <button
                onClick={() => {
                  if (confirm(`Delete the zone set ${fmtVersionDate(v.effective_from)}?${(versions ?? []).length === 1 ? "\n\nIt's the last one — zone graphs would fall back to the intervals.icu model." : ""}`))
                    remove.mutate(v.id);
                }}
                className="ml-auto rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="px-5 py-4">
        <p className="mb-3 text-xs font-semibold text-slate-700">Add a new zone set (after a test)</p>
        <div className="flex flex-wrap items-end gap-2.5">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-slate-500">Effective from</span>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-[9.5rem] px-2 py-1.5 font-mono text-sm" />
          </label>
          {values.map((v, i) => (
            <label key={i} className="block">
              <span className="mb-1 block text-center text-[11px] font-medium text-slate-500">
                Z{i + 1}{i === values.length - 1 ? " (max)" : " ≤"}
              </span>
              <Input
                inputMode="numeric"
                value={v}
                onChange={(e) => {
                  const next = [...values];
                  next[i] = e.target.value;
                  setRows(next);
                }}
                className="w-[4.2rem] px-2 py-1.5 text-center font-mono text-sm"
              />
            </label>
          ))}
          <div className="flex gap-1 pb-0.5">
            <button title="Add a zone" disabled={values.length >= 8}
              onClick={() => setRows([...values, String(Number(values[values.length - 1] || 0) + 5)])}
              className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40">
              <Plus className="h-4 w-4" />
            </button>
            <button title="Remove the last zone" disabled={values.length <= 3}
              onClick={() => setRows(values.slice(0, -1))}
              className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40">
              <Minus className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="min-w-[14rem] flex-1">
            <Input placeholder="Note — e.g. Lactate test @ clinic" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button onClick={submit} loading={add.isPending}>Add zone set</Button>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          Ceilings in bpm — Z1 runs up to the first value, each next zone to its ceiling, the last
          value is max HR. Activities on/after the date use the new set; everything earlier keeps
          its old zones. Re-bucketing happens automatically from raw heart-rate streams.
        </p>
        {msg && (
          <p className={cn("mt-2 rounded-lg px-3 py-2 text-xs",
            msg.startsWith("Failed") || msg.includes("must") || msg.includes("already") ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700")}>
            {msg}
          </p>
        )}
      </div>
    </Card>
  );
}

function ConnRow({ ok, name, what, children }: {
  ok: boolean; name: string; what: string; children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 px-5 py-3.5">
      <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
        ok ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400")}>
        {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{name}</p>
        <p className="text-xs text-slate-500">{what}</p>
      </div>
      <div className="max-w-[55%] shrink-0">{children}</div>
    </li>
  );
}

function IntervalsInputs({ configured, athleteId }: { configured: boolean; athleteId: string | null }) {
  const qc = useQueryClient();
  const [id, setId] = useState("");
  const [key, setKey] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const uid = (await supabase.auth.getUser()).data.user!.id;
      const { error } = await supabase.from("tr_settings").update({
        intervals_athlete_id: id.trim() || null,
        intervals_api_key: key.trim() || null,
        updated_at: new Date().toISOString(),
      }).eq("user_id", uid);
      if (error) throw error;
    },
    onSuccess: () => { setId(""); setKey(""); qc.invalidateQueries({ queryKey: ["tr-conn-status"] }); },
  });
  if (configured) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-emerald-600">{athleteId}</span>
        <Button variant="ghost" className="px-2 py-1 text-xs"
          onClick={() => { setId(""); setKey(""); save.mutate(); }}>Disconnect</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Input placeholder="Athlete ID (i1234567)" value={id} onChange={(e) => setId(e.target.value)}
        className="w-36 px-2.5 py-1.5 font-mono text-xs" />
      <Input type="password" placeholder="API key" value={key} onChange={(e) => setKey(e.target.value)}
        className="w-32 px-2.5 py-1.5 text-xs" />
      <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => save.mutate()}
        loading={save.isPending} disabled={!id.trim() || !key.trim()}>Save</Button>
    </div>
  );
}

function HevyKeyInput({ hasKey }: { hasKey: boolean }) {
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const uid = (await supabase.auth.getUser()).data.user!.id;
      const { error } = await supabase.from("tr_settings")
        .update({ hevy_api_key: key.trim() || null, updated_at: new Date().toISOString() }).eq("user_id", uid);
      if (error) throw error;
    },
    onSuccess: () => { setKey(""); qc.invalidateQueries({ queryKey: ["tr-conn-status"] }); },
  });
  return (
    <div className="flex items-center gap-2">
      <Input
        type="password"
        placeholder={hasKey ? "••••••••  (replace)" : "Hevy API key"}
        value={key}
        onChange={(e) => setKey(e.target.value)}
        className="w-36 px-2.5 py-1.5 text-xs"
      />
      <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => save.mutate()}
        loading={save.isPending} disabled={!key.trim()}>Save</Button>
    </div>
  );
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function PrefsCard() {
  const qc = useQueryClient();
  const { data: settings } = useTrSettings();
  const [form, setForm] = useState({
    weekly_hours: String(settings?.weekly_hours ?? 8),
    days_per_week: String(settings?.days_per_week ?? 6),
    long_run_day: settings?.long_run_day ?? "saturday",
    session_time: settings?.session_time ?? "06:30",
  });
  const save = useMutation({
    mutationFn: async () => {
      const uid = (await supabase.auth.getUser()).data.user!.id;
      const { error } = await supabase.from("tr_settings").update({
        weekly_hours: Number(form.weekly_hours) || 8,
        days_per_week: Math.min(7, Math.max(3, Number(form.days_per_week) || 6)),
        long_run_day: form.long_run_day,
        session_time: form.session_time,
        updated_at: new Date().toISOString(),
      }).eq("user_id", uid);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tr-settings"] }),
  });

  return (
    <Card>
      <CardHeader title="Training preferences" subtitle="The plan generator respects these"
        action={<Button onClick={() => save.mutate()} loading={save.isPending}>
          {save.isSuccess ? "Saved" : "Save"}
        </Button>} />
      <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Weekly hours available</span>
          <Input inputMode="decimal" value={form.weekly_hours}
            onChange={(e) => setForm({ ...form, weekly_hours: e.target.value })} className="font-mono" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Training days / week (3–7)</span>
          <Input inputMode="numeric" value={form.days_per_week}
            onChange={(e) => setForm({ ...form, days_per_week: e.target.value })} className="font-mono" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Long run day</span>
          <Select value={form.long_run_day} onChange={(e) => setForm({ ...form, long_run_day: e.target.value })}>
            {DAYS.map((d) => <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>)}
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Default session time (calendar)</span>
          <Input type="time" value={form.session_time}
            onChange={(e) => setForm({ ...form, session_time: e.target.value })} className="font-mono" />
        </label>
      </div>
      <div className="border-t border-slate-100 px-5 py-3">
        <DataRow label="Data note" value="No sleep/HRV source connected (intervals.icu + Hevy only) — recovery advice keys off completed load, not biometrics" />
      </div>
    </Card>
  );
}
