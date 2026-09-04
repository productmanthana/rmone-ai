import { useMemo, useState } from "react";
import {
  Clock, CheckCircle2, XCircle, AlertTriangle, Loader2, ExternalLink, MoreVertical,
  RefreshCw, PlusCircle, Trash2, Users, Building2, Download, List, Search, X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import "./_group.css";

type ImportMode = "update" | "add" | "replace";

interface Job {
  uploadId: string;
  tenantId: string;
  fileName: string;
  status: "pending" | "running" | "success" | "partial" | "failed" | "cancelled" | "provisioned";
  createdAt: string;
  totalInserted: number;
  totalErrors: number;
  warningsCount?: number;
}

/** Realistic mock data mirroring the "All Companies" superadmin view. */
const MOCK_COMPANIES: { tenantId: string; runs: Job[] }[] = [
  {
    tenantId: "US Dept of Veterans Affairs",
    runs: [{
      uploadId: "u1", tenantId: "US Dept of Veterans Affairs", fileName: "VA_Projects_Q3.xlsx",
      status: "success", createdAt: "2026-07-06T14:22:00Z", totalInserted: 482, totalErrors: 0, warningsCount: 0,
    }],
  },
  {
    tenantId: "Westfield University",
    runs: [{
      uploadId: "u2", tenantId: "Westfield University", fileName: "Campus_Master_Plan.xlsx",
      status: "partial", createdAt: "2026-07-05T09:10:00Z", totalInserted: 156, totalErrors: 4, warningsCount: 3,
    }],
  },
  {
    tenantId: "Vertex Development Group",
    runs: [{
      uploadId: "u3", tenantId: "Vertex Development Group", fileName: "Vertex_Portfolio.xlsx",
      status: "failed", createdAt: "2026-07-04T18:41:00Z", totalInserted: 0, totalErrors: 62, warningsCount: 0,
    }],
  },
  {
    tenantId: "Gensler",
    runs: [{
      uploadId: "u4", tenantId: "Gensler", fileName: "Gensler_ProjectData.xlsx",
      status: "success", createdAt: "2026-07-03T11:05:00Z", totalInserted: 941, totalErrors: 0, warningsCount: 0,
    }],
  },
  {
    tenantId: "Valley Health Systems",
    runs: [{
      uploadId: "u5", tenantId: "Valley Health Systems", fileName: "provisioned",
      status: "provisioned", createdAt: "2026-07-02T08:00:00Z", totalInserted: 0, totalErrors: 0,
    }],
  },
  {
    tenantId: "Meridian Construction Partners",
    runs: [{
      uploadId: "u6", tenantId: "Meridian Construction Partners", fileName: "Meridian_2026_Import.xlsx",
      status: "running", createdAt: "2026-07-08T07:12:00Z", totalInserted: 88, totalErrors: 0, warningsCount: 0,
    }],
  },
];

function WarningsBadge({ count }: { count: number | undefined }) {
  if (!count) return null;
  return (
    <Badge
      variant="outline"
      className="border-yellow-500 text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30 gap-1 shrink-0"
      title={`${count} field write warning${count === 1 ? "" : "s"}`}
    >
      <AlertTriangle className="w-3 h-3" />
      {count} warning{count === 1 ? "" : "s"}
    </Badge>
  );
}

function StatusBadge({ status }: { status: Job["status"] }) {
  if (status === "success")     return <Badge className="bg-green-600 text-white"><CheckCircle2 className="w-3 h-3 mr-1" />Success</Badge>;
  if (status === "failed")      return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
  if (status === "cancelled")   return <Badge variant="outline" className="text-slate-500 border-slate-300 dark:border-slate-600"><XCircle className="w-3 h-3 mr-1" />Cancelled</Badge>;
  if (status === "partial")     return <Badge className="bg-yellow-500 text-black"><AlertTriangle className="w-3 h-3 mr-1" />Partial</Badge>;
  if (status === "pending")     return <Badge variant="outline" className="text-muted-foreground"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
  if (status === "provisioned") return <Badge variant="outline" className="border-blue-400 text-blue-600 bg-blue-50 dark:bg-blue-950/30"><Building2 className="w-3 h-3 mr-1" />Provisioned</Badge>;
  return <Badge variant="secondary"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Running</Badge>;
}

function RowActions({ job }: { job: Job }) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" title="View details">
        <ExternalLink className="w-3 h-3" />
      </Button>
      <Button variant="ghost" size="sm" title="Download">
        <Download className="w-3.5 h-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        title="Invite team members to set their password"
        className="text-[#6BA539] hover:text-[#5a8f30]"
      >
        <Users className="w-3.5 h-3.5" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" title="More actions" disabled={job.status === "running"}>
            <MoreVertical className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuItem>
            <Users className="w-4 h-4 mr-2 text-[#6BA539]" />
            <div className="flex flex-col">
              <span>Invite team members</span>
              <span className="text-xs text-muted-foreground">Send a secure "set your own password" email.</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Re-import — upload a new file</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            <RefreshCw className="w-4 h-4 mr-2 text-blue-600" />
            <div className="flex flex-col">
              <span>Update existing &amp; add new</span>
              <span className="text-xs text-muted-foreground">Pick a new file. Update matches, add new. No duplicates.</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <PlusCircle className="w-4 h-4 mr-2 text-green-600" />
            <div className="flex flex-col">
              <span>Only add new</span>
              <span className="text-xs text-muted-foreground">Pick a new file. Leave existing untouched, add new rows.</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive">
            <Trash2 className="w-4 h-4 mr-2" />
            <div className="flex flex-col">
              <span>Replace all data</span>
              <span className="text-xs text-muted-foreground">Pick a new file. Wipe this client's data, load fresh.</span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Extracted verbatim (structure, classes, spacing) from the superadmin
 * "All Companies" card grid in artifacts/rmone-web/src/pages/onboarding-history.tsx
 * (lines ~460-552), with mock data replacing useQuery/useAuth.
 */
export function Current() {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredCompanies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return MOCK_COMPANIES;
    return MOCK_COMPANIES.filter(({ tenantId }) => tenantId.toLowerCase().includes(q));
  }, [searchQuery]);

  return (
    <div className="onboarding-companies-root min-h-screen">
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold">All Companies</h1>
              <p className="text-muted-foreground text-sm mt-0.5">All companies' onboarding runs</p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button variant="outline">+ New Company</Button>
            </div>
          </div>

          <div className="relative max-w-sm">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
              style={{ color: "var(--rm-muted, #888)" }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search companies…"
              className="w-full pl-9 pr-8 py-2 text-sm rounded-lg outline-none bg-white dark:bg-[#1a2035] text-gray-900 dark:text-white border border-gray-200 dark:border-[#2a3248] placeholder:text-gray-400 dark:placeholder:text-gray-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100 transition-opacity"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" style={{ color: "var(--rm-muted, #888)" }} />
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {filteredCompanies.map(({ tenantId, runs }) => {
            const realRuns = runs.filter(r => r.status !== "provisioned");
            const latest = realRuns[0] ?? runs[0];
            const isProvisionedOnly = realRuns.length === 0;
            const inserted = realRuns.reduce((n, r) => n + (r.totalInserted ?? 0), 0);
            const errors = realRuns.reduce((n, r) => n + (r.totalErrors ?? 0), 0);
            return (
              <Card
                key={tenantId}
                className="flex flex-col hover:border-[#6BA539]/60 transition-colors cursor-pointer"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-9 h-9 rounded-md bg-[#6BA539]/15 flex items-center justify-center shrink-0">
                        <Building2 className="w-5 h-5 text-[#6BA539]" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base truncate">{tenantId}</CardTitle>
                        <CardDescription className="text-xs">
                          {isProvisionedOnly ? "No uploads yet" : `${realRuns.length} run${realRuns.length === 1 ? "" : "s"}`}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <StatusBadge status={latest.status} />
                      {!isProvisionedOnly && <WarningsBadge count={latest.warningsCount} />}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 flex-1">
                  {isProvisionedOnly ? (
                    <p className="text-xs text-muted-foreground">
                      Tenant provisioned — ready for first upload.
                    </p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wide">Inserted</div>
                          <div className="font-semibold text-green-500">{inserted}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wide">Errors</div>
                          <div className={`font-semibold ${errors > 0 ? "text-red-500" : "text-muted-foreground"}`}>{errors}</div>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <span className="block truncate font-medium text-foreground/80" title={latest.fileName}>{latest.fileName}</span>
                        Last run {new Date(latest.createdAt).toLocaleString()}
                      </div>
                    </>
                  )}
                  <div className="mt-auto pt-2 border-t flex items-center justify-between">
                    {isProvisionedOnly ? (
                      <Button variant="ghost" size="sm">
                        <Users className="w-3.5 h-3.5 mr-1.5" /> Invite admin
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm">
                        <List className="w-3.5 h-3.5 mr-1.5" /> View runs
                      </Button>
                    )}
                    {!isProvisionedOnly && <RowActions job={latest} />}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
