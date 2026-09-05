import { useState, type FormEvent } from "react";
import { Boxes, MailCheck } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Button, Input, Card } from "../components/ui";

// Passwordless login: email → 6-digit code (or tap the magic link in the same
// email). shouldCreateUser: false is the security half of this — a stranger
// with the URL who types their own email gets rejected instead of a fresh
// account. Keep "allow new sign-ups" OFF in the Supabase dashboard too, so the
// raw auth API can't mint accounts either.
const LAST_EMAIL_KEY = "aio:last-email";

// DEV MODE: password sign-in is shown by default while the app isn't deployed
// yet (Jared's preference). At go-live, flip this to "otp" — both modes stay
// available behind the toggle either way. The OTP *code* path works even
// undeployed; only the clickable magic link needs the Site URL configured.
const DEFAULT_MODE: "password" | "otp" = "password";

export default function Login() {
  const [mode, setMode] = useState<"password" | "otp">(DEFAULT_MODE);
  const [email, setEmail] = useState(() => localStorage.getItem(LAST_EMAIL_KEY) ?? "");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signInPassword(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message);
    else localStorage.setItem(LAST_EMAIL_KEY, email);
  }

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    setLoading(false);
    if (error) {
      // Supabase words the unknown-email rejection as a signup problem; say
      // something truthful but less confusing for the one real user.
      setError(/signup/i.test(error.message) ? "That email doesn't have access." : error.message);
      return;
    }
    localStorage.setItem(LAST_EMAIL_KEY, email);
    setSent(true);
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: "email" });
    setLoading(false);
    if (error) setError(error.message);
    // On success the auth listener in App.tsx swaps this screen out.
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent shadow-lg shadow-accent/40">
            <Boxes className="h-6 w-6 text-ink" />
          </div>
          <h1 className="mt-4 text-xl font-extrabold tracking-tight text-slate-900">All-In-One</h1>
          <p className="mt-1 text-sm text-slate-500">Your personal tools, one place</p>
        </div>
        <Card className="p-6">
          {mode === "password" ? (
            <form onSubmit={signInPassword} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Email</label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoFocus={!email} required />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Password</label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
              </div>
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
              <Button type="submit" loading={loading} className="w-full">Sign in</Button>
              <button
                type="button"
                onClick={() => { setMode("otp"); setError(null); }}
                className="w-full text-center text-xs font-medium text-slate-500 hover:text-slate-700"
              >
                Email me a login code instead
              </button>
            </form>
          ) : !sent ? (
            <form onSubmit={sendCode} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoFocus={!email}
                  required
                />
              </div>
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
              <Button type="submit" loading={loading} className="w-full">Email me a login code</Button>
              <button
                type="button"
                onClick={() => { setMode("password"); setSent(false); setError(null); }}
                className="w-full text-center text-xs font-medium text-slate-500 hover:text-slate-700"
              >
                Use a password instead
              </button>
            </form>
          ) : (
            <form onSubmit={verifyCode} className="space-y-4">
              <div className="flex items-start gap-2.5 rounded-lg bg-indigo-50 px-3 py-2.5">
                <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
                <p className="text-xs leading-relaxed text-indigo-900">
                  Code sent to <b>{email}</b>. Enter it below — or just tap the sign-in link in the same email.
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">6-digit code</label>
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  className="text-center font-mono text-lg tracking-[0.4em]"
                  autoFocus
                  required
                />
              </div>
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
              <Button type="submit" loading={loading} disabled={code.trim().length < 6} className="w-full">
                Sign in
              </Button>
              <button
                type="button"
                onClick={() => { setSent(false); setCode(""); setError(null); }}
                className="w-full text-center text-xs font-medium text-slate-500 hover:text-slate-700"
              >
                Use a different email / resend
              </button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
