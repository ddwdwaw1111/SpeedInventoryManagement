import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import { Button, Chip } from "@mui/material";
import { type KeyboardEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

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
  selectPalletLabel?: string;
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
  fillRemainingLabel?: string;
  fullPalletLabel?: string;
  clearLabel?: string;
  repeatLastPickQtyLabel?: string;
  increaseQtyLabel?: string;
  decreaseQtyLabel?: string;
  maxHintLabel?: string;
  searchShortcutHint?: string;
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
  selectPalletLabel = "Select Pallet",
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
  fillRemainingLabel = "Fill Remaining",
  fullPalletLabel = "Full Pallet",
  clearLabel = "Clear",
  repeatLastPickQtyLabel = "Repeat Last",
  increaseQtyLabel = "Increase Qty",
  decreaseQtyLabel = "Decrease Qty",
  maxHintLabel = "Max",
  searchShortcutHint = "Press / to search",
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
  const [lastPickedQty, setLastPickedQty] = useState(0);
  const [recentlyUpdatedRowId, setRecentlyUpdatedRowId] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const normalizedSearch = deferredSearchTerm.trim().toLowerCase();

  useEffect(() => () => {
    if (highlightTimeoutRef.current) {
      window.clearTimeout(highlightTimeoutRef.current);
    }
  }, []);

  function handleAllocatedQtyUpdate(rowId: string, quantity: number) {
    if (!onAllocatedQtyChange) {
      return;
    }
    if (quantity > 0) {
      setLastPickedQty(quantity);
    }
    setRecentlyUpdatedRowId(rowId);
    if (highlightTimeoutRef.current) {
      window.clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = window.setTimeout(() => {
      setRecentlyUpdatedRowId((current) => current === rowId ? null : current);
      highlightTimeoutRef.current = null;
    }, 1400);
    onAllocatedQtyChange(rowId, quantity);
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!editable || inputDisabled || event.key !== "/") {
      return;
    }

    const target = event.target;
    if (
      (target instanceof HTMLInputElement && ["text", "search", "number", "email", "tel", "url", "password", "date"].includes(target.type))
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
      || (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }

    event.preventDefault();
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }

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
        <div className="space-y-3 pt-0.5" onKeyDownCapture={handlePanelKeyDown}>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { key: "selected", label: selectedQtyLabel, value: selectedQtyValue, tone: "text-emerald-700" },
              { key: "required", label: requiredQtyLabel, value: requiredQtyValue, tone: "text-[#143569]" },
              { key: "remaining", label: remainingQtyLabel, value: remainingQtyValue, tone: remainingQtyValue > 0 ? "text-amber-700" : "text-slate-700" }
            ].map((stat) => (
              <div
                key={stat.key}
                className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-3 py-3"
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{stat.label}</div>
                <div className={`mt-1 text-lg font-extrabold ${stat.tone}`}>{stat.value}</div>
              </div>
            ))}
          </div>

          {editable ? (
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              <span className="flex items-center justify-between gap-3">
                <span>{searchLabel}</span>
                <span className="text-[10px] font-medium normal-case tracking-normal text-slate-400">{searchShortcutHint}</span>
              </span>
              <input
                ref={searchInputRef}
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
                  (() => {
                    const rowIdentity = row.palletCode || row.containerNo || row.locationLabel;
                    const isSelected = row.allocatedQty > 0;
                    const remainingQtyForRow = Math.max(0, requiredQtyValue - (selectedQtyValue - row.allocatedQty));
                    const maxEditableQty = typeof row.availableQty === "number"
                      ? Math.min(row.availableQty, remainingQtyForRow)
                      : remainingQtyForRow;
                    const canSelectRow = isSelected || maxEditableQty > 0;

                    return (
                      <div
                        key={row.id}
                        className={`grid gap-2 rounded-2xl border px-3 py-3 transition ${
                          recentlyUpdatedRowId === row.id
                            ? "border-emerald-300 bg-emerald-50/70 shadow-[0_0_0_1px_rgba(16,185,129,0.18)]"
                            : "border-slate-200/80 bg-white/95"
                        }`}
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
                              {typeof row.availableQty === "number" ? <span>{`${availableQtyLabel}: ${row.availableQty} ${unitLabel}`}</span> : null}
                            </div>
                          </div>
                          <div className="text-right">
                              {editable && onAllocatedQtyChange ? (
                              <div className="flex flex-col items-end gap-2">
                                <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    disabled={inputDisabled || !canSelectRow}
                                    aria-label={`${selectPalletLabel}: ${rowIdentity}`}
                                    onChange={(event) => handleAllocatedQtyUpdate(row.id, event.target.checked ? maxEditableQty : 0)}
                                    className="h-4 w-4 rounded border-slate-300 text-[#143569] focus:ring-[#143569]"
                                  />
                                  <span>{selectPalletLabel}</span>
                                </label>
                                <div>
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{pickQtyLabel}</div>
                                  <div className="flex items-center justify-end gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleAllocatedQtyUpdate(row.id, Math.max(0, row.allocatedQty - 1))}
                                      disabled={inputDisabled || !isSelected || row.allocatedQty <= 0}
                                      aria-label={`${decreaseQtyLabel}: ${rowIdentity}`}
                                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200/80 bg-white text-base font-bold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      -
                                    </button>
                                    <input
                                      type="number"
                                      min="0"
                                      max={maxEditableQty > 0 ? maxEditableQty : undefined}
                                      value={row.allocatedQty === 0 ? "" : String(row.allocatedQty)}
                                      aria-label={`${pickQtyLabel}: ${rowIdentity}`}
                                      onChange={(event) => handleAllocatedQtyUpdate(
                                        row.id,
                                        Math.min(maxEditableQty, Math.max(0, Number(event.target.value || 0)))
                                      )}
                                      disabled={inputDisabled || !isSelected}
                                      className="w-24 rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2 text-right text-sm font-semibold text-[#143569] outline-none transition focus:border-[#143569]/40 focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleAllocatedQtyUpdate(row.id, Math.min(maxEditableQty, row.allocatedQty + 1))}
                                      disabled={inputDisabled || !canSelectRow || row.allocatedQty >= maxEditableQty}
                                      aria-label={`${increaseQtyLabel}: ${rowIdentity}`}
                                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200/80 bg-white text-base font-bold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      +
                                    </button>
                                  </div>
                                  <div className="mt-1 text-right text-[11px] font-medium text-slate-500">
                                    {`${maxHintLabel} ${maxEditableQty}`}
                                  </div>
                                </div>
                                <div className="flex flex-wrap justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleAllocatedQtyUpdate(row.id, maxEditableQty)}
                                    disabled={inputDisabled || !canSelectRow || maxEditableQty <= 0 || row.allocatedQty === maxEditableQty}
                                    className="rounded-full border border-slate-200/80 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {fillRemainingLabel}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleAllocatedQtyUpdate(row.id, row.availableQty ?? 0)}
                                    disabled={
                                      inputDisabled
                                      || typeof row.availableQty !== "number"
                                      || row.availableQty <= 0
                                      || row.availableQty > remainingQtyForRow
                                      || row.allocatedQty === row.availableQty
                                    }
                                    className="rounded-full border border-slate-200/80 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {fullPalletLabel}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleAllocatedQtyUpdate(row.id, 0)}
                                    disabled={inputDisabled || !isSelected}
                                    className="rounded-full border border-slate-200/80 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {clearLabel}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleAllocatedQtyUpdate(row.id, Math.min(maxEditableQty, lastPickedQty))}
                                    disabled={inputDisabled || !canSelectRow || lastPickedQty <= 0 || Math.min(maxEditableQty, lastPickedQty) <= 0 || row.allocatedQty === Math.min(maxEditableQty, lastPickedQty)}
                                    className="rounded-full border border-slate-200/80 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {repeatLastPickQtyLabel}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{pickQtyLabel}</div>
                                <div className="text-sm font-semibold text-[#143569]">{row.allocatedQty} {unitLabel}</div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()
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
