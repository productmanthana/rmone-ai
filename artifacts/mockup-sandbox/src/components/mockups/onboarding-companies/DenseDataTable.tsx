import { useMemo, useState } from "react";
import {
  Clock, CheckCircle2, XCircle, AlertTriangle, Loader2, ExternalLink, MoreVertical,
  RefreshCw, PlusCircle, Trash2, Users, Building2, Download, List, Search, X,
  ArrowUpDown, Filter, DownloadCloud, Mail, ChevronRight, HardHat, ShieldCheck, Stethoscope
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";

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
    tenantId: "Aecom North America",
    runs: [{
      uploadId: "u7", tenantId: "Aecom North America", fileName: "Infrastructure_Master_2026.xlsx",
      status: "success", createdAt: "2026-07-07T10:15:00Z", totalInserted: 1204, totalErrors: 0, warningsCount: 5,
    }],
  },
  {
    tenantId: "Kaiser Permanente",
    runs: [{
      uploadId: "u8", tenantId: "Kaiser Permanente", fileName: "Hospital_Expansion_V2.xlsx",
      status: "partial", createdAt: "2026-07-06T16:45:00Z", totalInserted: 89, totalErrors: 12, warningsCount: 0,
    }],
  },
  {
    tenantId: "Skanska Civil",
    runs: [{
      uploadId: "u9", tenantId: "Skanska Civil", fileName: "Skanska_Civil_Data.xlsx",
      status: "pending", createdAt: "2026-07-08T09:00:00Z", totalInserted: 0, totalErrors: 0,
    }],
  },
  {
    tenantId: "Turner Construction",
    runs: [{
      uploadId: "u10", tenantId: "Turner Construction", fileName: "Turner_Project_History.xlsx",
      status: "cancelled", createdAt: "2026-07-01T14:00:00Z", totalInserted: 45, totalErrors: 0,
    }],
  },
  {
    tenantId: "Bechtel National",
    runs: [{
      uploadId: "u11", tenantId: "Bechtel National", fileName: "Bechtel_GigaProject_A.xlsx",
      status: "success", createdAt: "2026-07-05T12:30:00Z", totalInserted: 3412, totalErrors: 0, warningsCount: 12,
    }],
  },
  {
    tenantId: "Jacobs Engineering",
    runs: [{
      uploadId: "u12", tenantId: "Jacobs Engineering", fileName: "provisioned",
      status: "provisioned", createdAt: "2026-06-28T09:00:00Z", totalInserted: 0, totalErrors: 0,
    }],
  }
];

