import BalanceOutlinedIcon from "@mui/icons-material/BalanceOutlined";
import CloseIcon from "@mui/icons-material/Close";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import { Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import { api } from "../lib/api";
import { toIsoDateTimeString } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import {
  buildInventoryProjectionKey,
  normalizeStorageSection,
  toInventoryProjectionRef,
  type Item
} from "../lib/types";
import { InlineAlert, useFeedbackToast } from "./Feedback";

type ContainerAdjustmentDialogProps = {
  open: boolean;
  items: Item[];
  initialSourceKey?: string;
  preferredContainerNo?: string;
  initialReasonCode?: string;
  containerFilter?: string;
  customerIdFilter?: number;
  quickMode?: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

type AdjustmentFormState = {
  adjustmentNo: string;
  reasonCode: string;
  actualAdjustedAt: string;
  notes: string;
};

type AdjustmentLineState = {
  id: string;
  bucketKey: string;
  adjustQty: number;
  adjustPallets: number;
  lineNote: string;
};

type AdjustmentEntryMode = "FINAL" | "DELTA";

type AdjustmentContainerOption = {
  key: string;
  containerNo: string;
  customerName: string;
  locationName: string;
  storageSections: string[];
  items: Item[];
  totalQty: number;
  totalPallets: number;
};

const emptyAdjustmentForm: AdjustmentFormState = {
  adjustmentNo: "",
  reasonCode: "",
  actualAdjustedAt: "",
  notes: ""
};

const reasonCodePresets = ["COUNT_GAIN", "COUNT_LOSS", "DAMAGE", "CORRECTION", "WRITE_OFF", "RETURN"];

function buildAdjustmentContainerOptions(items: Item[]) {
  const optionsByKey = new Map<string, AdjustmentContainerOption>();

  for (const item of items) {
    const containerNo = item.containerNo.trim().toUpperCase();
    const storageSection = normalizeStorageSection(item.storageSection);
    const key = containerNo
      ? [item.customerId, item.locationId, containerNo].join(":")
      : `unassigned:${buildInventoryProjectionKey(toInventoryProjectionRef(item))}`;
    const existing = optionsByKey.get(key);
    if (existing) {
      existing.items.push(item);
      existing.totalQty += item.quantity;
      existing.totalPallets += item.pallets;
      if (!existing.storageSections.includes(storageSection)) {
        existing.storageSections.push(storageSection);
      }
      continue;
    }

    optionsByKey.set(key, {
      key,
      containerNo,
      customerName: item.customerName,
      locationName: item.locationName,
      storageSections: [storageSection],
      items: [item],
      totalQty: item.quantity,
      totalPallets: item.pallets
    });
  }

  return [...optionsByKey.values()]
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

function buildLines(option: AdjustmentContainerOption) {
  return option.items.map((item): AdjustmentLineState => {
    const bucketKey = buildInventoryProjectionKey(toInventoryProjectionRef(item));
    return {
      id: bucketKey,
      bucketKey,
      adjustQty: 0,
      adjustPallets: 0,
      lineNote: ""
    };
  });
}

export function ContainerAdjustmentDialog({
  open,
  items,
  initialSourceKey = "",
  preferredContainerNo = "",
  initialReasonCode = "",
  containerFilter = "",
  customerIdFilter,
  quickMode = false,
  onClose,
  onSaved
}: ContainerAdjustmentDialogProps) {
  const { t } = useI18n();
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
  const [form, setForm] = useState<AdjustmentFormState>(emptyAdjustmentForm);
  const [selectedContainerKey, setSelectedContainerKey] = useState("");
  const [entryMode, setEntryMode] = useState<AdjustmentEntryMode>("FINAL");
  const [lines, setLines] = useState<AdjustmentLineState[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const normalizedContainerFilter = containerFilter.trim().toUpperCase();
  const containerOptions = useMemo(() => buildAdjustmentContainerOptions(items)
    .filter((option) => (!normalizedContainerFilter || option.containerNo === normalizedContainerFilter)
      && (!customerIdFilter || option.items[0]?.customerId === customerIdFilter)), [customerIdFilter, items, normalizedContainerFilter]);
  const selectedContainer = useMemo(
    () => containerOptions.find((option) => option.key === selectedContainerKey) ?? null,
    [containerOptions, selectedContainerKey]
  );
  const sourceItemsByKey = useMemo(() => new Map(
    items.map((item) => [buildInventoryProjectionKey(toInventoryProjectionRef(item)), item])
  ), [items]);

  useEffect(() => {
    if (!open) return;
    const normalizedPreferredContainerNo = preferredContainerNo.trim().toUpperCase();
    const initialMatches = containerOptions.filter((option) => normalizedPreferredContainerNo
      ? option.containerNo === normalizedPreferredContainerNo
        && (!initialSourceKey || option.items.some((item) => `${item.customerId}:${item.sku.trim().toUpperCase()}` === initialSourceKey))
      : initialSourceKey
        ? option.items.some((item) => `${item.customerId}:${item.sku.trim().toUpperCase()}` === initialSourceKey)
        : false);
    const initialContainer = initialMatches.length === 1 ? initialMatches[0] : undefined;
    setForm({ ...emptyAdjustmentForm, reasonCode: initialReasonCode.trim().toUpperCase() });
    setSelectedContainerKey(initialContainer?.key ?? "");
    setEntryMode("FINAL");
    setLines(initialContainer ? buildLines(initialContainer) : []);
    setSubmitting(false);
    setErrorMessage("");
  }, [containerOptions, initialReasonCode, initialSourceKey, open, preferredContainerNo]);

  function handleClose() {
    if (submitting) return;
    setSubmitting(false);
    setErrorMessage("");
    onClose();
  }

  function selectContainer(containerKey: string) {
    const option = containerOptions.find((candidate) => candidate.key === containerKey);
    setSelectedContainerKey(containerKey);
    setLines(option ? buildLines(option) : []);
    setErrorMessage("");
  }

  function updateLine(lineId: string, patch: Partial<AdjustmentLineState>) {
    setLines((current) => current.map((line) => line.id === lineId ? { ...line, ...patch } : line));
  }

  const activeLines = lines.filter((line) => line.adjustQty !== 0 || line.adjustPallets !== 0);
  const invalidLines = lines.filter((line) => {
    const item = sourceItemsByKey.get(line.bucketKey);
    if (!item) return false;
    const minimumQty = item.allocatedQty + item.damagedQty + item.holdQty;
    const minimumPallets = item.allocatedPallets;
    return item.quantity + line.adjustQty < minimumQty || item.pallets + line.adjustPallets < minimumPallets;
  });
  const totalQtyDelta = activeLines.reduce((total, line) => total + line.adjustQty, 0);
  const totalPalletDelta = activeLines.reduce((total, line) => total + line.adjustPallets, 0);
  const hasCompleteDraft = Boolean(selectedContainer)
    && Boolean(form.reasonCode.trim())
    && activeLines.length > 0
    && invalidLines.length === 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasCompleteDraft || submitting) return;
    setSubmitting(true);
    setErrorMessage("");

    try {
      await api.createInventoryAdjustment({
        adjustmentNo: form.adjustmentNo || undefined,
        reasonCode: form.reasonCode,
        actualAdjustedAt: toIsoDateTimeString(form.actualAdjustedAt),
        notes: form.notes || undefined,
        lines: activeLines
          .map((line) => {
            const item = sourceItemsByKey.get(line.bucketKey);
            if (!item) return null;
            const balanceInput = entryMode === "FINAL"
              ? {
                finalQty: item.quantity + line.adjustQty,
                finalPallets: item.pallets + line.adjustPallets
              }
              : {
                adjustQty: line.adjustQty,
                adjustPallets: line.adjustPallets
              };
            return {
              ...toInventoryProjectionRef(item),
              ...balanceInput,
              lineNote: line.lineNote || undefined
            };
          })
          .filter((line): line is NonNullable<typeof line> => line !== null)
      });
      await onSaved();
      showSuccess(t("adjustmentSavedSuccess"));
      setErrorMessage("");
      setSubmitting(false);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : t("couldNotSaveAdjustment");
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
          <div className="adjustment-dialog__title">
            <span>{quickMode ? t("quickAdjustment") : t("addAdjustment")}</span>
            <small>{t("adjustmentQuickHint")}</small>
          </div>
          <IconButton aria-label={t("close")} disabled={submitting} onClick={handleClose} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers className="adjustment-dialog__content">
          {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}
          <form className="adjustment-compose" onSubmit={handleSubmit}>
            {containerOptions.length === 0 ? (
              <InlineAlert severity="info">{t("noAdjustableInventory")}</InlineAlert>
            ) : (
              <div className="adjustment-control-deck">
                <section className="adjustment-control-panel adjustment-control-panel--container">
                  <div className="adjustment-control-label"><Inventory2OutlinedIcon fontSize="small" />1 · {t("adjustmentContainer")}</div>
                  <label htmlFor="adjustment-container-select">
                    {t("containerNo")}
                    <select id="adjustment-container-select" value={selectedContainerKey} onChange={(event) => selectContainer(event.target.value)}>
                      <option value="">{t("selectContainerToAdjust")}</option>
                      {containerOptions.map((option) => (
                        <option key={option.key} value={option.key}>
                          {`${option.containerNo || `${t("unassignedInventory")} / ${option.items[0]!.sku}`} | ${option.customerName} | ${option.locationName} / ${option.storageSections.join(", ")} | ${option.totalQty} QTY | ${option.totalPallets} ${t("pallets")}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedContainer ? (
                    <div className="adjustment-container-summary">
                      <strong>{selectedContainer.containerNo || t("unassignedInventory")}</strong>
                      <span>{selectedContainer.customerName}</span>
                      <span>{`${selectedContainer.locationName} / ${selectedContainer.storageSections.join(", ")}`}</span>
                    </div>
                  ) : null}
                </section>

                <section className="adjustment-control-panel adjustment-control-panel--reason">
                  <div className="adjustment-control-label"><TuneRoundedIcon fontSize="small" />2 · {t("reasonCode")}</div>
                  <label htmlFor="adjustment-reason-code">
                    {t("reasonCode")}
                    <input
                      id="adjustment-reason-code"
                      value={form.reasonCode}
                      list="adjustment-reason-presets"
                      onChange={(event) => setForm((current) => ({ ...current, reasonCode: event.target.value.toUpperCase() }))}
                      placeholder={t("selectAdjustmentReason")}
                      required
                    />
                  </label>
                  <datalist id="adjustment-reason-presets">
                    {reasonCodePresets.map((reasonCode) => <option key={reasonCode} value={reasonCode} />)}
                  </datalist>
                  <div className="adjustment-reason-presets">
                    {reasonCodePresets.slice(0, 4).map((reasonCode) => (
                      <button key={reasonCode} type="button" className={form.reasonCode === reasonCode ? "is-active" : ""} onClick={() => setForm((current) => ({ ...current, reasonCode }))}>{reasonCode}</button>
                    ))}
                  </div>
                </section>

                <section className="adjustment-control-panel adjustment-control-panel--mode">
                  <div className="adjustment-control-label"><BalanceOutlinedIcon fontSize="small" />3 · {t("adjustmentEntryMode")}</div>
                  <div className="adjustment-mode-toggle" role="group" aria-label={t("adjustmentEntryMode")}>
                    <button type="button" className={entryMode === "FINAL" ? "is-active" : ""} aria-pressed={entryMode === "FINAL"} onClick={() => setEntryMode("FINAL")}>
                      <strong>{t("finalBalance")}</strong>
                      <small>{t("finalBalanceHint")}</small>
                    </button>
                    <button type="button" className={entryMode === "DELTA" ? "is-active" : ""} aria-pressed={entryMode === "DELTA"} onClick={() => setEntryMode("DELTA")}>
                      <strong>{t("changeAmount")}</strong>
                      <small>{t("changeAmountHint")}</small>
                    </button>
                  </div>
                </section>
              </div>
            )}

            {selectedContainer ? (
              <section className="adjustment-manifest">
                <header className="adjustment-manifest__header">
                  <div>
                    <strong>{t("containerContents")}</strong>
                    <small>{entryMode === "FINAL" ? t("finalBalanceHint") : t("changeAmountHint")}</small>
                  </div>
                  <div className="adjustment-manifest__totals">
                    <span>QTY<strong>{formatSignedNumber(totalQtyDelta)}</strong></span>
                    <span>{t("pallets")}<strong>{formatSignedNumber(totalPalletDelta)}</strong></span>
                  </div>
                </header>
                <div className="adjustment-lines">
                  {lines.map((line) => {
                    const item = sourceItemsByKey.get(line.bucketKey);
                    if (!item) return null;
                    const sourceSection = normalizeStorageSection(item.storageSection);
                    const afterQty = item.quantity + line.adjustQty;
                    const afterPallets = item.pallets + line.adjustPallets;
                    const minimumQty = item.allocatedQty + item.damagedQty + item.holdQty;
                    const minimumPallets = item.allocatedPallets;
                    const qtyInvalid = afterQty < minimumQty;
                    const palletsInvalid = afterPallets < minimumPallets;
                    const isChanged = line.adjustQty !== 0 || line.adjustPallets !== 0;

                    return (
                      <article className={`adjustment-stock-row${isChanged ? " is-changed" : ""}${qtyInvalid || palletsInvalid ? " has-error" : ""}`} key={line.id}>
                        <header className="adjustment-stock-row__identity">
                          <div>
                            <span className="cell--mono">{item.itemNumber || "-"}</span>
                            <strong>{item.sku}</strong>
                            <small>{item.description || item.name || "-"}</small>
                            <small className="adjustment-stock-row__source">{`${item.locationName} / ${sourceSection}`}</small>
                          </div>
                          <div className="adjustment-stock-row__current">
                            <span>{t("currentBalance")} QTY<strong>{item.quantity}</strong></span>
                            <span>{t("currentBalance")} {t("pallets")}<strong>{item.pallets}</strong></span>
                          </div>
                        </header>

                        <div className="adjustment-balance-fields">
                          <div className={`adjustment-balance-field${qtyInvalid ? " adjustment-balance-field--error" : ""}`}>
                            <label htmlFor={`adjustment-qty-${line.id}`}>{entryMode === "FINAL" ? t("finalQty") : t("adjustQty")}</label>
                            <input
                              aria-label={`${entryMode === "FINAL" ? t("finalQty") : t("adjustQty")} - ${item.sku} - ${sourceSection}`}
                              id={`adjustment-qty-${line.id}`}
                              type="number"
                              step="1"
                              value={entryMode === "FINAL" ? String(afterQty) : numberInputValue(line.adjustQty)}
                              onChange={(event) => updateLine(line.id, {
                                adjustQty: entryMode === "FINAL"
                                  ? Number(event.target.value || 0) - item.quantity
                                  : Number(event.target.value || 0)
                              })}
                            />
                            <div className="adjustment-balance-field__result">
                              <span>{item.quantity}</span><strong>→</strong><b>{afterQty}</b>
                            </div>
                            <small>{qtyInvalid
                              ? t("adjustmentQtyFloorWarning", { minimum: String(minimumQty) })
                              : `${t("availableQty")}: ${item.availableQty} · ${t("adjustment")}: ${formatSignedNumber(line.adjustQty)}`}</small>
                          </div>

                          <div className={`adjustment-balance-field${palletsInvalid ? " adjustment-balance-field--error" : ""}`}>
                            <label htmlFor={`adjustment-pallets-${line.id}`}>{entryMode === "FINAL" ? t("finalPallets") : `${t("adjustment")} (${t("pallets")})`}</label>
                            <input
                              aria-label={`${entryMode === "FINAL" ? t("finalPallets") : `${t("adjustment")} (${t("pallets")})`} - ${item.sku} - ${sourceSection}`}
                              id={`adjustment-pallets-${line.id}`}
                              type="number"
                              step="1"
                              value={entryMode === "FINAL" ? String(afterPallets) : numberInputValue(line.adjustPallets)}
                              onChange={(event) => updateLine(line.id, {
                                adjustPallets: entryMode === "FINAL"
                                  ? Number(event.target.value || 0) - item.pallets
                                  : Number(event.target.value || 0)
                              })}
                            />
                            <div className="adjustment-balance-field__result">
                              <span>{item.pallets}</span><strong>→</strong><b>{afterPallets}</b>
                            </div>
                            <small>{palletsInvalid
                              ? t("adjustmentPalletFloorWarning", { minimum: String(minimumPallets) })
                              : `${t("availablePallets")}: ${item.availablePallets} · ${t("adjustment")}: ${formatSignedNumber(line.adjustPallets)}`}</small>
                          </div>
                        </div>

                        <details className="adjustment-line-options">
                          <summary>{t("optionalDetails")}</summary>
                          <label htmlFor={`adjustment-note-${line.id}`}>{t("internalNotes")}<input id={`adjustment-note-${line.id}`} value={line.lineNote} onChange={(event) => updateLine(line.id, { lineNote: event.target.value })} placeholder={t("adjustmentLineNotePlaceholder")} /></label>
                        </details>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : containerOptions.length > 0 ? (
              <InlineAlert severity="info">{t("selectContainerBeforeAdjustment")}</InlineAlert>
            ) : null}

            <details className="adjustment-document-options">
              <summary><TuneRoundedIcon fontSize="small" />{t("optionalDetails")}</summary>
              <div className="sheet-form">
                <label>{t("adjustmentNo")}<input value={form.adjustmentNo} onChange={(event) => setForm((current) => ({ ...current, adjustmentNo: event.target.value }))} placeholder={t("autoGeneratedOptional")} /></label>
                <label>{t("actualAdjustedAt")}<input type="datetime-local" value={form.actualAdjustedAt} onChange={(event) => setForm((current) => ({ ...current, actualAdjustedAt: event.target.value }))} /></label>
                <label className="sheet-form__wide">{t("notes")}<input value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder={t("adjustmentNotesPlaceholder")} /></label>
              </div>
            </details>

            <div className="adjustment-compose__actions">
              <div>
                <strong>{selectedContainer ? selectedContainer.containerNo || t("unassignedInventory") : t("adjustmentReadyTitle")}</strong>
                <small>{invalidLines.length > 0
                  ? t("adjustmentBalanceInvalidHint")
                  : !form.reasonCode.trim()
                    ? t("adjustmentReasonHint")
                    : activeLines.length === 0
                      ? t("completeContainerAdjustmentHint")
                      : t("containerAdjustmentReadyHint", { count: String(activeLines.length), qty: formatSignedNumber(totalQtyDelta), pallets: formatSignedNumber(totalPalletDelta) })}</small>
              </div>
              <button className="button button--primary" type="submit" disabled={!hasCompleteDraft || submitting}>{submitting ? t("saving") : t("saveAdjustment")}</button>
              <button className="button button--ghost" type="button" disabled={submitting} onClick={handleClose}>{t("cancel")}</button>
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

function formatSignedNumber(value: number) {
  return `${value >= 0 ? "+" : ""}${new Intl.NumberFormat("en-US").format(value)}`;
}
