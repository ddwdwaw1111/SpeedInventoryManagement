import CloseIcon from "@mui/icons-material/Close";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import WarehouseOutlinedIcon from "@mui/icons-material/WarehouseOutlined";
import { Chip, Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";

import { ApiError, api } from "../lib/api";
import { formatDateTimeValue } from "../lib/dates";
import {
  buildAllContainerContentsRows,
  buildContainerSkuCards,
  formatContainerTimelineValue,
  normalizeContainerNumber,
  type ContainerSkuCard
} from "../lib/containerInventory";
import { setPendingAllActivityContext } from "../lib/allActivityContext";
import { useI18n } from "../lib/i18n";
import { setPendingPalletTraceLaunchContext } from "../lib/palletTraceLaunchContext";
import { useSettings } from "../lib/settings";
import type { PageKey } from "../lib/routes";
import {
  getLocationSectionOptions,
  normalizeStorageSection,
  type Item,
  type Location,
  type Movement,
  type PalletTrace,
  type UserRole
} from "../lib/types";
import { InlineAlert, useFeedbackToast } from "./Feedback";
import { WorkspacePanelHeader } from "./WorkspacePanelChrome";

const PALLETS_PER_PAGE = 6;

type ActiveInventoryDialog = "adjustment" | "transfer" | null;

type ContainerAdjustmentFormState = {
  reasonCode: string;
  notes: string;
  selectedPalletIds: number[];
  lineNote: string;
};

type ContainerTransferFormState = {
  notes: string;
  selectedPalletIds: number[];
  toLocationId: string;
  toStorageSection: string;
  lineNote: string;
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
  onBackToList
}: ContainerDetailPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
  const canManageInventory = currentUserRole === "admin" || currentUserRole === "operator";
  const normalizedContainerNo = normalizeContainerNumber(containerNo);
  const [pallets, setPallets] = useState<PalletTrace[]>([]);
  const [isPalletsLoading, setIsPalletsLoading] = useState(false);
  const [palletErrorMessage, setPalletErrorMessage] = useState("");
  const [palletPage, setPalletPage] = useState(1);
  const [palletReloadToken, setPalletReloadToken] = useState(0);
  const [activeInventoryDialog, setActiveInventoryDialog] = useState<ActiveInventoryDialog>(null);
  const [inventoryDialogError, setInventoryDialogError] = useState("");
  const [inventoryDialogSubmitting, setInventoryDialogSubmitting] = useState(false);
  const [adjustmentForm, setAdjustmentForm] = useState<ContainerAdjustmentFormState>(createEmptyContainerAdjustmentForm());
  const [transferForm, setTransferForm] = useState<ContainerTransferFormState>(createEmptyContainerTransferForm());

  const containerRows = useMemo(
    () => buildAllContainerContentsRows(items, movements, locations),
    [items, locations, movements]
  );
  const container = useMemo(
    () => containerRows.find((row) => row.containerNo === normalizedContainerNo) ?? null,
    [containerRows, normalizedContainerNo]
  );
  const skuCards = useMemo(() => buildContainerSkuCards(container?.items ?? []), [container?.items]);
  const isHistoricalOnly = Boolean(container && container.rowCount === 0);
  const actionablePallets = useMemo(
    () => pallets.filter((pallet) => isPalletActionable(pallet)),
    [pallets]
  );
  const defaultSelectedPalletIds = useMemo(
    () => actionablePallets.length === 1 ? [actionablePallets[0].id] : [],
    [actionablePallets]
  );
  const selectedAdjustmentPallets = useMemo(
    () => actionablePallets.filter((pallet) => adjustmentForm.selectedPalletIds.includes(pallet.id)),
    [actionablePallets, adjustmentForm.selectedPalletIds]
  );
  const selectedTransferPallets = useMemo(
    () => actionablePallets.filter((pallet) => transferForm.selectedPalletIds.includes(pallet.id)),
    [actionablePallets, transferForm.selectedPalletIds]
  );
  const transferDestinationLocation = useMemo(
    () => locations.find((location) => location.id === Number(transferForm.toLocationId)) ?? null,
    [locations, transferForm.toLocationId]
  );
  const transferDestinationSections = useMemo(
    () => getLocationSectionOptions(transferDestinationLocation ?? undefined),
    [transferDestinationLocation]
  );
  const canOpenAdjustmentDialog = canManageInventory && actionablePallets.length > 0;
  const canOpenTransferDialog = canManageInventory && actionablePallets.length > 0;

  useEffect(() => {
    let active = true;

    async function loadPallets() {
      if (!normalizedContainerNo) {
        setPallets([]);
        setPalletErrorMessage("");
        setIsPalletsLoading(false);
        return;
      }

      setIsPalletsLoading(true);
      setPalletErrorMessage("");
      try {
        const nextPallets = await api.getPallets(300, normalizedContainerNo);
        if (!active) return;
        setPallets(nextPallets
          .filter((pallet) => normalizeContainerNumber(pallet.currentContainerNo) === normalizedContainerNo)
          .sort(comparePallets));
      } catch (error) {
        if (!active) return;
        setPalletErrorMessage(getErrorMessage(error, t("couldNotLoadReport")));
      } finally {
        if (active) {
          setIsPalletsLoading(false);
        }
      }
    }

    void loadPallets();
    return () => {
      active = false;
    };
  }, [normalizedContainerNo, palletReloadToken, routeKey, t]);

  const totalPalletPages = Math.max(1, Math.ceil(pallets.length / PALLETS_PER_PAGE));
  const paginatedPallets = useMemo(() => {
    const startIndex = (palletPage - 1) * PALLETS_PER_PAGE;
    return pallets.slice(startIndex, startIndex + PALLETS_PER_PAGE);
  }, [palletPage, pallets]);

  useEffect(() => {
    setPalletPage(1);
  }, [normalizedContainerNo]);

  useEffect(() => {
    setPalletPage((current) => Math.min(current, totalPalletPages));
  }, [totalPalletPages]);

  function openAdjustmentDialog() {
    setAdjustmentForm(createEmptyContainerAdjustmentForm(defaultSelectedPalletIds));
    setInventoryDialogError("");
    setInventoryDialogSubmitting(false);
    setActiveInventoryDialog("adjustment");
  }

  function openTransferDialog() {
    setTransferForm(createEmptyContainerTransferForm(defaultSelectedPalletIds));
    setInventoryDialogError("");
    setInventoryDialogSubmitting(false);
    setActiveInventoryDialog("transfer");
  }

  function closeInventoryDialog(force = false) {
    if (inventoryDialogSubmitting && !force) {
      return;
    }

    setActiveInventoryDialog(null);
    setInventoryDialogError("");
    setAdjustmentForm(createEmptyContainerAdjustmentForm(defaultSelectedPalletIds));
    setTransferForm(createEmptyContainerTransferForm(defaultSelectedPalletIds));
  }

  async function handleSubmitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedAdjustmentPallets.length === 0) {
      setInventoryDialogError(t("selectAtLeastOnePallet"));
      return;
    }
    if (!adjustmentForm.reasonCode.trim()) {
      setInventoryDialogError(t("reasonCode"));
      return;
    }

    const adjustmentLines = buildAdjustmentLinesFromPallets(selectedAdjustmentPallets, adjustmentForm.lineNote);
    if (adjustmentLines.length === 0) {
      setInventoryDialogError(t("containerDetailNoActionablePallets"));
      return;
    }

    setInventoryDialogSubmitting(true);
    setInventoryDialogError("");

    try {
      await api.createInventoryAdjustment({
        reasonCode: adjustmentForm.reasonCode.trim(),
        notes: adjustmentForm.notes.trim() || undefined,
        lines: adjustmentLines
      });
      await onRefresh();
      setPalletReloadToken((current) => current + 1);
      closeInventoryDialog(true);
      showSuccess(t("adjustmentSavedSuccess"));
    } catch (error) {
      const message = getErrorMessage(error, t("couldNotSaveAdjustment"));
      setInventoryDialogError(message);
      showError(message);
    } finally {
      setInventoryDialogSubmitting(false);
    }
  }

  async function handleSubmitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedTransferPallets.length === 0) {
      setInventoryDialogError(t("selectAtLeastOnePallet"));
      return;
    }
    if (Number(transferForm.toLocationId) <= 0) {
      setInventoryDialogError(t("selectStorage"));
      return;
    }

    const transferLines = buildTransferLinesFromPallets(
      selectedTransferPallets,
      Number(transferForm.toLocationId),
      transferForm.toStorageSection,
      transferForm.lineNote
    );
    if (transferLines.length === 0) {
      setInventoryDialogError(t("containerDetailNoActionablePallets"));
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
      setPalletReloadToken((current) => current + 1);
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

  function handleOpenPalletWorkspace() {
    if (!normalizedContainerNo) {
      return;
    }

    setPendingPalletTraceLaunchContext({ searchTerm: normalizedContainerNo });
    onNavigate("pallet-trace");
  }

  const openPalletCount = useMemo(
    () => pallets.filter((pallet) => pallet.status === "OPEN" || pallet.status === "PARTIAL").length,
    [pallets]
  );

  return (
    <main className="workspace-main">
      <div className="space-y-6 pb-6">
        <section className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,#f4f8ff_0%,#eef4fb_100%)] px-5 py-5 shadow-[0_18px_48px_rgba(10,31,68,0.06)]">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2.5">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 ring-1 ring-slate-200/70">
                <span>{t("containerDetailEyebrow")}</span>
              </div>
              <div>
                <h1 className="font-headline text-3xl font-extrabold tracking-tight text-[#0d2d63]">
                  {normalizedContainerNo || t("containerDetailMissingTitle")}
                </h1>
                {container ? (
                  <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#143569] ring-1 ring-slate-200/80">
                    <span>{isHistoricalOnly ? t("containerDetailHistoricalBadge") : t("containerDetailCurrentBadge")}</span>
                  </div>
                ) : null}
                <p className="mt-1.5 max-w-3xl text-sm text-slate-600">
                  {container
                    ? t("containerDetailSubtitle", {
                      customer: container.customerSummary || "-",
                      warehouse: container.warehouseSummary || "-"
                    })
                    : t("containerDetailMissingDesc")}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onBackToList}
                className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#143569] ring-1 ring-slate-200 transition hover:bg-slate-50"
              >
                <OpenInNewRoundedIcon sx={{ fontSize: 18 }} />
                {t("back")}
              </button>
              <button
                type="button"
                onClick={handleOpenActivity}
                disabled={!container}
                className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#143569] ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <HistoryOutlinedIcon sx={{ fontSize: 18 }} />
                {t("allActivity")}
              </button>
              {canManageInventory ? (
                <button
                  type="button"
                  onClick={openAdjustmentDialog}
                  disabled={!canOpenAdjustmentDialog}
                  className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#143569] ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <WarehouseOutlinedIcon sx={{ fontSize: 18 }} />
                  {t("addAdjustment")}
                </button>
              ) : null}
              {canManageInventory ? (
                <button
                  type="button"
                  onClick={openTransferDialog}
                  disabled={!canOpenTransferDialog}
                  className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#143569] ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <WarehouseOutlinedIcon sx={{ fontSize: 18 }} />
                  {t("addTransfer")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleOpenPalletWorkspace}
                disabled={!normalizedContainerNo}
                className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#143569] ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <WarehouseOutlinedIcon sx={{ fontSize: 18 }} />
                {t("openPalletWorkspace")}
              </button>
            </div>
          </div>

          <div className="mt-5 rounded-[22px] border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_32px_rgba(15,23,42,0.04)]">
            {isLoading ? (
              <div className="grid gap-4 md:grid-cols-4 animate-pulse">
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="rounded-[18px] border border-slate-200/80 bg-slate-50/80 p-4">
                    <div className="h-4 w-24 rounded-full bg-slate-200" />
                    <div className="mt-4 h-8 w-20 rounded-full bg-slate-200" />
                    <div className="mt-3 h-3 w-full rounded-full bg-slate-200" />
                  </div>
                ))}
              </div>
            ) : container ? (
              <>
                <div className="grid gap-3 md:grid-cols-4">
                  <OverviewStatCard icon={<WarehouseOutlinedIcon sx={{ fontSize: 18 }} />} label={t("skuCount")} value={String(skuCards.length)} meta={t("containerItems")} />
                  <OverviewStatCard icon={<WarehouseOutlinedIcon sx={{ fontSize: 18 }} />} label={t("onHand")} value={String(container.onHand)} meta={t("availableQty")} secondaryValue={String(container.availableQty)} />
                  <OverviewStatCard icon={<WarehouseOutlinedIcon sx={{ fontSize: 18 }} />} label={t("palletTrace")} value={String(pallets.length)} meta={t("palletOpenCount")} secondaryValue={String(openPalletCount)} />
                  <OverviewStatCard icon={<WarehouseOutlinedIcon sx={{ fontSize: 18 }} />} label={t("currentInventoryRows")} value={String(container.rowCount)} meta={container.warehouseSummary || "-"} />
                </div>

                <div className="mt-4 rounded-[20px] bg-[#143569] px-4 py-4 text-white shadow-[0_14px_30px_rgba(20,53,105,0.22)]">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <DetailStatRow label={t("customer")} value={container.customerSummary} />
                    <DetailStatRow label={t("currentStorage")} value={container.warehouseSummary} />
                    <DetailStatRow label={t("pickLocations")} value={container.pickLocationSummary} />
                    <DetailStatRow label={t("containerReceivedAt")} value={formatContainerTimelineValue(container.receivedAt, resolvedTimeZone)} />
                    <DetailStatRow label={t("containerShippedAt")} value={formatContainerTimelineValue(container.shippedAt, resolvedTimeZone, t("containerNotShipped"))} />
                  </div>
                </div>

                {isHistoricalOnly ? (
                  <div className="mt-4 rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                    {t("containerNoCurrentInventoryNotice")}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="rounded-[18px] border border-slate-200/80 bg-slate-50/80 px-4 py-5 text-sm text-slate-600">
                <strong className="block text-base font-semibold text-slate-800">{t("containerDetailMissingTitle")}</strong>
                <span className="mt-2 block">{t("containerDetailMissingDesc")}</span>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_16px_34px_rgba(15,23,42,0.05)]">
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

        <section className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_16px_34px_rgba(15,23,42,0.05)]">
          <WorkspacePanelHeader
            title={t("containerDetailPalletTitle")}
            description={t("containerDetailPalletDesc")}
            actions={pallets.length > PALLETS_PER_PAGE ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPalletPage((current) => Math.max(1, current - 1))}
                  disabled={palletPage === 1}
                  className="inline-flex items-center rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-xs font-semibold text-[#143569] transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t("previousPage")}
                </button>
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {t("containerDetailPalletPageStatus", { page: palletPage, pages: totalPalletPages })}
                </span>
                <button
                  type="button"
                  onClick={() => setPalletPage((current) => Math.min(totalPalletPages, current + 1))}
                  disabled={palletPage >= totalPalletPages}
                  className="inline-flex items-center rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-xs font-semibold text-[#143569] transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t("nextPage")}
                </button>
              </div>
            ) : undefined}
            errorMessage={palletErrorMessage}
          />
          {isPalletsLoading ? (
            <CardSkeletonGrid />
          ) : pallets.length > 0 ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {paginatedPallets.map((pallet) => (
                <PalletTraceCard
                  key={pallet.id}
                  pallet={pallet}
                  resolvedTimeZone={resolvedTimeZone}
                  t={t}
                />
              ))}
            </div>
          ) : (
            <div className="sheet-note sheet-note--readonly">{t("containerDetailNoCurrentPallets")}</div>
          )}
        </section>
      </div>
      {feedbackToast}

      <Dialog
        open={activeInventoryDialog === "adjustment"}
        onClose={(_, reason) => {
          if (reason === "backdropClick") return;
          closeInventoryDialog();
        }}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle sx={{ pb: 1 }}>
          {t("addAdjustment")}
          <IconButton aria-label={t("close")} onClick={() => closeInventoryDialog()} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {inventoryDialogError ? <InlineAlert>{inventoryDialogError}</InlineAlert> : null}
          <form className="sheet-form" onSubmit={handleSubmitAdjustment}>
            <PalletSelectionList
              pallets={actionablePallets}
              selectedPalletIds={adjustmentForm.selectedPalletIds}
              onToggle={(palletId) => setAdjustmentForm((current) => ({
                ...current,
                selectedPalletIds: toggleSelectedPalletId(current.selectedPalletIds, palletId)
              }))}
              t={t}
            />
            <label>{t("reasonCode")}<input value={adjustmentForm.reasonCode} onChange={(event) => setAdjustmentForm((current) => ({ ...current, reasonCode: event.target.value }))} placeholder="COUNT_GAIN / DAMAGE / CORRECTION" required /></label>
            <label className="sheet-form__wide">{t("notes")}<input value={adjustmentForm.notes} onChange={(event) => setAdjustmentForm((current) => ({ ...current, notes: event.target.value }))} placeholder={t("adjustmentNotesPlaceholder")} /></label>
            <label className="sheet-form__wide">{t("internalNotes")}<input value={adjustmentForm.lineNote} onChange={(event) => setAdjustmentForm((current) => ({ ...current, lineNote: event.target.value }))} placeholder={t("adjustmentLineNotePlaceholder")} /></label>

            <div className="sheet-form__actions sheet-form__wide">
              <button className="button button--primary" type="submit" disabled={inventoryDialogSubmitting}>{inventoryDialogSubmitting ? t("saving") : t("saveAdjustment")}</button>
              <button className="button button--ghost" type="button" onClick={() => closeInventoryDialog()} disabled={inventoryDialogSubmitting}>{t("cancel")}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={activeInventoryDialog === "transfer"}
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
            <PalletSelectionList
              pallets={actionablePallets}
              selectedPalletIds={transferForm.selectedPalletIds}
              onToggle={(palletId) => setTransferForm((current) => ({
                ...current,
                selectedPalletIds: toggleSelectedPalletId(current.selectedPalletIds, palletId)
              }))}
              t={t}
            />
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
    </main>
  );
}