function StatusPill({ status }: { status: JobStatus }) {
  const styles: Record<JobStatus, { color: string; icon: any; label: string }> = {
    success: { color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2, label: "Success" },
    failed: { color: "bg-red-50 text-red-700 border-red-200", icon: XCircle, label: "Failed" },
    partial: { color: "bg-amber-50 text-amber-700 border-amber-200", icon: AlertTriangle, label: "Partial" },
    running: { color: "bg-blue-50 text-blue-700 border-blue-200", icon: Loader2, label: "Running" },
    pending: { color: "bg-slate-50 text-slate-700 border-slate-200", icon: Clock, label: "Pending" },
    cancelled: { color: "bg-slate-100 text-slate-500 border-slate-200", icon: X, label: "Cancelled" },
    provisioned: { color: "bg-indigo-50 text-indigo-700 border-indigo-200", icon: Building2, label: "Provisioned" },
  };

  const { color, icon: Icon, label } = styles[status] || styles.pending;
  
  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium ${color}`}>
      <Icon className={`w-3 h-3 ${status === 'running' ? 'animate-spin' : ''}`} />
      {label}
    </div>
  );
}

export function DenseDataTable() {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  const processedData = useMemo(() => {
    return MOCK_COMPANIES.map(company => {
      const realRuns = company.runs.filter(r => r.status !== "provisioned");
      const latest = realRuns[0] ?? company.runs[0];
      const inserted = realRuns.reduce((n, r) => n + (r.totalInserted ?? 0), 0);
      const errors = realRuns.reduce((n, r) => n + (r.totalErrors ?? 0), 0);
      const runCount = realRuns.length;
      
      return {
        tenantId: company.tenantId,
        latest,
        inserted,
        errors,
        runCount,
        isProvisionedOnly: runCount === 0
      };
    });
  }, []);

  const filteredData = useMemo(() => {
    let result = processedData.filter(item => 
      item.tenantId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.latest.fileName.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (sortConfig) {
      result.sort((a, b) => {
        let aValue: any = a[sortConfig.key as keyof typeof a];
        let bValue: any = b[sortConfig.key as keyof typeof b];
        
        if (sortConfig.key === 'tenantId') {
          return sortConfig.direction === 'asc' 
            ? a.tenantId.localeCompare(b.tenantId)
            : b.tenantId.localeCompare(a.tenantId);
        }
        
        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [processedData, searchQuery, sortConfig]);

  const handleSort = (key: string) => {
    setSortConfig(current => {
      if (current?.key === key) {
        if (current.direction === 'asc') return { key, direction: 'desc' };
        return null;
      }
      return { key, direction: 'asc' };
    });
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-8 font-sans antialiased text-slate-900">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      
      <div className="max-w-[1400px] mx-auto space-y-4">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <Building2 className="w-5 h-5 text-indigo-600" />
              Onboarding Command Center
            </h1>
            <p className="text-slate-500 text-sm">Superadmin overview of all active client tenant provisions and data imports.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input 
                placeholder="Search tenants or files..." 
                className="pl-9 w-[280px] h-9 text-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white h-9 px-4">
              <PlusCircle className="w-4 h-4 mr-2" />
              New Company
            </Button>
          </div>
        </div>

        {/* Quick Stats Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Active Tenants', value: MOCK_COMPANIES.length, icon: ShieldCheck, color: 'text-blue-600' },
            { label: 'Successful Runs', value: processedData.filter(d => d.latest.status === 'success').length, icon: CheckCircle2, color: 'text-emerald-600' },
            { label: 'Needs Attention', value: processedData.filter(d => ['failed', 'partial'].includes(d.latest.status)).length, icon: AlertTriangle, color: 'text-amber-600' },
            { label: 'Running Now', value: processedData.filter(d => d.latest.status === 'running').length, icon: Loader2, color: 'text-blue-500' },
          ].map((stat, i) => (
            <div key={i} className="bg-white p-3 rounded-lg border border-slate-200 flex items-center gap-3">
              <div className={`p-2 rounded-md bg-slate-50 ${stat.color}`}>
                <stat.icon className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{stat.label}</div>
                <div className="text-lg font-bold leading-none">{stat.value}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Main Table Section */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto relative max-h-[calc(100vh-280px)] overflow-y-auto">
            <Table className="border-collapse">
              <TableHeader className="sticky top-0 bg-slate-50 z-10 shadow-[0_1px_0_rgba(0,0,0,0.05)]">
                <TableRow className="hover:bg-transparent border-b">
                  <TableHead className="w-[300px] h-10 py-0">
                    <button onClick={() => handleSort('tenantId')} className="flex items-center gap-1 hover:text-indigo-600 transition-colors uppercase text-[10px] font-bold tracking-wider">
                      Company / Tenant <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </TableHead>
                  <TableHead className="w-[140px] h-10 py-0">
                    <span className="uppercase text-[10px] font-bold tracking-wider text-slate-500">Latest Status</span>
                  </TableHead>
                  <TableHead className="w-[80px] h-10 py-0 text-right">
                    <button onClick={() => handleSort('runCount')} className="flex items-center gap-1 hover:text-indigo-600 transition-colors uppercase text-[10px] font-bold tracking-wider ml-auto">
                      Runs <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </TableHead>
                  <TableHead className="w-[100px] h-10 py-0 text-right">
                    <button onClick={() => handleSort('inserted')} className="flex items-center gap-1 hover:text-indigo-600 transition-colors uppercase text-[10px] font-bold tracking-wider ml-auto">
                      Inserted <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </TableHead>
                  <TableHead className="w-[100px] h-10 py-0 text-right">
                    <button onClick={() => handleSort('errors')} className="flex items-center gap-1 hover:text-indigo-600 transition-colors uppercase text-[10px] font-bold tracking-wider ml-auto text-red-500">
                      Errors <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </TableHead>
                  <TableHead className="h-10 py-0">
                    <span className="uppercase text-[10px] font-bold tracking-wider text-slate-500">Latest Run File & Timestamp</span>
                  </TableHead>
                  <TableHead className="w-[180px] h-10 py-0 text-right">
                    <span className="uppercase text-[10px] font-bold tracking-wider text-slate-500">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.map((row) => (
                  <TableRow key={row.tenantId} className="group hover:bg-slate-50/80 border-b border-slate-100 transition-colors">
                    <TableCell className="py-2 font-medium">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded bg-indigo-50 flex items-center justify-center border border-indigo-100 group-hover:bg-indigo-100 transition-colors">
                          <Building2 className="w-3.5 h-3.5 text-indigo-600" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm truncate max-w-[200px]">{row.tenantId}</span>
                          <span className="text-[10px] text-slate-400 font-normal">ID: {row.tenantId.replace(/\s+/g, '-').toLowerCase()}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="py-2">
                      <StatusPill status={row.latest.status} />
                    </TableCell>
                    <TableCell className="py-2 text-right text-sm text-slate-600 font-mono">
                      {row.isProvisionedOnly ? "—" : row.runCount}
                    </TableCell>
                    <TableCell className="py-2 text-right text-sm text-emerald-600 font-mono font-medium">
                      {row.isProvisionedOnly ? "—" : row.inserted.toLocaleString()}
                    </TableCell>
                    <TableCell className="py-2 text-right text-sm font-mono font-medium">
                      {row.isProvisionedOnly ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5">
                          {row.errors > 0 && <AlertTriangle className="w-3 h-3 text-red-500" />}
                          <span className={row.errors > 0 ? "text-red-500" : "text-slate-300"}>
                            {row.errors.toLocaleString()}
                          </span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="flex flex-col max-w-[300px]">
                        {row.isProvisionedOnly ? (
                          <span className="text-xs text-slate-400 italic">No activity recorded</span>
                        ) : (
                          <>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-xs font-medium text-slate-700 truncate" title={row.latest.fileName}>
                                {row.latest.fileName}
                              </span>
                              {row.latest.warningsCount && row.latest.warningsCount > 0 && (
                                <Badge variant="outline" className="h-4 px-1 text-[9px] border-amber-200 bg-amber-50 text-amber-700 gap-0.5">
                                  <AlertTriangle className="w-2 h-2" />
                                  {row.latest.warningsCount}w
                                </Badge>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-400">
                              {new Date(row.latest.createdAt).toLocaleDateString()} @ {new Date(row.latest.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-2 text-right">
                      <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md hover:bg-slate-200" title="View Detail History">
                          <List className="w-3.5 h-3.5 text-slate-500" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md hover:bg-slate-200" title="Download Source File" disabled={row.isProvisionedOnly}>
                          <DownloadCloud className="w-3.5 h-3.5 text-slate-500" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md hover:bg-emerald-100 hover:text-emerald-700" title="Invite Team Members">
                          <Mail className="w-3.5 h-3.5" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md hover:bg-slate-200" disabled={row.latest.status === "running"}>
                              <MoreVertical className="w-4 h-4 text-slate-500" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-72">
                            <DropdownMenuLabel className="text-[10px] uppercase text-slate-500">Account Management</DropdownMenuLabel>
                            <DropdownMenuItem className="cursor-pointer">
                              <Users className="w-4 h-4 mr-2 text-indigo-600" />
                              <div className="flex flex-col">
                                <span className="text-sm">Manage Team Members</span>
                                <span className="text-xs text-slate-500">Send invites & set permissions</span>
                              </div>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel className="text-[10px] uppercase text-slate-500">Import Actions</DropdownMenuLabel>
                            <DropdownMenuItem className="cursor-pointer">
                              <RefreshCw className="w-4 h-4 mr-2 text-blue-600" />
                              <div className="flex flex-col">
                                <span className="text-sm">Re-import: Update & Add</span>
                                <span className="text-xs text-slate-500">Update existing matches + add new</span>
                              </div>
                            </DropdownMenuItem>
                            <DropdownMenuItem className="cursor-pointer">
                              <PlusCircle className="w-4 h-4 mr-2 text-emerald-600" />
                              <div className="flex flex-col">
                                <span className="text-sm">Re-import: Only Add New</span>
                                <span className="text-xs text-slate-500">Strictly append only, ignore matches</span>
                              </div>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50">
                              <Trash2 className="w-4 h-4 mr-2" />
                              <div className="flex flex-col">
                                <span className="text-sm">Replace All Data</span>
                                <span className="text-xs text-red-500/70 font-medium">Destructive: wipes all existing data</span>
                              </div>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          
          <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500 font-medium">
            <div>Showing {filteredData.length} of {MOCK_COMPANIES.length} total companies</div>
            <div className="flex items-center gap-2">
              <span>Rows per page: 25</span>
              <div className="h-4 w-px bg-slate-200 mx-1" />
              <span>Page 1 of 1</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
