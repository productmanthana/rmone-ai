import React, { useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export type CreatableOption = { id: string; label: string };

const ADD_SENTINEL = "__creatable_add_new__";

/**
 * A shadcn Select that also lets the user add a brand-new option inline.
 * The list itself ends with an "+ Add new …" entry; choosing it reveals a small
 * text field. On save it calls `onCreate`, selects the returned id, and keeps it
 * visible locally until the parent's list query catches up. `onCreate` should
 * perform the API call AND any cache invalidation (it returns the created/existing
 * {id,label}).
 */
export function CreatableSelect({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  loading,
  onCreate,
  addLabel = "Add new",
  newPlaceholder = "New name",
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: CreatableOption[];
  placeholder: string;
  disabled?: boolean;
  loading?: boolean;
  onCreate: (name: string) => Promise<CreatableOption>;
  addLabel?: string;
  newPlaceholder?: string;
}) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  // Locally-created options that may not yet be in `options` (parent query
  // refetch is async) so the new selection renders a label immediately.
  const [extras, setExtras] = useState<CreatableOption[]>([]);

  const merged = useMemo(() => {
    const seen = new Set(options.map((o) => o.id));
    return [...options, ...extras.filter((e) => !seen.has(e.id))];
  }, [options, extras]);

  const reset = () => { setAdding(false); setName(""); };

  const save = async () => {
    const clean = name.trim();
    if (!clean) return;
    setBusy(true);
    try {
      const created = await onCreate(clean);
      setExtras((prev) => (prev.some((e) => e.id === created.id) ? prev : [...prev, created]));
      onValueChange(created.id);
      reset();
    } catch (e) {
      toast({ title: "Couldn't add", description: (e as Error)?.message || "Failed to add.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-10 w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground opacity-70 cursor-not-allowed">
        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
        <span>Loading options…</span>
      </div>
    );
  }

  if (adding) {
    return (
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          value={name}
          placeholder={newPlaceholder}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void save(); }
            if (e.key === "Escape") { e.preventDefault(); reset(); }
          }}
        />
        <Button type="button" size="icon" onClick={() => void save()} disabled={busy || !name.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </Button>
        <Button type="button" size="icon" variant="outline" onClick={reset} disabled={busy}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v === ADD_SENTINEL) { setAdding(true); return; }
        // Radix controlled Select can emit an empty-string change in a
        // transient mount-race frame (selected item not rendered yet) or on
        // native <form> reset — silently wiping prefilled values. No
        // SelectItem here can carry value="" (Radix throws), so an empty
        // fire is NEVER a real user action: swallow it.
        if (!v) return;
        onValueChange(v);
      }}
      disabled={disabled}
    >
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {merged.map((o) => (
          <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
        ))}
        {merged.length > 0 && <SelectSeparator />}
        <SelectItem value={ADD_SENTINEL} className="text-primary font-medium">
          <span className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            {addLabel}
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
