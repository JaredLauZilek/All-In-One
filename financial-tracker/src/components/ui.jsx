// Design-system primitives. Kept deliberately in sync with
// lazada-monitor/web/src/components/ui.tsx so the two All-In-One apps look like
// one product: white cards on slate-50, indigo primary, slate-900 sidebar.
// If you change a primitive here, check whether the sibling app needs it too.
import { X, Loader2 } from "lucide-react";

export function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

const buttonVariants = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm",
  secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-sm",
  danger: "bg-white text-red-600 border border-red-200 hover:bg-red-50 shadow-sm",
  ghost: "text-slate-600 hover:bg-slate-100",
};

export function Button({ variant = "primary", loading, className, children, disabled, ...props }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
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

export function Input(props) {
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

export function Select(props) {
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

export function Textarea(props) {
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

export function Card({ children, className }) {
  return <div className={cn("rounded-xl border border-slate-200 bg-white shadow-sm", className)}>{children}</div>;
}

export function CardHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// Verdicts and contract-print directions share the badge vocabulary of the sibling
// app's stock statuses: emerald = fine, amber = watch, red = bad, indigo = act.
const badgeStyles = {
  HOLD: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  WATCH: "bg-amber-50 text-amber-700 ring-amber-600/20",
  ENTRY: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  CAUTION: "bg-red-50 text-red-700 ring-red-600/20",
  none: "bg-slate-100 text-slate-600 ring-slate-500/20",
  up: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  down: "bg-red-50 text-red-700 ring-red-600/20",
  flat: "bg-slate-100 text-slate-600 ring-slate-500/20",
  mixed: "bg-amber-50 text-amber-700 ring-amber-600/20",
};

const badgeDots = {
  HOLD: "bg-emerald-500",
  WATCH: "bg-amber-500",
  ENTRY: "bg-indigo-500",
  CAUTION: "bg-red-500",
  up: "bg-emerald-500",
  down: "bg-red-500",
  flat: "bg-slate-400",
  mixed: "bg-amber-500",
  none: "bg-slate-400",
};

const badgeLabels = {
  HOLD: "Hold",
  WATCH: "Watch",
  ENTRY: "Entry level hit",
  CAUTION: "Caution",
  none: "No snapshot yet",
  up: "Up",
  down: "Down",
  flat: "Flat",
  mixed: "Mixed",
};

export function StatusBadge({ status, dot = true }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        badgeStyles[status] ?? badgeStyles.none,
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", badgeDots[status] ?? badgeDots.none)} />}
      {badgeLabels[status] ?? status}
    </span>
  );
}

export function StatCard({ label, value, icon, accent }) {
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

export function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className={cn("relative w-full rounded-xl bg-white shadow-2xl", wide ? "max-w-2xl" : "max-w-md")}>
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

export function Switch({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-5.5 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-indigo-600" : "bg-slate-300",
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

export function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
    </div>
  );
}

export function EmptyState({ icon, title, subtitle, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">{icon}</div>
      <h3 className="mt-4 text-sm font-semibold text-slate-900">{title}</h3>
      {subtitle && <p className="mt-1 max-w-sm text-sm text-slate-500">{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// Label/value row used inside cards. Mirrors HealthRow in the sibling app's Dashboard.
export function DataRow({ label, value, tone }) {
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
