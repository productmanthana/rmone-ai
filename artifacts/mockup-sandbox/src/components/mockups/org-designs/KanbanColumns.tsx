import React, { useState } from 'react';
import { Plus, MoreVertical, Pencil, Trash2, ChevronRight, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

type EntityType = 'bu' | 'div' | 'dept' | 'role' | 'job';

interface Entity {
  id: string;
  name: string;
  parentId?: string | null;
  type: EntityType;
}

const INITIAL_DATA: Entity[] = [
  // Business Units
  { id: 'bu1', name: 'Engineering', type: 'bu' },
  { id: 'bu2', name: 'Construction', type: 'bu' },
  { id: 'bu3', name: 'Corporate Services', type: 'bu' },
  
  // Divisions
  { id: 'div1', name: 'Civil', parentId: 'bu1', type: 'div' },
  { id: 'div2', name: 'Structural', parentId: 'bu1', type: 'div' },
  { id: 'div3', name: 'MEP', parentId: 'bu1', type: 'div' },
  { id: 'div4', name: 'Architecture', parentId: 'bu2', type: 'div' },
  
  // Departments
  { id: 'dept1', name: 'Site Works', parentId: 'div1', type: 'dept' },
  { id: 'dept2', name: 'Estimating', parentId: 'div1', type: 'dept' },
  { id: 'dept3', name: 'BIM', parentId: 'div3', type: 'dept' },
  { id: 'dept4', name: 'Design Management', parentId: 'div4', type: 'dept' },
  
  // Roles
  { id: 'role1', name: 'Project Manager', type: 'role' },
  { id: 'role2', name: 'Site Engineer', type: 'role' },
  { id: 'role3', name: 'Quantity Surveyor', type: 'role' },
  { id: 'role4', name: 'BIM Coordinator', type: 'role' },
  { id: 'role5', name: 'Director', type: 'role' },
  
  // Job Titles
  { id: 'job1', name: 'Graduate Engineer', parentId: 'role2', type: 'job' },
  { id: 'job2', name: 'Senior PM', parentId: 'role1', type: 'job' },
  { id: 'job3', name: 'Principal Consultant', parentId: 'role5', type: 'job' },
  { id: 'job4', name: 'Associate Director', parentId: 'role5', type: 'job' },
];

export function KanbanColumns() {
  const [entities, setEntities] = useState<Entity[]>(INITIAL_DATA);
  const [selectedBU, setSelectedBU] = useState<string | null>(null);
  const [selectedDiv, setSelectedDiv] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);

  const [addingType, setAddingType] = useState<EntityType | null>(null);
  const [addingName, setAddingName] = useState('');
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const handleAdd = (type: EntityType) => {
    if (!addingName.trim()) return;
    
    let parentId = null;
    if (type === 'div') parentId = selectedBU;
    if (type === 'dept') parentId = selectedDiv;
    if (type === 'job') parentId = selectedRole;

    const newEntity: Entity = {
      id: `${type}_${Date.now()}`,
      name: addingName,
      type,
      parentId
    };

    setEntities([...entities, newEntity]);
    setAddingType(null);
    setAddingName('');
  };

  const handleEdit = (id: string) => {
    if (!editingName.trim()) return;
    setEntities(entities.map(e => e.id === id ? { ...e, name: editingName } : e));
    setEditingId(null);
    setEditingName('');
  };

  const handleDelete = (id: string) => {
    // Delete entity and its children recursively
    const toDelete = new Set<string>([id]);
    let added = true;
    while (added) {
      added = false;
      for (const e of entities) {
        if (e.parentId && toDelete.has(e.parentId) && !toDelete.has(e.id)) {
          toDelete.add(e.id);
          added = true;
        }
      }
    }
    setEntities(entities.filter(e => !toDelete.has(e.id)));
    if (toDelete.has(selectedBU || '')) setSelectedBU(null);
    if (toDelete.has(selectedDiv || '')) setSelectedDiv(null);
    if (toDelete.has(selectedRole || '')) setSelectedRole(null);
  };

  const getFilteredEntities = (type: EntityType) => {
    return entities.filter(e => {
      if (e.type !== type) return false;
      if (type === 'div' && selectedBU) return e.parentId === selectedBU;
      if (type === 'dept' && selectedDiv) return e.parentId === selectedDiv;
      if (type === 'job' && selectedRole) return e.parentId === selectedRole;
      return true;
    });
  };

  const Column = ({ 
    title, 
    type, 
    items, 
    selectedId, 
    onSelect,
    accentColor
  }: { 
    title: string; 
    type: EntityType; 
    items: Entity[];
    selectedId?: string | null;
    onSelect?: (id: string | null) => void;
    accentColor: string;
  }) => {
    const isAdding = addingType === type;
    
    // Check if column is effectively disabled (requires parent selection but none selected)
    const isDisabled = (type === 'div' && !selectedBU) || 
                       (type === 'dept' && !selectedDiv) || 
                       (type === 'job' && !selectedRole);

    return (
      <div className="flex flex-col h-full w-full min-w-[280px] max-w-[320px] shrink-0 bg-[#16161c] border border-white/5 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-white/5 flex items-center justify-between" style={{ borderTop: `3px solid ${accentColor}` }}>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-white tracking-tight">{title}</h3>
            <span className="text-xs font-medium bg-white/10 text-white/70 px-2 py-0.5 rounded-full">
              {items.length}
            </span>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 text-white/50 hover:text-white hover:bg-white/10"
            onClick={() => {
              setAddingType(type);
              setAddingName('');
            }}
            disabled={isDisabled}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2 relative no-scrollbar">
          {isDisabled && (
            <div className="absolute inset-0 z-10 bg-[#16161c]/60 backdrop-blur-[1px] flex items-center justify-center">
              <p className="text-xs font-medium text-white/40 text-center px-6">
                Select a parent item to view {title.toLowerCase()}
              </p>
            </div>
          )}

          {isAdding && (
            <div className="bg-[#1e1e26] border border-[#22c55e]/50 rounded-lg p-3 shadow-lg mb-4">
              <Input
                autoFocus
                className="h-8 bg-black/40 border-white/10 text-white text-sm mb-2"
                placeholder={`New ${title}...`}
                value={addingName}
                onChange={e => setAddingName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAdd(type);
                  if (e.key === 'Escape') setAddingType(null);
                }}
              />
              <div className="flex justify-end gap-1">
                <Button size="icon" variant="ghost" className="h-6 w-6 text-white/50" onClick={() => setAddingType(null)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" className="h-6 w-6 bg-[#22c55e] hover:bg-[#22c55e]/80 text-black" onClick={() => handleAdd(type)}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {items.map(item => {
            const isSelected = selectedId === item.id;
            const isEditing = editingId === item.id;

            return (
              <div 
                key={item.id}
                className={cn(
                  "group flex flex-col justify-center min-h-[64px] bg-[#1e1e26] border rounded-lg px-3 py-2 cursor-pointer transition-all duration-200 relative overflow-hidden",
                  isSelected 
                    ? "border-[#22c55e] shadow-[0_0_15px_rgba(34,197,94,0.15)] ring-1 ring-[#22c55e]/50" 
                    : "border-white/5 hover:border-white/20 hover:bg-[#22222d]"
                )}
                onClick={() => {
                  if (isEditing) return;
                  if (onSelect) onSelect(isSelected ? null : item.id);
                }}
              >
                {isSelected && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#22c55e]" />
                )}

                {isEditing ? (
                  <div className="flex items-center gap-2 w-full z-10">
                    <Input
                      autoFocus
                      className="h-8 bg-black/40 border-[#22c55e]/50 text-white text-sm flex-1"
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleEdit(item.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onClick={e => e.stopPropagation()}
                    />
                    <Button 
                      size="icon" 
                      className="h-7 w-7 shrink-0 bg-[#22c55e] hover:bg-[#22c55e]/80 text-black"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit(item.id);
                      }}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between w-full z-10">
                    <span className={cn(
                      "font-medium text-sm truncate pr-2",
                      isSelected ? "text-white" : "text-white/80 group-hover:text-white"
                    )}>
                      {item.name}
                    </span>
                    
                    <div className="flex items-center">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-white/50 hover:text-white hover:bg-white/10 data-[state=open]:opacity-100"
                            onClick={e => e.stopPropagation()}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36 bg-[#1e1e26] border-white/10 text-white">
                          <DropdownMenuItem 
                            className="hover:bg-white/10 focus:bg-white/10 cursor-pointer text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingId(item.id);
                              setEditingName(item.name);
                            }}
                          >
                            <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            className="hover:bg-red-500/20 focus:bg-red-500/20 text-red-400 focus:text-red-400 cursor-pointer text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(item.id);
                            }}
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      
                      {onSelect && (
                        <ChevronRight className={cn(
                          "h-4 w-4 shrink-0 transition-transform duration-200 ml-1",
                          isSelected ? "text-[#22c55e]" : "text-white/20 group-hover:text-white/50"
                        )} />
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          
          {items.length === 0 && !isAdding && !isDisabled && (
            <div className="flex flex-col items-center justify-center py-8 px-4 text-center border border-dashed border-white/10 rounded-lg">
              <p className="text-sm text-white/40 mb-3">No {title.toLowerCase()} configured</p>
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8 text-xs border-white/10 bg-transparent text-white/70 hover:bg-white/5 hover:text-white"
                onClick={() => {
                  setAddingType(type);
                  setAddingName('');
                }}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Add First
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#0f0f13] flex flex-col text-white font-sans overflow-hidden">
      {/* Header */}
      <header className="h-16 shrink-0 border-b border-white/10 flex items-center px-6 justify-between bg-[#16161c]/50">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-white flex items-center gap-3">
            <div className="h-6 w-6 rounded-md bg-[#22c55e]/20 flex items-center justify-center border border-[#22c55e]/50">
              <div className="h-2 w-2 rounded-sm bg-[#22c55e]" />
            </div>
Organization Structure
          </h1>
          <p className="text-xs text-white/50 font-medium">Configure hierarchical and talent structures</p>
        </div>
      </header>

      {/* Main Content - Horizontal Scroll */}
      <main className="flex-1 overflow-x-auto overflow-y-hidden p-6">
        <div className="flex gap-6 h-full min-w-max pb-4">
          
          {/* Hierarchy Group */}
          <div className="flex gap-6 relative">
            <div className="absolute -top-4 left-0 text-[10px] font-bold uppercase tracking-wider text-white/30 flex items-center gap-2">
              <div className="h-px w-4 bg-white/20" />
              Hierarchy
              <div className="h-px w-64 bg-white/20" />
            </div>
            
            <Column 
              title="Business Units" 
              type="bu" 
              items={getFilteredEntities('bu')} 
              selectedId={selectedBU}
              onSelect={setSelectedBU}
              accentColor="#3b82f6" // Blue
            />
            
            <Column 
              title="Divisions" 
              type="div" 
              items={getFilteredEntities('div')} 
              selectedId={selectedDiv}
              onSelect={setSelectedDiv}
              accentColor="#8b5cf6" // Indigo/Blue
            />
            
            <Column 
              title="Departments" 
              type="dept" 
              items={getFilteredEntities('dept')} 
              accentColor="#a855f7" // Purple
            />
          </div>

          <div className="w-px bg-white/5 mx-2 my-8 shrink-0 self-stretch rounded-full relative">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-[#0f0f13] border border-white/10 flex items-center justify-center">
              <div className="w-1 h-1 rounded-full bg-white/20" />
            </div>
          </div>

          {/* Talent Group */}
          <div className="flex gap-6 relative">
            <div className="absolute -top-4 left-0 text-[10px] font-bold uppercase tracking-wider text-[#22c55e]/40 flex items-center gap-2">
              <div className="h-px w-4 bg-[#22c55e]/20" />
              Talent
              <div className="h-px w-32 bg-[#22c55e]/20" />
            </div>

            <Column 
              title="Roles" 
              type="role" 
              items={getFilteredEntities('role')} 
              selectedId={selectedRole}
              onSelect={setSelectedRole}
              accentColor="#10b981" // Emerald
            />
            
            <Column 
              title="Job Titles" 
              type="job" 
              items={getFilteredEntities('job')} 
              accentColor="#22c55e" // Green
            />
          </div>
          
        </div>
      </main>
    </div>
  );
}
