import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import { Button, Chip } from "@mui/material";

import { LineDetailAccordionPanel } from "./LineDetailAccordionPanel";

type OutboundPickPlanRow = {
  id: string;
  containerNo: string;
  locationLabel: string;
  allocatedQty: number;
  itemNumber?: string;
};

type OutboundPickPlanPanelProps = {
  title: string;
  helperText: string;
  autoPickLabel: string;
  detailsLabel: string;
  skuLabel: string;
  skuValue: string;
  itemNumberLabel: string;
  itemNumberValue?: string;
  locationLabel: string;
  locationValue: string;
  containersLabel: string;
  containerCount: number;
  availableQtyLabel: string;
  availableQtyValue: number;
  requiredQtyLabel: string;
  requiredQtyValue: number;
  selectedQtyLabel: string;
  selectedQtyValue: number;
  remainingQtyLabel: string;
  remainingQtyValue: number;
  sourceContainerLabel: string;
  pickQtyLabel: string;
  unitLabel: string;
  canExpand: boolean;
  expanded: boolean;
  onToggle: () => void;
  emptyHint: string;
  rows: OutboundPickPlanRow[];
  shortageMessage?: string | null;
};

export function OutboundPickPlanPanel({
  title,
  helperText,
  autoPickLabel,
  detailsLabel,
  skuLabel,
  skuValue,
  itemNumberLabel,
  itemNumberValue,
  locationLabel,
  locationValue,
  containersLabel,
  containerCount,
  availableQtyLabel,
  availableQtyValue,
  requiredQtyLabel,
  requiredQtyValue,
  selectedQtyLabel,
  selectedQtyValue,
  remainingQtyLabel,
  remainingQtyValue,
  sourceContainerLabel,
  pickQtyLabel,
  unitLabel,
  canExpand,
  expanded,
  onToggle,
  emptyHint,
  rows,
  shortageMessage
}: OutboundPickPlanPanelProps) {
  return (
    <LineDetailAccordionPanel
      title={title}
      helperText={helperText}
      chips={[
        { key: "sku", label: `${skuLabel}: ${skuValue}` },
        ...(itemNumberValue ? [{ key: "itemNumber", label: `${itemNumberLabel}: ${itemNumberValue}` }] : []),
        { key: "location", label: `${locationLabel}: ${locationValue}` },
        { key: "containers", label: `${containersLabel}: ${containerCount}` },
        { key: "available", label: `${availableQtyLabel}: ${availableQtyValue}` },
        { key: "required", label: `${requiredQtyLabel}: ${requiredQtyValue}` },
        { key: "selected", label: `${selectedQtyLabel}: ${selectedQtyValue}`, tone: "success" },
        { key: "remaining", label: `${remainingQtyLabel}: ${remainingQtyValue}`, tone: remainingQtyValue > 0 ? "danger" : "default" }
      ]}
      actions={(
        <>
          <Chip
            size="small"
            label={autoPickLabel}
            className="!h-8 !rounded-full !border !border-sky-200/80 !bg-sky-50 !text-xs !font-semibold !text-sky-700"
          />
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
      notice={!canExpand
        ? <div className="rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2 text-sm text-slate-500">{emptyHint}</div>
        : null}
      expanded={canExpand && expanded}
      collapseContent={canExpand ? (
        <div className="grid gap-2 pt-0.5 md:grid-cols-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid gap-2 rounded-2xl border border-slate-200/80 bg-white/95 px-3 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-700">
                    {sourceContainerLabel}: <span className="font-mono">{row.containerNo || "-"}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span>{row.locationLabel}</span>
                    {row.itemNumber ? <span className="font-mono">{row.itemNumber}</span> : null}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{pickQtyLabel}</div>
                  <div className="text-sm font-semibold text-[#143569]">{row.allocatedQty} {unitLabel}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      footer={shortageMessage
        ? <div className="rounded-xl border border-amber-200/80 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">{shortageMessage}</div>
        : null}
    />
  );
}