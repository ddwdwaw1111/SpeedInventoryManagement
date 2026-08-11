import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import CloseIcon from "@mui/icons-material/Close";
import WarehouseOutlinedIcon from "@mui/icons-material/WarehouseOutlined";
import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";

import { api } from "../lib/api";
import { toIsoDateTimeString } from "../lib/dates";
import { getErrorMessage } from "../lib/errors";
import { useI18n } from "../lib/i18n";
import type { Item, Location } from "../lib/types";
import { InlineAlert, useFeedbackToast } from "./Feedback";
import { InlineLoadingIndicator } from "./InlineLoadingIndicator";

type EntireWarehouseTransferDialogProps = {
  open: boolean;
  items: Item[];
  locations: Location[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

function localDateTimeNow() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function EntireWarehouseTransferDialog({
  open,
  items,
  locations,
  onClose,
  onSaved
}: EntireWarehouseTransferDialogProps) {
  const { t } = useI18n();
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [actualTransferredAt, setActualTransferredAt] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const activeItems = useMemo(
    () => items.filter((item) => item.quantity > 0 || item.pallets > 0),
    [items]
  );
  const sourceLocations = useMemo(
    () => locations.filter((location) => activeItems.some((item) => item.locationId === location.id)),
    [activeItems, locations]
  );
  const sourceItems = useMemo(
    () => activeItems.filter((item) => item.locationId === Number(fromLocationId)),
    [activeItems, fromLocationId]
  );
  const blockedItems = useMemo(
    () => sourceItems.filter((item) => item.availableQty !== item.quantity || item.availablePallets !== item.pallets),
    [sourceItems]
  );
  const containerCount = useMemo(
    () => new Set(sourceItems.map((item) => `${item.customerId}:${item.containerNo.trim().toUpperCase()}`)).size,
    [sourceItems]
  );
  const totalQty = sourceItems.reduce((sum, item) => sum + item.quantity, 0);
  const totalPallets = sourceItems.reduce((sum, item) => sum + item.pallets, 0);
  const sourceLocation = locations.find((location) => location.id === Number(fromLocationId));
  const destinationLocation = locations.find((location) => location.id === Number(toLocationId));
  const canSubmit = Number(fromLocationId) > 0
    && Number(toLocationId) > 0
    && fromLocationId !== toLocationId
    && sourceItems.length > 0
    && blockedItems.length === 0
    && !submitting;

  useEffect(() => {
    if (!open) return;
    setFromLocationId("");
    setToLocationId("");
    setActualTransferredAt(localDateTimeNow());
    setNotes("");
    setSubmitting(false);
    setErrorMessage("");
  }, [open]);

  function changeSource(locationId: string) {
    setFromLocationId(locationId);
    if (locationId === toLocationId) {
      setToLocationId("");
    }
  }

  async function submitTransfer() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMessage("");
    try {
      await api.createInventoryTransfer({
        actualTransferredAt: toIsoDateTimeString(actualTransferredAt),
        notes: notes.trim() || undefined,
        entireLocation: {
          locationId: Number(fromLocationId),
          toLocationId: Number(toLocationId),
          toStorageSection: "TEMP"
        }
      });
      await onSaved();
      showSuccess(t("entireWarehouseTransferSuccess", {
        source: sourceLocation?.name || "-",
        destination: destinationLocation?.name || "-"
      }));
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
            <span>{t("entireWarehouseTransfer")}</span>
            <small>{t("entireWarehouseTransferHint")}</small>
          </div>
          <IconButton aria-label={t("close")} onClick={onClose} disabled={submitting} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <div className="bulk-container-transfer">
            {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}

            <div className="bulk-container-transfer__route" aria-hidden="true">
              <span><WarehouseOutlinedIcon fontSize="small" />{sourceLocation?.name || t("sourceStorage")}</span>
              <ArrowForwardRoundedIcon fontSize="small" />
              <span><WarehouseOutlinedIcon fontSize="small" />{destinationLocation?.name || t("destinationStorage")}</span>
            </div>

            <div className="bulk-container-transfer__fields">
              <label>
                {t("sourceStorage")}
                <select value={fromLocationId} onChange={(event) => changeSource(event.target.value)}>
                  <option value="">{t("selectStorage")}</option>
                  {sourceLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                </select>
              </label>
              <label>
                {t("destinationStorage")}
                <select value={toLocationId} onChange={(event) => setToLocationId(event.target.value)} disabled={!fromLocationId}>
                  <option value="">{t("selectStorage")}</option>
                  {locations.filter((location) => String(location.id) !== fromLocationId).map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </label>
              <label>
                {t("actualTransferredAt")}
                <input type="datetime-local" value={actualTransferredAt} onChange={(event) => setActualTransferredAt(event.target.value)} />
              </label>
            </div>

            <InlineAlert severity="info">{t("entireWarehouseTransferTempNotice")}</InlineAlert>

            <label>
              {t("notes")}
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t("transferNotesPlaceholder")} />
            </label>

            <div className="bulk-container-transfer__summary">
              <article><span>{t("containers")}</span><strong>{containerCount}</strong></article>
              <article><span>{t("totalLines")}</span><strong>{sourceItems.length}</strong></article>
              <article><span>{t("quantity")}</span><strong>{totalQty}</strong></article>
              <article><span>{t("pallets")}</span><strong>{totalPallets}</strong></article>
            </div>

            {blockedItems.length > 0 ? (
              <InlineAlert severity="warning">
                {t("entireWarehouseTransferBlocked", {
                  container: blockedItems[0]?.containerNo || "-",
                  sku: blockedItems[0]?.sku || "-",
                  count: blockedItems.length
                })}
              </InlineAlert>
            ) : null}

            <div className="bulk-container-transfer__actions">
              <Button variant="text" onClick={onClose} disabled={submitting}>{t("cancel")}</Button>
              <Button
                variant="contained"
                color="warning"
                onClick={() => void submitTransfer()}
                disabled={!canSubmit}
                startIcon={submitting ? <InlineLoadingIndicator /> : <WarehouseOutlinedIcon />}
              >
                {submitting ? t("bulkTransferPosting") : t("postEntireWarehouseTransfer")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
