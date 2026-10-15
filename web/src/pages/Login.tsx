import { useEffect, useRef, useState } from "react";
import { Boxes, Delete, Lock } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Card } from "../components/ui";

// Passcode login (2026-10-15, replaces the email/password + OTP forms). The code
// is checked by the `aio-passcode` edge function — never in the browser — which
// returns a one-shot magic-link token for the account; verifyOtp turns it into
// the normal Supabase session, so RLS and the auth listener in App.tsx are
// untouched. Wrong codes count towards a 15-minute lockout server-side.
const LENGTH = 4;

export default function Login() {
  const [digits, setDigits] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(code: string) {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke<{ token_hash?: string; error?: string }>("aio-passcode", {
      body: { passcode: code },
    });
    // invoke() surfaces non-2xx as FunctionsHttpError with the body on context.
    let message = data?.error ?? null;
    if (error && !message) {
      try { message = (await (error as { context?: Response }).context?.json())?.error ?? null; } catch { /* ignore */ }
      message ??= error.message;
    }
    if (message || !data?.token_hash) {
      setLoading(false);
      setError(message ?? "Could not sign in.");
      setDigits("");
      setShake(true);
      setTimeout(() => setShake(false), 400);
      return;
    }
    const { error: vErr } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: "magiclink" });
    setLoading(false);
    if (vErr) { setError(vErr.message); setDigits(""); }
    // On success the auth listener in App.tsx swaps this screen out.
  }

  function press(d: string) {
    if (loading || digits.length >= LENGTH) return;
    const next = digits + d;
    setDigits(next);
    setError(null);
    if (next.length === LENGTH) void submit(next);
  }
  const backspace = () => { if (!loading) setDigits((s) => s.slice(0, -1)); };

  // Physical keyboard support (desktop) via a hidden input that stays focused.
  useEffect(() => { inputRef.current?.focus(); }, [loading]);
  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === "Backspace") { e.preventDefault(); backspace(); }
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 safe-top safe-bottom" onClick={() => inputRef.current?.focus()}>
      <div className="w-full max-w-xs">
        <div className="mb-6 flex flex-col items-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent shadow-lg shadow-accent/40">
            <Boxes className="h-6 w-6 text-ink" />
          </div>
          <h1 className="mt-4 text-xl font-extrabold tracking-tight text-slate-900">All-In-One</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500"><Lock className="h-3.5 w-3.5" /> Enter your passcode</p>
        </div>
        <Card className="p-6">
          <input
            ref={inputRef}
            inputMode="numeric"
            autoComplete="off"
            aria-label="Passcode"
            value={digits}
            onChange={() => { /* controlled via onKeyDown */ }}
            onKeyDown={onKey}
            className="absolute h-0 w-0 opacity-0"
            autoFocus
          />
          <div className={`mb-6 flex justify-center gap-4 ${shake ? "animate-[shake_0.4s]" : ""}`}>
            {Array.from({ length: LENGTH }).map((_, i) => (
              <span
                key={i}
                className={`h-3.5 w-3.5 rounded-full border-2 transition ${
                  i < digits.length ? "border-ink bg-ink dark:border-accent dark:bg-accent" : "border-slate-300"
                } ${loading ? "animate-pulse" : ""}`}
              />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {keys.map((k, i) =>
              k === "" ? <span key={i} /> : (
                <button
                  key={i}
                  type="button"
                  disabled={loading}
                  onClick={(e) => { e.stopPropagation(); k === "⌫" ? backspace() : press(k); }}
                  className="flex h-14 items-center justify-center rounded-full bg-slate-100 text-xl font-semibold text-slate-900 transition active:scale-95 active:bg-slate-200 disabled:opacity-50"
                  aria-label={k === "⌫" ? "Delete" : k}
                >
                  {k === "⌫" ? <Delete className="h-5 w-5" /> : k}
                </button>
              ),
            )}
          </div>
          <p className={`mt-4 min-h-[1.25rem] text-center text-xs ${error ? "text-red-600" : "text-transparent"}`}>{error ?? "·"}</p>
        </Card>
      </div>
    </div>
  );
}
