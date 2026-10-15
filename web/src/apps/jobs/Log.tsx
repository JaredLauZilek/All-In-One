// Job Search → Log: every application as a table, with search, a status filter
// and CSV export. Same modal as the pipeline for editing.
import { useMemo, useState } from "react";
import { Download, Search, Plus } from "lucide-react";
import { Button, Card, CardHeader, Input, Select, EmptyState, cn } from "../../components/ui";
import { type JbApplication, type JbStatus, STATUS, ALL_STATUSES } from "./lib";
import { useApplications } from "./Pipeline";
import ApplicationModal from "./ApplicationModal";

export default function Log() {
  const { data: apps } = useApplications();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<JbStatus | "">("");
  const [open, setOpen] = useState<JbApplication | null | "new">(null);
  const rows = useMemo(() => (apps ?? []).filter((a) =>
    (!status || a.status === status) &&
    (!q || `${a.company} ${a.role} ${a.location ?? ""} ${a.source ?? ""} ${a.resume_name ?? ""} ${a.notes ?? ""}`.toLowerCase().includes(q.toLowerCase()))),
    [apps, q, status]);

  const exportCsv = () => {
    const cols = ["company", "role", "status", "applied_on", "location", "source", "resume_name", "salary", "url", "notes"] as const;
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [cols.join(","), ...rows.map((a) => cols.map((c) => esc(a[c])).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const el = document.createElement("a"); el.href = url; el.download = `job-search-${new Date().toISOString().slice(0, 10)}.csv`; el.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Application log" subtitle={`${rows.length} of ${apps?.length ?? 0} · click a row to open`}
          action={
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" /> CSV</Button>
              <Button onClick={() => setOpen("new")}><Plus className="h-4 w-4" /> Add</Button>
            </div>
          } />
        <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, role, notes…" className="pl-9" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value as JbStatus | "")} className="sm:w-44">
            <option value="">All statuses</option>
            {ALL_STATUSES.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
          </Select>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<Search className="h-5 w-5" />} title="Nothing here" subtitle={apps?.length ? "No application matches that filter." : "Add your first application on the Pipeline tab."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2 font-medium">Company</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Applied</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Resume</th>
                  <th className="px-5 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((a) => (
                  <tr key={a.id} onClick={() => setOpen(a)} className="cursor-pointer hover:bg-slate-50">
                    <td className="px-5 py-2.5 font-semibold text-slate-900">{a.company}</td>
                    <td className="px-3 py-2.5 text-slate-700">{a.role}</td>
                    <td className="px-3 py-2.5"><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", STATUS[a.status].pill)}>{STATUS[a.status].label}</span></td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{a.applied_on ?? "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">{a.source ?? "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">{a.resume_name ?? "—"}</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-400">{a.updated_at.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {open && <ApplicationModal app={open === "new" ? null : open} onClose={() => setOpen(null)} />}
    </div>
  );
}
