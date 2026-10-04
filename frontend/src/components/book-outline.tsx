import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function BookOutline({ items, className }: { items: string[]; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRight
          className={cn(
            "h-4 w-4 transition-transform duration-300 ease-out motion-reduce:transition-none",
            open && "rotate-90",
          )}
          aria-hidden
        />
        Оглавление
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden" aria-hidden={!open} inert={open ? undefined : true}>
          <ol className="list-decimal space-y-1 pl-5 pt-2 text-sm">
            {items.map((item, index) => (
              <li key={`${index}-${item}`}>
                <Link
                  to={`/create?topic=${encodeURIComponent(item)}`}
                  className="rounded-sm hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {item}
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
