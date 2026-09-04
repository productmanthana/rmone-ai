import { Suspense, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, ShieldOff } from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { lazyWithReload } from "@/lib/lazyReload";
import { getMyCapabilitiesChecked, usePermissionsVersion } from "@/lib/permissions";

const OnboardingSettingsPage = lazyWithReload(() => import("./onboarding-settings"));

function SectionSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function ConfigurationPage() {
  const [location] = useLocation();
  const { user } = useAuth();
  const isAdmin = user?.isAdmin !== false;
  // Non-admins may still enter when their access level carries the "Company
  // settings" capability — including built-in Manager/User levels customized
  // on the Access Levels page (canSettings mirrors the server's save gate).
  // null = still resolving; never flash "Admin access required" while loading.
  const permsVersion = usePermissionsVersion();
  const [canSettings, setCanSettings] = useState<boolean | null>(null);
  useEffect(() => {
    if (isAdmin) return; // admins never need the lookup
    let alive = true;
    getMyCapabilitiesChecked() // strict: null on fetch failure, never optimistic
      .then(c => { if (alive) setCanSettings(c ? c.canSettings : false); })
      .catch(() => { if (alive) setCanSettings(false); }); // fails closed
    return () => { alive = false; };
  }, [isAdmin, permsVersion]);

  const seg = location.split("/")[2];
  const initialCat = seg === "organization" ? "org" : seg ?? undefined;

  if (!isAdmin && canSettings === null) {
    return (
      <div className="min-h-screen bg-background">
        <SectionSpinner />
      </div>
    );
  }
  if (!isAdmin && !canSettings) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div style={{ textAlign: "center", maxWidth: 360, padding: "40px 24px" }}>
          <ShieldOff size={40} style={{ margin: "0 auto 16px", color: "var(--rm-text-muted)" }} />
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Admin access required</h2>
          <p style={{ fontSize: 14, color: "var(--rm-text-muted)", lineHeight: 1.6 }}>
            Configuration is only available to Admin users. Contact your Admin to adjust your access level.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "var(--rm-bg, #f8fafc)" }}>
      <Suspense fallback={<SectionSpinner />}>
        <OnboardingSettingsPage embedded initialCat={initialCat} />
      </Suspense>
    </div>
  );
}
