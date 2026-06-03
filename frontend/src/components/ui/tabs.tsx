import type { ButtonHTMLAttributes, HTMLAttributes } from "react";

import { cn } from "../../lib/utils";

export function TabsList({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("inline-flex h-10 items-center justify-center rounded-md bg-slate-100 p-1 text-slate-500", className)}
      role="tablist"
      {...props}
    />
  );
}

type TabsTriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
};

export function TabsTrigger({ className, active = false, ...props }: TabsTriggerProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded px-3 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950/10 disabled:pointer-events-none disabled:opacity-50",
        active ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-950",
        className
      )}
      role="tab"
      aria-selected={active}
      type="button"
      {...props}
    />
  );
}
