/**
 * PersonSearchSelect — a searchable combobox for picking a person/user.
 *
 * Accepts the same `{ id, name }` shape that `getUsers()` returns.  An
 * optional `extraItem` lets callers inject a synthetic entry that doesn't
 * exist in the server list (e.g. a PM name that came from a linked
 * opportunity and isn't a staff user).
 *
 * Styling mirrors the existing OppSearchSelect in project-create.tsx so
 * the two pickers look identical across the app.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";

export interface PersonOption {
  id: string;
  name: string;
}

export function PersonSearchSelect({
  options,
  value,
  onChange,
  disabled,
  placeholder = "Select…",
  clearable = false,
  extraItem,
}: {
  options: PersonOption[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Allow clearing the selection back to "". */
  clearable?: boolean;
  /** Inject one extra synthetic item that isn't in `options` (e.g. a name
      prefilled from a linked record that isn't a staff user). */
  extraItem?: PersonOption;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 10);
    else setSearch("");
  }, [open]);

  const allOptions = useMemo<PersonOption[]>(() => {
    if (extraItem && !options.some((o) => o.id === extraItem.id)) {
      return [extraItem, ...options];
    }
    return options;
  }, [options, extraItem?.id]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return q ? allOptions.filter((o) => o.name.toLowerCase().includes(q)) : allOptions;
  }, [allOptions, search]);

  const selected = allOptions.find((o) => o.id === value);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className="w-full flex items-center justify-between border border-input rounded-md px-3 py-2 text-sm bg-background hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed text-left"
      >
        <span className={selected ? "truncate flex-1" : "text-muted-foreground truncate flex-1"}>
          {selected ? selected.name : placeholder}
        </span>
        <span className="flex items-center gap-1 shrink-0 ml-2">
          {clearable && value && !disabled && (
            <span
              role="button"
              aria-label="Clear"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onChange(""); } }}
              onClick={(e) => { e.stopPropagation(); onChange(""); }}
              className="text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown className="h-4 w-4 opacity-50" />
        </span>
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 border border-input rounded-md bg-popover shadow-lg overflow-hidden">
          <div className="p-2 border-b border-input">
            <input
              ref={searchRef}
              type="text"
              placeholder="Type a name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-sm px-2 py-1.5 rounded border border-input bg-background outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="max-h-60 overflow-y-auto overscroll-contain">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-sm text-center text-muted-foreground">No results</div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => { onChange(o.id); setOpen(false); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 flex items-center gap-2"
                >
                  <Check className={`h-3.5 w-3.5 shrink-0 ${value === o.id ? "text-primary" : "invisible"}`} />
                  <span className="truncate">{o.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
