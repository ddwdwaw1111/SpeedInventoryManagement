import type { ReactNode } from "react";

export type LineDetailAccordionPanelChip = {
  key: string;
  label: string;
  tone?: "default" | "danger" | "success" | "warning";
};

type LineDetailAccordionPanelProps = {
  title: string;
  helperText?: string;
  chips?: LineDetailAccordionPanelChip[];
  actions?: ReactNode;
  notice?: ReactNode;
  expanded?: boolean;
  collapseContent?: ReactNode;
  footer?: ReactNode;
  className?: string;
  compact?: boolean;
};

function getChipClassName(tone: LineDetailAccordionPanelChip["tone"], compact: boolean) {
  const sizeClassName = compact
    ? "inline-flex !h-7 items-center !rounded-lg !px-2 !text-[11px] !font-semibold"
    : "inline-flex !h-8 items-center !rounded-full px-3 !text-xs !font-semibold";
  switch (tone) {
    case "danger":
      return `${sizeClassName} !border !border-red-200/80 !bg-red-50 !text-red-700`;
    case "success":
      return `${sizeClassName} !border !border-emerald-200/80 !bg-emerald-50 !text-emerald-700`;
    case "warning":
      return `${sizeClassName} !border !border-amber-200/80 !bg-amber-50 !text-amber-800`;
    default:
      return `${sizeClassName} !border !border-slate-200/70 !bg-white/90 !text-slate-600`;
  }
}

export function LineDetailAccordionPanel({
  title,
  helperText,
  chips = [],
  actions,
  notice,
  expanded = false,
  collapseContent,
  footer,
  className = "",
  compact = false
}: LineDetailAccordionPanelProps) {
  return (
    <div
      className={`${className} !overflow-hidden ${compact ? "!rounded-[14px]" : "!rounded-[18px]"} !border-slate-200/80 !bg-[linear-gradient(180deg,#f7f9fc_0%,#ffffff_100%)] !shadow-none`.trim()}
    >
      <div className={compact ? "flex flex-col gap-2 px-3 py-2" : "flex flex-col gap-3 px-3.5 py-3 sm:px-4"}>
        <div className={compact ? "flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between" : "flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between"}>
          <div className={compact ? "min-w-0 space-y-1.5" : "min-w-0 space-y-2"}>
            <div className={compact ? "flex flex-wrap items-center gap-1.5" : "flex flex-wrap items-center gap-2"}>
              <strong className={compact ? "text-[13px] font-semibold text-[#143569]" : "text-sm font-semibold text-[#143569]"}>{title}</strong>
              {helperText ? <span className={compact ? "text-[11px] text-slate-500" : "text-xs text-slate-500"}>{helperText}</span> : null}
            </div>
            {chips.length > 0 ? (
              <div className={compact ? "flex flex-wrap gap-1.5" : "flex flex-wrap gap-2"}>
                {chips.map((chip) => (
                  <span
                    key={chip.key}
                    className={getChipClassName(chip.tone, compact)}
                  >
                    {chip.label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          {actions ? <div className={compact ? "flex flex-wrap items-center gap-1.5" : "flex flex-wrap items-center gap-2"}>{actions}</div> : null}
        </div>

        {notice}

        {collapseContent ? (
          expanded ? <div>{collapseContent}</div> : null
        ) : null}

        {footer}
      </div>
    </div>
  );
}
