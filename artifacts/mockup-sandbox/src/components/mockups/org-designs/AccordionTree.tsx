import React, { useState } from 'react';
import { 
  ChevronRight, 
  ChevronDown, 
  Plus, 
  MoreVertical, 
  Building2, 
  Users, 
  Briefcase, 
  Search,
  Trash2,
  Edit2,
  Save,
  X
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';

// Sample Data
const initialData = {
  businessUnits: [
    {
      id: 'bu-1',
      name: 'Engineering',
      divisions: [
        {
          id: 'div-1',
          name: 'Civil',
          departments: [
            { id: 'dep-1', name: 'Site Works' },
            { id: 'dep-2', name: 'Estimating' }
          ]
        },
        {
          id: 'div-2',
          name: 'Structural',
          departments: [
            { id: 'dep-3', name: 'Design Management' }
          ]
        }
      ]
    },
    {
      id: 'bu-2',
      name: 'Construction',
      divisions: [
        {
          id: 'div-3',
          name: 'MEP',
          departments: [
            { id: 'dep-4', name: 'BIM' }
          ]
        }
      ]
    },
    {
      id: 'bu-3',
      name: 'Corporate Services',
      divisions: []
    }
  ],
  roles: [
    { id: 'r-1', name: 'Project Manager' },
    { id: 'r-2', name: 'Site Engineer' },
    { id: 'r-3', name: 'Quantity Surveyor' },
    { id: 'r-4', name: 'BIM Coordinator' },
    { id: 'r-5', name: 'Director' }
  ],
  jobTitles: [
    { id: 'jt-1', name: 'Graduate Engineer', roleId: 'r-2' },
    { id: 'jt-2', name: 'Senior PM', roleId: 'r-1' },
    { id: 'jt-3', name: 'Principal Consultant', roleId: 'r-5' },
    { id: 'jt-4', name: 'Associate Director', roleId: 'r-5' }
  ]
};

type SelectedItem = {
  type: 'bu' | 'div' | 'dep' | 'role' | 'jobTitle';
  id: string;
  name: string;
  parentId?: string;
  roleId?: string;
} | null;

export function AccordionTree() {
  const [data, setData] = useState(initialData);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['bu-1', 'bu-2', 'div-1']));
  const [selectedItem, setSelectedItem] = useState<SelectedItem>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [searchQuery, setSearchQuery] = useState('');

  const toggleNode = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedNodes(newExpanded);
  };

  const handleSelect = (item: SelectedItem) => {
    setSelectedItem(item);
    setIsEditing(false);
    setEditForm({});
  };

  const handleEdit = () => {
    if (!selectedItem) return;
    setIsEditing(true);
    setEditForm({ ...selectedItem });
  };

  const handleSave = () => {
    // In a real app, this would update the state/backend
    setIsEditing(false);
    setSelectedItem(editForm);
  };

  const handleDelete = () => {
    // In a real app, this would delete the item
    setSelectedItem(null);
  };

  const TreeNode = ({ 
    item, 
    level = 0, 
    type,
    parentId
  }: { 
    item: any; 
    level?: number; 
    type: 'bu' | 'div' | 'dep' | 'role' | 'jobTitle';
    parentId?: string;
  }) => {
    const isExpanded = expandedNodes.has(item.id);
    const isSelected = selectedItem?.id === item.id;
    const hasChildren = item.divisions?.length > 0 || item.departments?.length > 0;
    
    return (
      <div className="w-full">
        <div 
          className={cn(
            "group flex items-center py-1.5 px-2 hover:bg-[#2a2a30] cursor-pointer text-sm transition-colors",
            isSelected && "bg-[#2a2a30] text-[#22c55e]"
          )}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          onClick={() => handleSelect({ type, id: item.id, name: item.name, parentId })}
        >
          <div className="flex items-center w-5 h-5 mr-1" onClick={(e) => hasChildren && toggleNode(item.id, e)}>
            {hasChildren && (
              isExpanded ? 
                <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-gray-200" /> : 
                <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-200" />
            )}
          </div>
          
          <div className="flex items-center flex-1 min-w-0">
            {type === 'bu' && <Building2 className="w-4 h-4 mr-2 opacity-50" />}
            {type === 'role' && <Users className="w-4 h-4 mr-2 opacity-50" />}
            {type === 'jobTitle' && <Briefcase className="w-4 h-4 mr-2 opacity-50" />}
            <span className="truncate flex-1">{item.name}</span>
          </div>
          
          <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
            {type !== 'dep' && type !== 'jobTitle' && (
              <button 
                className="p-1 hover:bg-[#3a3a40] rounded text-gray-400 hover:text-white"
                onClick={(e) => {
                  e.stopPropagation();
                  // Handle Add Child
                }}
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {isExpanded && item.divisions && (
          <div>
            {item.divisions.map((div: any) => (
              <TreeNode key={div.id} item={div} level={level + 1} type="div" parentId={item.id} />
            ))}
          </div>
        )}
        
        {isExpanded && item.departments && (
          <div>
            {item.departments.map((dep: any) => (
              <TreeNode key={dep.id} item={dep} level={level + 1} type="dep" parentId={item.id} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-screen w-full bg-[#0f0f13] text-gray-200 font-sans overflow-hidden">
      {/* Sidebar / Explorer */}
      <div className="w-[320px] flex-shrink-0 flex flex-col border-r border-[#2a2a30] bg-[#16161b]">
        {/* Sidebar Header */}
        <div className="p-4 border-b border-[#2a2a30]">
<h2 className="text-sm font-semibold tracking-wide text-gray-400 uppercase mb-3">Organization</h2>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input 
              type="text" 
              placeholder="Filter tree..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#0f0f13] border border-[#2a2a30] rounded-md py-1.5 pl-9 pr-3 text-sm focus:outline-none focus:border-[#22c55e] transition-colors"
            />
          </div>
        </div>

        {/* Tree Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar pb-10">
          <div className="py-2">
            <div className="px-3 py-1 flex items-center justify-between group">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Hierarchy</span>
              <button className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#2a2a30] rounded">
                <Plus className="w-3.5 h-3.5 text-gray-400" />
              </button>
            </div>
            {data.businessUnits.map(bu => (
              <TreeNode key={bu.id} item={bu} type="bu" />
            ))}
          </div>
          
          <div className="mt-4 py-2 border-t border-[#2a2a30]/50">
            <div className="px-3 py-1 flex items-center justify-between group">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Talent Structure</span>
              <button className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#2a2a30] rounded">
                <Plus className="w-3.5 h-3.5 text-gray-400" />
              </button>
            </div>
            
            <div className="mt-1">
              <div 
                className="flex items-center py-1.5 px-2 hover:bg-[#2a2a30] cursor-pointer text-sm"
                onClick={(e) => toggleNode('roles-root', e)}
              >
                <div className="flex items-center w-5 h-5 mr-1">
                  {expandedNodes.has('roles-root') ? 
                    <ChevronDown className="w-4 h-4 text-gray-400" /> : 
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  }
                </div>
                <Users className="w-4 h-4 mr-2 opacity-50" />
                <span className="flex-1">Roles</span>
                <Badge variant="secondary" className="bg-[#2a2a30] text-gray-400 hover:bg-[#2a2a30] text-[10px] px-1.5 py-0">
                  {data.roles.length}
                </Badge>
              </div>
              
              {expandedNodes.has('roles-root') && data.roles.map(role => (
                <TreeNode key={role.id} item={role} level={1} type="role" />
              ))}
            </div>

            <div className="mt-1">
              <div 
                className="flex items-center py-1.5 px-2 hover:bg-[#2a2a30] cursor-pointer text-sm"
                onClick={(e) => toggleNode('jt-root', e)}
              >
                <div className="flex items-center w-5 h-5 mr-1">
                  {expandedNodes.has('jt-root') ? 
                    <ChevronDown className="w-4 h-4 text-gray-400" /> : 
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  }
                </div>
                <Briefcase className="w-4 h-4 mr-2 opacity-50" />
                <span className="flex-1">Job Titles</span>
                <Badge variant="secondary" className="bg-[#2a2a30] text-gray-400 hover:bg-[#2a2a30] text-[10px] px-1.5 py-0">
                  {data.jobTitles.length}
                </Badge>
              </div>
              
              {expandedNodes.has('jt-root') && data.jobTitles.map(jt => (
                <TreeNode key={jt.id} item={jt} level={1} type="jobTitle" />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#0f0f13]">
        {selectedItem ? (
          <div className="max-w-3xl w-full mx-auto p-8 flex flex-col h-full animate-in fade-in duration-200">
            <div className="flex items-center justify-between mb-8">
              <div className="flex flex-col">
                <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                  <span className="uppercase tracking-wider font-semibold">
                    {selectedItem.type === 'bu' ? 'Business Unit' : 
                     selectedItem.type === 'div' ? 'Division' : 
                     selectedItem.type === 'dep' ? 'Department' : 
                     selectedItem.type === 'role' ? 'Role' : 'Job Title'}
                  </span>
                  <span className="text-[#2a2a30]">•</span>
                  <span className="font-mono text-xs text-gray-600">{selectedItem.id}</span>
                </div>
                <h1 className="text-3xl font-light text-white tracking-tight">
                  {selectedItem.name}
                </h1>
              </div>
              
              <div className="flex items-center gap-2">
                {!isEditing ? (
                  <>
                    <Button variant="outline" size="sm" onClick={handleEdit} className="bg-transparent border-[#2a2a30] hover:bg-[#2a2a30] hover:text-white text-gray-300">
                      <Edit2 className="w-4 h-4 mr-2" />
                      Edit
                    </Button>
                    <Button variant="ghost" size="icon" onClick={handleDelete} className="text-red-400 hover:text-red-300 hover:bg-red-400/10">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)} className="text-gray-400 hover:text-white">
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleSave} className="bg-[#22c55e] hover:bg-[#1ea34d] text-white">
                      <Save className="w-4 h-4 mr-2" />
                      Save Changes
                    </Button>
                  </>
                )}
              </div>
            </div>

            <div className="flex-1">
              <div className="bg-[#16161b] border border-[#2a2a30] rounded-xl p-6 shadow-xl">
                <div className="grid gap-6 max-w-xl">
                  <div className="grid gap-2">
                    <Label htmlFor="name" className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Name</Label>
                    {isEditing ? (
                      <Input 
                        id="name" 
                        value={editForm.name || ''} 
                        onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                        className="bg-[#0f0f13] border-[#2a2a30] focus-visible:ring-[#22c55e] text-white font-medium"
                      />
                    ) : (
                      <div className="py-2 text-white font-medium">{selectedItem.name}</div>
                    )}
                  </div>

                  {selectedItem.parentId && (
                    <div className="grid gap-2">
                      <Label className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Parent Link</Label>
                      {isEditing ? (
                        <select 
                          className="flex h-10 w-full rounded-md border border-[#2a2a30] bg-[#0f0f13] px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#22c55e] focus:ring-offset-2 focus:ring-offset-[#0f0f13] disabled:cursor-not-allowed disabled:opacity-50 text-white"
                          value={editForm.parentId}
                          onChange={(e) => setEditForm({...editForm, parentId: e.target.value})}
                        >
                          <option value={selectedItem.parentId}>Keep Current Parent</option>
                          {/* In a real app, populate this with valid parents */}
                        </select>
                      ) : (
                        <div className="py-2 text-gray-300 flex items-center">
                          <Badge variant="outline" className="border-[#2a2a30] bg-[#1a1a1f] text-gray-300 font-normal">
                            ID: {selectedItem.parentId}
                          </Badge>
                        </div>
                      )}
                    </div>
                  )}

                  {selectedItem.type === 'jobTitle' && (
                    <div className="grid gap-2">
                      <Label className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Mapped Role</Label>
                      {isEditing ? (
                        <select 
                          className="flex h-10 w-full rounded-md border border-[#2a2a30] bg-[#0f0f13] px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#22c55e] focus:ring-offset-2 focus:ring-offset-[#0f0f13] text-white"
                          value={editForm.roleId || ''}
                          onChange={(e) => setEditForm({...editForm, roleId: e.target.value})}
                        >
                          {data.roles.map(r => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      ) : (
                        <div className="py-2 text-gray-300">
                          {data.roles.find(r => r.id === selectedItem.roleId)?.name || 'Unmapped'}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {!isEditing && selectedItem.type !== 'jobTitle' && selectedItem.type !== 'role' && (
                    <div className="pt-4 mt-2 border-t border-[#2a2a30]">
                      <h3 className="text-sm font-medium text-gray-300 mb-4">Children Details</h3>
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <div className="flex flex-col bg-[#0f0f13] p-3 rounded-lg border border-[#2a2a30] min-w-[120px]">
                          <span className="text-xs uppercase tracking-wider mb-1">Direct Children</span>
                          <span className="text-xl font-light text-white">
                            {/* Dummy counts for mockup */}
                            {selectedItem.type === 'bu' ? '2' : selectedItem.type === 'div' ? '4' : '0'}
                          </span>
                        </div>
                        <div className="flex flex-col bg-[#0f0f13] p-3 rounded-lg border border-[#2a2a30] min-w-[120px]">
                          <span className="text-xs uppercase tracking-wider mb-1">Total Rollup</span>
                          <span className="text-xl font-light text-[#22c55e]">
                            {selectedItem.type === 'bu' ? '14' : selectedItem.type === 'div' ? '4' : '0'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center p-8 text-gray-500">
            <div className="w-16 h-16 rounded-full bg-[#1a1a1f] flex items-center justify-center mb-4 border border-[#2a2a30]">
              <Building2 className="w-8 h-8 text-gray-600" />
            </div>
            <h2 className="text-lg font-medium text-gray-300 mb-2">No Item Selected</h2>
            <p className="text-sm max-w-sm mx-auto">
Select an organization unit, role, or job title from the tree on the left to view details and edit.
            </p>
          </div>
        )}
      </div>
      
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #2a2a30;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: #3a3a40;
        }
      `}} />
    </div>
  );
}
