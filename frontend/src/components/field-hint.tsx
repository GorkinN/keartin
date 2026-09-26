import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CircleHelp } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function FieldHint({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Подсказка"
          className="inline-flex rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{text}</TooltipContent>
    </Tooltip>
  );
}

export function FieldLabel({
  children,
  hint,
  htmlFor,
  href,
}: {
  children: ReactNode;
  hint: string;
  htmlFor?: string;
  href?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor}>{children}</Label>
      <FieldHint text={hint} />
      {href ? (
        <Link
          to={href}
          className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Настроить
        </Link>
      ) : null}
    </div>
  );
}
