import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Lock, Eye, EyeOff, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { logout } from "@/lib/api";

const API = "/api/onboarding";

type ValidState =
  | { kind: "loading" }
  | { kind: "invalid"; message: string }
  | { kind: "valid"; name: string; email: string; company: string };

function getToken(): string {
  try {
    const sp = new URLSearchParams(window.location.search);
    return sp.get("token") || "";
  } catch {
    return "";
  }
}

export default function SetPasswordPage() {
  const [, setLocation] = useLocation();
  const [token] = useState(getToken);
  const [state, setState] = useState<ValidState>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setState({ kind: "invalid", message: "This link is missing its security code. Please use the link from your invite email." });
        return;
      }
      try {
        const r = await fetch(`${API}/invite/${encodeURIComponent(token)}`);
        const data = await r.json();
        if (cancelled) return;
        if (r.ok && data.ok) {
          setState({ kind: "valid", name: data.name, email: data.email, company: data.company });
        } else {
          setState({ kind: "invalid", message: data.error || "This link is not valid." });
        }
      } catch {
        if (!cancelled) setState({ kind: "invalid", message: "We couldn't check this link. Please try again in a moment." });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Once done: sign out of any existing session (clears localStorage token),
  // then auto-redirect to /login after a 3-second countdown.
  useEffect(() => {
    if (!done) return;
    logout().catch(() => {});
    const interval = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(interval);
          window.location.href = "/login";
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [done]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (password.length < 8) { setFormError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setFormError("The two passwords don't match."); return; }
    setSubmitting(true);
    try {
      const r = await fetch(`${API}/invite/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await r.json();
      if (r.ok && data.ok) {
        setDone(true);
      } else {
        setFormError(data.error || "We couldn't set your password. Please try again.");
      }
    } catch {
      setFormError("Something went wrong. Please try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: "#253746" }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-8 shadow-2xl"
        style={{ backgroundColor: "#ffffff" }}
      >
        <div className="flex items-center gap-2.5 mb-6">
          <div
            className="flex items-center justify-center rounded-lg"
            style={{ width: 40, height: 40, backgroundColor: "#A9C23F" }}
          >
            <Lock className="h-5 w-5" style={{ color: "#253746" }} />
          </div>
          <div>
            <div className="text-lg font-bold" style={{ color: "#253746" }}>RM ONE</div>
            <div className="text-xs text-muted-foreground">Set your password</div>
          </div>
        </div>

        {state.kind === "loading" && (
          <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm">Checking your invite…</span>
          </div>
        )}

        {state.kind === "invalid" && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertCircle className="h-9 w-9 text-red-500" />
            <p className="text-sm text-slate-700">{state.message}</p>
            <Button variant="outline" className="mt-2" onClick={() => setLocation("/login")}>
              Go to login
            </Button>
          </div>
        )}

        {state.kind === "valid" && done && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <CheckCircle2 className="h-10 w-10" style={{ color: "#A9C23F" }} />
            <p className="text-base font-semibold" style={{ color: "#253746" }}>Your password is set!</p>
            <p className="text-sm text-slate-600">
              You can now log in to your {state.company} RM ONE account.
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Redirecting to login in {countdown}s…
            </p>
            <Button
              className="mt-1 text-xs"
              variant="outline"
              onClick={() => { window.location.href = "/login"; }}
            >
              Go to login now
            </Button>
          </div>
        )}

        {state.kind === "valid" && !done && (
          <form onSubmit={onSubmit} className="space-y-4">
            <p className="text-sm text-slate-600">
              Welcome, <span className="font-semibold" style={{ color: "#253746" }}>{state.name}</span>.
              Choose a password for <span className="font-medium">{state.email}</span> to finish setting up your{" "}
              {state.company} account.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">New password</label>
              <div className="relative">
                <Input
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  className="pr-10 bg-white text-[#253746] placeholder:text-slate-400"
                />
                <button
                  type="button"
                  onClick={() => setShow(s => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  tabIndex={-1}
                  aria-label={show ? "Hide password" : "Show password"}
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">Confirm password</label>
              <Input
                type={show ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                className="bg-white text-[#253746] placeholder:text-slate-400"
              />
            </div>

            {formError && (
              <div className="flex items-start gap-2 text-sm text-red-600">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <Button
              type="submit"
              disabled={submitting}
              className="w-full gap-1.5"
              style={{ backgroundColor: "#A9C23F", color: "#253746" }}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              {submitting ? "Setting password…" : "Set my password"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
