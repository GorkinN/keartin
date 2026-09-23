import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm", className)}>
      {title ? <h2 className="text-lg font-semibold">{title}</h2> : null}
      <div className={title ? "mt-4 space-y-4" : "space-y-4"}>{children}</div>
    </section>
  );
}
