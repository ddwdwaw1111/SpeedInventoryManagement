import CheckCircleOutlineRoundedIcon from "@mui/icons-material/CheckCircleOutlineRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import { useEffect, useState } from "react";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton } from "@mui/material";

import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { downloadOutboundBulkImportSample, downloadOutboundBulkImportTemplate } from "../lib/outboundBulkImportTemplate";
import type {
  Customer,
  Item,
  Location,
  OutboundBulkImportCommitResponse,
  OutboundBulkImportDocumentPreview,
  OutboundBulkImportLinePreview,
  OutboundBulkImportPreview
} from "../lib/types";
import { InlineAlert } from "./Feedback";
import { InlineLoadingIndicator } from "./InlineLoadingIndicator";

type Props = {
  open: boolean;
  customers: Customer[];
  locations: Location[];
  items: Item[];
  initialCustomerId?: number;
  onClose: () => void;
  onImported: () => Promise<void> | void;
};

type Step = "UPLOAD" | "PREVIEW" | "RESULT";

export function OutboundBulkImportDialog({ open, customers, locations, items, initialCustomerId, onClose, onImported }: Props) {
  const { language, t } = useI18n();
  const [step, setStep] = useState<Step>("UPLOAD");
  const [customerId, setCustomerId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<OutboundBulkImportPreview | null>(null);
  const [result, setResult] = useState<OutboundBulkImportCommitResponse | null>(null);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const customer = customers.find((entry) => entry.id === initialCustomerId) ?? customers[0];
    setStep("UPLOAD");
    setCustomerId(customer ? String(customer.id) : "");
    setFile(null);
    setPreview(null);
    setResult(null);
    setChanged(false);
    setBusy(false);
    setError("");
  }, [open]);

  function selectFile(next: File | null) {
    setError("");
    if (!next) return setFile(null);
    if (!next.name.toLowerCase().endsWith(".xlsx")) {
      setFile(null);
      setError(t("bulkOutboundExcelOnly"));
      return;
    }
    if (next.size > 10 * 1024 * 1024) {
      setFile(null);
      setError(t("bulkOutboundFileTooLarge"));
      return;
    }
    setFile(next);
  }

  async function validateFile() {
    if (!file || !Number(customerId)) return;
    setBusy(true);
    setError("");
    try {
      setPreview(normalizeOutboundBulkImportPreview(await api.previewOutboundBulkImport(file, Number(customerId))));
      setChanged(false);
      setStep("PREVIEW");
    } catch (nextError) {
      setError(localizeOutboundRequestError(nextError, "bulkOutboundPreviewFailed", language, t));
    } finally {
      setBusy(false);
    }
  }

  function updateDocument(documentKey: string, patch: Partial<OutboundBulkImportDocumentPreview>) {
    setPreview((current) => current ? {
      ...current,
      documents: current.documents.map((document) => document.documentKey === documentKey ? { ...document, ...patch } : document)
    } : current);
    setChanged(true);
  }

  function updateLine(documentKey: string, lineIndex: number, patch: Partial<OutboundBulkImportLinePreview>) {
    setPreview((current) => current ? {
      ...current,
      documents: current.documents.map((document) => document.documentKey === documentKey ? {
        ...document,
        lines: document.lines.map((line, index) => index === lineIndex ? { ...line, ...patch } : line)
      } : document)
    } : current);
    setChanged(true);
  }

  async function revalidate() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      setPreview(normalizeOutboundBulkImportPreview(await api.revalidateOutboundBulkImport({
        importId: preview.importId,
        sourceFileName: preview.sourceFileName,
        customerId: preview.customerId,
        documents: preview.documents
      })));
      setChanged(false);
    } catch (nextError) {
      setError(localizeOutboundRequestError(nextError, "bulkOutboundRevalidateFailed", language, t));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.commitOutboundBulkImport({
        importId: preview.importId,
        sourceFileName: preview.sourceFileName,
        customerId: preview.customerId,
        documents: preview.documents.filter((document) => document.valid).map((document) => ({ documentKey: document.documentKey, input: document.input }))
      });
      setResult(response);
      setStep("RESULT");
      if (response.createdDocuments > 0) await onImported();
    } catch (nextError) {
      setError(localizeOutboundRequestError(nextError, "bulkOutboundCommitFailed", language, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} fullWidth maxWidth={false} PaperProps={{ className: "bulk-inbound-dialog" }}>
      <DialogTitle className="bulk-inbound-dialog__title">
        <div><span>{t("bulkOutboundEyebrow")}</span><strong>{t("bulkOutboundTitle")}</strong></div>
        <IconButton aria-label={t("close")} onClick={onClose} disabled={busy}><CloseRoundedIcon /></IconButton>
      </DialogTitle>
      <DialogContent dividers className="bulk-inbound-dialog__content">
        <div className="bulk-inbound-steps" aria-label={t("bulkOutboundProgress")}>
          {(["UPLOAD", "PREVIEW", "RESULT"] as Step[]).map((entry, index) => <div key={entry} className={`bulk-inbound-step ${entry === step ? "bulk-inbound-step--active" : ""}`}><span>{index + 1}</span><strong>{t(entry === "UPLOAD" ? "bulkOutboundStepUpload" : entry === "PREVIEW" ? "bulkOutboundStepPreview" : "bulkOutboundStepResult")}</strong></div>)}
        </div>
        {error ? <InlineAlert>{error}</InlineAlert> : null}

        {step === "UPLOAD" ? (
          <div className="bulk-inbound-upload-layout">
            <section className="bulk-inbound-context-panel">
              <div className="bulk-inbound-section-heading"><span>01</span><div><strong>{t("bulkOutboundImportContext")}</strong><p>{t("bulkOutboundImportContextHint")}</p></div></div>
              <div className="bulk-inbound-context-grid bulk-inbound-context-grid--single"><label>{t("customer")}<select value={customerId} onChange={(event) => setCustomerId(event.target.value)} disabled={busy}><option value="">{t("selectCustomer")}</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label></div>
              <InlineAlert severity="info">{t("bulkOutboundDraftOnlyNotice")}</InlineAlert>
              <div className="bulk-inbound-template-card">
                <DownloadOutlinedIcon />
                <div><strong>{t("bulkOutboundTemplateTitle")}</strong><span>{t("bulkOutboundTemplateHint")}</span></div>
                <div className="bulk-inbound-template-actions">
                  <Button variant="outlined" onClick={downloadOutboundBulkImportTemplate}>{t("bulkOutboundDownloadBlankTemplate")}</Button>
                  <Button variant="contained" onClick={() => downloadOutboundBulkImportSample(items.filter((item) => !customerId || item.customerId === Number(customerId)), locations)}>{t("bulkOutboundDownloadSampleTemplate")}</Button>
                </div>
              </div>
            </section>
            <section className="bulk-inbound-file-panel">
              <div className="bulk-inbound-section-heading"><span>02</span><div><strong>{t("bulkOutboundUploadWorkbook")}</strong><p>{t("bulkOutboundUploadWorkbookHint")}</p></div></div>
              <label className={`bulk-inbound-dropzone ${file ? "bulk-inbound-dropzone--selected" : ""}`}>
                <input type="file" accept=".xlsx" onChange={(event) => selectFile(event.target.files?.[0] ?? null)} disabled={busy} />
                {file ? <CheckCircleOutlineRoundedIcon className="bulk-inbound-dropzone__icon bulk-inbound-dropzone__icon--ready" /> : <CloudUploadOutlinedIcon className="bulk-inbound-dropzone__icon" />}
                <strong>{file?.name || t("bulkOutboundDropFile")}</strong><span>{t("bulkOutboundFileRules")}</span><em>{t("bulkOutboundBrowseFile")}</em>
              </label>
              <div className="bulk-inbound-rule-grid">
                <div><strong>{t("bulkOutboundContainerRule")}</strong><span>{t("bulkOutboundContainerRuleHint")}</span></div>
                <div><strong>{t("bulkOutboundQuantityRule")}</strong><span>{t("bulkOutboundQuantityRuleHint")}</span></div>
                <div><strong>{t("bulkOutboundWarehouseRule")}</strong><span>{t("bulkOutboundWarehouseRuleHint")}</span></div>
              </div>
            </section>
          </div>
        ) : null}

        {step === "PREVIEW" && preview ? (
          <div className="bulk-inbound-preview">
            <div className="bulk-inbound-preview__banner"><div><span>{preview.sourceFileName}</span><strong>{preview.customerName} · {t("bulkOutboundWarehouseCount", { count: preview.locationCount })}</strong></div><p>{t("bulkOutboundPreviewHint", { warehouse: preview.mainWarehouse })}</p></div>
            <div className="bulk-inbound-metrics"><div><strong>{preview.totalDocuments}</strong><span>{t("bulkOutboundShipmentsFound")}</span></div><div className="bulk-inbound-metric--success"><strong>{preview.validDocuments}</strong><span>{t("bulkOutboundReadyDrafts")}</span></div><div className={preview.invalidDocuments ? "bulk-inbound-metric--danger" : ""}><strong>{preview.invalidDocuments}</strong><span>{t("bulkOutboundBlockedDrafts")}</span></div><div><strong>{preview.totalLines}</strong><span>{t("lines")}</span></div></div>
            {preview.documents.some((document) => document.transferLines > 0) ? <InlineAlert severity="info">{t("bulkOutboundAutoTransferNotice", { warehouse: preview.mainWarehouse, count: preview.documents.reduce((total, document) => total + document.transferLines, 0) })}</InlineAlert> : null}
            {changed ? <InlineAlert severity="warning">{t("bulkOutboundChangesNeedValidation")}</InlineAlert> : null}
            <div className="bulk-inbound-document-list">
              {preview.documents.map((document) => (
                <details key={document.documentKey} className={`bulk-inbound-document ${document.valid ? "bulk-inbound-document--valid" : "bulk-inbound-document--invalid"}`} open={!document.valid}>
                  <summary><div className="bulk-inbound-document__identity">{document.valid ? <CheckCircleOutlineRoundedIcon /> : <ErrorOutlineRoundedIcon />}<div><strong>{document.pickingOrderNo || "—"}</strong><span>{t("bulkOutboundRows")} {formatRows(document.rowNumbers)} · {t("bulkOutboundShipDate")} {document.actualShipDate || document.expectedShipDate || "—"}</span></div></div><div className="bulk-inbound-document__totals"><span><strong>{document.totalPlannedQty ?? document.totalQty}</strong>{t("plannedShipQty")}</span><span><strong>{document.totalActualQty ?? document.totalQty}</strong>{t("actualShipQty")}</span><span><strong>{document.totalInventoryPallets}</strong>{t("bulkOutboundInventoryPallets")}</span><span><strong>{document.totalOutboundPallets}</strong>{t("bulkOutboundOutboundPallets")}</span><em>{t(document.valid ? "bulkOutboundReady" : "bulkOutboundBlocked")}</em><ExpandMoreRoundedIcon /></div></summary>
                  <div className="bulk-inbound-document__body">
                    <div className="bulk-inbound-edit-grid">
                      <label>{t("bulkOutboundPickingOrderNo")}<input value={document.pickingOrderNo} onChange={(event) => updateDocument(document.documentKey, { pickingOrderNo: event.target.value })} /></label>
                      <label>{t("bulkOutboundExpectedShipDate")}<input type="date" value={document.expectedShipDate} onChange={(event) => updateDocument(document.documentKey, { expectedShipDate: event.target.value })} /></label>
                      <label>{t("bulkOutboundActualShipDate")}<input type="date" value={document.actualShipDate} onChange={(event) => updateDocument(document.documentKey, { actualShipDate: event.target.value })} /></label>
                      <label>{t("bulkOutboundShipToName")}<input value={document.shipToName} onChange={(event) => updateDocument(document.documentKey, { shipToName: event.target.value })} /></label>
                      <label>{t("bulkOutboundShipToAddress")}<input value={document.shipToAddress} onChange={(event) => updateDocument(document.documentKey, { shipToAddress: event.target.value })} /></label>
                      <label>{t("bulkOutboundShipToContact")}<input value={document.shipToContact} onChange={(event) => updateDocument(document.documentKey, { shipToContact: event.target.value })} /></label>
                    </div>
                    {document.issues.length ? <div className="bulk-inbound-issue-list">{document.issues.map((issue, index) => <div className="bulk-inbound-issue bulk-inbound-issue--error" key={`${issue.code}-${issue.rowNumber}-${index}`}><WarningAmberRoundedIcon /><span>{issue.rowNumber ? `${t("bulkOutboundRow", { row: issue.rowNumber })}: ` : ""}{formatOutboundBulkIssue(issue, t)}</span></div>)}</div> : null}
                    <div className="bulk-inbound-table-wrap"><table className="bulk-inbound-line-table"><thead><tr><th>{t("bulkOutboundSourceWarehouse")}</th><th>{t("bulkOutboundOutboundWarehouse")}</th><th>{t("bulkOutboundSourceContainer")}</th><th>{t("bulkOutboundSection")}</th><th>SKU</th><th>{t("bulkOutboundItemCodeReference")}</th><th>{t("plannedShipQty")}</th><th>{t("actualShipQty")}</th><th>{t("bulkOutboundInventoryPallets")}</th><th>{t("bulkOutboundOutboundPallets")}</th><th>{t("bulkOutboundLineNote")}</th></tr></thead><tbody>
                      {document.lines.map((line, index) => <tr key={`${document.documentKey}-${line.rowNumber}-${index}`}>
                        <td><select value={line.warehouse} onChange={(event) => updateLine(document.documentKey, index, { warehouse: event.target.value })}><option value="">{t("bulkOutboundSelect")}</option>{locations.map((location) => <option key={location.id} value={location.name}>{location.name}</option>)}</select></td>
                        <td><span className={`bulk-outbound-transfer-badge ${line.requiresTransfer ? "bulk-outbound-transfer-badge--required" : ""}`}>{line.requiresTransfer ? t("bulkOutboundTransferToWarehouse", { warehouse: line.outboundWarehouse }) : line.outboundWarehouse}</span></td>
                        <td><input value={line.sourceContainer} onChange={(event) => updateLine(document.documentKey, index, { sourceContainer: event.target.value })} /></td>
                        <td><input value={line.storageSection} onChange={(event) => updateLine(document.documentKey, index, { storageSection: event.target.value })} /></td>
                        <td><input value={line.sku} onChange={(event) => updateLine(document.documentKey, index, { sku: event.target.value })} /></td>
                        <td><input value={line.itemNumber} onChange={(event) => updateLine(document.documentKey, index, { itemNumber: event.target.value })} /></td>
                        <td><input aria-label={t("plannedShipQty")} type="number" min="0" step="1" value={line.plannedQuantity ?? line.quantity} onChange={(event) => updateLine(document.documentKey, index, { plannedQuantity: toNonNegativeWholeNumber(event.target.value) })} /></td>
                        <td><input aria-label={t("actualShipQty")} type="number" min="0" step="1" value={line.actualQuantity ?? line.quantity} onChange={(event) => { const actualQuantity = toNonNegativeWholeNumber(event.target.value); updateLine(document.documentKey, index, { quantity: actualQuantity, actualQuantity }); }} /></td>
                        <td><input type="number" min="0" step="1" value={line.inventoryPallets} onChange={(event) => updateLine(document.documentKey, index, { inventoryPallets: toNonNegativeWholeNumber(event.target.value) })} /></td>
                        <td><input type="number" min="0" step="1" value={line.outboundPallets} onChange={(event) => updateLine(document.documentKey, index, { outboundPallets: toNonNegativeWholeNumber(event.target.value) })} /></td>
                        <td><input value={line.lineNote} onChange={(event) => updateLine(document.documentKey, index, { lineNote: event.target.value })} /></td>
                      </tr>)}
                    </tbody></table></div>
                  </div>
                </details>
              ))}
            </div>
          </div>
        ) : null}

        {step === "RESULT" && result ? <div className="bulk-inbound-result"><div className={`bulk-inbound-result__hero ${result.failedDocuments ? "bulk-inbound-result__hero--partial" : ""}`}>{result.failedDocuments ? <WarningAmberRoundedIcon /> : <CheckCircleOutlineRoundedIcon />}<div><span>{result.sourceFileName}</span><strong>{t("bulkOutboundComplete")}</strong><p>{t("bulkOutboundResultSummary", { created: result.createdDocuments, failed: result.failedDocuments })}</p></div></div><div className="bulk-inbound-result-list">{result.results.map((entry) => <div key={entry.documentKey} className={`bulk-inbound-result-row ${entry.success ? "bulk-inbound-result-row--success" : "bulk-inbound-result-row--failed"}`}>{entry.success ? <CheckCircleOutlineRoundedIcon /> : <ErrorOutlineRoundedIcon />}<div><strong>{entry.pickingOrderNo || entry.documentKey}</strong><span>{entry.success ? entry.transferLines > 0 ? t("bulkOutboundDraftCreatedWithTransfer", { id: entry.document?.id ?? "—", count: entry.transferLines }) : t("bulkOutboundDraftCreated", { id: entry.document?.id ?? "—" }) : formatOutboundCommitError(entry.error, t)}</span></div></div>)}</div></div> : null}
      </DialogContent>
      <DialogActions className="bulk-inbound-dialog__actions">
        {step === "UPLOAD" ? <><Button onClick={onClose} disabled={busy}>{t("cancel")}</Button><Button variant="contained" disabled={busy || !file || !customerId} onClick={() => void validateFile()} startIcon={busy ? <InlineLoadingIndicator /> : <CloudUploadOutlinedIcon />}>{busy ? t("bulkOutboundValidating") : t("bulkOutboundPreviewFile")}</Button></> : null}
        {step === "PREVIEW" && preview ? <><Button disabled={busy} onClick={() => setStep("UPLOAD")}>{t("back")}</Button>{changed ? <Button variant="outlined" disabled={busy} onClick={() => void revalidate()}>{busy ? t("bulkOutboundRevalidating") : t("bulkOutboundRevalidate")}</Button> : null}<Button variant="contained" disabled={busy || changed || preview.validDocuments === 0} onClick={() => void commit()}>{busy ? t("bulkOutboundCreatingDrafts") : t("bulkOutboundImportDrafts", { count: preview.validDocuments })}</Button></> : null}
        {step === "RESULT" ? <Button variant="contained" onClick={onClose}>{t("done")}</Button> : null}
      </DialogActions>
    </Dialog>
  );
}

