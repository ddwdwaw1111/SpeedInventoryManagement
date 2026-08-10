import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import CloseIcon from "@mui/icons-material/Close";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import WarehouseOutlinedIcon from "@mui/icons-material/WarehouseOutlined";
import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";

import { api } from "../lib/api";
import type { ContainerContentsRow } from "../lib/containerInventory";
import { toIsoDateTimeString } from "../lib/dates";
import { getErrorMessage } from "../lib/errors";
import { useI18n } from "../lib/i18n";
import {
  getLocationSectionOptions,
  normalizeStorageSection,
  toInventoryProjectionRef,
  type InventoryTransferPayload,
  type Location
} from "../lib/types";
import { InlineAlert, useFeedbackToast } from "./Feedback";
import { InlineLoadingIndicator } from "./InlineLoadingIndicator";

type BulkContainerTransferDialogProps = {
  open: boolean;
  rows: ContainerContentsRow[];
  locations: Location[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

export type BulkContainerTransferPlan = {
  payload: InventoryTransferPayload;
  movableContainers: number;
  alreadyAtDestination: string[];
  blockedContainers: string[];
  totalQty: number;
  totalPallets: number;
};

export function buildBulkContainerTransferPlan(
  rows: ContainerContentsRow[],
  toLocationId: number,
  toStorageSection: string,
  actualTransferredAt = "",
  notes = ""
): BulkContainerTransferPlan {
  const normalizedDestinationSection = normalizeStorageSection(toStorageSection);
  const alreadyAtDestination: string[] = [];
  const blockedContainers: string[] = [];
  const movableContainerKeys = new Set<string>();
  const lines: NonNullable<InventoryTransferPayload["lines"]> = [];

  for (const row of rows) {
    const activeItems = row.items.filter((item) => item.quantity > 0 || item.pallets > 0);
    const movingItems = activeItems.filter((item) => (
      item.locationId !== toLocationId
      || normalizeStorageSection(item.storageSection) !== normalizedDestinationSection
    ));
    if (movingItems.length === 0) {
      alreadyAtDestination.push(row.containerNo);
      continue;
    }
    if (movingItems.some((item) => item.availableQty !== item.quantity || item.availablePallets !== item.pallets)) {
      blockedContainers.push(row.containerNo);
      continue;
    }

    movableContainerKeys.add(row.id);
    for (const item of movingItems) {
      lines.push({
        ...toInventoryProjectionRef(item),
        quantity: item.quantity,
        sourcePallets: item.pallets,
        destinationPallets: item.pallets,
        toLocationId,
        toStorageSection: normalizedDestinationSection,
        lineNote: ""
      });
    }
  }

  return {
    payload: {
      actualTransferredAt: toIsoDateTimeString(actualTransferredAt),
      notes: notes.trim() || undefined,
      lines
    },
    movableContainers: movableContainerKeys.size,
    alreadyAtDestination,
    blockedContainers,
    totalQty: lines.reduce((total, line) => total + line.quantity, 0),
    totalPallets: lines.reduce((total, line) => total + line.sourcePallets, 0)
  };
}

export function BulkContainerTransferDialog({
  open,
  rows,
  locations,
  onClose,
  onSaved
}: BulkContainerTransferDialogProps) {
  const { t } = useI18n();
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
  const [toLocationId, setToLocationId] = useState("");
  const [toStorageSection, setToStorageSection] = useState("");
  const [actualTransferredAt, setActualTransferredAt] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const destinationLocation = locations.find((location) => location.id === Number(toLocationId));
  const destinationSections = getLocationSectionOptions(destinationLocation);
  const plan = useMemo(() => buildBulkContainerTransferPlan(
    rows,
    Number(toLocationId),
    toStorageSection,
    actualTransferredAt,
    notes
  ), [actualTransferredAt, notes, rows, toLocationId, toStorageSection]);
  const canSubmit = Number(toLocationId) > 0
    && Boolean(toStorageSection)
    && plan.movableContainers > 0
    && plan.blockedContainers.length === 0
    && !submitting;

  useEffect(() => {
    if (!open) return;
    const now = new Date();
    const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    const preferredDestination = locations.find((location) => location.name.trim().toUpperCase() === "308");
    setToLocationId(preferredDestination ? String(preferredDestination.id) : "");
    setToStorageSection(getLocationSectionOptions(preferredDestination)[0] ?? "");
    setActualTransferredAt(localTime);
    setNotes("");
    setSubmitting(false);
    setErrorMessage("");
  }, [locations, open]);

  function changeDestination(locationId: string) {
    const nextLocation = locations.find((location) => location.id === Number(locationId));
    setToLocationId(locationId);
    setToStorageSection(getLocationSectionOptions(nextLocation)[0] ?? "");
  }

  async function submitTransfer() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMessage("");
    try {
      await api.createInventoryTransfer(plan.payload);
      await onSaved();
      showSuccess(t("bulkContainerTransferSuccess", { count: plan.movableContainers }));
      onClose();
    } catch (error) {
      const message = getErrorMessage(error, t("couldNotSaveTransfer"));
      setErrorMessage(message);
      showError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {feedbackToast}
      <Dialog open={open} onClose={() => !submitting && onClose()} fullWidth maxWidth="md">
        <DialogTitle sx={{ pb: 1 }}>
          <div className="transfer-dialog__title">
            <span>{t("bulkContainerTransfer")}</span>
            <small>{t("bulkContainerTransferHint")}</small>
          </div>
          <IconButton aria-label={t("close")} onClick={onClose} disabled={submitting} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <div className="bulk-container-transfer">
            {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}

            <div className="bulk-container-transfer__route" aria-hidden="true">
              <span><Inventory2OutlinedIcon fontSize="small" />{t("selectedContainers", { count: rows.length })}</span>
              <ArrowForwardRoundedIcon fontSize="small" />
              <span><WarehouseOutlinedIcon fontSize="small" />{destinationLocation?.name || t("destinationStorage")}</span>
            </div>

            <div className="bulk-container-transfer__fields">
              <label>
                {t("destinationStorage")}
                <select value={toLocationId} onChange={(event) => changeDestination(event.target.value)}>
                  <option value="">{t("selectStorage")}</option>
                  {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                </select>
              </label>
              <label>
                {t("storageSection")}
                <select value={toStorageSection} onChange={(event) => setToStorageSection(event.target.value)} disabled={!destinationLocation}>
                  <option value="">{t("selectStorageSection")}</option>
                  {destinationSections.map((section) => <option key={section} value={section}>{section}</option>)}
                </select>
              </label>
              <label>
                {t("actualTransferredAt")}
                <input type="datetime-local" value={actualTransferredAt} onChange={(event) => setActualTransferredAt(event.target.value)} />
              </label>
            </div>

            <label>
              {t("notes")}
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t("transferNotesPlaceholder")} />
            </label>

            <div className="bulk-container-transfer__summary">
              <article><span>{t("containersToMove")}</span><strong>{plan.movableContainers}</strong></article>
              <article><span>{t("quantity")}</span><strong>{plan.totalQty}</strong></article>
              <article><span>{t("pallets")}</span><strong>{plan.totalPallets}</strong></article>
              <article><span>{t("alreadyAtDestination")}</span><strong>{plan.alreadyAtDestination.length}</strong></article>
            </div>

            {plan.blockedContainers.length > 0 ? (
              <InlineAlert severity="warning">
                {t("bulkContainerTransferBlocked", { containers: plan.blockedContainers.join(", ") })}
              </InlineAlert>
            ) : null}
            {plan.alreadyAtDestination.length > 0 ? (
              <InlineAlert severity="info">
                {t("bulkContainerTransferSkipped", { containers: plan.alreadyAtDestination.join(", ") })}
              </InlineAlert>
            ) : null}

            <div className="bulk-container-transfer__actions">
              <Button variant="text" onClick={onClose} disabled={submitting}>{t("cancel")}</Button>
              <Button
                variant="contained"
                onClick={() => void submitTransfer()}
                disabled={!canSubmit}
                startIcon={submitting ? <InlineLoadingIndicator /> : <WarehouseOutlinedIcon />}
              >
                {submitting ? t("bulkTransferPosting") : t("postContainerTransfers", { count: plan.movableContainers })}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
