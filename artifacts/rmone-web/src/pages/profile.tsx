import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getUserProfile, bustCache } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { getMyCapabilities, usePermissionsVersion, revertMyAccessLevel, notifyPermissionsChanged, type MyCapabilities } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { User, Mail, Building, Briefcase, LogOut, RefreshCw, Loader2, ShieldCheck } from "lucide-react";

/** "custom:xyz" → the level's display name; builtin acl → capitalized label. */
function accessLevelLabel(caps: MyCapabilities | null): string {
  if (!caps) return "—";
  if (caps.source === "custom") return caps.levelName || "Custom level";
  const acl = caps.acl.trim().toLowerCase();
  if (acl === "admin") return "Admin";
  if (acl === "manager") return "Manager";
  if (acl === "user") return "User (view only)";
  return "Manager"; // unset/grandfathered = editable, closest builtin label
}

export default function Profile() {
  const { signOut, user } = useAuth();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [reverting, setReverting] = React.useState(false);
  const [revertErr, setRevertErr] = React.useState<string | null>(null);

  // Live access level — re-reads whenever permissions change anywhere (an
  // admin editing levels or this person's assignment), no refresh needed.
  const permsVer = usePermissionsVersion();
  const [myCaps, setMyCaps] = React.useState<MyCapabilities | null>(null);
  React.useEffect(() => {
    let alive = true;
    getMyCapabilities().then((c) => { if (alive) setMyCaps(c); }).catch(() => { /* keep last */ });
    return () => { alive = false; };
  }, [permsVer]);

  const { data: profile, isLoading } = useQuery<Record<string, any>>({
    queryKey: ["userProfile", user?.username],
    queryFn: () => getUserProfile(user?.username ?? "") as Promise<Record<string, any>>,
    enabled: !!user?.username,
  });

  const handleClearCache = async () => {
    setIsRefreshing(true);
    try {
      bustCache();
      await queryClient.invalidateQueries();
    } finally {
      setIsRefreshing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-12 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Profile</h1>
        <p className="text-muted-foreground mt-1">Manage your account and preferences.</p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle>User Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-6 pb-6 border-b">
            <div className="w-20 h-20 rounded-full bg-primary/10 text-primary flex items-center justify-center text-2xl font-bold">
              {profile?.FirstName?.[0]}{profile?.LastName?.[0]}
            </div>
            <div>
              <h2 className="text-2xl font-bold">{profile?.FirstName} {profile?.LastName}</h2>
              <p className="text-muted-foreground">{profile?.JobTitle || "Team Member"}</p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Mail className="h-4 w-4" /> Email
              </span>
              <p className="font-medium">{profile?.Email || user?.username || "—"}</p>
            </div>
            
            <div className="space-y-1">
              <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Building className="h-4 w-4" /> Tenant
              </span>
              <p className="font-medium">{user?.tenant || "—"}</p>
            </div>
            
            <div className="space-y-1">
              <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Briefcase className="h-4 w-4" /> Business Unit
              </span>
              <p className="font-medium">{profile?.BusinessUnit || "—"}</p>
            </div>
            
            <div className="space-y-1">
              <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <User className="h-4 w-4" /> Role
              </span>
              <p className="font-medium">{profile?.Role || "—"}</p>
            </div>

            <div className="space-y-1">
              <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Access Level
              </span>
              <p className="font-medium">
                {accessLevelLabel(myCaps)}
                {myCaps?.source === "custom" && (
                  <span className="text-xs text-muted-foreground ml-2">(custom level)</span>
                )}
              </p>
              {/* Self-lockout escape hatch: shown only when THIS user changed
                  their own level — a level set by an admin stays admin-only. */}
              {myCaps?.selfRevert && (
                <div className="pt-1">
                  <p className="text-xs text-muted-foreground mb-1">
                    You changed your own access level. You can change it back to <span className="font-medium">{myCaps.selfRevert.label}</span> yourself.
                  </p>
                  <Button
                    variant="outline" size="sm" disabled={reverting}
                    onClick={async () => {
                      setReverting(true); setRevertErr(null);
                      try {
                        await revertMyAccessLevel();
                        notifyPermissionsChanged();
                      } catch (e) {
                        setRevertErr(e instanceof Error ? e.message : "Could not change your access level back.");
                      } finally {
                        setReverting(false);
                      }
                    }}>
                    {reverting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                    Change back to {myCaps.selfRevert.label}
                  </Button>
                  {revertErr && <p className="text-xs text-destructive mt-1">{revertErr}</p>}
                </div>
              )}
            </div>
          </div>
        </CardContent>
        <CardFooter className="bg-muted/30 border-t flex justify-between p-6">
          <Button variant="destructive" onClick={() => signOut()}>
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </CardFooter>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>System Data</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            The RM ONE Service Prime proxy caches API responses to ensure fast navigation. 
            If you've made changes directly in RM ONE and don't see them here, you can clear the local cache.
          </p>
          <Button variant="outline" onClick={handleClearCache} disabled={isRefreshing}>
            {isRefreshing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            {isRefreshing ? "Refreshing..." : "Clear Cache & Refetch"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
