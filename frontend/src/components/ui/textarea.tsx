import * as React from "react";
import { cn } from "@/lib/utils";
import { fieldClass } from "@/components/ui/input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return <textarea className={cn(fieldClass, "min-h-24 resize-y", className)} ref={ref} {...props} />;
  },
);
Textarea.displayName = "Textarea";
