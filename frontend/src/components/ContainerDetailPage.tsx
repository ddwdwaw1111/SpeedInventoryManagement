import CloseIcon from "@mui/icons-material/Close";
import CompareArrowsOutlinedIcon from "@mui/icons-material/CompareArrowsOutlined";
import SwapVertRoundedIcon from "@mui/icons-material/SwapVertRounded";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import MoveToInboxOutlinedIcon from "@mui/icons-material/MoveToInboxOutlined";
import OutboxOutlinedIcon from "@mui/icons-material/OutboxOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import WarehouseOutlinedIcon from "@mui/icons-material/WarehouseOutlined";
import { Chip, Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../lib/api";
import { formatDateTimeValue, formatDateValue, parseDateValue } from "../lib/dates";
import { getErrorMessage } from "../lib/errors";
import {
  buildAllContainerContentsRows,
  buildContainerSkuCards,
  formatContainerTimelineValue,
  normalizeContainerNumber,
  type ContainerSkuCard
} from "../lib/containerInventory";
import { setPendingAllActivityContext } from "../lib/allActivityContext";
import { consumePendingContainerDetailLaunchContext, type ContainerDetailLaunchContext } from "../lib/containerDetailLaunchContext";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import { type PageKey } from "../lib/routes";
import {
  getLocationSectionOptions,
  normalizeStorageSection,
  type Item,
  type Location,
  type Movement,
  type UserRole
} from "../lib/types";
import { InlineAlert, useFeedbackToast } from "./Feedback";
import { WorkspacePanelHeader } from "./WorkspacePanelChrome";

const HISTORY_PER_PAGE = 15;
const activityDateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

type ContainerHistoryFilter = "ALL" | Movement["movementType"];

type ContainerHistoryEntry = { id: string; filterKey: Movement["movementType"]; sortTimestamp: number; movement: Movement };

type ContainerTransferFormState = {
  notes: string;
  toLocationId: string;
  toStorageSection: string;
  lineNote: string;
};

type ContainerAdjustmentFormState = {
  reasonCode: string;
  actualAdjustedAt: string;
  notes: string;
  lineNote: string;
  quantities: Record<string, string>;
  palletDeltas: Record<string, string>;
};

type ContainerDetailPageProps = {
  routeKey: string;
  containerNo: string | null;
  items: Item[];
  movements: Movement[];
  locations: Location[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onNavigate: (page: PageKey) => void;
  onOpenContainerLifecycle?: (customerId: number | null, containerNo: string, containerId?: number | null) => void;
  onBackToList: () => void;
};

export function ContainerDetailPage({
  routeKey,
  containerNo,
  items,
  movements,
  locations,
  currentUserRole,
  isLoading,
  onRefresh,
  onNavigate,
  onOpenContainerLifecycle,
  onBackToList
}: ContainerDetailPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
  const canManageInventory = currentUserRole === "admin" || currentUserRole === "operator";
  const normalizedContainerNo = normalizeContainerNumber(containerNo);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyAscending, setHistoryAscending] = useState(false);
  const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
  const [isAdjustmentDialogOpen, setIsAdjustmentDialogOpen] = useState(false);
  const [inventoryDialogError, setInventoryDialogError] = useState("");
  const [inventoryDialogSubmitting, setInventoryDialogSubmitting] = useState(false);
  const [historyTypeFilter, setHistoryTypeFilter] = useState<ContainerHistoryFilter>("ALL");
  const [transferForm, setTransferForm] = useState<ContainerTransferFormState>(createEmptyContainerTransferForm());
  const [adjustmentForm, setAdjustmentForm] = useState<ContainerAdjustmentFormState>(createEmptyContainerAdjustmentForm([]));
  const pendingLaunchContextRef = useRef<ContainerDetailLaunchContext | null | undefined>(undefined);

  const containerRows = useMemo(
    () => buildAllContainerContentsRows(items, movements, locations),
    [items, locations, movements]
  );
  const container = useMemo(
    () => containerRows.find((row) => row.containerNo === normalizedContainerNo) ?? null,
    [containerRows, normalizedContainerNo]
  );
  const skuCards = useMemo(() => buildContainerSkuCards(container?.items ?? []), [container?.items]);
  const transferableContainerItems = useMemo(
    () => (container?.items ?? []).filter(canAutoTransferContainerItem),
    [container?.items]
  );
  const adjustableContainerItems = useMemo(
    () => (container?.items ?? []).filter((item) => item.containerId && item.containerId > 0 && item.skuMasterId > 0),
    [container?.items]
  );
  const isHistoricalOnly = Boolean(container && container.rowCount === 0);
  const containerMovements = useMemo(
    () => movements
      .filter((movement) => normalizeContainerNumber(movement.containerNo) === normalizedContainerNo)
      .sort((left, right) => getMovementSortTimestamp(right) - getMovementSortTimestamp(left)),
    [movements, normalizedContainerNo]
  );
  const containerHistoryEntries = useMemo<ContainerHistoryEntry[]>(() => containerMovements.map((movement) => ({
    id: `movement:${movement.id}`,
    filterKey: movement.movementType,
    sortTimestamp: getMovementSortTimestamp(movement),
    movement
  })), [containerMovements]);
  const historyTypeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of containerHistoryEntries) {
      counts.set(entry.filterKey, (counts.get(entry.filterKey) ?? 0) + 1);
    }

    const orderedTypes: Movement["movementType"][] = ["IN", "OUT", "TRANSFER_OUT", "TRANSFER_IN", "ADJUST", "COUNT", "REVERSAL"];
    return [
      { key: "ALL" as const, label: t("containerDetailHistoryAll"), count: containerHistoryEntries.length },
      ...orderedTypes
        .filter((historyType) => counts.has(historyType))
        .map((historyType) => ({
          key: historyType as ContainerHistoryFilter,
          label: getContainerHistoryFilterLabel(historyType, t),
          count: counts.get(historyType) ?? 0
        }))
    ];
  }, [containerHistoryEntries, t]);
  const filteredHistoryEntries = useMemo(
    () => historyTypeFilter === "ALL"
      ? containerHistoryEntries
      : containerHistoryEntries.filter((entry) => entry.filterKey === historyTypeFilter),
    [containerHistoryEntries, historyTypeFilter]
  );
  const sortedFilteredHistoryEntries = useMemo(
    () => historyAscending ? [...filteredHistoryEntries].reverse() : filteredHistoryEntries,
    [filteredHistoryEntries, historyAscending]
  );
  const firstReceivedAt = useMemo(() => {
    const firstReceivedEntry = [...containerHistoryEntries]
      .filter((entry) => entry.filterKey === "IN")
      .sort((left, right) => left.sortTimestamp - right.sortTimestamp)[0];
    return firstReceivedEntry ? getContainerHistoryEntryTimeValue(firstReceivedEntry) : null;
  }, [containerHistoryEntries]);
  const lastActivityAt = containerHistoryEntries[0] ? getContainerHistoryEntryTimeValue(containerHistoryEntries[0]) : null;
  const touchedWarehouseCount = useMemo(
    () => new Set(containerHistoryEntries.map((entry) => entry.movement.locationName).filter((value) => value.trim())).size,
    [containerHistoryEntries]
  );
  const transferDestinationLocation = useMemo(
    () => locations.find((location) => location.id === Number(transferForm.toLocationId)) ?? null,
    [locations, transferForm.toLocationId]
  );
  const transferDestinationSections = useMemo(
    () => getLocationSectionOptions(transferDestinationLocation ?? undefined),
    [transferDestinationLocation]
  );
  const canOpenTransferDialog = canManageInventory && transferableContainerItems.length > 0;
  const canOpenAdjustmentDialog = canManageInventory && adjustableContainerItems.length > 0;
  const lifecycleCustomerId = container?.customerIds.length === 1 ? container.customerIds[0] : null;
  const lifecycleContainerId = useMemo(() => {
    const containerIds = [...new Set((container?.items ?? []).map((item) => item.containerId).filter((containerId): containerId is number => Boolean(containerId && containerId > 0)))];
    return containerIds.length === 1 ? containerIds[0] : null;
  }, [container?.items]);
  const containerPalletCount = useMemo(
    () => (container?.items ?? []).reduce((sum, item) => sum + item.pallets, 0),
    [container]
  );

  const totalHistoryPages = Math.max(1, Math.ceil(filteredHistoryEntries.length / HISTORY_PER_PAGE));
  const paginatedHistoryEntries = useMemo(() => {
    const startIndex = (historyPage - 1) * HISTORY_PER_PAGE;
    return sortedFilteredHistoryEntries.slice(startIndex, startIndex + HISTORY_PER_PAGE);
  }, [sortedFilteredHistoryEntries, historyPage]);

  useEffect(() => {
    setHistoryPage(1);
  }, [historyTypeFilter, historyAscending]);

  useEffect(() => {
    if (pendingLaunchContextRef.current === undefined) {
      pendingLaunchContextRef.current = consumePendingContainerDetailLaunchContext();
    }

    const launchContext = pendingLaunchContextRef.current;
    if (launchContext?.openTransferDialog && canOpenTransferDialog) {
      openTransferDialog();
      pendingLaunchContextRef.current = null;
      return;
    }

    if (launchContext?.openAdjustmentDialog && canOpenAdjustmentDialog) {
      openAdjustmentDialog();
      pendingLaunchContextRef.current = null;
      return;
    }

    if (!isLoading) {
      pendingLaunchContextRef.current = null;
    }
  }, [canOpenAdjustmentDialog, canOpenTransferDialog, isLoading]);

  function openTransferDialog() {
    setTransferForm(createEmptyContainerTransferForm());
    setInventoryDialogError("");
    setInventoryDialogSubmitting(false);
    setIsTransferDialogOpen(true);
  }

  function closeInventoryDialog(force = false) {
    if (inventoryDialogSubmitting && !force) {
      return;
    }

    setIsTransferDialogOpen(false);
    setInventoryDialogError("");
    setTransferForm(createEmptyContainerTransferForm());
  }

  function openAdjustmentDialog() {
    setAdjustmentForm(createEmptyContainerAdjustmentForm(adjustableContainerItems));
    setInventoryDialogError("");
    setInventoryDialogSubmitting(false);
    setIsAdjustmentDialogOpen(true);
  }

  function closeAdjustmentDialog(force = false) {
    if (inventoryDialogSubmitting && !force) {
      return;
    }

    setIsAdjustmentDialogOpen(false);
    setInventoryDialogError("");
    setAdjustmentForm(createEmptyContainerAdjustmentForm([]));
  }

  async function handleSubmitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (transferableContainerItems.length === 0) {
      setInventoryDialogError(t("noInventoryAvailable"));
      return;
    }
    if (Number(transferForm.toLocationId) <= 0) {
      setInventoryDialogError(t("selectStorage"));
      return;
    }

    const transferLines = buildTransferLinesFromItems(
      transferableContainerItems,
      Number(transferForm.toLocationId),
      transferForm.toStorageSection,
      transferForm.lineNote
    );
    if (transferLines.length === 0) {
      setInventoryDialogError(t("noInventoryAvailable"));
      return;
    }

    setInventoryDialogSubmitting(true);
    setInventoryDialogError("");

    try {
      await api.createInventoryTransfer({
        notes: transferForm.notes.trim() || undefined,
        lines: transferLines
      });
      await onRefresh();
      closeInventoryDialog(true);
      showSuccess(t("transferSavedSuccess"));
    } catch (error) {
      const message = getErrorMessage(error, t("couldNotSaveTransfer"));
      setInventoryDialogError(message);
      showError(message);
    } finally {
      setInventoryDialogSubmitting(false);
    }
  }

  async function handleSubmitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adjustableContainerItems.length === 0) {
      setInventoryDialogError(t("noInventoryAvailable"));
      return;
    }

    const adjustmentLines = buildAdjustmentLinesFromItems(
      adjustableContainerItems,
      adjustmentForm.quantities,
      adjustmentForm.palletDeltas,
      adjustmentForm.lineNote
    );
    if (adjustmentLines.length === 0) {
      setInventoryDialogError(t("adjustmentRequireLine"));
      return;
    }

    setInventoryDialogSubmitting(true);
    setInventoryDialogError("");

    try {
      await api.createInventoryAdjustment({
        reasonCode: adjustmentForm.reasonCode.trim() || "MANUAL",
        actualAdjustedAt: adjustmentForm.actualAdjustedAt || undefined,
        notes: adjustmentForm.notes.trim() || undefined,
        lines: adjustmentLines
      });
      await onRefresh();
      closeAdjustmentDialog(true);
      showSuccess(t("adjustmentSavedSuccess"));
    } catch (error) {
      const message = getErrorMessage(error, t("couldNotSaveAdjustment"));
      setInventoryDialogError(message);
      showError(message);
    } finally {
      setInventoryDialogSubmitting(false);
    }
  }

  function handleOpenActivity() {
    if (!container) {
      return;
    }

    setPendingAllActivityContext({
      searchTerm: container.containerNo,
      customerId: container.customerIds.length === 1 ? container.customerIds[0] : undefined,
      locationId: container.locationIds.length === 1 ? container.locationIds[0] : undefined
    });
    onNavigate("all-activity");
  }

  return (
    <main className="workspace-main">
      <div className="space-y-4 pb-4">
        <section className="rounded-[24px] bg-[radial-gradient(ellipse_at_top_right,rgba(96,165,250,0.12),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(99,102,241,0.08),transparent_50%),linear-gradient(135deg,#09193a_0%,#0f2d63_50%,#173a7a_100%)] px-5 py-5 shadow-[0_20px_60px_rgba(8,20,50,0.28)]">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70 ring-1 ring-white/20">
                <span>{t("containerDetailEyebrow")}</span>
              </div>
              <div>
                <h1 className="font-headline text-2xl font-extrabold tracking-tight text-white">
                  {normalizedContainerNo || t("containerDetailMissingTitle")}
                </h1>
                {container ? (
                  <div className="mt-1 inline-flex items-center gap-2 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80 ring-1 ring-white/25">
                    <span>{isHistoricalOnly ? t("containerDetailHistoricalBadge") : t("containerDetailCurrentBadge")}</span>
                  </div>
                ) : null}
                <p className="mt-1 max-w-3xl text-sm text-white/65">
                  {container
                    ? t("containerDetailSubtitle", {
                      customer: container.customerSummary || "-",
                      warehouse: container.warehouseSummary || "-"
                    })
                    : t("containerDetailMissingDesc")}
                </p>
              </div>
            </div>

            {canManageInventory ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!normalizedContainerNo || !lifecycleContainerId) {
                      return;
                    }
                    onOpenContainerLifecycle?.(lifecycleCustomerId, normalizedContainerNo, lifecycleContainerId);
                  }}
                  disabled={!normalizedContainerNo || !lifecycleContainerId || !onOpenContainerLifecycle}
                  className="interactive-button-lift inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/25 transition hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <HistoryOutlinedIcon sx={{ fontSize: 15 }} />
                  {t("openContainerLifecycle")}
                </button>
                <button
                  type="button"
                  onClick={openTransferDialog}
                  disabled={!canOpenTransferDialog}
                  className="interactive-button-lift inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/25 transition hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <CompareArrowsOutlinedIcon sx={{ fontSize: 15 }} />
                  {t("addTransfer")}
                </button>
                <button
                  type="button"
                  onClick={openAdjustmentDialog}
                  disabled={!canOpenAdjustmentDialog}
                  className="interactive-button-lift inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/25 transition hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <TuneOutlinedIcon sx={{ fontSize: 15 }} />
                  {t("addAdjustment")}
                </button>
              </div>
            ) : null}
          </div>

          <div className="mt-3 rounded-[18px] bg-white/10 p-3 ring-1 ring-white/15 backdrop-blur-sm">
            {isLoading ? (
              <div className="grid gap-3 md:grid-cols-4 animate-pulse">
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="rounded-[14px] bg-white/10 p-3 ring-1 ring-white/15">
                    <div className="h-3 w-20 rounded-full bg-white/20" />
                    <div className="mt-3 h-6 w-16 rounded-full bg-white/20" />
                    <div className="mt-2 h-3 w-full rounded-full bg-white/15" />
                  </div>
                ))}
              </div>
            ) : container ? (
              <>
                <div className="grid gap-2 md:grid-cols-4">
                  <OverviewStatCard icon={<FactCheckOutlinedIcon sx={{ fontSize: 16 }} />} label={t("skuCount")} value={String(skuCards.length)} meta={t("containerItems")} />
                  <OverviewStatCard icon={<MoveToInboxOutlinedIcon sx={{ fontSize: 16 }} />} label={t("onHand")} value={String(container.onHand)} meta={t("availableQty")} secondaryValue={String(container.availableQty)} />
                  <OverviewStatCard icon={<WarehouseOutlinedIcon sx={{ fontSize: 16 }} />} label={t("pallets")} value={String(containerPalletCount)} meta={t("currentInventoryRows")} secondaryValue={String(container.rowCount)} />
                  <OverviewStatCard icon={<TuneOutlinedIcon sx={{ fontSize: 16 }} />} label={t("currentInventoryRows")} value={String(container.rowCount)} meta={container.warehouseSummary || "-"} />
                </div>

                <div className="mt-3 rounded-[16px] bg-white/10 px-3 py-2.5 ring-1 ring-white/15">
                  <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-5">
                    <DetailStatRow label={t("customer")} value={container.customerSummary} />
                    <DetailStatRow label={t("currentStorage")} value={container.warehouseSummary} />
                    <DetailStatRow label={t("pickLocations")} value={container.pickLocationSummary} />
                    <DetailStatRow label={t("containerReceivedAt")} value={formatContainerTimelineValue(container.receivedAt, resolvedTimeZone)} />
                    <DetailStatRow label={t("containerShippedAt")} value={formatContainerTimelineValue(container.shippedAt, resolvedTimeZone, t("containerNotShipped"))} />
                  </div>
                </div>

                {isHistoricalOnly ? (
                  <div className="mt-3 rounded-[14px] border border-amber-400/30 bg-amber-500/20 px-3 py-2 text-sm font-medium text-amber-200">
                    {t("containerNoCurrentInventoryNotice")}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="rounded-[14px] bg-white/10 px-3 py-4 text-sm text-white/70 ring-1 ring-white/15">
                <strong className="block text-base font-semibold text-white/90">{t("containerDetailMissingTitle")}</strong>
                <span className="mt-1 block">{t("containerDetailMissingDesc")}</span>
              </div>
            )}
          </div>
        </section>

        {container ? (
          <div className="flex flex-wrap items-center gap-2.5 rounded-2xl bg-white px-3.5 py-2.5 shadow-[0_4px_16px_rgba(15,23,42,0.07)] ring-1 ring-slate-200/60">
            {[
              { id: "section-sku", label: t("containerNavSku"), count: skuCards.length },
              { id: "section-history", label: t("containerNavHistory"), count: containerHistoryEntries.length },
            ].map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => document.getElementById(section.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="group inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-[#143569] hover:text-white hover:shadow-[0_4px_12px_rgba(20,53,105,0.20)]"
              >
                <span>{section.label}</span>
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold text-slate-500 group-hover:bg-white/20 group-hover:text-white/90">{section.count}</span>
              </button>
            ))}
          </div>
        ) : null}

        <section id="section-sku" className="rounded-[20px] border border-slate-200/80 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
          <WorkspacePanelHeader
            title={t("containerDetailSkuTitle")}
            description={t("containerDetailSkuDesc")}
          />
          {isLoading ? (
            <CardSkeletonGrid />
          ) : skuCards.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {skuCards.map((card) => (
                <SkuSnapshotCard
                  key={card.id}
                  card={card}
                  t={t}
                  onOpenActivity={() => {
                    setPendingAllActivityContext({
                      customerId: card.customerId,
                      searchTerm: card.sku
                    });
                    onNavigate("all-activity");
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="sheet-note sheet-note--readonly">{t("containerDetailNoCurrentSku")}</div>
          )}
        </section>

        <section id="section-history" className="rounded-[20px] border border-slate-200/80 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
          <WorkspacePanelHeader
            title={t("containerDetailHistoryTitle")}
            description={t("containerDetailHistoryDesc")}
            actions={containerHistoryEntries.length > 0 ? (
              <button
                type="button"
                onClick={handleOpenActivity}
                className="interactive-button-lift inline-flex items-center gap-1.5 rounded-xl border border-[#143569]/20 bg-white px-3 py-1.5 text-xs font-semibold text-[#143569] shadow-[0_2px_8px_rgba(20,53,105,0.10)] transition hover:bg-[#f4f8ff] hover:shadow-[0_4px_12px_rgba(20,53,105,0.16)]"
              >
                <HistoryOutlinedIcon sx={{ fontSize: 14 }} />
                {t("allActivity")}
              </button>
            ) : undefined}
          />
          {containerHistoryEntries.length > 0 ? (
            <>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[12px] border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-xs text-slate-500">
                <span><span className="font-semibold text-slate-700">{containerHistoryEntries.length}</span> {t("recordCount")}</span>
                <span className="text-slate-300">·</span>
                <span><span className="font-semibold text-slate-700">{touchedWarehouseCount}</span> {t("warehouses")}</span>
                <span className="text-slate-300">·</span>
                <span>{t("containerReceivedAt")}: <span className="font-semibold text-slate-700">{formatContainerTimelineValue(firstReceivedAt, resolvedTimeZone)}</span></span>
                <span className="text-slate-300">·</span>
                <span>{t("lastActivity")}: <span className="font-semibold text-slate-700">{formatContainerTimelineValue(lastActivityAt, resolvedTimeZone)}</span></span>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {historyTypeOptions.map((option) => {
                    const selected = historyTypeFilter === option.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setHistoryTypeFilter(option.key)}
                        className={`interactive-block inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold transition ${selected ? "bg-[#143569] text-white shadow-[0_10px_24px_rgba(20,53,105,0.16)]" : "bg-slate-100 text-slate-600 hover:bg-slate-200/80"}`}
                      >
                        <span>{option.label}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${selected ? "bg-white/15 text-white" : "bg-white text-slate-500"}`}>{option.count}</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setHistoryAscending((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/80 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-[#143569]/30 hover:bg-[#f4f8ff] hover:text-[#143569]"
                >
                  <SwapVertRoundedIcon sx={{ fontSize: 14 }} />
                  {historyAscending ? t("historySortOldest") : t("historySortNewest")}
                </button>
              </div>

              <div className="relative mt-5">
                <div className={`pointer-events-none absolute bottom-4 left-[15px] top-3 w-0.5 bg-gradient-to-b ${historyAscending ? "from-transparent via-slate-200 to-violet-200" : "from-violet-200 via-slate-200 to-transparent"}`} />
                {paginatedHistoryEntries.map((entry) => (
                  <ContainerHistoryCard
                    key={entry.id}
                    entry={entry}
                    resolvedTimeZone={resolvedTimeZone}
                    t={t}
                  />
                ))}
              </div>
              {filteredHistoryEntries.length > HISTORY_PER_PAGE ? (
                <div className="mt-4 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setHistoryPage((current) => Math.max(1, current - 1))}
                    disabled={historyPage === 1}
                    className="inline-flex items-center rounded-xl border border-slate-200/80 bg-white px-4 py-2 text-sm font-semibold text-[#143569] transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t("previousPage")}
                  </button>
                  <span className="text-sm font-semibold text-slate-500">
                    {t("pageStatus", { page: historyPage, pages: totalHistoryPages })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setHistoryPage((current) => Math.min(totalHistoryPages, current + 1))}
                    disabled={historyPage >= totalHistoryPages}
                    className="inline-flex items-center rounded-xl border border-slate-200/80 bg-white px-4 py-2 text-sm font-semibold text-[#143569] transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t("nextPage")}
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="sheet-note sheet-note--readonly">{t("containerDetailNoHistory")}</div>
          )}
        </section>
      </div>
      {feedbackToast}

      <Dialog
        open={isTransferDialogOpen}
        onClose={(_, reason) => {
          if (reason === "backdropClick") return;
          closeInventoryDialog();
        }}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle sx={{ pb: 1 }}>
          {t("addTransfer")}
          <IconButton aria-label={t("close")} onClick={() => closeInventoryDialog()} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {inventoryDialogError ? <InlineAlert>{inventoryDialogError}</InlineAlert> : null}
          <form className="sheet-form" onSubmit={handleSubmitTransfer}>
            <ContainerTransferItemSummary items={transferableContainerItems} t={t} />
            <label>{t("destinationStorage")}<select value={transferForm.toLocationId} onChange={(event) => setTransferForm((current) => {
              const nextLocationId = event.target.value;
              const nextLocation = locations.find((location) => location.id === Number(nextLocationId));
              return {
                ...current,
                toLocationId: nextLocationId,
                toStorageSection: getLocationSectionOptions(nextLocation)[0] || normalizeStorageSection(current.toStorageSection)
              };
            })}><option value="">{t("selectStorage")}</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
            <label>{t("toSection")}<select value={transferForm.toStorageSection} onChange={(event) => setTransferForm((current) => ({ ...current, toStorageSection: event.target.value }))}>{transferDestinationSections.map((section) => <option key={section} value={section}>{section}</option>)}</select></label>
            <label className="sheet-form__wide">{t("notes")}<input value={transferForm.notes} onChange={(event) => setTransferForm((current) => ({ ...current, notes: event.target.value }))} placeholder={t("transferNotesPlaceholder")} /></label>
            <label className="sheet-form__wide">{t("internalNotes")}<input value={transferForm.lineNote} onChange={(event) => setTransferForm((current) => ({ ...current, lineNote: event.target.value }))} placeholder={t("transferLineNotePlaceholder")} /></label>

            <div className="sheet-form__actions sheet-form__wide">
              <button className="button button--primary" type="submit" disabled={inventoryDialogSubmitting}>{inventoryDialogSubmitting ? t("saving") : t("saveTransfer")}</button>
              <button className="button button--ghost" type="button" onClick={() => closeInventoryDialog()} disabled={inventoryDialogSubmitting}>{t("cancel")}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isAdjustmentDialogOpen}
        onClose={(_, reason) => {
          if (reason === "backdropClick") return;
          closeAdjustmentDialog();
        }}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle sx={{ pb: 1 }}>
          {t("addAdjustment")}
          <IconButton aria-label={t("close")} onClick={() => closeAdjustmentDialog()} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {inventoryDialogError ? <InlineAlert>{inventoryDialogError}</InlineAlert> : null}
          <form className="sheet-form" onSubmit={handleSubmitAdjustment}>
            <ContainerAdjustmentItemInputs
              items={adjustableContainerItems}
              quantities={adjustmentForm.quantities}
              palletDeltas={adjustmentForm.palletDeltas}
              onQuantityChange={(itemKey, value) => setAdjustmentForm((current) => ({
                ...current,
                quantities: { ...current.quantities, [itemKey]: value }
              }))}
              onPalletDeltaChange={(itemKey, value) => setAdjustmentForm((current) => ({
                ...current,
                palletDeltas: { ...current.palletDeltas, [itemKey]: value }
              }))}
              t={t}
            />
            <label>{t("reasonCode")}<input value={adjustmentForm.reasonCode} onChange={(event) => setAdjustmentForm((current) => ({ ...current, reasonCode: event.target.value }))} /></label>
            <label>{t("actualAdjustedAt")}<input type="datetime-local" value={adjustmentForm.actualAdjustedAt} onChange={(event) => setAdjustmentForm((current) => ({ ...current, actualAdjustedAt: event.target.value }))} /></label>
            <label className="sheet-form__wide">{t("notes")}<input value={adjustmentForm.notes} onChange={(event) => setAdjustmentForm((current) => ({ ...current, notes: event.target.value }))} placeholder={t("adjustmentNotesPlaceholder")} /></label>
            <label className="sheet-form__wide">{t("internalNotes")}<input value={adjustmentForm.lineNote} onChange={(event) => setAdjustmentForm((current) => ({ ...current, lineNote: event.target.value }))} placeholder={t("adjustmentLineNotePlaceholder")} /></label>

            <div className="sheet-form__actions sheet-form__wide">
              <button className="button button--primary" type="submit" disabled={inventoryDialogSubmitting}>{inventoryDialogSubmitting ? t("saving") : t("saveAdjustment")}</button>
              <button className="button button--ghost" type="button" onClick={() => closeAdjustmentDialog()} disabled={inventoryDialogSubmitting}>{t("cancel")}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function SkuSnapshotCard({
  card,
  t,
  onOpenActivity
}: {
  card: ContainerSkuCard;
  t: (key: string, params?: Record<string, string | number>) => string;
  onOpenActivity: () => void;
}) {
  return (
    <article className="rounded-[16px] border border-slate-200/80 bg-[linear-gradient(180deg,#f8fbff_0%,#f2f6fb_100%)] px-3 py-2.5 shadow-[0_4px_12px_rgba(15,23,42,0.04)] transition hover:shadow-[0_8px_22px_rgba(20,53,105,0.09)] hover:border-slate-300">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 truncate">{card.itemNumber || t("itemNumber")}</div>
          <h3 className="mt-0.5 text-sm font-extrabold tracking-tight text-[#0d2d63] truncate">{card.sku}</h3>
        </div>
        <span className="shrink-0 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#143569] ring-1 ring-slate-200/80">
          {card.customerSummary}
        </span>
      </div>
      {card.description ? <p className="mt-1 text-[11px] text-slate-500 line-clamp-1">{card.description}</p> : null}
      <div className="mt-1.5 text-[11px] text-slate-500 truncate">
        <span className="font-semibold text-slate-600">{card.storageSummary || "-"}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 rounded-[10px] border border-slate-200/70 bg-white/80 px-2.5 py-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
          <span><span className="font-extrabold text-[#0d2d63]">{card.onHand}</span> {t("onHand")}</span>
          <span className="text-slate-200">·</span>
          <span><span className="font-semibold text-slate-700">{card.availableQty}</span> {t("availableQty")}</span>
          {card.damagedQty > 0 ? <><span className="text-slate-200">·</span><span className="text-rose-500"><span className="font-semibold">{card.damagedQty}</span> {t("damagedQty")}</span></> : null}
          <span className="text-slate-200">·</span>
          <span><span className="font-semibold text-slate-600">{card.rowCount}</span> rows</span>
        </div>
        <button
          type="button"
          onClick={onOpenActivity}
          className="shrink-0 text-[11px] font-semibold text-[#143569]/70 hover:text-[#143569] transition"
        >
          {t("allActivity")} →
        </button>
      </div>
    </article>
  );
}

function ContainerHistoryCard({
  entry,
  resolvedTimeZone,
  t
}: {
  entry: ContainerHistoryEntry;
  resolvedTimeZone: string;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const iconNode = (
    <div className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ring-2 ring-white shadow-[0_2px_8px_rgba(15,23,42,0.12)] ${getHistoryIconSurfaceClass(entry.filterKey)}`}>
      {getHistoryIcon(entry.filterKey)}
    </div>
  );

  const movement = entry.movement;
  const signedQuantity = movement.quantityChange >= 0 ? `+${movement.quantityChange}` : String(movement.quantityChange);
  const referenceSummary = [movement.referenceCode, movement.packingListNo, movement.orderRef]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" | ");

  return (
    <div className="relative flex items-start gap-3 pb-4">
      {iconNode}
      <div className="min-w-0 flex-1 rounded-[14px] border border-slate-100 bg-[linear-gradient(135deg,#fbfdff_0%,#f4f8fc_100%)] px-3 py-2.5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] transition hover:border-slate-200 hover:shadow-[0_4px_14px_rgba(15,23,42,0.09)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {renderHistoryFilterChip(entry.filterKey, t)}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              {t("inventoryLedger")}
            </span>
            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 ring-1 ring-slate-200/80">
              {movement.locationName}{movement.storageSection ? ` / ${normalizeStorageSection(movement.storageSection)}` : ""}
            </span>
          </div>
          <time className="text-[11px] font-semibold tabular-nums text-slate-400">
            {formatMovementActivityDate(movement, resolvedTimeZone)}
          </time>
        </div>
        <div className="mt-1.5">
          <div className="text-sm font-extrabold tracking-tight text-[#0d2d63]">
            {movement.sku} <span className="text-xs font-normal text-slate-400">| {movement.itemNumber || "-"}</span>
          </div>
          {movement.description ? <div className="mt-0.5 text-xs text-slate-500 line-clamp-1">{movement.description}</div> : null}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
            <span><span className="font-semibold text-slate-700">{signedQuantity}</span> {t("qtyChange")}</span>
            <span className="text-slate-200">|</span>
            <span><span className="font-semibold text-slate-700">{movement.pallets}</span> pallets</span>
            {referenceSummary ? <><span className="text-slate-200">|</span><span className="text-slate-500">{referenceSummary}</span></> : null}
            {movement.reason?.trim() ? <><span className="text-slate-200">|</span><span className="text-slate-500">{movement.reason}</span></> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function OverviewStatCard({
  icon,
  label,
  value,
  meta,
  secondaryValue
}: {
  icon: ReactNode;
  label: string;
  value: string;
  meta: string;
  secondaryValue?: string;
}) {
  return (
    <article className="rounded-[14px] bg-white/10 p-2.5 ring-1 ring-white/15">
      <div className="flex items-center justify-between gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white/20 text-white">
          {icon}
        </div>
        {secondaryValue ? <span className="text-[11px] font-semibold text-white/55">{secondaryValue}</span> : null}
      </div>
      <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">{label}</div>
      <div className="mt-0.5 text-lg font-extrabold tracking-tight text-white">{value}</div>
      <div className="text-[11px] text-white/50">{meta}</div>
    </article>
  );
}

function DetailStatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-100/75">{label}</span>
      <span className="text-sm font-semibold text-white/95 break-words">{value}</span>
    </div>
  );
}

function SmallMetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-slate-200/80 bg-white/90 px-2.5 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-extrabold tracking-tight text-[#0d2d63] break-words">{value}</div>
    </div>
  );
}

function TimelineStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-700">{value}</div>
    </div>
  );
}

function CardSkeletonGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 animate-pulse">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="rounded-[20px] border border-slate-200/80 bg-slate-50/80 p-4">
          <div className="h-4 w-28 rounded-full bg-slate-200" />
          <div className="mt-3 h-6 w-24 rounded-full bg-slate-200" />
          <div className="mt-4 h-3 w-full rounded-full bg-slate-200" />
          <div className="mt-2 h-3 w-3/4 rounded-full bg-slate-200" />
          <div className="mt-4 grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }, (__unused, metricIndex) => (
              <div key={metricIndex} className="h-16 rounded-[14px] bg-white/90" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function getContainerHistoryFilterLabel(filterKey: Movement["movementType"], t: (key: string) => string) {
  return getMovementTypeLabel(filterKey, t);
}

function renderHistoryFilterChip(filterKey: Movement["movementType"], t: (key: string) => string) {
  return renderMovementTypeChip(filterKey, t);
}

function getHistoryIcon(filterKey: Movement["movementType"]) {
  return getMovementIcon(filterKey);
}

function getHistoryIconSurfaceClass(filterKey: Movement["movementType"]) {
  return getMovementIconSurfaceClass(filterKey);
}

function getContainerHistoryEntryTimeValue(entry: ContainerHistoryEntry) {
  return getMovementActivityDateValue(entry.movement);
}

function getMovementTypeLabel(movementType: Movement["movementType"], t: (key: string) => string) {
  switch (movementType) {
    case "IN":
      return t("inbound");
    case "OUT":
      return t("outbound");
    case "REVERSAL":
      return t("reversal");
    case "COUNT":
      return t("cycleCount");
    case "TRANSFER_IN":
      return t("transferIn");
    case "TRANSFER_OUT":
      return t("transferOut");
    default:
      return t("adjustment");
  }
}

function renderMovementTypeChip(movementType: Movement["movementType"], t: (key: string) => string) {
  if (movementType === "IN") {
    return <Chip label={t("inbound")} color="success" size="small" />;
  }

  if (movementType === "OUT") {
    return <Chip label={t("outbound")} color="error" size="small" />;
  }

  if (movementType === "REVERSAL") {
    return <Chip label={t("reversal")} color="info" size="small" />;
  }

  if (movementType === "COUNT") {
    return <Chip label={t("cycleCount")} color="warning" size="small" />;
  }

  if (movementType === "TRANSFER_IN") {
    return <Chip label={t("transferIn")} color="success" size="small" />;
  }

  if (movementType === "TRANSFER_OUT") {
    return <Chip label={t("transferOut")} color="default" size="small" />;
  }

  return <Chip label={t("adjustment")} color="warning" size="small" />;
}

function getMovementIcon(movementType: Movement["movementType"]) {
  const sharedProps = { sx: { fontSize: 20 } };

  switch (movementType) {
    case "IN":
      return <MoveToInboxOutlinedIcon {...sharedProps} />;
    case "OUT":
      return <OutboxOutlinedIcon {...sharedProps} />;
    case "TRANSFER_IN":
    case "TRANSFER_OUT":
      return <CompareArrowsOutlinedIcon {...sharedProps} />;
    case "COUNT":
      return <FactCheckOutlinedIcon {...sharedProps} />;
    case "REVERSAL":
      return <HistoryOutlinedIcon {...sharedProps} />;
    default:
      return <TuneOutlinedIcon {...sharedProps} />;
  }
}

function getMovementIconSurfaceClass(movementType: Movement["movementType"]) {
  switch (movementType) {
    case "IN":
      return "bg-emerald-100 text-emerald-700";
    case "OUT":
      return "bg-rose-100 text-rose-700";
    case "TRANSFER_IN":
    case "TRANSFER_OUT":
      return "bg-amber-100 text-amber-700";
    case "COUNT":
      return "bg-blue-100 text-[#143569]";
    case "REVERSAL":
      return "bg-violet-100 text-violet-700";
    default:
      return "bg-slate-200 text-slate-700";
  }
}

function getMovementActivityDateValue(movement: Movement) {
  if (movement.movementType === "OUT" || movement.movementType === "REVERSAL") {
    return movement.outDate || movement.createdAt;
  }

  return movement.createdAt || movement.deliveryDate || movement.outDate;
}

function getMovementSortTimestamp(movement: Movement) {
  const value = getMovementActivityDateValue(movement);
  if (!value) {
    return 0;
  }

  const parsed = parseDateValue(value);
  const timestamp = parsed.getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatMovementActivityDate(movement: Movement, resolvedTimeZone: string) {
  if ((movement.movementType === "OUT" || movement.movementType === "REVERSAL") && movement.outDate) {
    return formatDateValue(movement.outDate, activityDateFormatter);
  }

  if (movement.createdAt) {
    return formatDateTimeValue(movement.createdAt, resolvedTimeZone);
  }

  if (movement.deliveryDate) {
    return formatDateValue(movement.deliveryDate, activityDateFormatter);
  }

  return "-";
}

function createEmptyContainerTransferForm(): ContainerTransferFormState {
  return {
    notes: "",
    toLocationId: "",
    toStorageSection: "TEMP",
    lineNote: ""
  };
}

function createEmptyContainerAdjustmentForm(items: Item[]): ContainerAdjustmentFormState {
  const quantities = Object.fromEntries(items.map((item) => [containerInventoryItemKey(item), ""]));
  const palletDeltas = Object.fromEntries(items.map((item) => [containerInventoryItemKey(item), ""]));
  return {
    reasonCode: "MANUAL",
    actualAdjustedAt: toDateTimeInputValue(new Date()),
    notes: "",
    lineNote: "",
    quantities,
    palletDeltas
  };
}

function ContainerTransferItemSummary({
  items,
  t
}: {
  items: Item[];
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  if (items.length === 0) {
    return <div className="sheet-note sheet-note--readonly sheet-form__wide">{t("noInventoryAvailable")}</div>;
  }

  return (
    <div className="sheet-form__wide overflow-hidden rounded-xl border border-slate-200/80 bg-white">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.12em] text-slate-500">
          <tr>
            <th className="px-3 py-2 font-semibold">{t("sku")}</th>
            <th className="px-3 py-2 font-semibold">{t("sourceStorage")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("availableQty")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("palletQty")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((item) => (
            <tr key={`${item.id}-${item.skuMasterId}`}>
              <td className="px-3 py-2 font-semibold text-[#143569]">{item.sku}</td>
              <td className="px-3 py-2 text-slate-600">{item.locationName} / {normalizeStorageSection(item.storageSection)}</td>
              <td className="px-3 py-2 text-right font-semibold text-slate-700">{item.availableQty}</td>
              <td className="px-3 py-2 text-right text-slate-600">{item.availableQty >= item.quantity ? item.pallets : 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContainerAdjustmentItemInputs({
  items,
  quantities,
  palletDeltas,
  onQuantityChange,
  onPalletDeltaChange,
  t
}: {
  items: Item[];
  quantities: Record<string, string>;
  palletDeltas: Record<string, string>;
  onQuantityChange: (itemKey: string, value: string) => void;
  onPalletDeltaChange: (itemKey: string, value: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  if (items.length === 0) {
    return <div className="sheet-note sheet-note--readonly sheet-form__wide">{t("noInventoryAvailable")}</div>;
  }

  return (
    <div className="sheet-form__wide overflow-hidden rounded-xl border border-slate-200/80 bg-white">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.12em] text-slate-500">
          <tr>
            <th className="px-3 py-2 font-semibold">{t("sku")}</th>
            <th className="px-3 py-2 font-semibold">{t("sourceStorage")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("onHand")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("palletQty")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("adjustQty")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("adjustPallets")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((item) => {
            const itemKey = containerInventoryItemKey(item);
            return (
              <tr key={itemKey}>
                <td className="px-3 py-2 font-semibold text-[#143569]">{item.sku}</td>
                <td className="px-3 py-2 text-slate-600">{item.locationName} / {normalizeStorageSection(item.storageSection)}</td>
                <td className="px-3 py-2 text-right font-semibold text-slate-700">{item.quantity}</td>
                <td className="px-3 py-2 text-right font-semibold text-slate-700">{item.pallets}</td>
                <td className="px-3 py-2 text-right">
                  <input
                    className="w-24 rounded-md border border-slate-200 px-2 py-1 text-right"
                    type="number"
                    value={quantities[itemKey] ?? ""}
                    onChange={(event) => onQuantityChange(itemKey, event.target.value)}
                    placeholder="0"
                    aria-label={`${t("adjustQty")}: ${item.sku}`}
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    className="w-24 rounded-md border border-slate-200 px-2 py-1 text-right"
                    type="number"
                    value={palletDeltas[itemKey] ?? ""}
                    onChange={(event) => onPalletDeltaChange(itemKey, event.target.value)}
                    placeholder="0"
                    aria-label={`${t("adjustPallets")}: ${item.sku}`}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function canAutoTransferContainerItem(item: Item) {
  return item.availableQty > 0 && (item.pallets <= 0 || item.availableQty >= item.quantity);
}

function buildTransferLinesFromItems(
  items: Item[],
  toLocationId: number,
  toStorageSection: string,
  lineNote: string
) {
  const normalizedLineNote = lineNote.trim() || undefined;
  const normalizedToStorageSection = normalizeStorageSection(toStorageSection);

  return items.flatMap((item) => {
    if (!canAutoTransferContainerItem(item)) {
      return [];
    }

    return [{
      customerId: item.customerId,
      locationId: item.locationId,
      storageSection: normalizeStorageSection(item.storageSection),
      containerId: item.containerId,
      containerNo: normalizeContainerNumber(item.containerNo),
      skuMasterId: item.skuMasterId,
      quantity: item.availableQty,
      pallets: Math.max(0, item.pallets),
      toLocationId,
      toStorageSection: normalizedToStorageSection,
      lineNote: normalizedLineNote
    }];
  });
}

function buildAdjustmentLinesFromItems(
  items: Item[],
  quantities: Record<string, string>,
  palletDeltas: Record<string, string>,
  lineNote: string
) {
  const normalizedLineNote = lineNote.trim() || undefined;

  return items.flatMap((item) => {
    const adjustQty = Number(quantities[containerInventoryItemKey(item)] || 0);
    const adjustPallets = Number(palletDeltas[containerInventoryItemKey(item)] || 0);
    if (!Number.isFinite(adjustQty) || !Number.isFinite(adjustPallets) || (adjustQty === 0 && adjustPallets === 0)) {
      return [];
    }

    return [{
      customerId: item.customerId,
      locationId: item.locationId,
      storageSection: normalizeStorageSection(item.storageSection),
      containerId: item.containerId,
      containerNo: normalizeContainerNumber(item.containerNo),
      skuMasterId: item.skuMasterId,
      adjustQty,
      adjustPallets,
      lineNote: normalizedLineNote
    }];
  });
}

function containerInventoryItemKey(item: Item) {
  return `${item.id}-${item.customerId}-${item.locationId}-${normalizeStorageSection(item.storageSection)}-${item.containerId || 0}-${item.skuMasterId}`;
}

function toDateTimeInputValue(value: Date) {
  const offsetMs = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16);
}
