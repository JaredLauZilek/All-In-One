import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Send, Copy, Check, KeyRound } from "lucide-react";
import { supabase, BOT_USERNAME, type Settings as SettingsRow } from "../lib/supabase";
import { Button, Card, CardHeader, Input, Spinner } from "../components/ui";

export default function Settings() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("lzd_settings").select("*").maybeSingle();
      if (error) throw error;
      if (!data) {
        const { data: inserted, error: insErr } = await supabase.from("lzd_settings")
          .insert({ user_id: (await supabase.auth.getUser()).data.user!.id })
          .select().single();
        if (insErr) throw insErr;
        return inserted as SettingsRow;
      }
      return data as SettingsRow;
    },
  });

  const updateSettings = useMutation({
    mutationFn: async (patch: Partial<SettingsRow>) => {
      const { error } = await supabase.from("lzd_settings").update(patch).eq("user_id", settings!.user_id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  const [copied, setCopied] = useState(false);
  const [pw, setPw] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwSaving, setPwSaving] = useState(false);

  if (isLoading || !settings) return <Spinner />;

  const linked = !!settings.telegram_chat_id;
  const deepLink = `https://t.me/${BOT_USERNAME}?start=${settings.link_code}`;

  async function changePassword() {
    setPwSaving(true); setPwMsg(null);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setPwSaving(false);
    setPwMsg(error ? error.message : "Password updated ✓");
    if (!error) setPw("");
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader
          title="Telegram notifications"
          subtitle={linked ? `Connected${settings.telegram_username ? ` as @${settings.telegram_username}` : ""}` : "Not connected yet"}
          action={
            <span className={`inline-flex h-2.5 w-2.5 rounded-full ${linked ? "bg-emerald-500" : "bg-slate-300"}`} />
          }
        />
        <div className="space-y-4 px-5 py-4">
          {linked ? (
            <p className="text-sm text-slate-600">
              Restock alerts are delivered to your Telegram instantly. Send <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">/list</code> to{" "}
              <a className="text-indigo-600 hover:underline" href={`https://t.me/${BOT_USERNAME}`} target="_blank" rel="noreferrer">@{BOT_USERNAME}</a>{" "}
              anytime to verify it's working.
            </p>
          ) : (
            <>
              <p className="text-sm text-slate-600">
                Tap the button below — it opens <b>@{BOT_USERNAME}</b> in Telegram and links this account in one tap.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <a href={deepLink} target="_blank" rel="noreferrer">
                  <Button><Send className="h-4 w-4" /> Connect Telegram</Button>
                </a>
                <button
                  onClick={() => { navigator.clipboard.writeText(`/start ${settings.link_code}`); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  Copy /start {settings.link_code}
                </button>
              </div>
              <p className="text-xs text-slate-400">
                After linking, the page updates automatically within ~30 seconds (or refresh).
              </p>
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Monitoring defaults" subtitle="Applied to newly added products" />
        <div className="space-y-4 px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-700">Default check interval</p>
              <p className="text-xs text-slate-500">Per-product interval can be changed on the Products page</p>
            </div>
            <select
              value={settings.default_check_interval_secs}
              onChange={(e) => updateSettings.mutate({ default_check_interval_secs: Number(e.target.value) })}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value={60}>1 minute</option>
              <option value={180}>3 minutes</option>
              <option value={300}>5 minutes</option>
              <option value={900}>15 minutes</option>
            </select>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-700">Check history retention</p>
              <p className="text-xs text-slate-500">Older check logs are pruned nightly</p>
            </div>
            <span className="text-sm font-semibold text-slate-800">{settings.retention_days} days</span>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Account" subtitle="Change your sign-in password" />
        <div className="space-y-3 px-5 py-4">
          <div className="flex gap-2">
            <Input type="password" placeholder="New password (min 8 characters)" value={pw} onChange={(e) => setPw(e.target.value)} />
            <Button variant="secondary" onClick={changePassword} loading={pwSaving} disabled={pw.length < 8}>
              <KeyRound className="h-4 w-4" /> Update
            </Button>
          </div>
          {pwMsg && <p className={`text-xs ${pwMsg.includes("✓") ? "text-emerald-600" : "text-red-600"}`}>{pwMsg}</p>}
        </div>
      </Card>
    </div>
  );
}
