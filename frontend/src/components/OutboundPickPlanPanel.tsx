import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import { Button, Chip } from "@mui/material";
import { useDeferredValue, useMemo, useState } from "react";

import { LineDetailAccordionPanel } from "./LineDetailAccordionPanel";

type OutboundPickPlanRow = {
  id: string;
  palletId?: number;
  palletCode?: string;
  containerNo: string;
  locationLabel: string;
  availableQty?: number;
  allocatedQty: number;
  itemNumber?: string;
};

type OutboundPickPlanPanelProps = {
  title: string;
  helperText: string;
  autoPickLabel: string;
  searchLabel: string;
  searchPlaceholder: string;
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
  palletLabel?: string;
  canExpand: boolean;
  expanded: boolean;
  onToggle: () => void;
  emptyHint: string;
  rows: OutboundPickPlanRow[];
  editable?: boolean;
  inputDisabled?: boolean;
  onAllocatedQtyChange?: (rowId: string, quantity: number) => void;
  shortageMessage?: string | null;
};

type OutboundPickPlanGroup = {
  key: string;
  title: string;
  rows: OutboundPickPlanRow[];
};

export function OutboundPickPlanPanel({
  title,
  helperText,
  autoPickLabel,
  searchLabel,
  searchPlaceholder,
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
  palletLabel,
  canExpand,
  expanded,
  onToggle,
  emptyHint,
  rows,
  editable = false,
  inputDisabled = false,
  onAllocatedQtyChange,
  shortageMessage
}: OutboundPickPlanPanelProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const normalizedSearch = deferredSearchTerm.trim().toLowerCase();

  const filteredRows = useMemo(() => rows.filter((row) => {
    if (!normalizedSearch) {
      return true;
    }
    const searchBlob = [
      row.containerNo,
      row.palletCode,
      row.itemNumber,
      row.locationLabel
    ].join(" ").toLowerCase();
    return searchBlob.includes(normalizedSearch);
  }), [normalizedSearch, rows]);

  const groupedRows = useMemo<OutboundPickPlanGroup[]>(() => {
    const groups = new Map<string, OutboundPickPlanGroup>();
    for (const row of filteredRows) {
      const key = `${row.containerNo || "-"}|${row.locationLabel}`;
      const existing = groups.get(key);
      if (existing) {
        existing.rows.push(row);
        continue;
      }

      groups.set(key, {
        key,
        title: `${sourceContainerLabel}: ${row.containerNo || "-"} | ${row.locationLabel}`,
        rows: [row]
      });
    }
    return [...groups.values()];
  }, [filteredRows, sourceContainerLabel]);

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
        <div className="space-y-3 pt-0.5">
          {editable ? (
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              {searchLabel}
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={searchPlaceholder}
                disabled={inputDisabled}
                className="rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-700 outline-none transition focus:border-[#143569]/40"
              />
            </label>
          ) : null}

          {groupedRows.length > 0 ? groupedRows.map((group) => (
            <div key={group.key} className="space-y-2">
              <div className="rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                {group.title}
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {group.rows.map((row) => (
                  <div
                    key={row.id}
                    className="grid gap-2 rounded-2xl border border-slate-200/80 bg-white/95 px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-700">
                          {row.palletCode ? (
                            <span>{palletLabel || "Pallet"}: <span className="font-mono">{row.palletCode}</span></span>
                          ) : (
                            <span>{sourceContainerLabel}: <span className="font-mono">{row.containerNo || "-"}</span></span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                          <span>{row.locationLabel}</span>
                          {row.palletCode ? <span>{sourceContainerLabel}: <span className="font-mono">{row.containerNo || "-"}</span></span> : null}
                          {row.itemNumber ? <span className="font-mono">{row.itemNumber}</span> : null}
                          {typeof row.availableQty === "number" ? <span>{row.availableQty} {unitLabel} available</span> : null}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{pickQtyLabel}</div>
                        {editable && onAllocatedQtyChange ? (
                          <input
                            type="number"
                            min="0"
                            max={typeof row.availableQty === "number" ? row.availableQty : undefined}
                            value={row.allocatedQty === 0 ? "" : String(row.allocatedQty)}
                            onChange={(event) => onAllocatedQtyChange(row.id, Math.max(0, Number(event.target.value || 0)))}
                            disabled={inputDisabled}
                            className="w-24 rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2 text-right text-sm font-semibold text-[#143569] outline-none transition focus:border-[#143569]/40 focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                          />
                        ) : (
                          <div className="text-sm font-semibold text-[#143569]">{row.allocatedQty} {unitLabel}</div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )) : (
            <div className="rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2 text-sm text-slate-500">{emptyHint}</div>
          )}
        </div>
      ) : null}
      footer={shortageMessage
        ? <div className="rounded-xl border border-amber-200/80 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">{shortageMessage}</div>
        : null}
    />
  );
}
