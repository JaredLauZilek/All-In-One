// One modal for add + edit. Edit mode also shows the timeline (jb_events) with
// an add-event form, and Delete. A status change on save logs itself as an event.
//
// FILES: two PDF slots (resume, cover letter) in the private bucket jb-resumes.
// A duplicate SHARES its source's objects (same path, no copy), so an object is
// only deleted from storage once no application references it (releaseObject).
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, ExternalLink, Plus, FileText, Mail, Upload, X, Copy } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Button, Input, Select, Textarea, Modal, cn } from "../../components/ui";
import {
  type JbApplication, type JbEvent, type JbStatus, type JbEventKind,
  ALL_STATUSES, STATUS, EVENT_KINDS, SOURCES, STATUS_EVENT, RESUME_BUCKET, todayISO, fmtDay,
} from "./lib";

type FileKind = "resume" | "cover";
type PathKey = "resume_path" | "cover_path";
type NameKey = "resume_name" | "cover_name";
const FILE_META: Record<FileKind, { pathKey: PathKey; nameKey: NameKey; label: string; hint: string; Icon: typeof FileText }> = {
  resume: { pathKey: "resume_path", nameKey: "resume_name", label: "Resume PDF", hint: "Attach the resume you sent", Icon: FileText },
  cover:  { pathKey: "cover_path",  nameKey: "cover_name",  label: "Cover letter PDF", hint: "Attach the cover letter, if you sent one", Icon: Mail },
};
type FileRefs = Pick<JbApplication, PathKey | NameKey>;
type Draft = Omit<JbApplication, "id" | "created_at" | "updated_at" | PathKey | NameKey>;
export type Template = Partial<Draft> & Partial<FileRefs>;
const EMPTY: Draft = {
  company: "", role: "", location: "", url: "", source: "LinkedIn", status: "applied", applied_on: todayISO(),
  resume_version: "", salary: "", contact: "", next_action: "", next_action_on: "", notes: "",
};
// One slot per file kind: an existing reference (path/name), a newly chosen File
// (uploads on Save), and a "removed" flag (applied on Save).
interface Slot { path: string | null; name: string | null; file: File | null; removed: boolean }

