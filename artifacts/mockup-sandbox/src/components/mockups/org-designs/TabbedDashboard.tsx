import React, { useState } from 'react';
import { 
  Building2, 
  Users, 
  Briefcase, 
  Network, 
  Plus, 
  MoreVertical, 
  Edit2, 
  Trash2, 
  ChevronRight, 
  ChevronDown,
  Search,
  CheckCircle2,
  XCircle,
  LayoutTemplate
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';

// Sample Data
const initialStructure = [
  {
    id: 'bu-1',
    name: 'Engineering',
    type: 'Business Unit',
    children: [
      {
        id: 'div-1',
        name: 'Civil',
        type: 'Division',
        children: [
          { id: 'dep-1', name: 'Site Works', type: 'Department' },
          { id: 'dep-2', name: 'Estimating', type: 'Department' },
        ]
      },
      {
        id: 'div-2',
        name: 'Structural',
        type: 'Division',
        children: []
      }
    ]
  },
  {
    id: 'bu-2',
    name: 'Construction',
    type: 'Business Unit',
    children: [
      {
        id: 'div-3',
        name: 'Architecture',
        type: 'Division',
        children: [
          { id: 'dep-3', name: 'Design Management', type: 'Department' },
          { id: 'dep-4', name: 'BIM', type: 'Department' },
        ]
      },
      {
        id: 'div-4',
        name: 'MEP',
        type: 'Division',
        children: []
      }
    ]
  },
  {
    id: 'bu-3',
    name: 'Corporate Services',
    type: 'Business Unit',
    children: []
  }
];

const initialRoles = [
  { id: 'r-1', name: 'Project Manager', count: 12 },
  { id: 'r-2', name: 'Site Engineer', count: 24 },
  { id: 'r-3', name: 'Quantity Surveyor', count: 8 },
  { id: 'r-4', name: 'BIM Coordinator', count: 5 },
  { id: 'r-5', name: 'Director', count: 3 },
];

const initialJobTitles = [
  { id: 'jt-1', name: 'Graduate Engineer', role: 'Site Engineer' },
  { id: 'jt-2', name: 'Senior PM', role: 'Project Manager' },
  { id: 'jt-3', name: 'Principal Consultant', role: 'Director' },
  { id: 'jt-4', name: 'Associate Director', role: 'Director' },
  { id: 'jt-5', name: 'Junior QS', role: 'Quantity Surveyor' },
];

// Tree Node Component
const TreeNode = ({ node, level = 0, onSelect, selectedId }: { node: any, level?: number, onSelect: (n: any) => void, selectedId: string | null }) => {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedId === node.id;

  return (
    <div className="select-none">
      <div 
        className={`flex items-center gap-2 py-2 px-3 rounded-md cursor-pointer transition-colors ${
          isSelected ? 'bg-zinc-800 text-green-400' : 'hover:bg-zinc-800/50 text-zinc-300'
        }`}
        style={{ paddingLeft: `${level * 1.5 + 0.75}rem` }}
        onClick={() => onSelect(node)}
      >
        <div 
          className="w-5 h-5 flex items-center justify-center cursor-pointer text-zinc-500 hover:text-zinc-300"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) setExpanded(!expanded);
          }}
        >
          {hasChildren ? (
            expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
          ) : (
            <div className="w-1 h-1 rounded-full bg-zinc-600" />
          )}
        </div>
        
        {node.type === 'Business Unit' && <Building2 className="w-4 h-4 opacity-70" />}
        {node.type === 'Division' && <LayoutTemplate className="w-4 h-4 opacity-70" />}
        {node.type === 'Department' && <Network className="w-4 h-4 opacity-70" />}
        
        <span className="font-medium text-sm flex-1">{node.name}</span>
        
        {hasChildren && (
          <Badge variant="secondary" className="bg-zinc-800 hover:bg-zinc-700 text-xs font-normal">
            {node.children.length}
          </Badge>
        )}
      </div>
      
      {expanded && hasChildren && (
        <div className="mt-1">
          {node.children.map((child: any) => (
            <TreeNode key={child.id} node={child} level={level + 1} onSelect={onSelect} selectedId={selectedId} />
          ))}
        </div>
      )}
    </div>
  );
};

