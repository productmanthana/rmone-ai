import { useMemo, useState } from "react";
import {
  Clock, CheckCircle2, XCircle, AlertTriangle, Loader2, ExternalLink, MoreVertical,
  RefreshCw, PlusCircle, Trash2, Users, Building2, Download, List, Search, X,
  Activity, TrendingUp, BarChart3, PieChart, ArrowUpRight, ArrowDownRight,
  ShieldCheck, AlertCircle, FileText, Plus
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/**
 * StatCockpit Variant
 * Focus: Portfolio health dashboard with KPI summary and high-density status cards.
 */

type JobStatus = "pending" | "running" | "success" | "partial" | "failed" | "cancelled" | "provisioned";

interface Job {
  uploadId: string;
  tenantId: string;
  fileName: string;
  status: JobStatus;
  createdAt: string;
  totalInserted: number;
  totalErrors: number;
  warningsCount?: number;
}

const MOCK_COMPANIES: { tenantId: string; runs: Job[] }[] = [
  {
    tenantId: "Bechtel Corporation",
    runs: [{
      uploadId: "u1", tenantId: "Bechtel Corporation", fileName: "Bechtel_Infrastructure_Phase2.xlsx",
      status: "success", createdAt: "2026-07-08T14:22:00Z", totalInserted: 1240, totalErrors: 0, warningsCount: 0,
    }],
  },
  {
    tenantId: "Skanska AEC",
    runs: [{
      uploadId: "u2", tenantId: "Skanska AEC", fileName: "Nordic_Expansion_Projects.xlsx",
      status: "partial", createdAt: "2026-07-08T09:10:00Z", totalInserted: 450, totalErrors: 12, warningsCount: 5,
    }],
  },
  {
    tenantId: "Turner Construction",
    runs: [{
      uploadId: "u3", tenantId: "Turner Construction", fileName: "Midwest_Portfolio_Update.xlsx",
      status: "running", createdAt: "2026-07-08T11:45:00Z", totalInserted: 890, totalErrors: 0, warningsCount: 2,
    }],
  },
  {
    tenantId: "Kaiser Permanente Health",
    runs: [{
      uploadId: "u4", tenantId: "Kaiser Permanente Health", fileName: "Medical_Center_Refurb.xlsx",
      status: "failed", createdAt: "2026-07-07T18:41:00Z", totalInserted: 0, totalErrors: 124, warningsCount: 0,
    }],
  },
  {
    tenantId: "AECOM Global",
    runs: [{
      uploadId: "u5", tenantId: "AECOM Global", fileName: "Transportation_Grid_2026.xlsx",
      status: "success", createdAt: "2026-07-06T11:05:00Z", totalInserted: 3200, totalErrors: 0, warningsCount: 8,
    }],
  },
  {
    tenantId: "Laing O'Rourke",
    runs: [{
      uploadId: "u6", tenantId: "Laing O'Rourke", fileName: "provisioned",
      status: "provisioned", createdAt: "2026-07-05T08:00:00Z", totalInserted: 0, totalErrors: 0,
    }],
  },
  {
    tenantId: "Jacobs Engineering",
    runs: [{
      uploadId: "u7", tenantId: "Jacobs Engineering", fileName: "Jacobs_Environmental_Data.xlsx",
      status: "pending", createdAt: "2026-07-08T12:00:00Z", totalInserted: 0, totalErrors: 0,
    }],
  },
  {
    tenantId: "HOK Architects",
    runs: [{
      uploadId: "u8", tenantId: "HOK Architects", fileName: "Stadium_Design_Imports.xlsx",
      status: "success", createdAt: "2026-07-04T15:30:00Z", totalInserted: 156, totalErrors: 0, warningsCount: 0,
    }],
  },
  {
    tenantId: "Lendlease",
    runs: [{
      uploadId: "u9", tenantId: "Lendlease", fileName: "Urban_Regen_Sydney.xlsx",
      status: "cancelled", createdAt: "2026-07-03T09:20:00Z", totalInserted: 42, totalErrors: 0, warningsCount: 0,
    }],
  }
];

function StatusBadge({ status }: { status: JobStatus }) {
  const configs: Record<JobStatus, { label: string; icon: any; color: string; bg: string; border: string }> = {
    success: { label: "Success", icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200" },
    failed: { label: "Failed", icon: XCircle, color: "text-rose-600", bg: "bg-rose-50", border: "border-rose-200" },
    partial: { label: "Partial", icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200" },
    running: { label: "Running", icon: Loader2, color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200" },
    pending: { label: "Pending", icon: Clock, color: "text-slate-600", bg: "bg-slate-50", border: "border-slate-200" },
    cancelled: { label: "Cancelled", icon: XCircle, color: "text-slate-400", bg: "bg-slate-50", border: "border-slate-200" },
    provisioned: { label: "Provisioned", icon: Building2, color: "text-indigo-600", bg: "bg-indigo-50", border: "border-indigo-200" },
  };

  const config = configs[status];
  const Icon = config.icon;

  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${config.bg} ${config.color} ${config.border}`}>
      <Icon className={`w-3 h-3 ${status === 'running' ? 'animate-spin' : ''}`} />
      {config.label}
    </div>
  );
}

function WarningsBadge({ count }: { count: number | undefined }) {
  if (!count) return null;
  return (
    <div className="flex items-center gap-1 text-amber-600 bg-amber-100/50 px-1.5 py-0.5 rounded text-[10px] font-medium">
      <AlertCircle className="w-3 h-3" />
      {count} Warnings
    </div>
  );
}

function MiniTrend({ status }: { status: JobStatus }) {
  if (status === 'success') return <ArrowUpRight className="w-4 h-4 text-emerald-500" />;
  if (status === 'failed' || status === 'partial') return <ArrowDownRight className="w-4 h-4 text-rose-500" />;
  return <TrendingUp className="w-4 h-4 text-slate-300" />;
}

export function StatCockpit() {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredCompanies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return MOCK_COMPANIES;
    return MOCK_COMPANIES.filter(({ tenantId }) => tenantId.toLowerCase().includes(q));
  }, [searchQuery]);

  const stats = useMemo(() => {
    const total = MOCK_COMPANIES.length;
    let inserted = 0;
    let errors = 0;
    let successfulRuns = 0;
    let totalRuns = 0;

    MOCK_COMPANIES.forEach(c => {
      c.runs.forEach(r => {
        if (r.status !== 'provisioned') {
          inserted += r.totalInserted;
          errors += r.totalErrors;
          totalRuns++;
          if (r.status === 'success') successfulRuns++;
        }
      });
    });

    const successRate = totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : 100;

    return { total, inserted, errors, successRate };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-indigo-100">
      {/* Background patterns */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:20px_20px]" />
      </div>

      <div className="relative p-8 max-w-[1400px] mx-auto space-y-8">
        {/* Header section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 flex items-center gap-3">
              <Activity className="w-8 h-8 text-indigo-600" />
              Onboarding Cockpit
            </h1>
            <p className="text-slate-500 font-medium">Global portfolio health & import status overview</p>
          </div>
          
          <div className="flex items-center gap-3">
             <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search tenants..."
                className="w-[280px] pl-10 pr-10 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all shadow-sm"
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <Button className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl h-10 px-5 shadow-lg shadow-indigo-200">
              <Plus className="w-4 h-4 mr-2" /> New Company
            </Button>
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Total Companies", value: stats.total, icon: Building2, color: "text-blue-600", bg: "bg-blue-50" },
            { label: "Records Inserted", value: stats.inserted.toLocaleString(), icon: ShieldCheck, color: "text-emerald-600", bg: "bg-emerald-50" },
            { label: "Attention Needed", value: stats.errors.toLocaleString(), icon: AlertCircle, color: "text-rose-600", bg: "bg-rose-50" },
            { label: "Success Velocity", value: `${stats.successRate}%`, icon: PieChart, color: "text-indigo-600", bg: "bg-indigo-50" },
          ].map((kpi, i) => (
            <Card key={i} className="border-none shadow-sm overflow-hidden bg-white/80 backdrop-blur-sm">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className={`p-2.5 rounded-xl ${kpi.bg} ${kpi.color}`}>
                    <kpi.icon className="w-6 h-6" />
                  </div>
                  <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Live Data
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-sm font-semibold text-slate-500">{kpi.label}</div>
                  <div className="text-3xl font-black text-slate-900 mt-1">{kpi.value}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Companies Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredCompanies.map(({ tenantId, runs }) => {
            const realRuns = runs.filter(r => r.status !== "provisioned");
            const latest = realRuns[0] ?? runs[0];
            const isProvisionedOnly = realRuns.length === 0;
            const inserted = realRuns.reduce((n, r) => n + (r.totalInserted ?? 0), 0);
            const errors = realRuns.reduce((n, r) => n + (r.totalErrors ?? 0), 0);

            return (
              <Card key={tenantId} className="group border-none shadow-sm hover:shadow-md transition-all duration-300 bg-white/90 backdrop-blur-md relative overflow-hidden ring-1 ring-slate-200/50">
                {/* Status Indicator Bar */}
                <div className={`absolute top-0 left-0 right-0 h-1 ${
                  latest.status === 'success' ? 'bg-emerald-500' :
                  latest.status === 'failed' ? 'bg-rose-500' :
                  latest.status === 'partial' ? 'bg-amber-500' :
                  latest.status === 'running' ? 'bg-blue-500' : 'bg-slate-200'
                }`} />

                <CardHeader className="pb-4">
                  <div className="flex justify-between items-start mb-2">
                    <StatusBadge status={latest.status} />
                    <MiniTrend status={latest.status} />
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0 group-hover:bg-indigo-50 transition-colors">
                      <Building2 className="w-6 h-6 text-slate-400 group-hover:text-indigo-600 transition-colors" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-lg font-bold truncate text-slate-800 leading-tight">
                        {tenantId}
                      </CardTitle>
                      <CardDescription className="text-xs font-medium text-slate-400 flex items-center gap-1.5 mt-1">
                        <FileText className="w-3 h-3" />
                        {isProvisionedOnly ? "Awaiting initial data" : `${realRuns.length} processing cycles`}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-5">
                  {isProvisionedOnly ? (
                    <div className="py-6 flex flex-col items-center justify-center border-2 border-dashed border-slate-100 rounded-2xl bg-slate-50/50">
                      <Users className="w-8 h-8 text-slate-300 mb-2" />
                      <p className="text-xs font-semibold text-slate-400 text-center px-4">
                        Tenant ready. Setup team access to begin.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-slate-50/80 p-3 rounded-2xl border border-slate-100/50">
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Inserted</div>
                          <div className="text-lg font-black text-emerald-600">{inserted.toLocaleString()}</div>
                        </div>
                        <div className="bg-slate-50/80 p-3 rounded-2xl border border-slate-100/50">
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Errors</div>
                          <div className={`text-lg font-black ${errors > 0 ? "text-rose-600" : "text-slate-400"}`}>
                            {errors.toLocaleString()}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                           <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Latest Activity</div>
                           <WarningsBadge count={latest.warningsCount} />
                        </div>
                        <div className="p-3 bg-white border border-slate-100 rounded-xl shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                          <div className="text-xs font-bold text-slate-700 truncate" title={latest.fileName}>
                            {latest.fileName}
                          </div>
                          <div className="text-[10px] text-slate-400 font-medium mt-1 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(latest.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  <div className="flex items-center gap-2 pt-2">
                    <Button variant="outline" size="sm" className="flex-1 h-9 rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-indigo-600 font-bold text-xs">
                      <List className="w-3.5 h-3.5 mr-1.5" /> Full History
                    </Button>
                    
                    <div className="flex items-center bg-slate-100 p-0.5 rounded-xl">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg hover:bg-white text-slate-500 hover:text-indigo-600" title="Download Source">
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg hover:bg-white text-slate-500 hover:text-[#6BA539]" title="Invite Team">
                        <Users className="w-4 h-4" />
                      </Button>
                      
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg hover:bg-white text-slate-500" disabled={latest.status === "running"}>
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64 p-2 rounded-2xl shadow-xl border-slate-100">
                          <DropdownMenuLabel className="px-3 py-2 text-xs font-black uppercase text-slate-400 tracking-widest">
                            Management
                          </DropdownMenuLabel>
                          <DropdownMenuItem className="rounded-xl focus:bg-indigo-50 py-2.5">
                            <ExternalLink className="w-4 h-4 mr-3 text-indigo-500" />
                            <div className="flex flex-col">
                              <span className="text-sm font-bold">Go to Dashboard</span>
                              <span className="text-[10px] text-slate-400">View company workspace</span>
                            </div>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="my-2 bg-slate-100" />
                          <DropdownMenuLabel className="px-3 py-2 text-xs font-black uppercase text-slate-400 tracking-widest">
                            Import Actions
                          </DropdownMenuLabel>
                          <DropdownMenuItem className="rounded-xl focus:bg-blue-50 py-2.5">
                            <RefreshCw className="w-4 h-4 mr-3 text-blue-500" />
                            <div className="flex flex-col">
                              <span className="text-sm font-bold">Update & Add</span>
                              <span className="text-[10px] text-slate-400">Smart merge new file</span>
                            </div>
                          </DropdownMenuItem>
                          <DropdownMenuItem className="rounded-xl focus:bg-emerald-50 py-2.5">
                            <PlusCircle className="w-4 h-4 mr-3 text-emerald-500" />
                            <div className="flex flex-col">
                              <span className="text-sm font-bold">Append Only</span>
                              <span className="text-[10px] text-slate-400">Only add new rows</span>
                            </div>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="my-2 bg-slate-100" />
                          <DropdownMenuItem className="rounded-xl text-rose-600 focus:bg-rose-50 focus:text-rose-600 py-2.5">
                            <Trash2 className="w-4 h-4 mr-3" />
                            <div className="flex flex-col">
                              <span className="text-sm font-bold">Wipe & Replace</span>
                              <span className="text-[10px] text-rose-400/80">Destructive re-import</span>
                            </div>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
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
