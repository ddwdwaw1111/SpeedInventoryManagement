import type { ReactNode } from "react";
import { Chip, Collapse, Paper } from "@mui/material";

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
};

function getChipClassName(tone: LineDetailAccordionPanelChip["tone"]) {
  switch (tone) {
    case "danger":
      return "!h-8 !rounded-full !border !border-red-200/80 !bg-red-50 !text-xs !font-semibold !text-red-700";
    case "success":
      return "!h-8 !rounded-full !border !border-emerald-200/80 !bg-emerald-50 !text-xs !font-semibold !text-emerald-700";
    case "warning":
      return "!h-8 !rounded-full !border !border-amber-200/80 !bg-amber-50 !text-xs !font-semibold !text-amber-800";
    default:
      return "!h-8 !rounded-full !border !border-slate-200/70 !bg-white/90 !text-xs !font-semibold !text-slate-600";
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
  className = ""
}: LineDetailAccordionPanelProps) {
  return (
    <Paper
      variant="outlined"
      className={`${className} !overflow-hidden !rounded-[18px] !border-slate-200/80 !bg-[linear-gradient(180deg,#f7f9fc_0%,#ffffff_100%)] !shadow-none`.trim()}
    >
      <div className="flex flex-col gap-3 px-3.5 py-3 sm:px-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-sm font-semibold text-[#143569]">{title}</strong>
              {helperText ? <span className="text-xs text-slate-500">{helperText}</span> : null}
            </div>
            {chips.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {chips.map((chip) => (
                  <Chip
                    key={chip.key}
                    size="small"
                    label={chip.label}
                    className={getChipClassName(chip.tone)}
                  />
                ))}
              </div>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>

        {notice}

        {collapseContent ? (
          <Collapse in={expanded} mountOnEnter unmountOnExit>
            {collapseContent}
          </Collapse>
        ) : null}

        {footer}
      </div>
    </Paper>
  );
}