/* Upload to <uid>/<application id>/<timestamp>-<filename>; returns the object path. */
async function uploadPdf(appId: string, file: File): Promise<string> {
  const uid = (await supabase.auth.getSession()).data.session?.user.id;
  if (!uid) throw new Error("Not signed in");
  const path = `${uid}/${appId}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
  const { error } = await supabase.storage.from(RESUME_BUCKET).upload(path, file, { contentType: "application/pdf", upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return path;
}
/* Delete an object ONLY when no application (resume or cover) still points at it. */
async function releaseObject(path: string | null) {
  if (!path) return;
  const { count } = await supabase.from("jb_applications").select("id", { count: "exact", head: true })
    .or(`resume_path.eq.${path},cover_path.eq.${path}`);
  if ((count ?? 0) === 0) await supabase.storage.from(RESUME_BUCKET).remove([path]);
}

// Explicit column list: `d` carries id / created_at / file refs when editing, and
// those must not ride along in the PATCH.
const clean = (d: Draft): Draft => ({
  company: d.company.trim(), role: d.role.trim(), status: d.status,
  location: d.location || null, url: d.url || null, source: d.source || null, applied_on: d.applied_on || null,
  resume_version: d.resume_version || null, salary: d.salary || null, contact: d.contact || null,
  next_action: d.next_action || null, next_action_on: d.next_action_on || null, notes: d.notes || null,
});

/* Refetch the list NOW (not on the 30 s poll) — awaited by callers before they
   close the modal, so the board already shows the change when it reappears. */
export async function invalidateJobs(qc: ReturnType<typeof useQueryClient>) {
  await qc.refetchQueries({ queryKey: ["jb-apps"], type: "all" });
  qc.invalidateQueries({ queryKey: ["home-status"] });
}

/* What a duplicate carries over: the posting's facts and the SAME file objects
   (shared references, not copies) — not its history. Status resets to "applied"
   today — the usual case is another role at the same company or a re-apply. */
export function duplicateTemplate(a: JbApplication): Template {
  return { company: a.company, role: a.role, location: a.location ?? "", url: a.url ?? "", source: a.source ?? "",
    salary: a.salary ?? "", notes: a.notes ?? "", status: "applied", applied_on: todayISO(),
    resume_path: a.resume_path, resume_name: a.resume_name, cover_path: a.cover_path, cover_name: a.cover_name };
}

export default function ApplicationModal({ app, template, onClose, onDuplicate }: {
  app: JbApplication | null; template?: Template; onClose: () => void; onDuplicate?: (a: JbApplication) => void;
}) {
  const qc = useQueryClient();
  const editing = !!app;
  const [d, setD] = useState<Draft>(app ? { ...EMPTY, ...app, location: app.location ?? "", url: app.url ?? "", source: app.source ?? "",
    applied_on: app.applied_on ?? "", resume_version: app.resume_version ?? "", salary: app.salary ?? "", contact: app.contact ?? "",
    next_action: app.next_action ?? "", next_action_on: app.next_action_on ?? "", notes: app.notes ?? "" } : { ...EMPTY, ...template });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const refs: Partial<FileRefs> = app ?? template ?? {};
  const [slots, setSlots] = useState<Record<FileKind, Slot>>({
    resume: { path: refs.resume_path ?? null, name: refs.resume_name ?? null, file: null, removed: false },
    cover:  { path: refs.cover_path ?? null,  name: refs.cover_name ?? null,  file: null, removed: false },
  });
  const [fileErr, setFileErr] = useState<string | null>(null);
  const patchSlot = (k: FileKind, p: Partial<Slot>) => setSlots((s) => ({ ...s, [k]: { ...s[k], ...p } }));
  const pickFile = (k: FileKind, f: File | null) => {
    setFileErr(null);
    if (!f) { patchSlot(k, { file: null }); return; }
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) { setFileErr("PDF only."); return; }
    if (f.size > 10 * 1024 * 1024) { setFileErr("Max 10 MB."); return; }
    patchSlot(k, { file: f, removed: false });
  };
  const openFile = async (path: string) => {
    const { data, error } = await supabase.storage.from(RESUME_BUCKET).createSignedUrl(path, 3600);
    if (error || !data) { setFileErr(error?.message ?? "Could not open"); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const save = useMutation({
    mutationFn: async () => {
      const row = clean(d);
      const kinds = Object.keys(FILE_META) as FileKind[];
      if (editing) {
        // 1) uploads first (so a failed upload leaves the row untouched)
        const fileCols: Partial<FileRefs> = {};
        const toRelease: (string | null)[] = [];
        for (const k of kinds) {
          const { pathKey, nameKey } = FILE_META[k]; const s = slots[k]; const old = app![pathKey];
          if (s.file) { fileCols[pathKey] = await uploadPdf(app!.id, s.file); fileCols[nameKey] = s.file.name; if (old) toRelease.push(old); }
          else if (s.removed && old) { fileCols[pathKey] = null; fileCols[nameKey] = null; toRelease.push(old); }
        }
        const { error } = await supabase.from("jb_applications").update({ ...row, ...fileCols, updated_at: new Date().toISOString() }).eq("id", app!.id);
        if (error) throw error;
        for (const p of toRelease) await releaseObject(p);
        // status moved → one timeline event, so the history writes itself
        if (row.status !== app!.status) {
          const kind: JbEventKind = STATUS_EVENT[row.status] ?? "note";
          await supabase.from("jb_events").insert({ application_id: app!.id, kind, happened_on: todayISO(),
            notes: kind === "note" ? `Status → ${STATUS[row.status].label}` : null });
        }
      } else {
        // inherited references (duplicate) go in with the row; chosen files upload after
        const inherited: Partial<FileRefs> = {};
        for (const k of kinds) {
          const { pathKey, nameKey } = FILE_META[k]; const s = slots[k];
          if (!s.file && !s.removed && s.path) { inherited[pathKey] = s.path; inherited[nameKey] = s.name; }
        }
        const { data, error } = await supabase.from("jb_applications").insert({ ...row, ...inherited }).select("id").single();
        if (error) throw error;
        const fileCols: Partial<FileRefs> = {};
        for (const k of kinds) {
          const { pathKey, nameKey } = FILE_META[k]; const s = slots[k];
          if (s.file && data) { fileCols[pathKey] = await uploadPdf(data.id, s.file); fileCols[nameKey] = s.file.name; }
        }
        if (Object.keys(fileCols).length && data) {
          const { error: fErr } = await supabase.from("jb_applications").update(fileCols).eq("id", data.id);
          if (fErr) throw fErr;
        }
        if (row.status !== "saved" && data) {
          await supabase.from("jb_events").insert({ application_id: data.id, kind: STATUS_EVENT[row.status] ?? "note",
            happened_on: row.applied_on ?? todayISO(), notes: null });
        }
      }
    },
    onSuccess: async () => { await invalidateJobs(qc); onClose(); },
  });
  const remove = useMutation({
    mutationFn: async () => {
      const paths = [app!.resume_path, app!.cover_path];
      const { error } = await supabase.from("jb_applications").delete().eq("id", app!.id);
      if (error) throw error;
      for (const p of paths) await releaseObject(p); // gone from storage only if no duplicate still uses it
    },
    onSuccess: async () => { await invalidateJobs(qc); onClose(); },
  });

  const onSubmit = (e: FormEvent) => { e.preventDefault(); if (d.company.trim() && d.role.trim()) save.mutate(); };
  const field = (label: string, el: React.ReactNode, span2 = false) => (
    <label className={cn("block", span2 && "sm:col-span-2")}>
      <span className="mb-1 block text-[11px] font-medium text-slate-500">{label}</span>{el}
    </label>
  );
  const fileField = (k: FileKind) => {
    const { label, hint, Icon } = FILE_META[k]; const s = slots[k];
    const shared = !editing && !!template && !!s.path && !s.file && !s.removed;
    return field(label, (
      <div className="flex min-h-[42px] flex-wrap items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs">
        {s.file ? (
          <>
            <Icon className="h-4 w-4 text-indigo-600" />
            <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{s.file.name}</span>
            <span className="text-slate-400">uploads on save</span>
            <button type="button" onClick={() => pickFile(k, null)} className="rounded-md p-0.5 text-slate-400 hover:text-red-500"><X className="h-3.5 w-3.5" /></button>
          </>
        ) : s.path && !s.removed ? (
          <>
            <Icon className="h-4 w-4 text-indigo-600" />
            <button type="button" onClick={() => openFile(s.path!)} className="min-w-0 flex-1 truncate text-left font-medium text-indigo-600 hover:underline" title="Open in a new tab">{s.name ?? "file.pdf"}</button>
            {shared && <span className="text-slate-400" title="Same file as the original — not copied">shared</span>}
            <label className="cursor-pointer text-slate-500 hover:text-slate-800">replace<input type="file" accept="application/pdf" className="hidden" onChange={(e) => pickFile(k, e.target.files?.[0] ?? null)} /></label>
            <button type="button" onClick={() => patchSlot(k, { removed: true })} className="text-slate-400 hover:text-red-500">remove</button>
          </>
        ) : (
          <label className="flex cursor-pointer items-center gap-2 text-slate-500 hover:text-slate-800">
            <Upload className="h-4 w-4" /> {hint} (max 10 MB)
            <input type="file" accept="application/pdf" className="hidden" onChange={(e) => pickFile(k, e.target.files?.[0] ?? null)} />
            {s.removed && s.path && <button type="button" onClick={(e) => { e.preventDefault(); patchSlot(k, { removed: false }); }} className="ml-auto text-slate-400 hover:text-slate-700">undo remove</button>}
          </label>
        )}
      </div>
    ), true);
  };

  return (
    <Modal open onClose={onClose} title={editing ? `${app!.company} — ${app!.role}` : template ? `Duplicate of ${template.company ?? "application"} — edit, then Add` : "Add application"} wide>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field("Company", <Input autoFocus value={d.company} onChange={(e) => set("company", e.target.value)} placeholder="e.g. Grab" />)}
          {field("Role", <Input value={d.role} onChange={(e) => set("role", e.target.value)} placeholder="e.g. Product Manager" />)}
          {field("Status", <Select value={d.status} onChange={(e) => set("status", e.target.value as JbStatus)}>
            {ALL_STATUSES.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}</Select>)}
          {field("Applied on", <Input type="date" value={d.applied_on ?? ""} onChange={(e) => set("applied_on", e.target.value)} />)}
          {field("Location", <Input value={d.location ?? ""} onChange={(e) => set("location", e.target.value)} placeholder="KL · Singapore · Remote" />)}
          {field("Source", <Select value={d.source ?? ""} onChange={(e) => set("source", e.target.value)}>
            <option value="">—</option>{SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>)}
          {field("Posting link", <Input value={d.url ?? ""} onChange={(e) => set("url", e.target.value)} placeholder="https://…" />, true)}
          {fileField("resume")}
          {fileField("cover")}
          {fileErr && <p className="text-xs text-red-600 sm:col-span-2">{fileErr}</p>}
          {field("Salary / range", <Input value={d.salary ?? ""} onChange={(e) => set("salary", e.target.value)} placeholder="e.g. RM 12–15k" />)}
          {field("Notes", <Textarea rows={3} value={d.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="JD highlights, who referred you, interview prep…" />, true)}
        </div>
        {(save.isError || remove.isError) && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {((save.error ?? remove.error) as { message?: string })?.message ?? String(save.error ?? remove.error)}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {editing && (
              <Button type="button" variant="ghost" onClick={() => { if (confirm(`Delete ${app!.company} — ${app!.role}? Its timeline goes too.`)) remove.mutate(); }} loading={remove.isPending}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            )}
            {editing && onDuplicate && (
              <Button type="button" variant="ghost" title="Start a new application with these details (files shared, not copied)" onClick={() => onDuplicate(app!)}>
                <Copy className="h-4 w-4" /> Duplicate
              </Button>
            )}
            {editing && app!.url && (
              <a href={app!.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline">
                <ExternalLink className="h-3.5 w-3.5" /> posting
              </a>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>{editing ? "Save" : "Add"}</Button>
          </div>
        </div>
      </form>
      {editing && <Timeline app={app!} />}
    </Modal>
  );
}

function Timeline({ app }: { app: JbApplication }) {
  const qc = useQueryClient();
  const { data: events } = useQuery({
    queryKey: ["jb-events", app.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("jb_events").select("*").eq("application_id", app.id)
        .order("happened_on", { ascending: false }).order("created_at", { ascending: false });
      if (error) throw error;
      return data as JbEvent[];
    },
  });
  const [kind, setKind] = useState<JbEventKind>("followup");
  const [on, setOn] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("jb_events").insert({ application_id: app.id, kind, happened_on: on, notes: notes.trim() || null });
      if (error) throw error;
      await supabase.from("jb_applications").update({ updated_at: new Date().toISOString() }).eq("id", app.id);
    },
    onSuccess: () => { setNotes(""); qc.invalidateQueries({ queryKey: ["jb-events", app.id] }); void invalidateJobs(qc); },
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("jb_events").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jb-events", app.id] }),
  });
  return (
    <div className="mt-5 border-t border-slate-100 pt-4">
      <p className="mb-2 text-xs font-semibold text-slate-700">Timeline</p>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <Select value={kind} onChange={(e) => setKind(e.target.value as JbEventKind)} className="sm:w-40">
          {(Object.keys(EVENT_KINDS) as JbEventKind[]).map((k) => <option key={k} value={k}>{EVENT_KINDS[k]}</option>)}
        </Select>
        <Input type="date" value={on} onChange={(e) => setOn(e.target.value)} className="sm:w-40" />
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="what happened"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add.mutate(); } }} />
        <Button type="button" variant="secondary" onClick={() => add.mutate()} loading={add.isPending}><Plus className="h-4 w-4" /> Log</Button>
      </div>
      {(events ?? []).length === 0 ? (
        <p className="text-xs text-slate-400">Nothing logged yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {(events ?? []).map((ev) => (
            <li key={ev.id} className="group flex items-start gap-3 py-2 text-xs">
              <span className="w-14 shrink-0 font-mono text-slate-400">{fmtDay(ev.happened_on)}</span>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">{EVENT_KINDS[ev.kind]}</span>
              <span className="min-w-0 flex-1 text-slate-700">{ev.notes}</span>
              <button type="button" onClick={() => del.mutate(ev.id)} className="rounded-md p-1 text-slate-300 opacity-0 hover:bg-red-50 hover:text-red-500 group-hover:opacity-100">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
