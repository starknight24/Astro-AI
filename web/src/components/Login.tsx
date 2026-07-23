import { useState, type FormEvent } from "react";
import { Orbit, Mail, Lock, LogIn, UserPlus } from "lucide-react";
import { supabase } from "../lib/supabase";

type Mode = "signin" | "signup";

export default function Login() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        if (!data.session) {
          setInfo(
            "Check your email for a confirmation link to finish sign-up.",
          );
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6 font-sans">
      <div className="w-full max-w-md bg-slate-900/50 border border-slate-800 rounded-2xl p-8 backdrop-blur-md shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <Orbit
            className="w-7 h-7 text-indigo-500 animate-spin"
            style={{ animationDuration: "12s" }}
          />
          <div>
            <h1 className="font-display font-extrabold text-xl text-white tracking-tight">
              AstroAI
            </h1>
            <p className="text-xs text-slate-400 font-mono">
              {mode === "signin"
                ? "Sign in to continue"
                : "Create your account"}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
              Email
            </span>
            <div className="flex items-center gap-2 bg-slate-950/70 border border-slate-800 rounded-xl px-3 py-2 focus-within:border-indigo-500 transition-colors">
              <Mail className="w-4 h-4 text-slate-500" />
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-transparent flex-1 text-sm text-slate-100 placeholder-slate-600 outline-none"
                placeholder="you@example.com"
              />
            </div>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
              Password
            </span>
            <div className="flex items-center gap-2 bg-slate-950/70 border border-slate-800 rounded-xl px-3 py-2 focus-within:border-indigo-500 transition-colors">
              <Lock className="w-4 h-4 text-slate-500" />
              <input
                type="password"
                required
                minLength={6}
                autoComplete={
                  mode === "signin" ? "current-password" : "new-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-transparent flex-1 text-sm text-slate-100 placeholder-slate-600 outline-none"
                placeholder="••••••••"
              />
            </div>
          </label>

          {error && (
            <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          {info && (
            <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl px-4 py-2.5 transition-all shadow-md shadow-indigo-600/20"
          >
            {mode === "signin" ? (
              <>
                <LogIn className="w-4 h-4" />
                Sign in
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4" />
                Sign up
              </>
            )}
          </button>
        </form>

        <div className="flex items-center gap-3 my-5 text-[10px] font-mono uppercase text-slate-500">
          <div className="h-px flex-1 bg-slate-800" />
          or
          <div className="h-px flex-1 bg-slate-800" />
        </div>

        <button
          onClick={handleGoogle}
          disabled={busy}
          className="w-full flex items-center justify-center gap-3 bg-slate-950/70 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-100 text-sm font-semibold rounded-xl px-4 py-2.5 transition-all disabled:opacity-50"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#EA4335"
              d="M12 10.2v3.9h5.5c-.24 1.4-1.72 4.1-5.5 4.1-3.31 0-6.02-2.75-6.02-6.15S8.69 5.9 12 5.9c1.88 0 3.14.8 3.86 1.5l2.64-2.55C16.85 3.28 14.62 2.4 12 2.4 6.87 2.4 2.7 6.57 2.7 12S6.87 21.6 12 21.6c6.93 0 9.3-4.86 9.3-7.35 0-.5-.06-.9-.14-1.25H12z"
            />
          </svg>
          Continue with Google
        </button>

        <div className="mt-6 text-center text-xs text-slate-400">
          {mode === "signin" ? (
            <>
              New here?{" "}
              <button
                onClick={() => {
                  setMode("signup");
                  setError(null);
                  setInfo(null);
                }}
                className="text-indigo-400 hover:text-indigo-300 font-semibold"
              >
                Create an account
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => {
                  setMode("signin");
                  setError(null);
                  setInfo(null);
                }}
                className="text-indigo-400 hover:text-indigo-300 font-semibold"
              >
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
