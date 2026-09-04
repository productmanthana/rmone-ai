// CompanySearchSelect — the ONE way to set a company on create/edit forms.
//
// Mandatory-ID policy (Aug 2026): free-typed company names are no longer
// accepted by the server (strict rewriteCompanyContactFields 400s them), so
// every form binds a company through this picker instead. The selection value
// is the numeric CRMCompany.ID as a string — exactly what the payload sends
// as CRMCompanyLookup. Blank stays legal: records without a company are fine.
//
// "+ Create new company…" opens CompanyCreateModal seeded with the search
// text; a duplicate name/ID resolves to "use existing" inside the modal, so
// the picker can never mint case-variant duplicates.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Building2, Check, ChevronsUpDown, Loader2, Plus, X } from "lucide-react";
import { getCompaniesList, type CompanySlim } from "@/lib/api";
import { CompanyCreateModal } from "./CompanyCreateModal";

export function CompanySearchSelect({
  value, onChange, disabled, placeholder = "Select company…", hintName, allowClear = true,
}: {
  /** Numeric CRMCompany.ID as a string; "" = no company. */
  value: string;
  /** Fires with ("", "") on clear. */
  onChange: (id: string, label: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Unlinked name carried from a conversion/prefill — shown as a nudge until a company is picked. */
  hintName?: string;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  // Just-created companies that the list query may not have caught up with.
  const [extras, setExtras] = useState<CompanySlim[]>([]);

  const listQ = useQuery({
    queryKey: ["companies-list"],
    queryFn: () => getCompaniesList(),
    staleTime: 60_000,
    retry: 1,
  });

  const options = useMemo(() => {
    const base = listQ.data ?? [];
    const seen = new Set(base.map(o => o.id));
    return [...base, ...extras.filter(e => !seen.has(e.id))];
  }, [listQ.data, extras]);

  const selected = useMemo(
    () => (value ? options.find(o => String(o.id) === value) ?? null : null),
    [options, value],
  );

  const pick = (o: CompanySlim) => {
    onChange(String(o.id), o.title);
    setOpen(false);
    setQuery("");
  };

  const onCreated = (c: CompanySlim) => {
    setExtras(prev => (prev.some(e => e.id === c.id) ? prev : [...prev, c]));
    void listQ.refetch(); // createCompany() already busted the api.ts cache
    pick(c);
  };

  return (
    <>
      <Popover open={open} onOpenChange={(o) => { if (!disabled) { setOpen(o); if (!o) setQuery(""); } }}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            {selected ? (
              <span className="flex items-center gap-2 min-w-0">
                <Building2 className="w-3.5 h-3.5 shrink-0 opacity-60" />
                <span className="truncate">{selected.title}</span>
                {selected.ticketId && (
                  <span className="text-[10px] text-muted-foreground border rounded px-1 py-px shrink-0">{selected.ticketId}</span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
            <span className="flex items-center gap-1 shrink-0">
              {allowClear && selected && !disabled && (
                // Not a nested <button> — Radix triggers render a real button
                // and nested interactive buttons are invalid + break clicks.
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="Clear company"
                  className="rounded p-0.5 hover:bg-muted"
                  onClick={(e) => { e.stopPropagation(); onChange("", ""); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onChange("", ""); } }}
                >
                  <X className="w-3.5 h-3.5 opacity-60" />
                </span>
              )}
              <ChevronsUpDown className="w-4 h-4 opacity-50" />
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[280px]" align="start">
          <Command>
            <CommandInput placeholder="Search by name or Company ID…" value={query} onValueChange={setQuery} />
            <CommandList>
              {listQ.isLoading ? (
                <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading companies…
                </div>
              ) : (
                <>
                  <CommandEmpty>
                    <div className="px-2 py-1 text-sm text-muted-foreground">No matching company.</div>
                  </CommandEmpty>
                  <CommandGroup>
                    {options.map(o => (
                      <CommandItem
                        key={o.id}
                        // Filter text: title + ticket, id suffix keeps duplicates unique.
                        value={`${o.title} ${o.ticketId ?? ""} #${o.id}`}
                        onSelect={() => pick(o)}
                      >
                        <Check className={`w-3.5 h-3.5 mr-2 ${String(o.id) === value ? "opacity-100" : "opacity-0"}`} />
                        <span className="truncate">{o.title}</span>
                        {o.ticketId && <span className="ml-auto pl-2 text-[10px] text-muted-foreground shrink-0">{o.ticketId}</span>}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
            <div className="border-t p-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start h-8 text-xs"
                onClick={() => { setOpen(false); setCreateOpen(true); }}
              >
                <Plus className="w-3.5 h-3.5 mr-1.5" /> Create new company…
              </Button>
            </div>
          </Command>
        </PopoverContent>
      </Popover>

      {hintName && !value && (
        <p className="text-xs text-amber-600 mt-1">
          Came over as “{hintName}” — pick or create that company to keep the link.
        </p>
      )}

      <CompanyCreateModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={onCreated}
        initialName={query.trim() || hintName || ""}
      />
    </>
  );
}