function SkuSnapshotCard({
  card,
  t,
  onOpenActivity
}: {
  card: ContainerSkuCard;
  t: (key: string) => string;
  onOpenActivity: () => void;
}) {
  return (
    <article className="rounded-[20px] border border-slate-200/80 bg-[linear-gradient(180deg,#f8fbff_0%,#f2f6fb_100%)] p-4 shadow-[0_10px_22px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{card.itemNumber || t("itemNumber")}</div>
          <h3 className="mt-1 text-lg font-extrabold tracking-tight text-[#0d2d63]">{card.sku}</h3>
        </div>
        <span className="rounded-full bg-white/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#143569] ring-1 ring-slate-200/80">
          {card.customerSummary}
        </span>
      </div>
      <p className="mt-3 text-sm text-slate-600">{card.description}</p>
      <div className="mt-4 rounded-[16px] border border-slate-200/80 bg-white/90 px-3 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{t("currentStorage")}</div>
        <div className="mt-1 text-sm font-semibold text-slate-700">{card.storageSummary}</div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <SmallMetricCard label={t("onHand")} value={String(card.onHand)} />
        <SmallMetricCard label={t("availableQty")} value={String(card.availableQty)} />
        <SmallMetricCard label={t("damagedQty")} value={String(card.damagedQty)} />
        <SmallMetricCard label={t("currentInventoryRows")} value={String(card.rowCount)} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onOpenActivity}
          className="inline-flex items-center rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-xs font-semibold text-[#143569] transition hover:bg-slate-50"
        >
          {t("allActivity")}
        </button>
      </div>
    </article>
  );
}

