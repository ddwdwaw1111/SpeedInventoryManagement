import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import { Button } from "@mui/material";

import { LineDetailAccordionPanel } from "./LineDetailAccordionPanel";

type InboundPalletBreakdownRow = {
  id: string;
  label: string;
  quantity: number;
};

type InboundPalletBreakdownPanelProps = {
  title: string;
  helperText?: string;
  skuLabel: string;
  skuValue: string;
  storageSectionLabel: string;
  storageSectionValue: string;
  palletsLabel: string;
  palletCount: number;
  palletsDetailLabel: string;1
  palletsDetailValue: string;
  unitLabel: string;
  detailTone?: "default" | "danger";
  resetLabel: string;
  detailsLabel: string;
  emptyHint: string;
  sealedHint: string;
  resetDisabled: boolean;
  canExpand: boolean;
  expanded: boolean;
  onToggle: () => void;
  onReset: () => void;
  state: "sealed" | "empty" | "ready";
  rows: InboundPalletBreakdownRow[];
  onQuantityChange: (rowId: string, quantity: number) => void;
  inputDisabled?: boolean;
  mismatchMessage?: string | null;
};

export function InboundPalletBreakdownPanel({
  title,
  helperText,
  skuLabel,
  skuValue,
  storageSectionLabel,
  storageSectionValue,
  palletsLabel,
  palletCount,
  palletsDetailLabel,
  palletsDetailValue,
  unitLabel,
  detailTone = "default",
  resetLabel,
  detailsLabel,
  emptyHint,
  sealedHint,
  resetDisabled,
  canExpand,
  expanded,
  onToggle,
  onReset,
  state,
  rows,
  onQuantityChange,
  inputDisabled = false,
  mismatchMessage
}: InboundPalletBreakdownPanelProps) {
  return (
    <LineDetailAccordionPanel
      title={title}
      helperText={helperText}
      className="batch-line-grid__detail"
      chips={[
        { key: "sku", label: `${skuLabel}: ${skuValue}` },
        { key: "section", label: `${storageSectionLabel}: ${storageSectionValue}` },
        { key: "pallets", label: `${palletCount} ${palletsLabel}` },
        {
          key: "detail",
          label: `${palletsDetailLabel}: ${palletsDetailValue} ${unitLabel}`,
          tone: detailTone
        }
      ]}
      actions={(
        <>
          <Button
            size="small"
            variant="text"
            onClick={onReset}
            disabled={resetDisabled}
            className="!min-h-9 !rounded-xl !px-3 !text-[12px] !font-semibold !text-[#143569]"
          >
            {resetLabel}
          </Button>
          {canExpand ? (
            <Button
              size="small"
              variant="outlined"
              onClick={onToggle}
              aria-expanded={expanded}
              endIcon={
                <ExpandMoreOutlinedIcon
                  fontSize="small"
                  className={`transition-transform duration-200 ${expanded ? "rotate-180" : "rotate-0"}`}
                />
              }
              className="!min-h-9 !rounded-xl !border-slate-200/80 !bg-white/90 !px-3 !text-[12px] !font-semibold !text-[#143569] hover:!border-slate-300 hover:!bg-white"
            >
              {detailsLabel}
            </Button>
          ) : null}
        </>
      )}
      notice={state === "sealed"
        ? <div className="rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2 text-sm text-slate-500">{sealedHint}</div>
        : state === "empty"
          ? <div className="rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2 text-sm text-slate-500">{emptyHint}</div>
          : null}
      expanded={state === "ready" && expanded}
      collapseContent={state === "ready" ? (
        <div className="grid gap-2 pt-0.5 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <label
              key={row.id}
              className="grid gap-2 rounded-2xl border border-slate-200/80 bg-white/95 px-3 py-3"
            >
              <span className="text-sm font-semibold text-slate-700">{row.label}</span>
              <span className="flex items-center justify-between gap-3">
                <input
                  type="number"
                  min="0"
                  value={row.quantity === 0 ? "" : String(row.quantity)}
                  onChange={(event) => onQuantityChange(row.id, Math.max(0, Number(event.target.value || 0)))}
                  disabled={inputDisabled}
                  className="w-24 rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#143569]/40 focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                />
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{unitLabel}</span>
              </span>
            </label>
          ))}
        </div>
      ) : null}
      footer={mismatchMessage
        ? <div className="rounded-xl border border-amber-200/80 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">{mismatchMessage}</div>
        : null}
    />
  );
}