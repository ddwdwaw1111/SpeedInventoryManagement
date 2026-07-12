import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import { Button, Chip } from "@mui/material";
import { type KeyboardEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { LineDetailAccordionPanel } from "./LineDetailAccordionPanel";

type OutboundPickPlanRow = {
  id: string;
  inventoryItemId?: number;
  positionLabel?: string;
  containerNo: string;
  locationLabel: string;
  availableQty?: number;
  allocatedQty: number;
  itemNumber?: string;
};

type OutboundPickPlanPanelProps = {
  title: string;
  autoPickLabel: string;
  selectContainerLabel?: string;
  selectPositionLabel?: string;
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
  positionLabel?: string;
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
  containerNo: string;
  locationLabel: string;
  title: string;
  rows: OutboundPickPlanRow[];
};

export function OutboundPickPlanPanel({
  title,
  autoPickLabel,
  selectContainerLabel = "Select Container",
  selectPositionLabel = "Select Pallet",
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
  positionLabel,
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
  const [recentlyUpdatedRowId, setRecentlyUpdatedRowId] = useState<string | null>(null);
  const [expandedContainerGroups, setExpandedContainerGroups] = useState<Record<string, boolean>>({});
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

  function handleContainerSelectionUpdate(group: OutboundPickPlanGroup, shouldSelect: boolean) {
    if (!onAllocatedQtyChange) {
      return;
    }

    let remainingQtyForGroup = shouldSelect
      ? Math.max(0, requiredQtyValue - selectedQtyValue)
      : 0;

    for (const row of group.rows) {
      const maxRowQty = typeof row.availableQty === "number"
        ? row.availableQty
        : Math.max(row.allocatedQty, remainingQtyForGroup);
      const availableToAdd = Math.max(0, maxRowQty - row.allocatedQty);
      const addedQty = shouldSelect ? Math.min(availableToAdd, remainingQtyForGroup) : 0;
      const nextQty = shouldSelect ? row.allocatedQty + addedQty : 0;
      remainingQtyForGroup = Math.max(0, remainingQtyForGroup - addedQty);
      if (nextQty !== row.allocatedQty) {
        handleAllocatedQtyUpdate(row.id, nextQty);
      }
    }

    if (shouldSelect) {
      setExpandedContainerGroups((current) => ({ ...current, [group.key]: true }));
    }
  }

  function toggleContainerGroup(groupKey: string) {
    setExpandedContainerGroups((current) => ({ ...current, [groupKey]: !current[groupKey] }));
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
      row.positionLabel,
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
        containerNo: row.containerNo || "-",
        locationLabel: row.locationLabel,
        title: `${sourceContainerLabel}: ${row.containerNo || "-"} | ${row.locationLabel}`,
        rows: [row]
      });
    }
    return [...groups.values()];
  }, [filteredRows, sourceContainerLabel]);

  return (
    <LineDetailAccordionPanel
      compact
      className="outbound-pick-plan-panel"
      title={title}
      chips={[
        { key: "sku", label: `${skuLabel}: ${skuValue}` },
        ...(itemNumberValue ? [{ key: "itemNumber", label: `${itemNumberLabel}: ${itemNumberValue}` }] : []),
        { key: "location", label: `${locationLabel}: ${locationValue}` },
        { key: "containers", label: `${containersLabel}: ${containerCount}` },
        { key: "available", label: `${availableQtyLabel}: ${availableQtyValue}` },
        { key: "selected", label: `${selectedQtyLabel}/${requiredQtyLabel}: ${selectedQtyValue}/${requiredQtyValue}`, tone: "success" },
        { key: "remaining", label: `${remainingQtyLabel}: ${remainingQtyValue}`, tone: remainingQtyValue > 0 ? "danger" : "default" }
      ]}
      actions={(
        <>
          <Chip
            size="small"
            label={autoPickLabel}
            className="!h-7 !rounded-lg !border !border-sky-200/80 !bg-sky-50 !px-2 !text-[11px] !font-semibold !text-sky-700"
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
              className="!min-h-8 !rounded-lg !border-slate-300/80 !bg-white/90 !px-2.5 !text-[11px] !font-semibold !text-[#143569] hover:!border-slate-400 hover:!bg-white"
            >
              {detailsLabel}
            </Button>
          ) : null}
        </>
      )}
      notice={!canExpand
        ? <div className="rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-1.5 text-xs text-slate-500">{emptyHint}</div>
        : null}
      expanded={canExpand && expanded}
      collapseContent={canExpand ? (
        <div className="space-y-2 pt-0.5" onKeyDownCapture={handlePanelKeyDown}>
          {editable ? (
            <label className="grid gap-1 text-[11px] font-semibold text-slate-500">
              <span className="flex items-center justify-between gap-3">
                <span>{searchLabel}</span>
                <span className="text-[10px] font-medium text-slate-400">{searchShortcutHint}</span>
              </span>
              <input
                ref={searchInputRef}
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={searchPlaceholder}
                disabled={inputDisabled}
                className="min-h-8 rounded-lg border border-slate-300/90 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 outline-none transition focus:border-[#143569]/60 focus:ring-2 focus:ring-[#143569]/10"
              />
            </label>
          ) : null}

          {groupedRows.length > 0 ? groupedRows.map((group) => {
            const groupAllocatedQty = group.rows.reduce((sum, row) => sum + row.allocatedQty, 0);
            const groupAvailableQty = group.rows.reduce((sum, row) => sum + (row.availableQty ?? row.allocatedQty), 0);
            const groupSelectedPositions = group.rows.filter((row) => row.allocatedQty > 0).length;
            const groupRemainingQty = Math.max(0, requiredQtyValue - (selectedQtyValue - groupAllocatedQty));
            const groupHasSelection = groupAllocatedQty > 0;
            const groupIsFullySelected = groupHasSelection
              && (groupSelectedPositions === group.rows.length || groupAllocatedQty >= groupRemainingQty);
            const groupIsPartiallySelected = groupHasSelection && !groupIsFullySelected;
            const groupCanSelect = Boolean(editable && onAllocatedQtyChange && !inputDisabled && (groupHasSelection || groupRemainingQty > 0));
            const isGroupExpanded = Boolean(expandedContainerGroups[group.key]) || normalizedSearch !== "";

            return (
              <div key={group.key} className="space-y-1.5">
                <div className="rounded-lg border border-slate-200/80 bg-slate-50/80 px-2.5 py-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      {editable && onAllocatedQtyChange ? (
                        <input
                          type="checkbox"
                          checked={groupIsFullySelected}
                          disabled={!groupCanSelect}
                          aria-label={`${selectContainerLabel}: ${group.containerNo}`}
                          aria-checked={groupIsPartiallySelected ? "mixed" : groupHasSelection ? "true" : "false"}
                          ref={(input) => {
                            if (input) {
                              input.indeterminate = groupIsPartiallySelected;
                            }
                          }}
                          onChange={(event) => handleContainerSelectionUpdate(group, event.target.checked)}
                          className="h-4 w-4 shrink-0 rounded border-slate-300 text-[#143569] focus:ring-[#143569]"
                        />
                      ) : null}
                      <button
                        type="button"
                        onClick={() => toggleContainerGroup(group.key)}
                        aria-expanded={isGroupExpanded}
                        aria-label={`${detailsLabel}: ${group.containerNo}`}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left text-[12px] font-semibold text-slate-700"
                      >
                        <ExpandMoreOutlinedIcon
                          fontSize="small"
                          className={`shrink-0 transition-transform duration-200 ${isGroupExpanded ? "rotate-180" : "rotate-0"}`}
                        />
                        <span className="truncate">
                          {sourceContainerLabel}: <span className="font-mono">{group.containerNo}</span>
                        </span>
                        <span className="hidden text-slate-400 sm:inline">|</span>
                        <span className="truncate text-[11px] font-medium text-slate-500">{group.locationLabel}</span>
                      </button>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1.5 text-[10px] font-semibold text-slate-500">
                      <span className="rounded-full bg-white px-2 py-0.5">{`${positionLabel || "Position"}: ${groupSelectedPositions}/${group.rows.length}`}</span>
                      <span className="rounded-full bg-white px-2 py-0.5">{`${pickQtyLabel}: ${groupAllocatedQty}/${groupAvailableQty}`}</span>
                    </div>
                  </div>
                </div>

                {isGroupExpanded ? (
                  <div className="space-y-1">
                    {group.rows.map((row) => {
                      const rowIdentity = row.positionLabel || row.containerNo || row.locationLabel;
                      const isSelected = row.allocatedQty > 0;
                      const remainingQtyForRow = Math.max(0, requiredQtyValue - (selectedQtyValue - row.allocatedQty));
                      const maxEditableQty = typeof row.availableQty === "number"
                        ? Math.min(row.availableQty, remainingQtyForRow)
                        : remainingQtyForRow;
                      const canSelectRow = isSelected || maxEditableQty > 0;
                      const rowIsEditable = Boolean(editable && onAllocatedQtyChange);

                      return (
                        <div
                          key={row.id}
                          data-testid={`outbound-pick-position-${rowIdentity}`}
                          className={`grid gap-2 rounded-lg border px-2.5 py-1.5 transition md:items-center ${
                            rowIsEditable
                              ? "grid-cols-[auto_minmax(0,1fr)] md:grid-cols-[auto_minmax(0,1fr)_auto]"
                              : "md:grid-cols-[minmax(0,1fr)_auto]"
                          } ${
                            recentlyUpdatedRowId === row.id
                              ? "border-emerald-300 bg-emerald-50/70 shadow-[0_0_0_1px_rgba(16,185,129,0.18)]"
                              : "border-slate-200/80 bg-white/95"
                          }`}
                        >
                          {rowIsEditable ? (
                            <div className="flex items-center self-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={inputDisabled || !canSelectRow}
                                aria-label={`${selectPositionLabel}: ${rowIdentity}`}
                                onChange={(event) => handleAllocatedQtyUpdate(row.id, event.target.checked ? maxEditableQty : 0)}
                                className="h-4 w-4 rounded border-slate-300 text-[#143569] focus:ring-[#143569]"
                              />
                            </div>
                          ) : null}
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] font-semibold text-slate-700">
                              <span>
                                {row.positionLabel ? (positionLabel || "Position") : sourceContainerLabel}:{" "}
                                <span className="font-mono">{row.positionLabel || row.containerNo || "-"}</span>
                              </span>
                              {row.itemNumber ? <span className="font-mono text-[11px] text-slate-500">{row.itemNumber}</span> : null}
                            </div>
                            <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                              {typeof row.availableQty === "number" ? <span>{`${availableQtyLabel}: ${row.availableQty} ${unitLabel}`}</span> : null}
                              <span>{`${pickQtyLabel}: ${row.allocatedQty} ${unitLabel}`}</span>
                            </div>
                          </div>
                          <div className={rowIsEditable ? "col-span-2 justify-self-end text-right md:col-span-1" : "text-right"}>
                            {rowIsEditable ? (
                              <div className="flex flex-wrap items-center justify-end gap-1.5">
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
                                  className="w-24 rounded-lg border border-slate-300/90 bg-slate-50 px-2.5 py-1.5 text-right text-sm font-semibold text-[#143569] outline-none transition focus:border-[#143569]/60 focus:bg-white focus:ring-2 focus:ring-[#143569]/10 disabled:cursor-not-allowed disabled:opacity-60"
                                />
                              </div>
                            ) : (
                              <div>
                                <div className="text-[10px] font-semibold text-slate-500">{pickQtyLabel}</div>
                                <div className="text-sm font-semibold text-[#143569]">{row.allocatedQty} {unitLabel}</div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          }) : (
            <div className="rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-1.5 text-xs text-slate-500">{emptyHint}</div>
          )}
        </div>
      ) : null}
      footer={shortageMessage
        ? <div className="rounded-lg border border-amber-200/80 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800">{shortageMessage}</div>
        : null}
    />
  );
}
