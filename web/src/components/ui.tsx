// Design-system primitives shared by every tool in All-In-One: white cards on
// slate-50, indigo primary, slate-900 sidebar. This is the single copy (the
// pre-merge apps kept two mirrored files in sync by hand — no longer needed).
//
// StatusBadge speaks both vocabularies on purpose: the restock monitor's stock
// statuses AND the financial desk's verdicts/print directions share the same
// semantic colours (emerald = good/up, amber = watch, red = bad/down,
// indigo = act, slate = unknown/flat).
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { X, Loader2 } from "lucide-react";

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

const buttonVariants = {
  primary: "bg-accent text-ink hover:bg-accent-hover shadow-sm",
  secondary: "bg-slate-100 text-slate-800 hover:bg-slate-200",
  dark: "bg-ink text-white hover:bg-slate-800 shadow-sm",
  danger: "bg-white text-red-600 border border-red-200 hover:bg-red-50 shadow-sm",
  ghost: "text-slate-600 hover:bg-slate-100",
};

export function Button({
  variant = "primary",
  loading,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonVariants; loading?: boolean }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        buttonVariants[variant],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400",
        "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500",
        props.className,
      )}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm",
        "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500",
        props.className,
      )}
    />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400",
        "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500",
        props.className,
      )}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-3xl border border-slate-200/50 bg-white shadow-[0_1px_2px_rgba(15,17,13,0.04)]", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
      <div>
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const badgeStyles: Record<string, string> = {
  // generic
  unknown: "bg-slate-100 text-slate-600 ring-slate-500/20",
  error: "bg-orange-50 text-orange-700 ring-orange-600/20",
  // financial-tracker verdict / contract-print vocabulary
  HOLD: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  WATCH: "bg-amber-50 text-amber-700 ring-amber-600/20",
  ENTRY: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  CAUTION: "bg-red-50 text-red-700 ring-red-600/20",
  none: "bg-slate-100 text-slate-600 ring-slate-500/20",
  up: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  down: "bg-red-50 text-red-700 ring-red-600/20",
  flat: "bg-slate-100 text-slate-600 ring-slate-500/20",
  mixed: "bg-amber-50 text-amber-700 ring-amber-600/20",
  // earnings-vol-scanner verdict / filter vocabulary
  RECOMMEND: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  CONSIDER: "bg-amber-50 text-amber-700 ring-amber-600/20",
  AVOID: "bg-red-50 text-red-700 ring-red-600/20",
  PASS: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  FAIL: "bg-red-50 text-red-700 ring-red-600/20",
  open: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  closed: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

const badgeDots: Record<string, string> = {
  error: "bg-orange-500",
  HOLD: "bg-emerald-500",
  WATCH: "bg-amber-500",
  ENTRY: "bg-indigo-500",
  CAUTION: "bg-red-500",
  up: "bg-emerald-500",
  down: "bg-red-500",
  mixed: "bg-amber-500",
  RECOMMEND: "bg-emerald-500",
  CONSIDER: "bg-amber-500",
  AVOID: "bg-red-500",
  PASS: "bg-emerald-500",
  FAIL: "bg-red-500",
  open: "bg-indigo-500",
};

const badgeLabels: Record<string, string> = {
  unknown: "Unknown",
  error: "Error",
  HOLD: "Hold",
  WATCH: "Watch",
  ENTRY: "Entry level hit",
  CAUTION: "Caution",
  none: "No snapshot yet",
  up: "Up",
  down: "Down",
  flat: "Flat",
  mixed: "Mixed",
  RECOMMEND: "Recommend",
  CONSIDER: "Consider",
  AVOID: "Avoid",
  PASS: "Pass",
  FAIL: "Fail",
  open: "Open",
  closed: "Closed",
};

export function StatusBadge({ status, dot = true }: { status: string; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        badgeStyles[status] ?? badgeStyles.unknown,
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", badgeDots[status] ?? "bg-slate-400")} />}
      {badgeLabels[status] ?? status}
    </span>
  );
}

export function Modal({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className={cn("relative w-full rounded-3xl bg-white shadow-2xl", wide ? "max-w-2xl" : "max-w-md")}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-5.5 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-ink" : "bg-slate-300",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-1",
        )}
      />
    </button>
  );
}

export function StatCard({ label, value, icon, accent }: { label: string; value: string | number; icon: ReactNode; accent: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-4">
        <div className={cn("flex h-11 w-11 items-center justify-center rounded-lg", accent)}>{icon}</div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="mt-0.5 truncate text-2xl font-semibold text-slate-900">{value}</p>
        </div>
      </div>
    </Card>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
    </div>
  );
}

export function EmptyState({ icon, title, subtitle, action }: { icon: ReactNode; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">{icon}</div>
      <h3 className="mt-4 text-sm font-semibold text-slate-900">{title}</h3>
      {subtitle && <p className="mt-1 max-w-sm text-sm text-slate-500">{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// Label/value row used inside cards.
export function DataRow({ label, value, tone }: { label: string; value: ReactNode; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <span
        className={cn(
          "text-sm font-semibold",
          tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "text-slate-800",
        )}
      >
        {value}
      </span>
    </div>
  );
}
