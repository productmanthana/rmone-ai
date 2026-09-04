import React, { useState } from "react";
import { 
  Building2, 
  Layers, 
  Users, 
  Briefcase, 
  GraduationCap, 
  Plus, 
  Search, 
  MoreVertical, 
  Edit2, 
  Trash2, 
  ChevronRight, 
  ChevronDown, 
  FolderTree,
  Filter,
  ArrowUpDown
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// --- Types ---
type Entity = { id: string; name: string };
type Dept = Entity & { divisionId: string };
type Div = Entity & { buId: string; departments: Dept[] };
type BU = Entity & { divisions: Div[] };
type Role = Entity;
type JobTitle = Entity & { roleId: string; roleName: string };

// --- Sample Data ---
const initialBUs: BU[] = [
  {
    id: "bu-1", name: "Engineering", divisions: [
      { id: "div-1", name: "Civil", buId: "bu-1", departments: [{ id: "dep-1", name: "Site Works", divisionId: "div-1" }, { id: "dep-2", name: "Geotech", divisionId: "div-1" }] },
      { id: "div-2", name: "Structural", buId: "bu-1", departments: [{ id: "dep-3", name: "Design", divisionId: "div-2" }, { id: "dep-4", name: "Analysis", divisionId: "div-2" }] }
    ]
  },
  {
    id: "bu-2", name: "Construction", divisions: [
      { id: "div-3", name: "MEP", buId: "bu-2", departments: [{ id: "dep-5", name: "Electrical", divisionId: "div-3" }, { id: "dep-6", name: "Mechanical", divisionId: "div-3" }] },
      { id: "div-4", name: "Architecture", buId: "bu-2", departments: [{ id: "dep-7", name: "Interiors", divisionId: "div-4" }, { id: "dep-8", name: "Landscape", divisionId: "div-4" }] }
    ]
  },
  { id: "bu-3", name: "Corporate Services", divisions: [] }
];

const initialRoles: Role[] = [
  { id: "r-1", name: "Project Manager" },
  { id: "r-2", name: "Site Engineer" },
  { id: "r-3", name: "Quantity Surveyor" },
  { id: "r-4", name: "BIM Coordinator" },
  { id: "r-5", name: "Director" },
];

const initialJobTitles: JobTitle[] = [
  { id: "jt-1", name: "Graduate Engineer", roleId: "r-2", roleName: "Site Engineer" },
  { id: "jt-2", name: "Senior PM", roleId: "r-1", roleName: "Project Manager" },
  { id: "jt-3", name: "Principal Consultant", roleId: "r-5", roleName: "Director" },
  { id: "jt-4", name: "Associate Director", roleId: "r-5", roleName: "Director" },
  { id: "jt-5", name: "Junior QS", roleId: "r-3", roleName: "Quantity Surveyor" },
];

export function StatsGrid() {
  const [bus, setBus] = useState<BU[]>(initialBUs);
  const [roles, setRoles] = useState<Role[]>(initialRoles);
  const [jobTitles, setJobTitles] = useState<JobTitle[]>(initialJobTitles);
  
  const [searchRole, setSearchRole] = useState("");
  const [searchJT, setSearchJT] = useState("");

  const filteredRoles = roles.filter(r => r.name.toLowerCase().includes(searchRole.toLowerCase()));
  const filteredJobTitles = jobTitles.filter(jt => jt.name.toLowerCase().includes(searchJT.toLowerCase()));

  // Stats
  const totalBUs = bus.length;
  const totalDivs = bus.reduce((acc, bu) => acc + bu.divisions.length, 0);
  const totalDepts = bus.reduce((acc, bu) => acc + bu.divisions.reduce((dAcc, div) => dAcc + div.departments.length, 0), 0);
  const totalRoles = roles.length;
  const totalJTs = jobTitles.length;

  return (
    <div className="min-h-screen bg-[#0f0f13] text-slate-200 p-6 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
<h1 className="text-2xl font-bold text-white tracking-tight">Organization Config</h1>
            <p className="text-slate-400 text-sm mt-1">Manage hierarchy and talent structure</p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="bg-[#1a1a23] border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800">
              Export
            </Button>
            <Button className="bg-[#22c55e] hover:bg-[#1ea850] text-black font-semibold">
              Save Changes
            </Button>
          </div>
        </div>

        {/* Top Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <StatCard title="Business Units" count={totalBUs} icon={Building2} />
          <StatCard title="Divisions" count={totalDivs} icon={Layers} />
          <StatCard title="Departments" count={totalDepts} icon={FolderTree} />
          <StatCard title="Roles" count={totalRoles} icon={Briefcase} />
          <StatCard title="Job Titles" count={totalJTs} icon={GraduationCap} />
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Column: Hierarchy (BUs -> Divs -> Depts) */}
          <div className="lg:col-span-5 space-y-4">
            <Card className="bg-[#15151c] border-slate-800">
              <CardHeader className="pb-3 flex flex-row items-center justify-between border-b border-slate-800/50">
                <div>
                  <CardTitle className="text-lg font-semibold text-white">Company Structure</CardTitle>
<CardDescription className="text-slate-400">Hierarchical organization</CardDescription>
                </div>
                <Button size="sm" variant="ghost" className="h-8 text-xs bg-slate-800/50 hover:bg-slate-800 text-slate-300 border-0">
                  <Plus className="w-3 h-3 mr-1" /> Add BU
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[600px]">
                  <div className="p-4 space-y-3">
                    {bus.map(bu => (
                      <BUItem key={bu.id} bu={bu} />
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* Right Column: Roles & Job Titles */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Roles Table */}
            <Card className="bg-[#15151c] border-slate-800">
              <CardHeader className="pb-3 flex flex-row items-center justify-between border-b border-slate-800/50">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-lg font-semibold text-white">Roles</CardTitle>
                  <Badge variant="outline" className="bg-slate-800/50 text-slate-400 border-slate-700">{totalRoles}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <Input 
                      placeholder="Search roles..." 
                      className="h-8 w-48 bg-[#0f0f13] border-slate-800 text-sm pl-9 focus-visible:ring-1 focus-visible:ring-[#22c55e]"
                      value={searchRole}
                      onChange={(e) => setSearchRole(e.target.value)}
                    />
                  </div>
                  <Button size="sm" className="h-8 bg-[#22c55e] hover:bg-[#1ea850] text-black">
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-slate-900/50 hover:bg-slate-900/50">
                    <TableRow className="border-slate-800 hover:bg-transparent">
                      <TableHead className="text-slate-400 w-full">Role Name</TableHead>
                      <TableHead className="text-slate-400 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRoles.map(r => (
                      <TableRow key={r.id} className="border-slate-800 hover:bg-slate-800/30 group">
                        <TableCell className="font-medium text-slate-200">{r.name}</TableCell>
                        <TableCell className="text-right">
                          <RowActions />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Job Titles Table */}
            <Card className="bg-[#15151c] border-slate-800">
              <CardHeader className="pb-3 flex flex-row items-center justify-between border-b border-slate-800/50">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-lg font-semibold text-white">Job Titles</CardTitle>
                  <Badge variant="outline" className="bg-slate-800/50 text-slate-400 border-slate-700">{totalJTs}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <Input 
                      placeholder="Search titles..." 
                      className="h-8 w-48 bg-[#0f0f13] border-slate-800 text-sm pl-9 focus-visible:ring-1 focus-visible:ring-[#22c55e]"
                      value={searchJT}
                      onChange={(e) => setSearchJT(e.target.value)}
                    />
                  </div>
                  <Button size="sm" className="h-8 bg-[#22c55e] hover:bg-[#1ea850] text-black">
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[280px]">
                  <Table>
                    <TableHeader className="bg-slate-900/50 hover:bg-slate-900/50 sticky top-0 z-10">
                      <TableRow className="border-slate-800 hover:bg-transparent">
                        <TableHead className="text-slate-400">Job Title</TableHead>
                        <TableHead className="text-slate-400">Mapped Role</TableHead>
                        <TableHead className="text-slate-400 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredJobTitles.map(jt => (
                        <TableRow key={jt.id} className="border-slate-800 hover:bg-slate-800/30 group">
                          <TableCell className="font-medium text-slate-200">{jt.name}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="bg-slate-800 text-slate-300 font-normal hover:bg-slate-700">
                              {jt.roleName}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <RowActions />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>

          </div>
        </div>
      </div>
    </div>
  );
}

// --- Subcomponents ---

function StatCard({ title, count, icon: Icon }: { title: string, count: number, icon: any }) {
  return (
    <Card className="bg-[#15151c] border-slate-800 overflow-hidden relative group">
      <div className="absolute inset-0 bg-gradient-to-br from-[#22c55e]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <CardContent className="p-4 flex flex-col justify-between h-full relative z-10">
        <div className="flex justify-between items-start mb-2">
          <p className="text-sm font-medium text-slate-400">{title}</p>
          <div className="p-1.5 rounded-md bg-[#0f0f13] text-[#22c55e]">
            <Icon className="w-4 h-4" />
          </div>
        </div>
        <div className="flex items-end justify-between mt-1">
          <h3 className="text-3xl font-bold text-white tabular-nums">{count}</h3>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-slate-500 hover:text-[#22c55e] hover:bg-[#22c55e]/10 -mr-2">
            <Plus className="w-3 h-3 mr-1" /> Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function BUItem({ bu }: { bu: BU }) {
  const [open, setOpen] = useState(true);
  
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-1">
      <div className="flex items-center justify-between p-2 rounded-lg bg-[#1a1a23] border border-slate-800 hover:border-slate-700 transition-colors group">
        <div className="flex items-center gap-2">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-slate-400 hover:text-white hover:bg-slate-800">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <Building2 className="w-4 h-4 text-[#22c55e]" />
          <span className="font-semibold text-slate-200">{bu.name}</span>
          <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-slate-700 text-slate-500 bg-slate-900/50">
            {bu.divisions.length} Divs
          </Badge>
        </div>
        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-slate-400 hover:text-[#22c55e] hover:bg-[#22c55e]/10">
            <Plus className="w-3 h-3 mr-1" /> Div
          </Button>
          <RowActions />
        </div>
      </div>
      
      <CollapsibleContent className="pl-6 space-y-1 pt-1">
        {bu.divisions.length === 0 ? (
          <div className="pl-6 py-2 text-sm text-slate-500 italic">No divisions</div>
        ) : (
          bu.divisions.map(div => <DivItem key={div.id} div={div} />)
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function DivItem({ div }: { div: Div }) {
  const [open, setOpen] = useState(true);
  
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-1 relative">
      <div className="absolute left-[-11px] top-4 bottom-0 w-px bg-slate-800" />
      <div className="absolute left-[-11px] top-4 w-3 h-px bg-slate-800" />
      
      <div className="flex items-center justify-between p-2 rounded-md hover:bg-slate-800/30 transition-colors group">
        <div className="flex items-center gap-2">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-slate-400 hover:text-white hover:bg-slate-700">
              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </Button>
          </CollapsibleTrigger>
          <Layers className="w-4 h-4 text-blue-400" />
          <span className="font-medium text-sm text-slate-300">{div.name}</span>
          <Badge variant="outline" className="text-[10px] h-4 px-1 border-slate-700 text-slate-500 bg-transparent">
            {div.departments.length} Depts
          </Badge>
        </div>
        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] text-slate-400 hover:text-blue-400 hover:bg-blue-400/10">
            <Plus className="w-3 h-3" /> Dept
          </Button>
          <RowActions size="sm" />
        </div>
      </div>
      
      <CollapsibleContent className="pl-6 space-y-1">
        {div.departments.length === 0 ? (
          <div className="pl-6 py-1 text-xs text-slate-600 italic">No departments</div>
        ) : (
          div.departments.map(dep => <DeptItem key={dep.id} dep={dep} />)
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function DeptItem({ dep }: { dep: Dept }) {
  return (
    <div className="relative">
      <div className="absolute left-[-11px] top-4 bottom-0 w-px bg-slate-800" />
      <div className="absolute left-[-11px] top-4 w-3 h-px bg-slate-800" />
      
      <div className="flex items-center justify-between p-1.5 pl-2 rounded-md hover:bg-slate-800/30 transition-colors group">
        <div className="flex items-center gap-2 ml-5">
          <FolderTree className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-sm text-slate-400">{dep.name}</span>
        </div>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
          <RowActions size="sm" />
        </div>
      </div>
    </div>
  );
}

function RowActions({ size = "default" }: { size?: "sm" | "default" }) {
  const iconClass = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  const btnClass = size === "sm" ? "h-6 w-6" : "h-8 w-8";
  
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={`${btnClass} text-slate-400 hover:text-white hover:bg-slate-700`}>
          <MoreVertical className={iconClass} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-32 bg-[#15151c] border-slate-800 text-slate-300">
        <DropdownMenuItem className="hover:bg-slate-800 hover:text-white cursor-pointer">
          <Edit2 className="w-4 h-4 mr-2" /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem className="text-red-400 hover:bg-red-400/10 hover:text-red-300 cursor-pointer">
          <Trash2 className="w-4 h-4 mr-2" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
