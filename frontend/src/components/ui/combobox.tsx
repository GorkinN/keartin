import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";

export type ComboboxOption = {
  id: string;
  label: string;
  value: string;
};

export function Combobox({
  id,
  value,
  onValueChange,
  options,
  placeholder,
  emptyLabel = "Шаблонов пока нет",
  listLabel = "Открыть список",
  maxLength,
}: {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  emptyLabel?: string;
  listLabel?: string;
  maxLength?: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="none"
        className="pr-9"
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      />
      <button
        type="button"
        aria-label={listLabel}
        aria-expanded={open}
        aria-controls={listId}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronDown className="h-4 w-4 opacity-60" />
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {options.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">{emptyLabel}</li>
          ) : (
            options.map((option) => {
              const selected = option.value === value;
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className="relative flex w-full cursor-pointer items-center rounded-sm py-1.5 pl-8 pr-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
                    onClick={() => {
                      onValueChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                      {selected ? <Check className="h-4 w-4" /> : null}
                    </span>
                    {option.label}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
