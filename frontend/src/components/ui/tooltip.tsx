import { CircleHelp } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

type InfoTooltipProps = {
  content: ReactNode;
  label?: string;
  className?: string;
  focusable?: boolean;
};

export function InfoTooltip({
  content,
  label = "More information",
  className,
  focusable = true
}: InfoTooltipProps) {
  return (
    <span
      className={cn("group relative inline-flex rounded-full align-middle outline-none focus-visible:ring-2 focus-visible:ring-slate-950/15", className)}
      tabIndex={focusable ? 0 : undefined}
      aria-label={label}
    >
      <CircleHelp className="h-4 w-4 text-slate-400 transition group-hover:text-slate-700 group-focus:text-slate-700" aria-hidden="true" />
      <span
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 hidden w-64 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-xs font-medium leading-5 text-slate-600 shadow-lg group-hover:block group-focus:block"
        role="tooltip"
      >
        {content}
      </span>
    </span>
  );
}
