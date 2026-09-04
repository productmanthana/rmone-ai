import React from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/useAuth";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Loader2, Home, User, Lock, AlertCircle, ArrowRight, Eye, EyeOff } from "lucide-react";
import { shouldShowBriefingToday } from "@/lib/briefingGate";
import { warmDailyBriefing } from "@/lib/dailyBriefing";
import { armCommandCentreSplash } from "@/components/CommandCentreLoader";

/**
 * Pick the post-login landing route. The Daily Briefing screen is shown
 * once per calendar day per account (date-keyed in localStorage under a
 * tenant+username-scoped `rmone.lastBriefingShown:<tenant>::<user>` key —
 * see lib/briefingGate.ts). If this user has already seen today's
 * briefing, send them straight to the command center; otherwise route
 * them through `/briefing` first.
 */
function postLoginRoute(): string {
  if (shouldShowBriefingToday()) return "/briefing";
  // Already seen today's briefing — clear the intro-overlay flag armed at
  // login so a later manual open (avatar menu → Daily Briefing) doesn't
  // replay the login intro animation.
  try { sessionStorage.removeItem("rmone_briefing_intro_pending"); } catch {}
  return "/";
}

const loginSchema = z.object({
  tenant: z.string().min(1, "Tenant ID is required"),
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export default function Login() {
  const [, setLocation] = useLocation();
  const { signIn, user, isLoading } = useAuth();
  const [error, setError] = React.useState<string | null>(null);
  const [showPassword, setShowPassword] = React.useState(false);
  const [reconnecting, setReconnecting] = React.useState(false);

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      tenant: "Liro_Poc",
      username: "Administrator_Liro_Poc",
      password: "",
    },
  });

  React.useEffect(() => {
    if (user && !isLoading) {
      const route = postLoginRoute();
      // Start the briefing's slow data fetches NOW so the network overlaps
      // the route transition + intro overlay instead of starting on mount.
      if (route === "/briefing") warmDailyBriefing();
      setLocation(route);
    }
  }, [user, isLoading, setLocation]);

  async function onSubmit(values: z.infer<typeof loginSchema>) {
    setError(null);

    // Attempt login; on a transient server error (502/503/network) retry once
    // after a short pause before surfacing an error — the DB connection is
    // occasionally slow to establish on cold start.
    const attempt = () => signIn(values.tenant, values.username, values.password);
    const isCredentialError = (e: any) => {
      const msg = String(e?.message || e);
      const status = e?.status as number | undefined;
      return status === 400 || status === 401 || msg.includes("400") || msg.includes("401");
    };
    try {
      try {
        await attempt();
      } catch (e: any) {
        if (isCredentialError(e)) throw e; // wrong password — no retry
        // Server/DB blip — wait 3 s for the server to reset its connection
        // pool, then retry once. 1.5 s was too short: the pool reset takes
        // ~3 s on the server side, so the 1.5 s retry hit a still-dead pool.
        setReconnecting(true);
        await new Promise(r => setTimeout(r, 3000));
        setReconnecting(false);
        await attempt();
      }
      // Arm the AI Agents Command Center splash — plays ONCE on the next
      // mount of the home page as a popup overlay on top of the dashboard.
      // Tied to a real login event so refreshing later does not replay it.
      armCommandCentreSplash();
      // Arm the Daily Briefing intro overlay so it plays once on the
      // very next mount of /briefing. Briefing page consumes & clears
      // this flag — keeps the intro tied to LOGIN, not session.
      try { sessionStorage.setItem("rmone_briefing_intro_pending", "1"); } catch {}
      const route = postLoginRoute();
      // Kick off the briefing's data fetches immediately after sign-in so
      // they run during the splash/redirect (cached() de-dupes them with
      // the page's own compose call).
      if (route === "/briefing") warmDailyBriefing();
      setLocation(route);
    } catch (e: any) {
      // TEMP DIAGNOSTIC: report the REAL failure to the server log so we can
      // see what actually breaks in the user's browser (we cannot see their
      // console). Fire-and-forget; remove once the login issue is resolved.
      try {
        const detail = {
          where: "login.onSubmit",
          message: String(e?.message ?? e),
          status: e?.status ?? null,
          name: e?.name ?? null,
          stack: typeof e?.stack === "string" ? e.stack.slice(0, 600) : null,
          ua: navigator.userAgent.slice(0, 120),
        };
        console.error("[login] sign-in failed:", detail);
        void fetch("/api/rmone/debug-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(detail),
        }).catch(() => {});
      } catch { /* diagnostics must never mask the real error */ }
      if (isCredentialError(e)) {
        setError("Invalid credentials. Check your tenant, username, and password.");
      } else {
        setError("We are currently enhancing RM ONE with new features. Please try again in a moment.");
      }
    }
  }

  if (isLoading || user) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center" style={{ backgroundColor: "#253746" }}>
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#6BA539" }} />
      </div>
    );
  }

  return (
    <div className="login-screen relative min-h-[100dvh] overflow-hidden" style={{ backgroundColor: "#253746" }}>

      {/* Decorative glow top-right (matches mobile login) */}
      <div
        className="pointer-events-none absolute"
        style={{
          top: -120, right: -120, width: 360, height: 360, borderRadius: 180,
          backgroundColor: "#6BA539", opacity: 0.08, filter: "blur(20px)",
        }}
      />
      {/* Decorative glow bottom-left */}
      <div
        className="pointer-events-none absolute"
        style={{
          bottom: -100, left: -100, width: 280, height: 280, borderRadius: 140,
          backgroundColor: "#6BA539", opacity: 0.06, filter: "blur(20px)",
        }}
      />

      <div className="relative z-10 min-h-[100dvh] flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="mb-10 flex flex-col items-center justify-center gap-2.5">
            <img
              src={`${import.meta.env.BASE_URL}rm-one-logo.png`}
              alt="RM ONE"
              className="h-14 w-auto"
              data-testid="img-login-logo"
            />
            <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: "rgba(255,255,255,0.45)" }}>
              Operational Intelligence
            </span>
          </div>

          <h1 className="text-3xl font-bold text-white mb-2 text-center">Welcome back</h1>
          <p className="text-sm mb-8 leading-relaxed text-center" style={{ color: "rgba(255,255,255,0.55)" }}>
            Welcome to RM ONE Operation Command Center
          </p>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              {/* Tenant */}
              <FormField
                control={form.control}
                name="tenant"
                render={({ field }) => (
                  <FormItem>
                    <label className="block text-[10px] font-bold tracking-[0.15em] mb-2" style={{ color: "#6BA539" }}>
                      TENANT / ORGANIZATION
                    </label>
                    <div
                      className="flex items-center gap-3 rounded-lg px-3"
                      style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}
                    >
                      <Home className="h-4 w-4 shrink-0" style={{ color: "#6BA539" }} />
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="your-tenant"
                          autoCapitalize="off"
                          autoCorrect="off"
                          className="border-0 bg-transparent text-white px-0 placeholder:text-white/25 focus-visible:ring-0 focus-visible:ring-offset-0 h-12"
                        />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Username */}
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <label className="block text-[10px] font-bold tracking-[0.15em] mb-2" style={{ color: "#6BA539" }}>
                      USERNAME
                    </label>
                    <div
                      className="flex items-center gap-3 rounded-lg px-3"
                      style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}
                    >
                      <User className="h-4 w-4 shrink-0" style={{ color: "#6BA539" }} />
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Enter your username"
                          autoCapitalize="off"
                          autoCorrect="off"
                          autoComplete="username"
                          className="border-0 bg-transparent text-white px-0 placeholder:text-white/25 focus-visible:ring-0 focus-visible:ring-offset-0 h-12"
                        />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Password */}
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <label className="block text-[10px] font-bold tracking-[0.15em] mb-2" style={{ color: "#6BA539" }}>
                      PASSWORD
                    </label>
                    <div
                      className="flex items-center gap-3 rounded-lg px-3"
                      style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}
                    >
                      <Lock className="h-4 w-4 shrink-0" style={{ color: "#6BA539" }} />
                      <FormControl>
                        <Input
                          {...field}
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          autoComplete="current-password"
                          className="border-0 bg-transparent text-white px-0 placeholder:text-white/25 focus-visible:ring-0 focus-visible:ring-offset-0 h-12"
                        />
                      </FormControl>
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="p-1 -mr-1"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" style={{ color: "rgba(255,255,255,0.35)" }} />
                        ) : (
                          <Eye className="h-4 w-4" style={{ color: "rgba(255,255,255,0.35)" }} />
                        )}
                      </button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {error && (
                <div
                  className="flex items-start gap-2 p-3 rounded-md text-sm"
                  style={{ backgroundColor: "rgba(232,119,34,0.10)", border: "1px solid rgba(232,119,34,0.25)", color: "#E87722" }}
                >
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                disabled={form.formState.isSubmitting}
                className="w-full h-12 mt-2 text-base font-semibold flex items-center justify-center gap-2 transition-opacity"
                style={{ backgroundColor: "#6BA539", color: "#FFFFFF", border: "none" }}
              >
                {form.formState.isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {reconnecting ? "Reconnecting..." : "Signing in..."}
                  </>
                ) : (
                  <>
                    <span>
                      Sign In to <span className="text-white">RM&nbsp;</span>
                      <span style={{ color: "#1B2B38" }}>ONE</span>
                    </span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          </Form>

          {/* Security badge */}
          <div className="mt-8 flex items-center justify-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#6BA539" }} />
            <p className="text-[11px] tracking-wide" style={{ color: "rgba(255,255,255,0.45)" }}>
              JWT Secured · TLS 1.3 · End-to-End Encrypted
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
