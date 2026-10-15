// Job Search tracker — shared types + vocabulary. Tables jb_applications /
// jb_events (owner RLS, user_id defaults to auth.uid()). See job-tracker/CLAUDE.md.

export type JbStatus = "saved" | "applied" | "screening" | "interview" | "offer" | "rejected" | "withdrawn" | "ghosted";
export type JbEventKind = "applied" | "email" | "call" | "interview" | "assessment" | "offer" | "rejection" | "followup" | "note";

export interface JbApplication {
  id: string; company: string; role: string; location: string | null; url: string | null; source: string | null;
  status: JbStatus; applied_on: string | null; resume_version: string | null; salary: string | null;
  contact: string | null; next_action: string | null; next_action_on: string | null; notes: string | null;
  created_at: string; updated_at: string;
}
export interface JbEvent { id: string; application_id: string; kind: JbEventKind; happened_on: string; notes: string | null; created_at: string }

/* Pipeline order + colours. "open" = still in play (counts as active). */
export const STATUS: Record<JbStatus, { label: string; open: boolean; pill: string; dot: string }> = {
  saved:     { label: "Saved",      open: true,  pill: "bg-slate-100 text-slate-600 ring-slate-500/20",     dot: "bg-slate-400" },
  applied:   { label: "Applied",    open: true,  pill: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",   dot: "bg-indigo-500" },
  screening: { label: "Screening",  open: true,  pill: "bg-amber-50 text-amber-700 ring-amber-600/20",      dot: "bg-amber-500" },
  interview: { label: "Interview",  open: true,  pill: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", dot: "bg-emerald-500" },
  offer:     { label: "Offer",      open: true,  pill: "bg-accent text-ink ring-ink/10",                    dot: "bg-ink" },
  rejected:  { label: "Rejected",   open: false, pill: "bg-red-50 text-red-600 ring-red-600/20",            dot: "bg-red-500" },
  withdrawn: { label: "Withdrawn",  open: false, pill: "bg-slate-100 text-slate-500 ring-slate-500/20",     dot: "bg-slate-300" },
  ghosted:   { label: "Ghosted",    open: false, pill: "bg-slate-100 text-slate-500 ring-slate-500/20",     dot: "bg-slate-300" },
};
export const PIPELINE: JbStatus[] = ["saved", "applied", "screening", "interview", "offer"];
export const CLOSED: JbStatus[] = ["rejected", "withdrawn", "ghosted"];
export const ALL_STATUSES: JbStatus[] = [...PIPELINE, ...CLOSED];

export const EVENT_KINDS: Record<JbEventKind, string> = {
  applied: "Applied", email: "Email", call: "Call", interview: "Interview", assessment: "Assessment",
  offer: "Offer", rejection: "Rejection", followup: "Follow-up sent", note: "Note",
};
export const SOURCES = ["LinkedIn", "Company site", "Referral", "Recruiter", "JobStreet", "Indeed", "Glassdoor", "Other"];

/* A status change writes itself into the timeline as the matching event. */
export const STATUS_EVENT: Partial<Record<JbStatus, JbEventKind>> = {
  applied: "applied", screening: "call", interview: "interview", offer: "offer", rejected: "rejection",
};

export const todayISO = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in the browser's zone (MYT)
export const daysSince = (iso: string | null) =>
  iso ? Math.floor((Date.now() - new Date(iso + "T00:00:00").getTime()) / 86400_000) : null;
export const fmtDay = (iso: string | null) =>
  iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—";
export const isOverdue = (a: JbApplication) => !!a.next_action_on && STATUS[a.status].open && a.next_action_on < todayISO();
