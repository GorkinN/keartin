import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

export function Progress({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const width = Math.min(100, Math.max(0, value));
  return (
    <ProgressPrimitive.Root
      value={width}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <ProgressPrimitive.Indicator
        className="h-full bg-primary transition-all"
        style={{ width: `${width}%` }}
      />
    </ProgressPrimitive.Root>
  );
}
