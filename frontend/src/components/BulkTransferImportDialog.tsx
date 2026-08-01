import CheckCircleOutlineRoundedIcon from "@mui/icons-material/CheckCircleOutlineRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import { type DragEvent, useEffect, useState } from "react";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton } from "@mui/material";

import { api } from "../lib/api";
import { downloadBulkTransferImportSample, downloadBulkTransferImportTemplate } from "../lib/transferBulkImportTemplate";
import { useI18n } from "../lib/i18n";
import type {
  BulkTransferImportPreview,
  BulkTransferImportPreviewRow,
  BulkTransferImportCommitResponse,
  Customer,
  Item,
  Location
} from "../lib/types";
import { BulkImportHistoryDialog } from "./BulkImportHistoryDialog";
import { InlineAlert } from "./Feedback";
import { InlineLoadingIndicator } from "./InlineLoadingIndicator";

type Props = {
  open: boolean;
  customers: Customer[];
  locations: Location[];
  items: Item[];
  onClose: () => void;
  onImported: () => Promise<void> | void;
};

type ImportStep = "UPLOAD" | "PREVIEW" | "RESULT";

const maxFileSize = 10 * 1024 * 1024;

export function BulkTransferImportDialog({ open, customers, locations, items, onClose, onImported }: Props) {
  const { t } = useI18n();
  const [step, setStep] = useState<ImportStep>("UPLOAD");
  const [customerId, setCustomerId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [hasPreviewChanges, setHasPreviewChanges] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [preview, setPreview] = useState<BulkTransferImportPreview | null>(null);
  const [result, setResult] = useState<BulkTransferImportCommitResponse | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep("UPLOAD");
    setCustomerId(customers[0] ? String(customers[0].id) : "");
    setFile(null);
    setIsDragging(false);
    setIsPreviewing(false);
    setIsRevalidating(false);
    setIsImporting(false);
    setHasPreviewChanges(false);
    setErrorMessage("");
    setPreview(null);
    setResult(null);
  }, [open]);

  const isBusy = isPreviewing || isRevalidating || isImporting;

  function closeDialog() {
    if (!isBusy) onClose();
  }

  function selectFile(nextFile: File | null) {
    setErrorMessage("");
    setPreview(null);
    setResult(null);
    setHasPreviewChanges(false);
    if (!nextFile) {
      setFile(null);
      return;
    }
    if (!nextFile.name.toLowerCase().endsWith(".xlsx")) {
      setFile(null);
      setErrorMessage(t("bulkTransferExcelOnly"));
      return;
    }
    if (nextFile.size > maxFileSize) {
      setFile(null);
      setErrorMessage(t("bulkTransferFileTooLarge"));
      return;
    }
    setFile(nextFile);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    selectFile(event.dataTransfer.files[0] ?? null);
  }

  async function handlePreview() {
    const selectedCustomerId = Number(customerId);
    if (!selectedCustomerId || !file) {
      setErrorMessage(t("bulkTransferSelectContextAndFile"));
      return;
    }
    setIsPreviewing(true);
    setErrorMessage("");
    try {
      const nextPreview = await api.previewBulkTransferImport(file, selectedCustomerId);
      setPreview(nextPreview);
      setHasPreviewChanges(false);
      setStep("PREVIEW");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("bulkTransferPreviewFailed"));
    } finally {
      setIsPreviewing(false);
    }
  }

  function updatePreviewRow(documentKey: string, patch: Partial<BulkTransferImportPreviewRow["input"]>) {
    setPreview((current) => current ? {
      ...current,
      rows: current.rows.map((row) => row.documentKey === documentKey ? {
        ...row,
        input: { ...row.input, ...patch }
      } : row)
    } : current);
    setHasPreviewChanges(true);
    setErrorMessage("");
  }

  async function handleRevalidate() {
    if (!preview || !hasPreviewChanges) return;
    setIsRevalidating(true);
    setErrorMessage("");
    try {
      const nextPreview = await api.revalidateBulkTransferImport({
        importId: preview.importId,
        sourceFileName: preview.sourceFileName,
        customerId: preview.customerId,
        rows: preview.rows
      });
      setPreview({ ...nextPreview, importBatchId: preview.importBatchId });
      setHasPreviewChanges(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("bulkTransferRevalidateFailed"));
    } finally {
      setIsRevalidating(false);
    }
  }

  async function handleImport() {
    if (!preview || preview.validTransfers === 0) return;
    setIsImporting(true);
    setErrorMessage("");
    try {
      const response = await api.commitBulkTransferImport({
        importId: preview.importId,
        sourceFileName: preview.sourceFileName,
        customerId: preview.customerId,
        rows: preview.rows.filter((row) => row.valid).map((row) => ({ documentKey: row.documentKey, input: row.input }))
      });
      setResult(response);
      setStep("RESULT");
      if (response.createdTransfers > 0) await onImported();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("bulkTransferCommitFailed"));
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={(_, reason) => {
          if (reason === "backdropClick" || isBusy) return;
          closeDialog();
        }}
        fullWidth
        maxWidth={false}
        PaperProps={{ className: "bulk-inbound-dialog" }}
      >
        <DialogTitle className="bulk-inbound-dialog__title">
          <div><span>{t("bulkTransferEyebrow")}</span><strong>{t("bulkTransferTitle")}</strong></div>
          <IconButton aria-label={t("close")} onClick={closeDialog} disabled={isBusy}><CloseRoundedIcon /></IconButton>
        </DialogTitle>
        <DialogContent dividers className="bulk-inbound-dialog__content">
          <div className="bulk-inbound-steps" aria-label={t("bulkTransferProgress")}>
            {(["UPLOAD", "PREVIEW", "RESULT"] as ImportStep[]).map((candidate, index) => {
              const activeIndex = ["UPLOAD", "PREVIEW", "RESULT"].indexOf(step);
              const complete = index < activeIndex;
              return <div className={`bulk-inbound-step ${candidate === step ? "bulk-inbound-step--active" : ""} ${complete ? "bulk-inbound-step--complete" : ""}`} key={candidate}>
                <span>{complete ? <CheckCircleOutlineRoundedIcon fontSize="small" /> : index + 1}</span>
                <strong>{t(candidate === "UPLOAD" ? "bulkTransferStepUpload" : candidate === "PREVIEW" ? "bulkTransferStepPreview" : "bulkTransferStepResult")}</strong>
              </div>;
            })}
          </div>
          {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}

          {step === "UPLOAD" ? <div className="bulk-inbound-upload-layout">
            <section className="bulk-inbound-context-panel">
              <div className="bulk-inbound-section-heading"><span>01</span><div><strong>{t("bulkTransferImportContext")}</strong><p>{t("bulkTransferImportContextHint")}</p></div></div>
              <div className="bulk-inbound-context-grid bulk-inbound-context-grid--single">
                <label>{t("customer")}
                  <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} disabled={isBusy}>
                    <option value="">{t("selectCustomer")}</option>
                    {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
                  </select>
                </label>
              </div>
              <InlineAlert severity="info">{t("bulkTransferModeNotice")}</InlineAlert>
              <InlineAlert severity="info">{t("bulkTransferPalletSidesNotice")}</InlineAlert>
              <InlineAlert severity="info">{t("bulkImportRetainedNotice")}</InlineAlert>
              <div className="bulk-inbound-template-card">
                <DescriptionOutlinedIcon />
                <div><strong>{t("bulkTransferTemplateTitle")}</strong><span>{t("bulkTransferTemplateHint")}</span></div>
                <div className="bulk-inbound-template-actions">
                  <Button variant="outlined" startIcon={<DownloadOutlinedIcon />} onClick={downloadBulkTransferImportTemplate}>{t("bulkTransferDownloadBlankTemplate")}</Button>
                  <Button variant="contained" startIcon={<DownloadOutlinedIcon />} onClick={() => downloadBulkTransferImportSample(items, locations)} disabled={locations.length < 2}>{t("bulkTransferDownloadSampleTemplate")}</Button>
                  <Button onClick={() => setHistoryOpen(true)}>{t("bulkImportHistory")}</Button>
                </div>
              </div>
            </section>
            <section className="bulk-inbound-file-panel">
              <div className="bulk-inbound-section-heading"><span>02</span><div><strong>{t("bulkTransferUploadWorkbook")}</strong><p>{t("bulkTransferUploadWorkbookHint")}</p></div></div>
              <label
                className={`bulk-inbound-dropzone ${isDragging ? "bulk-inbound-dropzone--dragging" : ""} ${file ? "bulk-inbound-dropzone--selected" : ""}`}
                onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => selectFile(event.target.files?.[0] ?? null)} disabled={isBusy} />
                {file ? <CheckCircleOutlineRoundedIcon className="bulk-inbound-dropzone__icon bulk-inbound-dropzone__icon--ready" /> : <CloudUploadOutlinedIcon className="bulk-inbound-dropzone__icon" />}
                <strong>{file ? file.name : t("bulkTransferDropFile")}</strong>
                <span>{file ? formatFileSize(file.size) : t("bulkTransferFileRules")}</span>
                <em>{file ? t("bulkInboundReplaceFile") : t("bulkTransferBrowseFile")}</em>
              </label>
              <div className="bulk-inbound-rule-grid">
                <div><strong>{t("bulkTransferModeRule")}</strong><span>{t("bulkTransferModeRuleHint")}</span></div>
                <div><strong>{t("bulkTransferAvailabilityRule")}</strong><span>{t("bulkTransferAvailabilityRuleHint")}</span></div>
                <div><strong>{t("bulkTransferDateRule")}</strong><span>{t("bulkTransferDateRuleHint")}</span></div>
              </div>
            </section>
          </div> : null}

          {step === "PREVIEW" && preview ? <div className="bulk-inbound-preview">
            <div className="bulk-inbound-preview__banner"><div><span>{preview.sourceFileName}</span><strong>{preview.customerName}</strong></div><p>{t("bulkTransferPreviewHint")}</p></div>
            <div className="bulk-inbound-metrics">
              <div><strong>{preview.totalTransfers}</strong><span>{t("bulkTransferTransfersFound")}</span></div>
              <div className="bulk-inbound-metric--success"><strong>{preview.validTransfers}</strong><span>{t("bulkTransferReady")}</span></div>
              <div className={preview.invalidTransfers > 0 ? "bulk-inbound-metric--danger" : ""}><strong>{preview.invalidTransfers}</strong><span>{t("bulkTransferBlocked")}</span></div>
              <div><strong>{preview.rows.reduce((total, row) => total + row.totalPallets, 0)}</strong><span>{t("pallets")}</span></div>
            </div>
            {hasPreviewChanges ? <InlineAlert severity="warning">{t("bulkTransferChangesNeedValidation")}</InlineAlert> : null}
            {preview.invalidTransfers > 0 ? <InlineAlert severity="warning">{t("bulkTransferInvalidSkipped")}</InlineAlert> : null}
            <div className="bulk-inbound-document-list">
              {preview.rows.map((row) => <details className={`bulk-inbound-document ${row.valid ? "bulk-inbound-document--valid" : "bulk-inbound-document--invalid"}`} key={row.documentKey} open={!row.valid}>
                <summary>
                  <div className="bulk-inbound-document__identity">
                    {row.valid ? <CheckCircleOutlineRoundedIcon /> : <ErrorOutlineRoundedIcon />}
                    <div><strong>{row.input.containerNo || "—"}</strong><span>{row.fromLocationName || t("bulkTransferMissingWarehouse")} → {row.toLocationName || t("bulkTransferMissingWarehouse")} · {t("bulkTransferRow", { row: row.rowNumber })}</span></div>
                  </div>
                  <div className="bulk-inbound-document__totals">
                    <span><strong>{row.totalQuantity}</strong>CTN</span>
                    <span><strong>{row.totalPallets}</strong>{t("pallets")}</span>
                    <em>{row.valid ? t("bulkTransferReady") : t("bulkTransferBlocked")}</em><ExpandMoreRoundedIcon />
                  </div>
                </summary>
                <div className="bulk-inbound-document__body">
                  <div className="bulk-inbound-edit-grid">
                    <label>{t("transferNo")}<input value={row.input.transferNo || ""} onChange={(event) => updatePreviewRow(row.documentKey, { transferNo: event.target.value })} disabled={isBusy} /></label>
                    <label>{t("bulkTransferMode")}<select value={row.input.transferMode || "FULL_CONTAINER"} onChange={(event) => updatePreviewRow(row.documentKey, { transferMode: event.target.value })} disabled={isBusy}><option value="FULL_CONTAINER">{t("bulkTransferModeFull")}</option><option value="PARTIAL">{t("bulkTransferModePartial")}</option></select></label>
                    <label>{t("actualTransferredAt")}<input type="date" value={row.input.transferDate || ""} onChange={(event) => updatePreviewRow(row.documentKey, { transferDate: event.target.value })} disabled={isBusy} /></label>
                    <label>{t("containerNo")}<input value={row.input.containerNo || ""} onChange={(event) => updatePreviewRow(row.documentKey, { containerNo: event.target.value })} disabled={isBusy} /></label>
                    <label>{t("bulkTransferFromWarehouse")}<select value={row.input.fromLocationId || ""} onChange={(event) => updatePreviewRow(row.documentKey, { fromLocationId: Number(event.target.value) })} disabled={isBusy}><option value="">{t("selectWarehouse")}</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
                    <label>{t("bulkTransferToWarehouse")}<select value={row.input.toLocationId || ""} onChange={(event) => updatePreviewRow(row.documentKey, { toLocationId: Number(event.target.value) })} disabled={isBusy}><option value="">{t("selectWarehouse")}</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
                    {row.input.transferMode === "PARTIAL" ? <>
                      <label>{t("bulkTransferFromStorageSection")}<input value={row.input.fromStorageSection || "TEMP"} onChange={(event) => updatePreviewRow(row.documentKey, { fromStorageSection: event.target.value })} disabled={isBusy} /></label>
                      <label>{t("bulkTransferToStorageSection")}<input value={row.input.toStorageSection || "TEMP"} onChange={(event) => updatePreviewRow(row.documentKey, { toStorageSection: event.target.value })} disabled={isBusy} /></label>
                      <label>{t("sku")}<input value={row.input.sku || ""} onChange={(event) => updatePreviewRow(row.documentKey, { sku: event.target.value })} disabled={isBusy} /></label>
                      <label>{t("itemCode")}<input value={row.input.itemCode || ""} onChange={(event) => updatePreviewRow(row.documentKey, { itemCode: event.target.value })} disabled={isBusy} /></label>
                      <label>{t("bulkTransferQty")}<input type="number" min="0" step="1" value={row.input.quantity ?? ""} onChange={(event) => updatePreviewRow(row.documentKey, { quantity: toNullableWholeNumber(event.target.value) })} disabled={isBusy} /></label>
                      <label>{t("bulkTransferSourcePallets")}<input type="number" min="0" step="1" value={row.input.sourcePallets ?? ""} onChange={(event) => updatePreviewRow(row.documentKey, { sourcePallets: toNullableWholeNumber(event.target.value) })} disabled={isBusy} /></label>
                      <label>{t("bulkTransferDestinationPallets")}<input type="number" min="0" step="1" value={row.input.destinationPallets ?? ""} onChange={(event) => updatePreviewRow(row.documentKey, { destinationPallets: toNullableWholeNumber(event.target.value) })} disabled={isBusy} /></label>
                    </> : <label>{t("bulkTransferToStorageSection")}<input value={row.input.toStorageSection || "TEMP"} onChange={(event) => updatePreviewRow(row.documentKey, { toStorageSection: event.target.value })} disabled={isBusy} /></label>}
                  </div>
                  {row.issues.length ? <div className="bulk-inbound-issue-list">
                    {row.issues.map((issue, index) => <div className="bulk-inbound-issue bulk-inbound-issue--error" key={`${issue.code}-${index}`}><ErrorOutlineRoundedIcon /><span>{t("bulkTransferRow", { row: issue.rowNumber || row.rowNumber })}: {issue.message}</span></div>)}
                  </div> : null}
                </div>
              </details>)}
            </div>
          </div> : null}

          {step === "RESULT" && result ? <div className="bulk-inbound-result">
            {result.retentionWarning ? <InlineAlert severity="warning">{result.retentionWarning}</InlineAlert> : null}
            <div className={`bulk-inbound-result__hero ${result.failedTransfers > 0 ? "bulk-inbound-result__hero--partial" : ""}`}>
              {result.failedTransfers > 0 ? <WarningAmberRoundedIcon /> : <CheckCircleOutlineRoundedIcon />}
              <div><span>{result.sourceFileName}</span><strong>{result.failedTransfers > 0 ? t("bulkTransferPartialComplete") : t("bulkTransferComplete")}</strong><p>{t("bulkTransferResultSummary", { created: result.createdTransfers, failed: result.failedTransfers })}</p></div>
            </div>
            <div className="bulk-inbound-result-list">
              {result.results.map((entry) => <div className={`bulk-inbound-result-row ${entry.success ? "bulk-inbound-result-row--success" : "bulk-inbound-result-row--failed"}`} key={entry.documentKey}>
                {entry.success ? <CheckCircleOutlineRoundedIcon /> : <ErrorOutlineRoundedIcon />}
                <div><strong>{entry.containerNo || entry.documentKey}</strong><span>{entry.success ? t("bulkTransferPosted", { id: entry.transfer?.transferNo || "—" }) : entry.error || t("bulkTransferCommitFailed")}</span></div><em>{entry.containerNo || "—"}</em>
              </div>)}
            </div>
          </div> : null}
        </DialogContent>
        <DialogActions className="bulk-inbound-dialog__actions">
          {step === "UPLOAD" ? <><Button onClick={closeDialog} disabled={isBusy}>{t("cancel")}</Button><Button variant="contained" startIcon={isPreviewing ? <InlineLoadingIndicator /> : <CloudUploadOutlinedIcon />} disabled={isBusy || !file || !customerId} onClick={() => void handlePreview()}>{isPreviewing ? t("bulkTransferReadingWorkbook") : t("bulkTransferPreviewFile")}</Button></> : null}
          {step === "PREVIEW" && preview ? <><Button onClick={() => { setStep("UPLOAD"); setPreview(null); setHasPreviewChanges(false); setErrorMessage(""); }} disabled={isBusy}>{t("back")}</Button>{hasPreviewChanges ? <Button variant="outlined" startIcon={isRevalidating ? <InlineLoadingIndicator /> : <CheckCircleOutlineRoundedIcon />} disabled={isBusy} onClick={() => void handleRevalidate()}>{isRevalidating ? t("bulkTransferRevalidating") : t("bulkTransferRevalidate")}</Button> : null}<Button variant="contained" startIcon={isImporting ? <InlineLoadingIndicator /> : <CheckCircleOutlineRoundedIcon />} disabled={isBusy || hasPreviewChanges || preview.validTransfers === 0} onClick={() => void handleImport()}>{isImporting ? t("bulkTransferPosting") : t("bulkTransferPost", { count: preview.validTransfers })}</Button></> : null}
          {step === "RESULT" ? <Button variant="contained" onClick={closeDialog}>{t("done")}</Button> : null}
        </DialogActions>
      </Dialog>
      <BulkImportHistoryDialog open={historyOpen} importType="TRANSFER" onClose={() => setHistoryOpen(false)} />
    </>
  );
}

function toNullableWholeNumber(value: string) {
  if (value.trim() === "") return null;
  return Number(value);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
