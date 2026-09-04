import React, { useMemo, useState } from "react";
import {
  Clock, CheckCircle2, XCircle, AlertTriangle, Loader2, ExternalLink, MoreVertical,
  RefreshCw, PlusCircle, Trash2, Users, Building2, Download, List, Search, X,
  ChevronDown, ChevronRight, Filter, LayoutGrid, Table as TableIcon, ArrowUpRight,
  ShieldAlert, Activity, Coffee
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

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

interface Company {
  tenantId: string;
  runs: Job[];
}

const MOCK_COMPANIES: Company[] = [
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
  {
    tenantId: "Skanska Infrastructure",
    runs: [{
      uploadId: "u7", tenantId: "Skanska Infrastructure", fileName: "Skanska_Core_Assets.xlsx",
      status: "failed", createdAt: "2026-07-08T10:30:00Z", totalInserted: 12, totalErrors: 8, warningsCount: 0,
    }],
  },
  {
    tenantId: "AECOM Global Services",
    runs: [{
      uploadId: "u8", tenantId: "AECOM Global Services", fileName: "AECOM_Master_Data.xlsx",
      status: "success", createdAt: "2026-07-07T16:45:00Z", totalInserted: 1240, totalErrors: 0, warningsCount: 5,
    }],
  },
  {
    tenantId: "Turner Construction",
    runs: [{
      uploadId: "u9", tenantId: "Turner Construction", fileName: "provisioned",
      status: "provisioned", createdAt: "2026-07-08T09:00:00Z", totalInserted: 0, totalErrors: 0,
    }],
  },
];

function StatusBadge({ status }: { status: Job["status"] }) {
  const configs = {
    success: { label: "Success", color: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
    failed: { label: "Failed", color: "bg-rose-100 text-rose-700 border-rose-200", icon: XCircle },
    partial: { label: "Partial", color: "bg-amber-100 text-amber-700 border-amber-200", icon: AlertTriangle },
    running: { label: "Running", color: "bg-blue-100 text-blue-700 border-blue-200", icon: Loader2 },
    pending: { label: "Pending", color: "bg-slate-100 text-slate-700 border-slate-200", icon: Clock },
    cancelled: { label: "Cancelled", color: "bg-slate-100 text-slate-500 border-slate-200", icon: XCircle },
    provisioned: { label: "Provisioned", color: "bg-sky-50 text-sky-600 border-sky-100", icon: Building2 },
  };

  const config = configs[status] || configs.pending;
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={cn("px-2 py-0.5 font-medium flex items-center gap-1.5", config.color)}>
      <Icon className={cn("w-3.5 h-3.5", status === "running" && "animate-spin")} />
      {config.label}
    </Badge>
  );
}

function ActionMenu({ job }: { job: Job }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-slate-100">
          <MoreVertical className="w-4 h-4 text-slate-500" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 p-2">
        <DropdownMenuLabel className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          General Actions
        </DropdownMenuLabel>
        <DropdownMenuItem className="rounded-md">
          <ExternalLink className="w-4 h-4 mr-2 text-slate-500" />
          <span>View full run history</span>
        </DropdownMenuItem>
        <DropdownMenuItem className="rounded-md">
          <Download className="w-4 h-4 mr-2 text-slate-500" />
          <span>Download latest file</span>
        </DropdownMenuItem>
        <DropdownMenuItem className="rounded-md text-emerald-600 focus:text-emerald-700 focus:bg-emerald-50">
          <Users className="w-4 h-4 mr-2" />
          <span>Invite team members</span>
        </DropdownMenuItem>
        
        <DropdownMenuSeparator className="my-2" />
        <DropdownMenuLabel className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Re-import Data
        </DropdownMenuLabel>
        <DropdownMenuItem className="rounded-md">
          <RefreshCw className="w-4 h-4 mr-2 text-blue-500" />
          <div className="flex flex-col">
            <span className="font-medium">Update & Add</span>
            <span className="text-[10px] text-slate-500">Update existing, append new</span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem className="rounded-md">
          <PlusCircle className="w-4 h-4 mr-2 text-emerald-500" />
          <div className="flex flex-col">
            <span className="font-medium">Only Add New</span>
            <span className="text-[10px] text-slate-500">Skip matches, append new</span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-2" />
        <DropdownMenuItem className="rounded-md text-rose-600 focus:text-rose-700 focus:bg-rose-50">
          <Trash2 className="w-4 h-4 mr-2" />
          <div className="flex flex-col">
            <span className="font-medium">Replace All</span>
            <span className="text-[10px] opacity-80">Wipe & reload (Destructive)</span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SectionHeader({ 
  title, 
  count, 
  icon: Icon, 
  isOpen, 
  variant = "default" 
}: { 
  title: string; 
  count: number; 
  icon: any; 
  isOpen: boolean;
  variant?: "danger" | "default" | "muted";
}) {
  const variants = {
    danger: "bg-rose-50 border-rose-100 text-rose-900",
    default: "bg-slate-50 border-slate-200 text-slate-900",
    muted: "bg-slate-50 border-slate-100 text-slate-500 opacity-80",
  };

  const iconColors = {
    danger: "text-rose-600",
    default: "text-blue-600",
    muted: "text-slate-400",
  };

  return (
    <div className={cn(
      "flex items-center justify-between px-4 py-3 rounded-lg border mb-3 transition-colors",
      variants[variant]
    )}>
      <div className="flex items-center gap-3">
        <div className={cn("p-2 rounded-md bg-white border", variant === 'danger' ? 'border-rose-200 shadow-sm' : 'border-slate-200 shadow-sm')}>
          <Icon className={cn("w-5 h-5", iconColors[variant])} />
        </div>
        <div>
          <h2 className="font-bold text-sm tracking-tight flex items-center gap-2 uppercase">
            {title}
            <Badge variant="secondary" className="rounded-full px-2 py-0 h-5 min-w-[20px] justify-center bg-white border border-inherit">
              {count}
            </Badge>
          </h2>
        </div>
      </div>
      {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
    </div>
  );
}

export function TriageGrouped() {
  const [searchQuery, setSearchQuery] = useState("");
  const [openSections, setOpenSections] = useState({
    attention: true,
    active: true,
    provisioned: false,
  });

  const groups = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const filtered = MOCK_COMPANIES.filter(c => 
      c.tenantId.toLowerCase().includes(q)
    );

    return {
      attention: filtered.filter(c => {
        const latest = c.runs[0];
        return latest.status === "failed" || latest.status === "partial";
      }),
      active: filtered.filter(c => {
        const latest = c.runs[0];
        return latest.status === "success" || latest.status === "running" || latest.status === "pending" || latest.status === "cancelled";
      }),
      provisioned: filtered.filter(c => {
        const latest = c.runs[0];
        return latest.status === "provisioned";
      }),
    };
  }, [searchQuery]);

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-4 md:p-8 font-sans text-slate-900">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header Area */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-1">
            <h1 className="text-3xl font-black tracking-tight text-slate-900 flex items-center gap-3">
              Superadmin <span className="text-blue-600">Onboarding</span>
            </h1>
            <p className="text-slate-500 font-medium">Manage client tenant data imports and provisioning status</p>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
              <input
                type="text"
                placeholder="Search companies..."
                className="pl-10 pr-4 py-2.5 w-[300px] rounded-xl border border-slate-200 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
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
            <Button
              className="!bg-blue-600 hover:!bg-blue-700 !text-white !border-blue-600 rounded-xl px-5 py-6 font-bold shadow-lg shadow-blue-500/20 transition-all active:scale-95"
              style={{ backgroundColor: "#2563eb", color: "#fff", borderColor: "#2563eb" }}
            >
              <PlusCircle className="w-5 h-5 mr-2" />
              New Company
            </Button>
          </div>
        </div>

        {/* Overview Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="border-slate-200 shadow-sm overflow-hidden group hover:border-rose-200 transition-colors">
            <div className="absolute top-0 left-0 w-1 h-full bg-rose-500" />
            <CardHeader className="py-4 px-5">
              <div className="flex justify-between items-start">
                <ShieldAlert className="w-5 h-5 text-rose-500" />
                <Badge variant="outline" className="text-[10px] uppercase font-bold text-rose-600 border-rose-100 bg-rose-50">Urgent</Badge>
              </div>
              <div className="mt-2">
                <div className="text-2xl font-black text-slate-900">{groups.attention.length}</div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Needs Attention</div>
              </div>
            </CardHeader>
          </Card>
          
          <Card className="border-slate-200 shadow-sm overflow-hidden group hover:border-blue-200 transition-colors">
            <div className="absolute top-0 left-0 w-1 h-full bg-blue-500" />
            <CardHeader className="py-4 px-5">
              <div className="flex justify-between items-start">
                <Activity className="w-5 h-5 text-blue-500" />
                <Badge variant="outline" className="text-[10px] uppercase font-bold text-blue-600 border-blue-100 bg-blue-50">Live</Badge>
              </div>
              <div className="mt-2">
                <div className="text-2xl font-black text-slate-900">{groups.active.length}</div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Active Imports</div>
              </div>
            </CardHeader>
          </Card>

          <Card className="border-slate-200 shadow-sm overflow-hidden group hover:border-sky-200 transition-colors">
            <div className="absolute top-0 left-0 w-1 h-full bg-sky-400" />
            <CardHeader className="py-4 px-5">
              <div className="flex justify-between items-start">
                <Building2 className="w-5 h-5 text-sky-400" />
                <Badge variant="outline" className="text-[10px] uppercase font-bold text-sky-600 border-sky-100 bg-sky-50">Queued</Badge>
              </div>
              <div className="mt-2">
                <div className="text-2xl font-black text-slate-900">{groups.provisioned.length}</div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Awaiting First Upload</div>
              </div>
            </CardHeader>
          </Card>

          <Card className="border-slate-200 shadow-sm overflow-hidden bg-slate-900 text-white">
            <CardHeader className="py-4 px-5">
              <div className="flex justify-between items-start">
                <LayoutGrid className="w-5 h-5 text-blue-400" />
                <Badge variant="outline" className="text-[10px] uppercase font-bold text-blue-400 border-blue-900">Total</Badge>
              </div>
              <div className="mt-2">
                <div className="text-2xl font-black">{MOCK_COMPANIES.length}</div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Portfolio Companies</div>
              </div>
            </CardHeader>
          </Card>
        </div>

        {/* Triage Sections */}
        <div className="space-y-6 pb-20">
          
          {/* Section: Needs Attention */}
          <Collapsible open={openSections.attention} onOpenChange={() => toggleSection('attention')}>
            <CollapsibleTrigger className="w-full">
              <SectionHeader 
                title="Immediate Attention Required" 
                count={groups.attention.length} 
                icon={ShieldAlert} 
                isOpen={openSections.attention}
                variant="danger"
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
                {groups.attention.map(company => (
                  <AttentionCard key={company.tenantId} company={company} />
                ))}
                {groups.attention.length === 0 && (
                  <div className="col-span-2 py-12 flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-xl bg-white text-slate-400">
                    <Coffee className="w-8 h-8 mb-2" />
                    <p className="font-medium">All clear! No current import failures.</p>
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Section: Active */}
          <Collapsible open={openSections.active} onOpenChange={() => toggleSection('active')}>
            <CollapsibleTrigger className="w-full">
              <SectionHeader 
                title="Healthy & Ongoing Runs" 
                count={groups.active.length} 
                icon={Activity} 
                isOpen={openSections.active}
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
                <CompanyTable companies={groups.active} />
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Section: Provisioned */}
          <Collapsible open={openSections.provisioned} onOpenChange={() => toggleSection('provisioned')}>
            <CollapsibleTrigger className="w-full">
              <SectionHeader 
                title="Provisioned — No Data Yet" 
                count={groups.provisioned.length} 
                icon={Building2} 
                isOpen={openSections.provisioned}
                variant="muted"
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden opacity-80 animate-in fade-in slide-in-from-top-2 duration-300">
                <CompanyTable companies={groups.provisioned} />
              </div>
            </CollapsibleContent>
          </Collapsible>

        </div>
      </div>
    </div>
  );
}