function PalletTraceCard({
  pallet,
  resolvedTimeZone,
  t
}: {
  pallet: PalletTrace;
  resolvedTimeZone: string;
  t: (key: string) => string;
}) {
  const totalQuantity = pallet.contents.reduce((sum, content) => sum + content.quantity, 0);

  return (
    <article className="rounded-[20px] border border-slate-200/80 bg-slate-50/70 p-4 shadow-[0_10px_22px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{t("palletCode")}</div>
          <h3 className="mt-1 text-lg font-extrabold tracking-tight text-[#0d2d63]">{pallet.palletCode}</h3>
        </div>
        <Chip
          size="small"
          label={getPalletStatusLabel(t, pallet.status)}
          color={getPalletStatusColor(pallet.status)}
          variant={pallet.status === "SHIPPED" || pallet.status === "CANCELLED" ? "outlined" : "filled"}
        />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <SmallMetricCard label={t("currentStorage")} value={pallet.currentLocationName || "-"} />
        <SmallMetricCard label={t("storageSection")} value={pallet.currentStorageSection || "-"} />
        <SmallMetricCard label={t("recordCount")} value={String(pallet.contents.length)} />
        <SmallMetricCard label={t("quantity")} value={String(totalQuantity)} />
      </div>

      <div className="mt-4 rounded-[16px] border border-slate-200/80 bg-white/90 px-3 py-3">
        <div className="grid gap-2 md:grid-cols-2">
          <TimelineStat label={t("created")} value={formatDateTimeValue(pallet.createdAt, resolvedTimeZone)} />
          <TimelineStat label={t("updated")} value={formatDateTimeValue(pallet.updatedAt, resolvedTimeZone)} />
        </div>
      </div>
      <div className="mt-4 rounded-[16px] border border-slate-200/80 bg-white/90 px-3 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{t("palletContents")}</div>
        {pallet.contents.length > 0 ? (
          <div className="mt-3 space-y-2.5">
            {pallet.contents.map((content) => (
              <div key={content.id} className="rounded-[14px] border border-slate-200/80 bg-slate-50/80 px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-800">{content.itemNumber || content.sku || "-"}</div>
                    <div className="mt-1 text-sm text-slate-600">{content.description || "-"}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{t("quantity")}</div>
                    <div className="mt-1 text-base font-extrabold tracking-tight text-[#0d2d63]">{content.quantity}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 text-sm text-slate-500">{t("palletNoContents")}</div>
        )}
      </div>
    </article>
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
    <article className="rounded-[18px] border border-slate-200/80 bg-slate-50/70 p-3 shadow-[0_8px_18px_rgba(15,23,42,0.03)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-[#143569]">
          {icon}
        </div>
        {secondaryValue ? <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{secondaryValue}</span> : null}
      </div>
      <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="mt-1.5 text-xl font-extrabold tracking-tight text-[#0d2d63]">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{meta}</div>
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
    <div className="rounded-[14px] border border-slate-200/80 bg-white/90 px-3 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-1 text-base font-extrabold tracking-tight text-[#0d2d63] break-words">{value}</div>
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

function comparePallets(left: PalletTrace, right: PalletTrace) {
  const leftStatus = getPalletStatusRank(left.status);
  const rightStatus = getPalletStatusRank(right.status);
  if (leftStatus !== rightStatus) {
    return leftStatus - rightStatus;
  }

  return left.palletCode.localeCompare(right.palletCode);
}

function getPalletStatusRank(status: string) {
  switch (status) {
    case "OPEN":
      return 0;
    case "PARTIAL":
      return 1;
    case "SHIPPED":
      return 2;
    case "CANCELLED":
      return 3;
    default:
      return 4;
  }
}

function getPalletStatusLabel(t: (key: string) => string, status: string) {
  switch (status) {
    case "OPEN":
      return t("palletOpen");
    case "PARTIAL":
      return t("palletPartial");
    case "SHIPPED":
      return t("palletShipped");
    case "CANCELLED":
      return t("palletCancelled");
    default:
      return status || t("pending");
  }
}

function getPalletStatusColor(status: string): "success" | "warning" | "default" {
  switch (status) {
    case "OPEN":
      return "success";
    case "PARTIAL":
      return "warning";
    default:
      return "default";
  }
}

function getErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message || fallbackMessage;
  }
  return fallbackMessage;
}

function createEmptyContainerAdjustmentForm(selectedPalletIds: number[] = []): ContainerAdjustmentFormState {
  return {
    reasonCode: "",
    notes: "",
    selectedPalletIds,
    lineNote: ""
  };
}

function createEmptyContainerTransferForm(selectedPalletIds: number[] = []): ContainerTransferFormState {
  return {
    notes: "",
    selectedPalletIds,
    toLocationId: "",
    toStorageSection: "TEMP",
    lineNote: ""
  };
}

function PalletSelectionList({
  pallets,
  selectedPalletIds,
  onToggle,
  t
}: {
  pallets: PalletTrace[];
  selectedPalletIds: number[];
  onToggle: (palletId: number) => void;
  t: (key: string) => string;
}) {
  const selectedCount = selectedPalletIds.length;
  const selectedAvailableQty = pallets
    .filter((pallet) => selectedPalletIds.includes(pallet.id))
    .reduce((sum, pallet) => sum + getPalletAvailableQty(pallet), 0);

  return (
    <div className="sheet-form__wide space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-[16px] border border-slate-200/80 bg-slate-50/80 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{t("selectPallets")}</div>
          <div className="mt-1 text-xs text-slate-500">{t("containerDetailPalletActionHint")}</div>
        </div>
        <div className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 ring-1 ring-slate-200/80">
          {t("selected")} {selectedCount} · {t("availableQty")} {selectedAvailableQty}
        </div>
      </div>

      {pallets.length > 0 ? (
        <div className="grid max-h-[360px] gap-3 overflow-y-auto pr-1">
          {pallets.map((pallet) => {
            const palletAvailableQty = getPalletAvailableQty(pallet);
            const palletTotalQty = getPalletTotalQty(pallet);
            const selectableContents = pallet.contents.filter((content) => getPalletContentAvailableQty(content) > 0);
            const checked = selectedPalletIds.includes(pallet.id);

            return (
              <label
                key={pallet.id}
                className={`cursor-pointer rounded-[18px] border px-4 py-3 transition ${checked ? "border-[#143569] bg-[#eff5ff] shadow-[0_10px_22px_rgba(20,53,105,0.08)]" : "border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50/80"}`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={checked}
                    onChange={() => onToggle(pallet.id)}
                  />
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{t("palletCode")}</div>
                        <div className="mt-1 text-base font-extrabold tracking-tight text-[#0d2d63]">{pallet.palletCode}</div>
                        <div className="mt-1 text-sm text-slate-600">{pallet.currentLocationName} / {normalizeStorageSection(pallet.currentStorageSection)}</div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:min-w-[220px]">
                        <SmallMetricCard label={t("availableQty")} value={String(palletAvailableQty)} />
                        <SmallMetricCard label={t("onHand")} value={String(palletTotalQty)} />
                      </div>
                    </div>

                    <div className="space-y-2">
                      {selectableContents.map((content) => (
                        <div key={content.id} className="rounded-[14px] border border-slate-200/80 bg-slate-50/80 px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-semibold text-slate-800">{content.itemNumber || content.sku || "-"}</div>
                              <div className="mt-1 text-sm text-slate-600">{content.description || "-"}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{t("availableQty")}</div>
                              <div className="mt-1 text-base font-extrabold tracking-tight text-[#0d2d63]">{getPalletContentAvailableQty(content)}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      ) : (
        <div className="sheet-note sheet-note--readonly">{t("containerDetailNoActionablePallets")}</div>
      )}
    </div>
  );
}

function toggleSelectedPalletId(selectedPalletIds: number[], palletId: number) {
  if (selectedPalletIds.includes(palletId)) {
    return selectedPalletIds.filter((value) => value !== palletId);
  }

  return [...selectedPalletIds, palletId];
}

function isPalletActionable(pallet: PalletTrace) {
  return (pallet.status === "OPEN" || pallet.status === "PARTIAL") && getPalletAvailableQty(pallet) > 0;
}

function getPalletTotalQty(pallet: PalletTrace) {
  return pallet.contents.reduce((sum, content) => sum + content.quantity, 0);
}

function getPalletAvailableQty(pallet: PalletTrace) {
  return pallet.contents.reduce((sum, content) => sum + getPalletContentAvailableQty(content), 0);
}

function getPalletContentAvailableQty(content: PalletTrace["contents"][number]) {
  return Math.max(0, content.quantity - (content.allocatedQty ?? 0) - (content.damagedQty ?? 0) - (content.holdQty ?? 0));
}

function buildAdjustmentLinesFromPallets(pallets: PalletTrace[], lineNote: string) {
  const normalizedLineNote = lineNote.trim() || undefined;

  return pallets.flatMap((pallet) => pallet.contents.flatMap((content) => {
    const availableQty = getPalletContentAvailableQty(content);
    if (availableQty <= 0) {
      return [];
    }

    return [{
      customerId: pallet.customerId,
      locationId: pallet.currentLocationId,
      storageSection: normalizeStorageSection(pallet.currentStorageSection),
      containerNo: normalizeContainerNumber(pallet.currentContainerNo),
      palletId: pallet.id,
      skuMasterId: content.skuMasterId,
      adjustQty: -availableQty,
      lineNote: normalizedLineNote
    }];
  }));
}

function buildTransferLinesFromPallets(
  pallets: PalletTrace[],
  toLocationId: number,
  toStorageSection: string,
  lineNote: string
) {
  const normalizedLineNote = lineNote.trim() || undefined;
  const normalizedToStorageSection = normalizeStorageSection(toStorageSection);

  return pallets.flatMap((pallet) => pallet.contents.flatMap((content) => {
    const availableQty = getPalletContentAvailableQty(content);
    if (availableQty <= 0) {
      return [];
    }

    return [{
      customerId: pallet.customerId,
      locationId: pallet.currentLocationId,
      storageSection: normalizeStorageSection(pallet.currentStorageSection),
      containerNo: normalizeContainerNumber(pallet.currentContainerNo),
      palletId: pallet.id,
      skuMasterId: content.skuMasterId,
      quantity: availableQty,
      toLocationId,
      toStorageSection: normalizedToStorageSection,
      lineNote: normalizedLineNote
    }];
  }));
}