export function TabbedDashboard() {
  const [activeTab, setActiveTab] = useState('structure');
  const [selectedNode, setSelectedNode] = useState<any | null>(initialStructure[0]);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');

  // Form State
  const [newRoleName, setNewRoleName] = useState('');
  const [newJobTitleName, setNewJobTitleName] = useState('');

  const handleSelectNode = (node: any) => {
    setSelectedNode(node);
    setIsEditing(false);
    setEditName(node.name);
  };

  return (
    <div className="min-h-screen bg-[#0f0f13] text-zinc-100 p-8 font-sans selection:bg-green-500/30">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header & Stats */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
<h1 className="text-3xl font-semibold tracking-tight text-white mb-2">Organization</h1>
            <p className="text-zinc-400">Configure business units, divisions, departments, and talent mapping.</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            {[
              { label: 'Business Units', count: 3, icon: Building2 },
              { label: 'Divisions', count: 4, icon: LayoutTemplate },
              { label: 'Departments', count: 4, icon: Network },
              { label: 'Roles', count: 5, icon: Briefcase },
              { label: 'Job Titles', count: 5, icon: Users },
            ].map((stat, i) => (
              <div key={i} className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-2 shadow-sm">
                <stat.icon className="w-4 h-4 text-green-500" />
                <span className="text-sm font-medium text-zinc-300">{stat.label}</span>
                <span className="text-sm font-bold text-white ml-1">{stat.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Main Content Tabs */}
        <Tabs defaultValue="structure" onValueChange={setActiveTab} className="w-full">
          <TabsList className="bg-zinc-900 border border-zinc-800 p-1 mb-8">
            <TabsTrigger 
              value="structure" 
              className="data-[state=active]:bg-zinc-800 data-[state=active]:text-green-400 px-6"
            >
              Structure
            </TabsTrigger>
            <TabsTrigger 
              value="talent" 
              className="data-[state=active]:bg-zinc-800 data-[state=active]:text-green-400 px-6"
            >
              Talent
            </TabsTrigger>
          </TabsList>

          {/* STRUCTURE TAB */}
          <TabsContent value="structure" className="outline-none mt-0">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              
              {/* Left Panel: Tree */}
              <div className="lg:col-span-4 lg:col-start-1 xl:col-span-4 bg-[#141419] border border-zinc-800/60 rounded-xl overflow-hidden shadow-xl">
                <div className="p-4 border-b border-zinc-800/60 flex items-center justify-between">
                  <h3 className="font-semibold text-white">Hierarchy</h3>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-white">
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                <div className="p-2 h-[600px] overflow-y-auto custom-scrollbar">
                  {initialStructure.map((node) => (
                    <TreeNode 
                      key={node.id} 
                      node={node} 
                      onSelect={handleSelectNode} 
                      selectedId={selectedNode?.id || null} 
                    />
                  ))}
                </div>
              </div>

              {/* Right Panel: Details/Form */}
              <div className="lg:col-span-8 lg:col-start-5 xl:col-span-8">
                {selectedNode ? (
                  <div className="bg-[#141419] border border-zinc-800/60 rounded-xl p-8 shadow-xl min-h-[400px]">
                    <div className="flex items-start justify-between mb-8">
                      <div>
                        <div className="flex items-center gap-3 mb-2">
                          <Badge variant="outline" className="text-green-400 border-green-400/20 bg-green-400/10">
                            {selectedNode.type}
                          </Badge>
                          <span className="text-xs text-zinc-500 font-mono">ID: {selectedNode.id}</span>
                        </div>
                        {isEditing ? (
                          <div className="flex items-center gap-3 mt-4">
                            <Input 
                              value={editName} 
                              onChange={(e) => setEditName(e.target.value)}
                              className="text-2xl font-bold bg-zinc-900 border-zinc-700 w-80 h-12"
                            />
                            <Button size="icon" className="bg-green-600 hover:bg-green-700" onClick={() => setIsEditing(false)}>
                              <CheckCircle2 className="w-5 h-5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="text-zinc-400" onClick={() => setIsEditing(false)}>
                              <XCircle className="w-5 h-5" />
                            </Button>
                          </div>
                        ) : (
                          <h2 className="text-3xl font-bold text-white mt-2 flex items-center gap-3 group">
                            {selectedNode.name}
                            <button 
                              onClick={() => {
                                setIsEditing(true);
                                setEditName(selectedNode.name);
                              }}
                              className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-white transition-opacity"
                            >
                              <Edit2 className="w-5 h-5" />
                            </button>
                          </h2>
                        )}
                      </div>
                      
                      <Button variant="outline" className="border-red-500/20 text-red-400 hover:bg-red-500/10 hover:text-red-300">
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </Button>
                    </div>

                    <div className="space-y-6">
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <Label className="text-zinc-400">Parent Entity</Label>
                          <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-zinc-300">
                            {selectedNode.type === 'Business Unit' ? 'None (Top Level)' : 'Engineering'}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-zinc-400">Status</Label>
                          <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-green-400 flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-green-500" />
                            Active
                          </div>
                        </div>
                      </div>

                      {/* Add Child Form */}
                      <div className="mt-12 pt-8 border-t border-zinc-800/60">
                        <h4 className="text-lg font-medium text-white mb-4">Add Child Entity</h4>
                        <div className="flex gap-4">
                          <div className="flex-1 space-y-2">
                            <Input placeholder={`New ${selectedNode.type === 'Business Unit' ? 'Division' : 'Department'} Name`} className="bg-zinc-900 border-zinc-800" />
                          </div>
                          <Button className="bg-white text-black hover:bg-zinc-200 mt-2">
                            <Plus className="w-4 h-4 mr-2" /> Add
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-zinc-500">
                    Select a node to view details
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* TALENT TAB */}
          <TabsContent value="talent" className="outline-none mt-0">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              
              {/* Roles Column */}
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-zinc-800/60 pb-4">
                  <div>
                    <h3 className="text-xl font-semibold text-white">Roles</h3>
                    <p className="text-sm text-zinc-400 mt-1">Standardized functional positions</p>
                  </div>
                </div>

                {/* Add Role Inline */}
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <Input 
                      placeholder="Add new role..." 
                      className="pl-9 bg-[#141419] border-zinc-800 h-12"
                      value={newRoleName}
                      onChange={(e) => setNewRoleName(e.target.value)}
                    />
                  </div>
                  <Button className="h-12 px-6 bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700">
                    Add
                  </Button>
                </div>

                <div className="grid gap-3">
                  {initialRoles.map(role => (
                    <div key={role.id} className="group flex items-center justify-between p-4 bg-[#141419] border border-zinc-800/60 rounded-xl hover:border-zinc-700 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                          <Briefcase className="w-5 h-5 text-zinc-400" />
                        </div>
                        <div>
                          <h4 className="font-medium text-white">{role.name}</h4>
                          <p className="text-xs text-zinc-500 mt-0.5">{role.count} Active Users</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-white">
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-white">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40 bg-zinc-900 border-zinc-800">
                            <DropdownMenuItem className="text-red-400 focus:text-red-400 focus:bg-red-500/10 cursor-pointer">
                              <Trash2 className="w-4 h-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Job Titles Column */}
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-zinc-800/60 pb-4">
                  <div>
                    <h3 className="text-xl font-semibold text-white">Job Titles</h3>
                    <p className="text-sm text-zinc-400 mt-1">Specific designations mapped to roles</p>
                  </div>
                </div>

                {/* Add Job Title Inline */}
                <div className="flex gap-3">
                  <Input 
                    placeholder="Add job title..." 
                    className="flex-1 bg-[#141419] border-zinc-800 h-12"
                    value={newJobTitleName}
                    onChange={(e) => setNewJobTitleName(e.target.value)}
                  />
                  <Button className="h-12 px-6 bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700">
                    Add
                  </Button>
                </div>

                <div className="flex flex-wrap gap-3">
                  {initialJobTitles.map(jt => (
                    <div key={jt.id} className="flex flex-col bg-[#141419] border border-zinc-800/60 rounded-lg p-3 hover:border-zinc-700 transition-colors group">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <h4 className="font-medium text-sm text-white">{jt.name}</h4>
                        <button className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 transition-opacity">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 mt-auto">
                        <Network className="w-3 h-3 text-green-500/70" />
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500">Maps to:</span>
                        <span className="text-xs text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded">{jt.role}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </TabsContent>
        </Tabs>
        
      </div>
      
      {/* Add some global scrollbar styles specifically for this mockup if needed, but Tailwind classes suffice mostly */}
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #27272a;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #3f3f46;
        }
      `}} />
    </div>
  );
}
