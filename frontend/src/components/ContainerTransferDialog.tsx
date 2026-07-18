import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import CloseIcon from "@mui/icons-material/Close";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import WarehouseOutlinedIcon from "@mui/icons-material/WarehouseOutlined";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";

import { api } from "../lib/api";
import { toIsoDateTimeString } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import {
  buildInventoryProjectionKey,
  getLocationSectionOptions,
  normalizeStorageSection,
  toInventoryProjectionRef,
  type Item,
  type Location
} from "../lib/types";
import { InlineAlert, useFeedbackToast } from "./Feedback";

type ContainerTransferDialogProps = {
  open: boolean;
  items: Item[];
  locations: Location[];
  initialSourceKey?: string;
  preferredContainerNo?: string;
  containerFilter?: string;
  customerIdFilter?: number;
  quickMode?: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

type TransferFormState = {
  transferNo: string;
  actualTransferredAt: string;
  notes: string;
};

type TransferLineFormState = {
  id: string;
  sourceBucketKey: string;
  quantity: number;
  pallets: number;
  toLocationId: string;
  toStorageSection: string;
  lineNote: string;
};

type TransferMode = "ENTIRE" | "PARTIAL";

type TransferContainerOption = {
  key: string;
  containerNo: string;
  customerName: string;
  locationName: string;
  storageSections: string[];
  items: Item[];
  totalAvailableQty: number;
  totalAvailablePallets: number;
};

const emptyTransferForm: TransferFormState = {
  transferNo: "",
  actualTransferredAt: "",
  notes: ""
};

function createTransferLine(
  item: Item,
  mode: TransferMode | null,
  destination: Pick<TransferLineFormState, "toLocationId" | "toStorageSection">
): TransferLineFormState {
  const sourceBucketKey = buildInventoryProjectionKey(toInventoryProjectionRef(item));
  return {
    id: sourceBucketKey,
    sourceBucketKey,
    quantity: mode === "ENTIRE" ? item.quantity : 0,
    pallets: mode === "ENTIRE" ? item.pallets : 0,
    ...destination,
    lineNote: ""
  };
}

function buildTransferContainerOptions(items: Item[]) {
  const optionsByKey = new Map<string, TransferContainerOption>();

  for (const item of items) {
    const containerNo = item.containerNo.trim().toUpperCase();
    const storageSection = normalizeStorageSection(item.storageSection);
    const key = containerNo
      ? [item.customerId, item.locationId, containerNo].join(":")
      : `unassigned:${buildInventoryProjectionKey(toInventoryProjectionRef(item))}`;
    const existing = optionsByKey.get(key);
    if (existing) {
      existing.items.push(item);
      if (!existing.storageSections.includes(storageSection)) {
        existing.storageSections.push(storageSection);
      }
      existing.totalAvailableQty += item.availableQty;
      existing.totalAvailablePallets += item.availablePallets;
      continue;
    }

    optionsByKey.set(key, {
      key,
      containerNo,
      customerName: item.customerName,
      locationName: item.locationName,
      storageSections: [storageSection],
      items: [item],
      totalAvailableQty: item.availableQty,
      totalAvailablePallets: item.availablePallets
    });
  }

  return [...optionsByKey.values()]
    .filter((option) => option.totalAvailableQty > 0 || option.totalAvailablePallets > 0)
    .map((option) => ({
      ...option,
      storageSections: [...option.storageSections].sort(),
      items: [...option.items].sort((left, right) => (
        left.sku.localeCompare(right.sku)
        || normalizeStorageSection(left.storageSection).localeCompare(normalizeStorageSection(right.storageSection))
      ))
    }))
    .sort((left, right) => {
      if (left.containerNo && right.containerNo) return left.containerNo.localeCompare(right.containerNo);
      if (left.containerNo) return -1;
      if (right.containerNo) return 1;
      return left.items[0]!.sku.localeCompare(right.items[0]!.sku);
    });
}

function isEntireContainerTransferable(container: TransferContainerOption | null) {
  if (!container?.containerNo) return false;
  return container.items.every((item) => (
    item.availableQty === item.quantity
    && item.availablePallets === item.pallets
  ));
}

export function ContainerTransferDialog({
  open,
  items,
  locations,
  initialSourceKey = "",
  preferredContainerNo = "",
  containerFilter = "",
  customerIdFilter,
  quickMode = false,
  onClose,
  onSaved
}: ContainerTransferDialogProps) {
  const { t } = useI18n();
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
  const [form, setForm] = useState<TransferFormState>(emptyTransferForm);
  const [lines, setLines] = useState<TransferLineFormState[]>([]);
  const [selectedContainerKey, setSelectedContainerKey] = useState("");
  const [transferMode, setTransferMode] = useState<TransferMode | null>(null);
  const [destinationResetNotice, setDestinationResetNotice] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const normalizedContainerFilter = containerFilter.trim().toUpperCase();
  const transferContainerOptions = useMemo(() => buildTransferContainerOptions(items)
    .filter((option) => (!normalizedContainerFilter || option.containerNo === normalizedContainerFilter)
      && (!customerIdFilter || option.items[0]?.customerId === customerIdFilter)), [customerIdFilter, items, normalizedContainerFilter]);
  const selectedContainer = useMemo(
    () => transferContainerOptions.find((option) => option.key === selectedContainerKey) ?? null,
    [selectedContainerKey, transferContainerOptions]
  );
  const sourceItemsByKey = useMemo(() => new Map(
    items.map((item) => [buildInventoryProjectionKey(toInventoryProjectionRef(item)), item])
  ), [items]);

  useEffect(() => {
    if (!open) return;
    const normalizedPreferredContainerNo = preferredContainerNo.trim().toUpperCase();
    const initialContainerMatches = transferContainerOptions.filter((option) => normalizedPreferredContainerNo
      ? option.containerNo === normalizedPreferredContainerNo
        && (!initialSourceKey || option.items.some((item) => `${item.customerId}:${item.sku.trim().toUpperCase()}` === initialSourceKey))
      : initialSourceKey
        ? option.items.some((item) => `${item.customerId}:${item.sku.trim().toUpperCase()}` === initialSourceKey)
        : false);
    const initialContainer = initialContainerMatches.length === 1 ? initialContainerMatches[0] : undefined;
    setForm(emptyTransferForm);
    setTransferMode(null);
    setDestinationResetNotice(false);
    setSelectedContainerKey(initialContainer?.key ?? "");
    setLines(initialContainer ? buildLinesForContainer(initialContainer, null) : []);
    setErrorMessage("");
    setSubmitting(false);
  }, [initialSourceKey, open, preferredContainerNo, transferContainerOptions]);

  function handleClose() {
    if (submitting) return;
    setErrorMessage("");
    onClose();
  }

  function updateLine(lineId: string, patch: Partial<TransferLineFormState>) {
    setLines((current) => current.map((line) => line.id === lineId ? { ...line, ...patch } : line));
  }

  function getDestinationSections(sourceItems: Item[], location: Location | undefined) {
    const sections = getLocationSectionOptions(location);
    if (sourceItems.length === 0 || !location || location.id !== sourceItems[0]!.locationId) {
      return sections;
    }
    const sourceSections = new Set(sourceItems.map((item) => normalizeStorageSection(item.storageSection)));
    return sections.filter((section) => !sourceSections.has(normalizeStorageSection(section)));
  }

  function buildLinesForContainer(container: TransferContainerOption, mode: TransferMode | null) {
    const destination = { toLocationId: "", toStorageSection: "" };
    return container.items.map((item) => createTransferLine(item, mode, destination));
  }

  function selectContainer(containerKey: string) {
    const container = transferContainerOptions.find((option) => option.key === containerKey);
    setSelectedContainerKey(containerKey);
    setTransferMode(null);
    setDestinationResetNotice(false);
    setLines(container ? buildLinesForContainer(container, null) : []);
  }

  function changeTransferMode(mode: TransferMode) {
    if (!selectedContainer || (mode === "ENTIRE" && !isEntireContainerTransferable(selectedContainer))) return;
    setTransferMode(mode);
    setLines((current) => current.map((line) => {
      const item = sourceItemsByKey.get(line.sourceBucketKey);
      return {
        ...line,
        quantity: mode === "ENTIRE" ? item?.quantity ?? 0 : 0,
        pallets: mode === "ENTIRE" ? item?.pallets ?? 0 : 0
      };
    }));
  }

  function updateDestination(toLocationId: string) {
    const nextLocation = locations.find((location) => location.id === Number(toLocationId));
    const toStorageSection = getDestinationSections(destinationSourceItems, nextLocation)[0] ?? "";
    setDestinationResetNotice(false);
    setLines((current) => current.map((line) => ({ ...line, toLocationId, toStorageSection })));
  }

  function updateDestinationSection(toStorageSection: string) {
    setDestinationResetNotice(false);
    setLines((current) => current.map((line) => ({ ...line, toStorageSection })));
  }

  const hasQtyOverflow = lines.some((line) => {
    const item = sourceItemsByKey.get(line.sourceBucketKey);
    return item !== undefined && (line.quantity > item.availableQty || line.pallets > item.availablePallets);
  });
  const activeLines = lines.filter((line) => line.quantity > 0 || line.pallets > 0);
  const canTransferEntireContainer = isEntireContainerTransferable(selectedContainer);
  const hasInvalidEntireMode = transferMode === "ENTIRE" && !canTransferEntireContainer;
  const activeSourceItems = activeLines
    .map((line) => sourceItemsByKey.get(line.sourceBucketKey))
    .filter((item): item is Item => item !== undefined);
  const destinationSourceItems = activeSourceItems.length > 0
    ? activeSourceItems
    : selectedContainer?.items ?? [];
  const hasIncompleteLines = !selectedContainer
    || !transferMode
    || hasInvalidEntireMode
    || activeLines.length === 0
    || activeLines.some((line) => Number(line.toLocationId) <= 0 || !line.toStorageSection);
  const hasSameStockPosition = activeLines.some((line) => {
    const item = sourceItemsByKey.get(line.sourceBucketKey);
    return item !== undefined
      && item.locationId === Number(line.toLocationId)
      && normalizeStorageSection(item.storageSection) === normalizeStorageSection(line.toStorageSection);
  });
  const destinationLine = lines[0];
  const destinationLocation = locations.find((location) => location.id === Number(destinationLine?.toLocationId));
  const destinationSections = getDestinationSections(destinationSourceItems, destinationLocation);
  const destinationLocations = selectedContainer
    ? locations.filter((location) => getDestinationSections(destinationSourceItems, location).length > 0)
    : locations;
  const totalTransferQty = activeLines.reduce((total, line) => total + line.quantity, 0);
  const totalTransferPallets = activeLines.reduce((total, line) => total + line.pallets, 0);

  useEffect(() => {
    if (!hasSameStockPosition) return;
    setLines((current) => current.map((line) => ({
      ...line,
      toLocationId: "",
      toStorageSection: ""
    })));
    setDestinationResetNotice(true);
  }, [hasSameStockPosition]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (hasQtyOverflow || hasIncompleteLines || hasSameStockPosition || hasInvalidEntireMode) return;
    setSubmitting(true);
    setErrorMessage("");

    try {
      const destination = lines[0];
      const entireContainer = transferMode === "ENTIRE" && selectedContainer && destination
        ? {
          customerId: selectedContainer.items[0]!.customerId,
          locationId: selectedContainer.items[0]!.locationId,
          containerNo: selectedContainer.containerNo,
          toLocationId: Number(destination.toLocationId),
          toStorageSection: destination.toStorageSection || undefined
        }
        : undefined;
      await api.createInventoryTransfer({
        transferNo: form.transferNo || undefined,
        actualTransferredAt: toIsoDateTimeString(form.actualTransferredAt),
        notes: form.notes || undefined,
        entireContainer,
        lines: transferMode === "PARTIAL" ? activeLines
          .map((line) => {
            const selectedItem = sourceItemsByKey.get(line.sourceBucketKey);
            if (!selectedItem || Number(line.toLocationId) <= 0 || (line.quantity <= 0 && line.pallets <= 0)) {
              return null;
            }

            return {
              ...toInventoryProjectionRef(selectedItem),
              quantity: line.quantity,
              pallets: line.pallets,
              toLocationId: Number(line.toLocationId),
              toStorageSection: line.toStorageSection || undefined,
              lineNote: line.lineNote || undefined
            };
          })
          .filter((line): line is NonNullable<typeof line> => line !== null) : undefined
      });
      await onSaved();
      showSuccess(t("transferSavedSuccess"));
      setErrorMessage("");
      setSubmitting(false);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : t("couldNotSaveTransfer");
      setErrorMessage(message);
      showError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {feedbackToast}
      <Dialog
        open={open}
        onClose={(_, reason) => {
          if (reason === "backdropClick" || submitting) return;
          handleClose();
        }}
        fullWidth
        maxWidth="lg"
      >
        <DialogTitle sx={{ pb: 1 }}>
          <div className="transfer-dialog__title">
            <span>{quickMode ? t("quickTransfer") : t("addTransfer")}</span>
            <small>{t("transferQuickHint")}</small>
          </div>
          <IconButton aria-label={t("close")} onClick={handleClose} disabled={submitting} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers className="transfer-dialog__content">
          {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}
          <form className="transfer-compose" onSubmit={handleSubmit}>
            <div className="transfer-flow-strip" aria-hidden="true">
              <span><Inventory2OutlinedIcon fontSize="small" />1 · {t("transferContainer")}</span>
              <ArrowForwardRoundedIcon fontSize="small" />
              <span>2 · {t("containerTransferScope")}</span>
              <ArrowForwardRoundedIcon fontSize="small" />
              <span><WarehouseOutlinedIcon fontSize="small" />3 · {t("destinationStorage")}</span>
            </div>

            {transferContainerOptions.length === 0 ? (
              <InlineAlert severity="info">{t("noTransferableInventory")}</InlineAlert>
            ) : (
              <>
                <div className="transfer-container-deck">
                  <section className="transfer-container-picker">
                    <div className="transfer-control-label"><Inventory2OutlinedIcon fontSize="small" />{t("transferContainer")}</div>
                    <label htmlFor="transfer-container-select">
                      {t("containerNo")}
                      <select id="transfer-container-select" value={selectedContainerKey} onChange={(event) => selectContainer(event.target.value)}>
                        <option value="">{t("selectContainerToTransfer")}</option>
                        {transferContainerOptions.map((container) => (
                          <option key={container.key} value={container.key}>
                            {`${container.containerNo || `${t("unassignedInventory")} / ${container.items[0]!.sku}`} | ${container.customerName} | ${container.locationName} / ${container.storageSections.join(", ")} | ${t("availableQty")}: ${container.totalAvailableQty} | ${t("pallets")}: ${container.totalAvailablePallets}`}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedContainer ? (
                      <div className="transfer-container-summary">
                        <strong>{selectedContainer.containerNo || t("unassignedInventory")}</strong>
                        <span>{selectedContainer.customerName}</span>
                        <span>{`${selectedContainer.locationName} / ${selectedContainer.storageSections.join(", ")}`}</span>
                        <span>{`${selectedContainer.items.length} SKU · ${selectedContainer.totalAvailableQty} QTY · ${selectedContainer.totalAvailablePallets} ${t("pallets")}`}</span>
                      </div>
                    ) : null}
                  </section>

                  <section className="transfer-scope-panel">
                    <div className="transfer-control-label">{t("containerTransferScope")}</div>
                    <div className="transfer-scope-toggle" role="group" aria-label={t("containerTransferScope")}>
                      <button type="button" className={transferMode === "ENTIRE" ? "is-active" : ""} aria-pressed={transferMode === "ENTIRE"} disabled={!canTransferEntireContainer} onClick={() => changeTransferMode("ENTIRE")}>
                        <strong>{t("entireContainer")}</strong>
                        <small>{t("entireContainerHint")}</small>
                      </button>
                      <button type="button" className={transferMode === "PARTIAL" ? "is-active" : ""} aria-pressed={transferMode === "PARTIAL"} disabled={!selectedContainer} onClick={() => changeTransferMode("PARTIAL")}>
                        <strong>{t("partialContainer")}</strong>
                        <small>{t("partialContainerHint")}</small>
                      </button>
                    </div>
                    {selectedContainer?.containerNo && !canTransferEntireContainer ? (
                      <InlineAlert severity="warning">{t("entireContainerUnavailableHint")}</InlineAlert>
                    ) : null}
                  </section>

                  <section className="transfer-destination-panel">
                    <div className="transfer-control-label"><WarehouseOutlinedIcon fontSize="small" />{t("destinationStorage")}</div>
                    <div className="transfer-destination-fields">
                      <label htmlFor="transfer-destination-location">
                        {t("destinationStorage")}
                        <select id="transfer-destination-location" value={destinationLine?.toLocationId ?? ""} disabled={!selectedContainer || !transferMode} onChange={(event) => updateDestination(event.target.value)}>
                          <option value="">{t("selectStorage")}</option>
                          {destinationLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                        </select>
                      </label>
                      <label htmlFor="transfer-destination-section">
                        {t("toSection")}
                        <select id="transfer-destination-section" value={destinationLine?.toStorageSection ?? ""} disabled={!transferMode || !destinationLine?.toLocationId} onChange={(event) => updateDestinationSection(event.target.value)}>
                          <option value="">{t("selectStorageSection")}</option>
                          {destinationSections.map((section) => <option key={section} value={section}>{section}</option>)}
                        </select>
                      </label>
                    </div>
                    {destinationResetNotice ? (
                      <InlineAlert className="transfer-destination-warning" severity="warning">
                        {t("transferDestinationResetHint")}
                      </InlineAlert>
                    ) : null}
                  </section>
                </div>

                {selectedContainer ? (
                  <section className="transfer-manifest">
                    <header className="transfer-manifest__header">
                      <div>
                        <strong>{t("containerContents")}</strong>
                        <small>{transferMode === "ENTIRE"
                          ? t("entireContainerManifestHint")
                          : transferMode === "PARTIAL"
                            ? t("partialContainerManifestHint")
                            : t("selectTransferScopeHint")}</small>
                      </div>
                      <div className="transfer-manifest__totals">
                        <span>{t("transferQty")}<strong>{totalTransferQty}</strong></span>
                        <span>{t("pallets")}<strong>{totalTransferPallets}</strong></span>
                      </div>
                    </header>
                    <div className="transfer-lines">
                      {lines.map((line) => {
                        const selectedItem = sourceItemsByKey.get(line.sourceBucketKey);
                        if (!selectedItem) return null;
                        const qtyOverflow = line.quantity > selectedItem.availableQty;
                        const palletOverflow = line.pallets > selectedItem.availablePallets;
                        const sourceSection = normalizeStorageSection(selectedItem.storageSection);

                        return (
                          <article className={`transfer-container-item${line.quantity > 0 || line.pallets > 0 ? " is-selected" : ""}`} key={line.id}>
                            <header className="transfer-container-item__identity">
                              <div>
                                <span className="cell--mono">{selectedItem.itemNumber || "-"}</span>
                                <strong>{selectedItem.sku}</strong>
                                <small>{selectedItem.description || selectedItem.name || "-"}</small>
                                <small className="transfer-container-item__source-section">{`${t("storageSection")}: ${sourceSection}`}</small>
                              </div>
                              <div className="transfer-container-item__available">
                                <span>{t("availableQty")}<strong>{selectedItem.availableQty}</strong></span>
                                <span>{t("pallets")}<strong>{selectedItem.availablePallets}</strong></span>
                              </div>
                            </header>

                            <div className="transfer-amounts">
                              <div className={`transfer-amount-field${qtyOverflow ? " transfer-amount-field--error" : ""}`}>
                                <span className="transfer-amount-field__label">{t("transferQty")}</span>
                                {transferMode === "ENTIRE" ? (
                                  <strong className="transfer-amount-field__locked">{line.quantity}</strong>
                                ) : (
                                  <div>
                                    <input aria-label={`${t("transferQty")} - ${selectedItem.sku} - ${sourceSection}`} id={`transfer-qty-${line.id}`} type="number" min="0" value={numberInputValue(line.quantity)} disabled={!transferMode || selectedItem.availableQty <= 0} onChange={(event) => updateLine(line.id, { quantity: Math.max(0, Number(event.target.value || 0)) })} />
                                    <button aria-label={`${t("allAvailable")} ${t("transferQty")} - ${selectedItem.sku} - ${sourceSection}`} type="button" disabled={!transferMode || selectedItem.availableQty <= 0} onClick={() => updateLine(line.id, { quantity: selectedItem.availableQty })}>{t("allAvailable")}</button>
                                  </div>
                                )}
                                <small>{!transferMode
                                  ? t("selectTransferScopeHint")
                                  : qtyOverflow
                                    ? t("transferQtyExceedsAvailable", { available: String(selectedItem.availableQty) })
                                    : line.quantity > 0
                                      ? `${t("remainingAfterTransfer")}: ${selectedItem.availableQty - line.quantity}`
                                      : t("quantityAndPalletsIndependent")}</small>
                              </div>
                              <div className={`transfer-amount-field${palletOverflow ? " transfer-amount-field--error" : ""}`}>
                                <span className="transfer-amount-field__label">{t("transferPallets")}</span>
                                {transferMode === "ENTIRE" ? (
                                  <strong className="transfer-amount-field__locked">{line.pallets}</strong>
                                ) : (
                                  <div>
                                    <input aria-label={`${t("transferPallets")} - ${selectedItem.sku} - ${sourceSection}`} id={`transfer-pallets-${line.id}`} type="number" min="0" value={numberInputValue(line.pallets)} disabled={!transferMode || selectedItem.availablePallets <= 0} onChange={(event) => updateLine(line.id, { pallets: Math.max(0, Number(event.target.value || 0)) })} />
                                    <button aria-label={`${t("allAvailable")} ${t("transferPallets")} - ${selectedItem.sku} - ${sourceSection}`} type="button" disabled={!transferMode || selectedItem.availablePallets <= 0} onClick={() => updateLine(line.id, { pallets: selectedItem.availablePallets })}>{t("allAvailable")}</button>
                                  </div>
                                )}
                                <small>{!transferMode
                                  ? t("selectTransferScopeHint")
                                  : palletOverflow
                                    ? t("transferPalletsExceedsAvailable", { available: String(selectedItem.availablePallets) })
                                    : t("palletTransferHint")}</small>
                              </div>
                            </div>

                            <details className="transfer-line-options">
                              <summary>{t("optionalDetails")}</summary>
                              <label htmlFor={`transfer-note-${line.id}`}>{t("internalNotes")}<input id={`transfer-note-${line.id}`} value={line.lineNote} onChange={(event) => updateLine(line.id, { lineNote: event.target.value })} placeholder={t("transferLineNotePlaceholder")} /></label>
                            </details>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ) : (
                  <InlineAlert severity="info">{t("selectContainerBeforeTransfer")}</InlineAlert>
                )}
              </>
            )}

            <details className="transfer-document-options">
              <summary><TuneRoundedIcon fontSize="small" />{t("optionalDetails")}</summary>
              <div className="sheet-form">
                <label>{t("transferNo")}<input value={form.transferNo} onChange={(event) => setForm((current) => ({ ...current, transferNo: event.target.value }))} placeholder={t("autoGeneratedOptional")} /></label>
                <label>{t("actualTransferredAt")}<input type="datetime-local" value={form.actualTransferredAt} onChange={(event) => setForm((current) => ({ ...current, actualTransferredAt: event.target.value }))} /></label>
                <label className="sheet-form__wide">{t("notes")}<input value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder={t("transferNotesPlaceholder")} /></label>
              </div>
            </details>

            <div className="transfer-compose__actions">
              <div>
                <strong>{selectedContainer ? `${selectedContainer.containerNo || t("unassignedInventory")} → ${destinationLocation?.name || t("selectStorage")}` : t("transferReadyTitle")}</strong>
                <small>{hasSameStockPosition || destinationResetNotice
                    ? t("transferDestinationResetHint")
                    : selectedContainer && !transferMode
                      ? t("selectTransferScopeHint")
                      : hasIncompleteLines
                        ? t("completeContainerTransferHint")
                        : t("containerTransferReadyHint", { qty: String(totalTransferQty), pallets: String(totalTransferPallets) })}</small>
              </div>
              <button className="button button--primary" type="submit" disabled={submitting || hasQtyOverflow || hasIncompleteLines || hasSameStockPosition || hasInvalidEntireMode}>{submitting ? t("saving") : t("saveTransfer")}</button>
              <button className="button button--ghost" type="button" onClick={handleClose} disabled={submitting}>{t("cancel")}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function numberInputValue(value: number) {
  return value === 0 ? "" : String(value);
}
