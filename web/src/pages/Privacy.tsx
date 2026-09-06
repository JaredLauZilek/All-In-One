// Public privacy-policy page. Exists because Google's OAuth consent screen
// requires a privacy policy URL to publish the "Ironman Bot" app that lets
// the Training tool write to Jared's own Google Calendar. Rendered WITHOUT
// the auth gate (see App.tsx) — Google may fetch it anonymously.
export default function Privacy() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="mb-8 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent text-lg">🏋️</span>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">All-In-One — Privacy Policy</h1>
      </div>
      <div className="space-y-4 text-sm leading-relaxed text-slate-600">
        <p>
          All-In-One is a personal, single-user application operated by and for its owner.
          It is not offered to the public and has no other users.
        </p>
        <p>
          <b className="text-slate-800">Google user data.</b> The app's Google integration writes
          training sessions to, and updates events on, the owner's own Google Calendar via the
          Google Calendar API (scope: <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">calendar.events</code>).
          Calendar data is not read for any other purpose, and no Google user data is shared with,
          sold to, or transferred to any third party, nor used for advertising.
        </p>
        <p>
          <b className="text-slate-800">Storage.</b> OAuth tokens are stored server-side in the
          owner's private database and used solely to perform the calendar actions described above.
        </p>
        <p>
          <b className="text-slate-800">Contact / revocation.</b> The owner can revoke access at any
          time at{" "}
          <a className="font-medium text-indigo-600 hover:underline" href="https://myaccount.google.com/permissions">
            myaccount.google.com/permissions
          </a>
          . Questions: jared@voltara.com.my.
        </p>
        <p className="pt-4 text-xs text-slate-400">Last updated 2026-09-06.</p>
      </div>
    </div>
  );
}
