// Job Search → Pipeline: stats + a board by status. Click a card to open it;
// the shared ApplicationModal handles add / edit / timeline / delete.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, Plus, Send, Users, Trophy, Percent, ExternalLink, FileText, Mail, Copy } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Button, Card, CardHeader, StatCard, EmptyState, cn } from "../../components/ui";
import { type JbApplication, STATUS, PIPELINE, CLOSED, daysSince, fmtDay, todayISO } from "./lib";
import ApplicationModal, { duplicateTemplate } from "./ApplicationModal";
type ModalState = { app: JbApplication } | { template: ReturnType<typeof duplicateTemplate> } | "new" | null;

export function useApplications() {
  return useQuery({
    queryKey: ["jb-apps"],
    queryFn: async () => {
      const { data, error } = await supabase.from("jb_applications").select("*")
        .order("applied_on", { ascending: false, nullsFirst: false }).order("updated_at", { ascending: false });
      if (error) throw error;
      return data as JbApplication[];
    },
  });
}

export default function Pipeline() {
  const { data: apps } = useApplications();
  const [open, setOpen] = useState<ModalState>(null);
  const list = apps ?? [];
  const active = list.filter((a) => STATUS[a.status].open && a.status !== "saved");
  const month = todayISO().slice(0, 7);
  const appliedThisMonth = list.filter((a) => a.applied_on?.startsWith(month)).length;
  const interviewing = list.filter((a) => a.status === "interview").length;
  const offers = list.filter((a) => a.status === "offer").length;
  // response rate = anything that got a human reply (screening onward, incl. rejections) / everything sent
  const sent = list.filter((a) => a.status !== "saved");
  const responded = sent.filter((a) => !["applied", "ghosted"].includes(a.status));
  const rate = sent.length ? Math.round((responded.length / sent.length) * 100) : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
        <StatCard label="Active" value={active.length} accent="bg-indigo-50 text-indigo-600" icon={<Briefcase className="h-5 w-5" />} />
        <StatCard label="Sent this month" value={appliedThisMonth} accent="bg-slate-100 text-slate-600" icon={<Send className="h-5 w-5" />} />
        <StatCard label="Interviewing" value={interviewing} accent="bg-emerald-50 text-emerald-600" icon={<Users className="h-5 w-5" />} />
        <StatCard label="Offers" value={offers} accent="bg-amber-50 text-amber-600" icon={<Trophy className="h-5 w-5" />} />
        <StatCard label="Response rate" value={rate != null ? `${rate}%` : "—"} accent="bg-slate-100 text-slate-600" icon={<Percent className="h-5 w-5" />} />
      </div>

      <Card>
        <CardHeader title="Pipeline" subtitle="Click a card to open it · status changes write themselves into the timeline"
          action={<Button onClick={() => setOpen("new")}><Plus className="h-4 w-4" /> Add application</Button>} />
        {list.length === 0 ? (
          <EmptyState icon={<Briefcase className="h-5 w-5" />} title="No applications yet"
            subtitle="Add the ones you've sent — company, role, which resume went out, and when to follow up." />
        ) : (
          <div className="overflow-x-auto">
            <div className="grid min-w-[60rem] grid-cols-5 divide-x divide-slate-100">
              {PIPELINE.map((s) => {
                const col = list.filter((a) => a.status === s);
                return (
                  <div key={s} className="min-h-[14rem] px-3 py-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <span className={cn("h-1.5 w-1.5 rounded-full", STATUS[s].dot)} /> {STATUS[s].label}
                      <span className="ml-auto font-mono text-slate-400">{col.length}</span>
                    </p>
                    <div className="space-y-2">
                      {col.map((a) => <AppCard key={a.id} a={a} onOpen={() => setOpen({ app: a })} onDuplicate={() => setOpen({ template: duplicateTemplate(a) })} />)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {list.some((a) => CLOSED.includes(a.status)) && (
        <Card>
          <CardHeader title="Closed" subtitle="Rejected · withdrawn · ghosted — kept for the record and the response rate" />
          <ul className="divide-y divide-slate-100">
            {list.filter((a) => CLOSED.includes(a.status)).map((a) => (
              <li key={a.id}>
                <button onClick={() => setOpen({ app: a })} className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-slate-50">
                  <span className="text-sm font-semibold text-slate-600">{a.company}</span>
                  <span className="truncate text-xs text-slate-400">{a.role}</span>
                  <span className={cn("ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset", STATUS[a.status].pill)}>{STATUS[a.status].label}</span>
                  <span className="w-16 shrink-0 text-right font-mono text-[11px] text-slate-400">{fmtDay(a.applied_on)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {open && (
        <ApplicationModal
          key={open === "new" ? "new" : "app" in open ? open.app.id : "dup"}
          app={open !== "new" && "app" in open ? open.app : null}
          template={open !== "new" && "template" in open ? open.template : undefined}
          onClose={() => setOpen(null)}
          onDuplicate={(a) => setOpen({ template: duplicateTemplate(a) })} />
      )}
    </div>
  );
}

function AppCard({ a, onOpen, onDuplicate }: { a: JbApplication; onOpen: () => void; onDuplicate: () => void }) {
  const age = daysSince(a.applied_on);
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
      className="group relative w-full cursor-pointer rounded-xl bg-slate-50 p-2.5 text-left transition hover:bg-slate-100 dark:bg-slate-100 dark:hover:bg-slate-200">
      <button type="button" title="Duplicate this application" aria-label="Duplicate"
        onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
        className="absolute right-1.5 top-1.5 rounded-full p-1 text-slate-400 opacity-0 transition hover:bg-slate-200/70 hover:text-slate-700 focus:opacity-100 group-hover:opacity-100">
        <Copy className="h-3.5 w-3.5" />
      </button>
      <p className="flex items-center gap-1 pr-6 text-sm font-semibold text-slate-900">
        <span className="truncate">{a.company}</span>
        {a.url && <ExternalLink className="h-3 w-3 shrink-0 text-slate-300" />}
        {a.resume_path && <FileText className="h-3 w-3 shrink-0 text-indigo-500" aria-label="Resume attached" />}
        {a.cover_path && <Mail className="h-3 w-3 shrink-0 text-indigo-500" aria-label="Cover letter attached" />}
      </p>
      <p className="truncate text-xs text-slate-600">{a.role}</p>
      <p className="mt-1 font-mono text-[10px] text-slate-400">
        {a.applied_on ? `${fmtDay(a.applied_on)} · ${age}d` : "not sent"}{a.source ? ` · ${a.source}` : ""}
      </p>
    </div>
  );
}