function normalizeOutboundBulkImportPreview(preview: OutboundBulkImportPreview): OutboundBulkImportPreview {
  return {
    ...preview,
    documents: (Array.isArray(preview.documents) ? preview.documents : []).map((document) => ({
      ...document,
      rowNumbers: Array.isArray(document.rowNumbers) ? document.rowNumbers : [],
      lines: Array.isArray(document.lines) ? document.lines : [],
      issues: Array.isArray(document.issues) ? document.issues : [],
      input: {
        ...document.input,
        lines: Array.isArray(document.input?.lines) ? document.input.lines : []
      }
    }))
  };
}

function formatRows(rows: number[]) {
  if (!rows.length) return "—";
  return rows.length === 1 ? String(rows[0]) : `${rows[0]}–${rows[rows.length - 1]}`;
}

function toNonNegativeWholeNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

function formatOutboundBulkIssue(issue: OutboundBulkImportPreview["documents"][number]["issues"][number], t: Translate) {
  if (issue.code === "INSUFFICIENT_STOCK") {
    return t("bulkOutboundIssueInsufficientStockDetail", {
      sku: issue.sku || "—",
      requestedQty: issue.requestedQty ?? Number(issue.value || 0),
      availableQty: issue.availableQty ?? 0,
      warehouse: issue.warehouse || "—",
      sourceContainer: issue.sourceContainer || t("bulkOutboundAllMatchingContainers"),
      storageSection: issue.storageSection || t("bulkOutboundAllStorageSections")
    });
  }
  if (issue.code === "INSUFFICIENT_INVENTORY_PALLETS") {
    return t("bulkOutboundIssueInsufficientInventoryPallets", {
      sku: issue.sku || "—",
      requestedPallets: issue.requestedPallets ?? Number(issue.value || 0),
      availablePallets: issue.availablePallets ?? 0,
      warehouse: issue.warehouse || "—",
      sourceContainer: issue.sourceContainer || t("bulkOutboundAllMatchingContainers"),
      storageSection: issue.storageSection || t("bulkOutboundAllStorageSections")
    });
  }
  const palletIssueValues = {
    container: issue.sourceContainer || t("bulkOutboundAllMatchingContainers"),
    requestedPallets: issue.requestedPallets ?? Number(issue.value || 0),
    availablePallets: issue.availablePallets ?? 0
  };
  if (issue.code === "INVENTORY_PALLETS_REQUIRED") {
    return t("bulkOutboundIssueInventoryPalletsRequired", palletIssueValues);
  }
  if (issue.code === "INVENTORY_PALLETS_EXCEED_SOURCE") {
    return t("bulkOutboundIssueInventoryPalletsExceedSource", palletIssueValues);
  }
  if (issue.code === "INVENTORY_PALLET_RELEASE_CONFLICT") {
    return t("bulkOutboundIssueInventoryPalletReleaseConflict", palletIssueValues);
  }
  if (issue.code === "INVALID_INVENTORY_PALLET_BALANCE") {
    return t("bulkOutboundIssueInvalidInventoryPalletBalance", palletIssueValues);
  }
  const keys: Record<string, string> = {
    MISSING_PICKING_ORDER: "bulkOutboundIssueMissingPickingOrder",
    INVALID_SHIP_DATE: "bulkOutboundIssueInvalidShipDate",
    INVALID_EXPECTED_SHIP_DATE: "bulkOutboundIssueInvalidExpectedShipDate",
    HEADER_CONFLICT: "bulkOutboundIssueHeaderConflict",
    INVALID_QUANTITY: "bulkOutboundIssueInvalidQuantity",
    INVALID_PLANNED_QUANTITY: "bulkOutboundIssueInvalidPlannedQuantity",
    INVALID_INVENTORY_PALLETS: "bulkOutboundIssueInvalidInventoryPallets",
    MISSING_SOURCE_CONTAINER: "bulkOutboundIssueMissingSourceContainer",
    AMBIGUOUS_SOURCE_CONTAINER: "bulkOutboundIssueAmbiguousSourceContainer",
    INVALID_OUTBOUND_PALLETS: "bulkOutboundIssueInvalidOutboundPallets",
    INVALID_WAREHOUSE: "bulkOutboundIssueInvalidWarehouse",
    INVALID_SKU: "bulkOutboundIssueInvalidSku",
    DUPLICATE_PICKING_ORDER: "bulkOutboundIssueDuplicatePickingOrder",
    DUPLICATE_PICKING_ORDER_IN_IMPORT: "bulkOutboundIssueDuplicatePickingOrderInImport"
  };
  return keys[issue.code] ? t(keys[issue.code]) : issue.message;
}

function formatOutboundCommitError(error: string | undefined, t: Translate) {
  const message = error || "";
  if (message.includes("Picking Order No is required")) return t("bulkOutboundIssueMissingPickingOrder");
  if (message.includes("duplicate Picking Order No in import request")) return t("bulkOutboundIssueDuplicatePickingOrderInImport");
  if (message.includes("Picking Order No already exists")) return t("bulkOutboundIssueDuplicatePickingOrder");
  if (message.toLowerCase().includes("stock")) return t("bulkOutboundIssueInsufficientStock");
  return t("bulkOutboundCommitFailed");
}

function localizeOutboundRequestError(error: unknown, fallbackKey: string, language: string, t: Translate) {
  if (language === "zh") return t(fallbackKey);
  return error instanceof Error && error.message ? error.message : t(fallbackKey);
}
