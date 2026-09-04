import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileText, Plus, Edit2, Trash2, Users, Briefcase, Building, Search, MoreHorizontal, Settings, File } from 'lucide-react';

type NodeType = 'bu' | 'division' | 'department';

interface TreeNode {
  id: string;
  name: string;
  type: NodeType;
  children?: TreeNode[];
}

const initialTree: TreeNode[] = [
  {
    id: 'bu-1',
    name: 'Engineering',
    type: 'bu',
    children: [
      {
        id: 'div-1',
        name: 'Civil',
        type: 'division',
        children: [
          { id: 'dep-1', name: 'Site Works', type: 'department' },
          { id: 'dep-2', name: 'Estimating', type: 'department' },
        ],
      },
      {
        id: 'div-2',
        name: 'Structural',
        type: 'division',
        children: [
          { id: 'dep-3', name: 'BIM', type: 'department' },
          { id: 'dep-4', name: 'Design Management', type: 'department' },
        ],
      },
    ],
  },
  {
    id: 'bu-2',
    name: 'Construction',
    type: 'bu',
    children: [
      {
        id: 'div-3',
        name: 'MEP',
        type: 'division',
        children: [],
      },
      {
        id: 'div-4',
        name: 'Architecture',
        type: 'division',
        children: [],
      },
    ],
  },
  {
    id: 'bu-3',
    name: 'Corporate Services',
    type: 'bu',
    children: [],
  },
];

const initialRoles = [
  { id: 'r1', name: 'Project Manager' },
  { id: 'r2', name: 'Site Engineer' },
  { id: 'r3', name: 'Quantity Surveyor' },
  { id: 'r4', name: 'BIM Coordinator' },
  { id: 'r5', name: 'Director' },
];

const initialJobTitles = [
  { id: 'jt1', name: 'Graduate Engineer', roleId: 'r2' },
  { id: 'jt2', name: 'Senior PM', roleId: 'r1' },
  { id: 'jt3', name: 'Principal Consultant', roleId: 'r5' },
  { id: 'jt4', name: 'Associate Director', roleId: 'r5' },
];