function AttentionCard({ company }: { company: Company }) {
  const latest = company.runs[0];
  const isFailed = latest.status === "failed";
  
  return (
    <Card className={cn(
      "border-2 transition-all hover:shadow-md overflow-hidden",
      isFailed ? "border-rose-100 hover:border-rose-300" : "border-amber-100 hover:border-amber-300"
    )}>
      <div className={cn("h-1.5 w-full", isFailed ? "bg-rose-500" : "bg-amber-500")} />
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between">
          <div className="flex gap-4">
            <div className="w-12 h-12 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0">
              <Building2 className="w-6 h-6 text-slate-400" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold leading-tight">{company.tenantId}</CardTitle>
              <div className="flex items-center gap-2 mt-1">
                <StatusBadge status={latest.status} />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{latest.uploadId}</span>
              </div>
            </div>
          </div>
          <ActionMenu job={latest} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 py-3 px-4 rounded-xl bg-slate-50 border border-slate-100">
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Inserted</div>
              <div className="text-xl font-black text-emerald-600">{latest.totalInserted}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Errors</div>
              <div className="text-xl font-black text-rose-600">{latest.totalErrors}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Warnings</div>
              <div className={cn("text-xl font-black", (latest.warningsCount || 0) > 0 ? "text-amber-500" : "text-slate-300")}>
                {latest.warningsCount || 0}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs border-b pb-3 border-slate-100">
            <div className="flex items-center gap-2 text-slate-500">
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="font-semibold truncate max-w-[180px]" title={latest.fileName}>{latest.fileName}</span>
            </div>
            <div className="flex items-center gap-2 text-slate-400">
              <Clock className="w-3.5 h-3.5" />
              <span>{new Date(latest.createdAt).toLocaleDateString()}</span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-9 px-4 rounded-lg font-bold border-slate-200 hover:bg-slate-50 text-slate-700">
                <List className="w-4 h-4 mr-2" />
                History
              </Button>
              <Button variant="outline" size="sm" className="h-9 px-4 rounded-lg font-bold border-slate-200 hover:bg-slate-50 text-slate-700">
                <Users className="w-4 h-4 mr-2 text-emerald-600" />
                Invite
              </Button>
            </div>
            <Button
              size="sm"
              className={cn(
                "h-9 px-4 rounded-lg font-bold !text-white shadow-sm transition-all active:scale-95",
                isFailed ? "!bg-rose-600 hover:!bg-rose-700 !border-rose-600" : "!bg-blue-600 hover:!bg-blue-700 !border-blue-600"
              )}
              style={{ backgroundColor: isFailed ? "#e11d48" : "#2563eb", color: "#fff", borderColor: isFailed ? "#e11d48" : "#2563eb" }}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Re-import
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CompanyTable({ companies }: { companies: Company[] }) {
  if (companies.length === 0) {
    return (
      <div className="p-8 text-center text-slate-400 italic text-sm">
        No companies matching filters in this section.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader className="bg-slate-50/50">
        <TableRow className="hover:bg-transparent border-slate-100">
          <TableHead className="w-[300px] text-[10px] font-bold uppercase tracking-widest text-slate-400">Company / Tenant</TableHead>
          <TableHead className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Status</TableHead>
          <TableHead className="text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Inserted</TableHead>
          <TableHead className="text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Errors</TableHead>
          <TableHead className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Last File / Run</TableHead>
          <TableHead className="w-[100px] text-right"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {companies.map((company) => {
          const latest = company.runs[0];
          const isProvisioned = latest.status === "provisioned";
          
          return (
            <TableRow key={company.tenantId} className="group hover:bg-slate-50/50 border-slate-100 transition-colors">
              <TableCell className="font-bold py-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0 group-hover:border-blue-200 transition-colors">
                    <Building2 className="w-4 h-4 text-slate-400 group-hover:text-blue-500 transition-colors" />
                  </div>
                  <div className="flex flex-col">
                    <span>{company.tenantId}</span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                      {isProvisioned ? "New Account" : `${company.runs.length} runs total`}
                    </span>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <StatusBadge status={latest.status} />
              </TableCell>
              <TableCell className="text-right py-4">
                {isProvisioned ? (
                  <span className="text-slate-300">—</span>
                ) : (
                  <span className={cn("font-black", latest.totalInserted > 0 ? "text-slate-700" : "text-slate-400")}>
                    {latest.totalInserted.toLocaleString()}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right py-4">
                {isProvisioned ? (
                  <span className="text-slate-300">—</span>
                ) : (
                  <span className={cn("font-black", latest.totalErrors > 0 ? "text-rose-600" : "text-slate-400")}>
                    {latest.totalErrors.toLocaleString()}
                  </span>
                )}
              </TableCell>
              <TableCell className="py-4">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-slate-700 max-w-[150px] truncate" title={latest.fileName}>
                    {latest.fileName === "provisioned" ? "No data uploaded" : latest.fileName}
                  </span>
                  <span className="text-[10px] text-slate-400 font-medium">
                    {new Date(latest.createdAt).toLocaleDateString()} at {new Date(latest.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-right py-4">
                <div className="flex items-center justify-end gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-blue-600 hover:bg-blue-50" title="View Details">
                    <ArrowUpRight className="w-4 h-4" />
                  </Button>
                  <ActionMenu job={latest} />
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