export function FileExplorer() {
  const [tree, setTree] = useState<TreeNode[]>(initialTree);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['bu-1', 'div-1', 'div-2']));
  const [selectedId, setSelectedId] = useState<string | null>('bu-1');
  
  const [roles, setRoles] = useState(initialRoles);
  const [jobTitles, setJobTitles] = useState(initialJobTitles);

  const [newItemName, setNewItemName] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(expanded);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setExpanded(next);
  };

  const findNode = (nodes: TreeNode[], id: string): TreeNode | null => {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children) {
        const found = findNode(node.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  const getBreadcrumbs = (nodes: TreeNode[], id: string, path: TreeNode[] = []): TreeNode[] | null => {
    for (const node of nodes) {
      if (node.id === id) return [...path, node];
      if (node.children) {
        const found = getBreadcrumbs(node.children, id, [...path, node]);
        if (found) return found;
      }
    }
    return null;
  };

  const selectedNode = selectedId ? findNode(tree, selectedId) : null;
  const breadcrumbs = selectedId ? getBreadcrumbs(tree, selectedId) : [];

  const handleAddChild = () => {
    if (!newItemName.trim() || !selectedNode) return;
    
    let newType: NodeType = 'department';
    if (selectedNode.type === 'bu') newType = 'division';
    if (selectedNode.type === 'division') newType = 'department';
    if (selectedNode.type === 'department') return; // Can't add child to department
    
    const newNode: TreeNode = {
      id: `new-${Date.now()}`,
      name: newItemName,
      type: newType,
      children: newType === 'department' ? undefined : [],
    };

    const updateTree = (nodes: TreeNode[]): TreeNode[] => {
      return nodes.map(n => {
        if (n.id === selectedNode.id) {
          return { ...n, children: [...(n.children || []), newNode] };
        }
        if (n.children) {
          return { ...n, children: updateTree(n.children) };
        }
        return n;
      });
    };

    setTree(updateTree(tree));
    setNewItemName('');
    setIsAdding(false);
    
    // Auto-expand
    const nextExp = new Set(expanded);
    nextExp.add(selectedNode.id);
    setExpanded(nextExp);
  };

  const handleDeleteNode = (id: string) => {
    const deleteFromTree = (nodes: TreeNode[]): TreeNode[] => {
      return nodes.filter(n => n.id !== id).map(n => {
        if (n.children) return { ...n, children: deleteFromTree(n.children) };
        return n;
      });
    };
    setTree(deleteFromTree(tree));
    if (selectedId === id) setSelectedId(null);
  };

  const renderTree = (nodes: TreeNode[], depth = 0) => {
    return nodes.map(node => {
      const isExpanded = expanded.has(node.id);
      const isSelected = selectedId === node.id;
      const hasChildren = node.children && node.children.length > 0;
      
      let Icon = FileText;
      let iconColor = "text-zinc-400";
      if (node.type === 'bu') {
        Icon = isExpanded ? FolderOpen : Folder;
        iconColor = "text-emerald-400";
      } else if (node.type === 'division') {
        Icon = isExpanded ? FolderOpen : Folder;
        iconColor = "text-blue-400";
      } else {
        Icon = File;
        iconColor = "text-zinc-500";
      }

      return (
        <div key={node.id}>
          <div 
            className={`flex items-center group py-1.5 px-2 cursor-pointer text-sm border-l-2 border-transparent transition-colors
              ${isSelected ? 'bg-zinc-800/80 border-emerald-500 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-300'}`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={() => setSelectedId(node.id)}
          >
            <div 
              className="w-5 h-5 flex items-center justify-center mr-1 cursor-pointer hover:bg-zinc-700/50 rounded"
              onClick={(e) => node.type !== 'department' ? toggleExpand(node.id, e) : undefined}
            >
              {node.type !== 'department' && (
                isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
              )}
            </div>
            
            <Icon className={`w-4 h-4 mr-2 ${iconColor}`} />
            <span className="truncate flex-1">{node.name}</span>
          </div>
          
          {isExpanded && node.children && (
            <div>{renderTree(node.children, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="min-h-screen bg-[#0f0f13] text-zinc-200 flex flex-col font-sans selection:bg-emerald-500/30">
      
      {/* Top Header */}
      <header className="h-12 border-b border-zinc-800/50 bg-[#0f0f13] flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded bg-emerald-500/20 flex items-center justify-center">
            <Building className="w-4 h-4 text-emerald-500" />
          </div>
<span className="text-sm font-medium tracking-wide">RM ONE <span className="text-zinc-500 font-normal">/ Organization</span></span>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative group hidden sm:block">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-emerald-500 transition-colors" />
            <input 
              type="text" 
              placeholder="Search..." 
              className="bg-zinc-900 border border-zinc-800 rounded-md py-1 pl-9 pr-3 text-xs w-48 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all placeholder:text-zinc-600"
            />
          </div>
          <button className="w-8 h-8 rounded hover:bg-zinc-800 flex items-center justify-center text-zinc-400 transition-colors">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - File Tree */}
        <div className="w-64 border-r border-zinc-800/50 flex flex-col bg-[#0b0b0e] shrink-0">
          <div className="px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center justify-between group">
            Structure
            <button className="opacity-0 group-hover:opacity-100 hover:text-zinc-300 transition-all" title="New Business Unit">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto pb-4 custom-scrollbar">
            {renderTree(tree)}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0">
          
          {/* Main Panel */}
          <div className="flex-1 overflow-y-auto flex flex-col">
            {/* Right Panel Header / Breadcrumb */}
            <div className="h-12 border-b border-zinc-800/50 flex items-center px-6 shrink-0 bg-[#0f0f13]">
              {breadcrumbs && breadcrumbs.length > 0 ? (
                <div className="flex items-center text-sm">
                  {breadcrumbs.map((b, i) => (
                    <React.Fragment key={b.id}>
                      {i > 0 && <ChevronRight className="w-4 h-4 mx-1.5 text-zinc-600" />}
                      <span className={`flex items-center gap-1.5 ${i === breadcrumbs.length - 1 ? 'text-zinc-200 font-medium' : 'text-zinc-500 hover:text-zinc-300 cursor-pointer transition-colors'}`} onClick={() => setSelectedId(b.id)}>
                        {b.type === 'bu' && <FolderOpen className="w-3.5 h-3.5 text-emerald-500/70" />}
                        {b.type === 'division' && <FolderOpen className="w-3.5 h-3.5 text-blue-400/70" />}
                        {b.type === 'department' && <File className="w-3.5 h-3.5 text-zinc-400/70" />}
                        {b.name}
                      </span>
                    </React.Fragment>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-zinc-500 italic">No node selected</div>
              )}
            </div>

            {selectedNode ? (
              <div className="p-8 max-w-4xl mx-auto w-full flex-1">
                <div className="flex items-start justify-between mb-8">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`p-2.5 rounded-lg border border-zinc-800 ${selectedNode.type === 'bu' ? 'bg-emerald-500/10' : selectedNode.type === 'division' ? 'bg-blue-500/10' : 'bg-zinc-800'}`}>
                        {selectedNode.type === 'bu' && <Folder className="w-6 h-6 text-emerald-400" />}
                        {selectedNode.type === 'division' && <Folder className="w-6 h-6 text-blue-400" />}
                        {selectedNode.type === 'department' && <FileText className="w-6 h-6 text-zinc-400" />}
                      </div>
                      <h1 className="text-2xl font-semibold tracking-tight">{selectedNode.name}</h1>
                      <button className="w-8 h-8 rounded hover:bg-zinc-800 flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors ml-2">
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="text-sm text-zinc-500 capitalize tracking-wide flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-zinc-700"></span>
                      {selectedNode.type === 'bu' ? 'Business Unit' : selectedNode.type}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => handleDeleteNode(selectedNode.id)}
                      className="px-3 py-1.5 rounded bg-red-500/10 text-red-400 text-sm font-medium hover:bg-red-500/20 border border-red-500/20 transition-colors flex items-center gap-1.5"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                  </div>
                </div>

                {selectedNode.type !== 'department' && (
                  <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-lg overflow-hidden">
                    <div className="px-5 py-3 border-b border-zinc-800/50 flex justify-between items-center bg-zinc-900/80">
                      <h3 className="text-sm font-medium text-zinc-300">
                        {selectedNode.type === 'bu' ? 'Divisions' : 'Departments'}
                        <span className="ml-2 px-1.5 py-0.5 rounded-full bg-zinc-800 text-xs text-zinc-500">{selectedNode.children?.length || 0}</span>
                      </h3>
                      {!isAdding && (
                        <button 
                          onClick={() => setIsAdding(true)}
                          className="text-xs font-medium text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors bg-emerald-400/10 px-2 py-1 rounded hover:bg-emerald-400/20"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add {selectedNode.type === 'bu' ? 'Division' : 'Department'}
                        </button>
                      )}
                    </div>
                    
                    <div className="divide-y divide-zinc-800/50">
                      {isAdding && (
                        <div className="p-4 bg-zinc-800/30 flex items-center gap-3">
                          <input 
                            type="text" 
                            autoFocus
                            value={newItemName}
                            onChange={(e) => setNewItemName(e.target.value)}
                            placeholder={`New ${selectedNode.type === 'bu' ? 'Division' : 'Department'} Name`}
                            className="flex-1 bg-zinc-900 border border-zinc-700 rounded py-1.5 px-3 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleAddChild();
                              if (e.key === 'Escape') setIsAdding(false);
                            }}
                          />
                          <button 
                            onClick={handleAddChild}
                            disabled={!newItemName.trim()}
                            className="bg-emerald-500 hover:bg-emerald-400 text-black px-3 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Save
                          </button>
                          <button 
                            onClick={() => setIsAdding(false)}
                            className="text-zinc-500 hover:text-zinc-300 text-sm px-2 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      )}

                      {selectedNode.children?.length === 0 && !isAdding ? (
                        <div className="p-8 text-center text-zinc-500 text-sm italic">
                          No {selectedNode.type === 'bu' ? 'divisions' : 'departments'} configured.
                        </div>
                      ) : (
                        selectedNode.children?.map(child => (
                          <div 
                            key={child.id} 
                            className="px-5 py-3 flex items-center justify-between hover:bg-zinc-800/30 group cursor-pointer transition-colors"
                            onClick={() => setSelectedId(child.id)}
                          >
                            <div className="flex items-center gap-3">
                              {child.type === 'division' ? <Folder className="w-4 h-4 text-blue-400/80" /> : <File className="w-4 h-4 text-zinc-400" />}
                              <span className="text-sm font-medium text-zinc-300 group-hover:text-emerald-400 transition-colors">{child.name}</span>
                            </div>
                            <button 
                              className="text-zinc-600 hover:text-zinc-300 opacity-0 group-hover:opacity-100 transition-all p-1"
                              onClick={(e) => { e.stopPropagation(); }}
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
                
                {selectedNode.type === 'department' && (
                  <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-lg p-6 flex flex-col items-center justify-center text-center">
                    <File className="w-12 h-12 text-zinc-700 mb-3" />
                    <h3 className="text-zinc-300 font-medium mb-1">Department Details</h3>
                    <p className="text-zinc-500 text-sm mb-4 max-w-sm">Leaf node in the organizational structure. This department acts as a cost center for project tracking.</p>
                    <button className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-sm font-medium transition-colors">
                      Edit Configuration
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center flex-col text-zinc-500 p-8">
                <FolderOpen className="w-16 h-16 text-zinc-800 mb-4" />
                <p>Select a node from the explorer to view details</p>
              </div>
            )}
          </div>

          {/* Bottom Panel - Roles & Job Titles */}
          <div className="h-64 border-t border-zinc-800/50 bg-[#0b0b0e] shrink-0 flex flex-col">
            <div className="px-6 py-3 border-b border-zinc-800/50 flex justify-between items-center bg-[#0f0f13]">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                  <Users className="w-4 h-4 text-purple-400" />
                  Talent Structure
                </div>
                <div className="h-4 w-px bg-zinc-800"></div>
                <div className="text-xs text-zinc-500">Standalone mapping decoupled from hierarchy</div>
              </div>
            </div>
            
            <div className="flex-1 flex overflow-hidden">
              {/* Roles */}
              <div className="flex-1 border-r border-zinc-800/50 p-5 overflow-y-auto custom-scrollbar">
                <div className="flex justify-between items-center mb-4">
                  <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Roles <span className="lowercase text-zinc-600 font-normal ml-1">({roles.length})</span></h4>
                  <button className="text-zinc-500 hover:text-emerald-400 transition-colors"><Plus className="w-4 h-4" /></button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {roles.map(r => (
                    <div key={r.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-zinc-700/50 bg-zinc-800/50 text-xs font-medium text-zinc-300 hover:bg-zinc-700 cursor-pointer transition-colors group">
                      <Briefcase className="w-3 h-3 text-purple-400/70 group-hover:text-purple-400" />
                      {r.name}
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Job Titles */}
              <div className="flex-1 p-5 overflow-y-auto custom-scrollbar">
                <div className="flex justify-between items-center mb-4">
                  <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Job Titles <span className="lowercase text-zinc-600 font-normal ml-1">({jobTitles.length})</span></h4>
                  <button className="text-zinc-500 hover:text-emerald-400 transition-colors"><Plus className="w-4 h-4" /></button>
                </div>
                <div className="flex flex-col gap-2">
                  {jobTitles.map(jt => {
                    const role = roles.find(r => r.id === jt.roleId);
                    return (
                      <div key={jt.id} className="flex justify-between items-center px-3 py-2 rounded border border-zinc-800/50 bg-[#0f0f13] text-xs hover:border-zinc-700 transition-colors group cursor-pointer">
                        <span className="font-medium text-zinc-300">{jt.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-500">maps to</span>
                          <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">{role?.name || 'Unassigned'}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #27272a;
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #3f3f46;
        }
      `}</style>
    </div>
  );
}
