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
import { downloadInboundBulkImportSample, downloadInboundBulkImportTemplate } from "../lib/inboundBulkImportTemplate";
import { useI18n } from "../lib/i18n";
import type {
  Customer,
  InboundBulkImportCommitResponse,
  InboundBulkImportDocumentPreview,
  InboundBulkImportIssue,
  InboundBulkImportPreview,
  InboundDocumentLinePayload,
  Location
} from "../lib/types";
import { BulkImportHistoryDialog } from "./BulkImportHistoryDialog";
import { InlineAlert } from "./Feedback";
import { InlineLoadingIndicator } from "./InlineLoadingIndicator";

type InboundBulkImportDialogProps = {
  open: boolean;
  customers: Customer[];
  locations: Location[];
  initialCustomerId?: number;
  onClose: () => void;
  onImported: () => Promise<void> | void;
};

type ImportStep = "UPLOAD" | "PREVIEW" | "RESULT";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function InboundBulkImportDialog({
  open,
  customers,
  locations,
  initialCustomerId,
  onClose,
  onImported
}: InboundBulkImportDialogProps) {
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
  const [preview, setPreview] = useState<InboundBulkImportPreview | null>(null);
  const [result, setResult] = useState<InboundBulkImportCommitResponse | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const defaultCustomer = customers.find((customer) => customer.id === initialCustomerId) ?? customers[0];
    setStep("UPLOAD");
    setCustomerId(defaultCustomer ? String(defaultCustomer.id) : "");
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
    setHasPreviewChanges(false);
    setResult(null);
    if (!nextFile) {
      setFile(null);
      return;
    }
    if (!nextFile.name.toLowerCase().endsWith(".xlsx")) {
      setFile(null);
      setErrorMessage(t("bulkInboundExcelOnly"));
      return;
    }
    if (nextFile.size > MAX_FILE_SIZE) {
      setFile(null);
      setErrorMessage(t("bulkInboundFileTooLarge"));
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
      setErrorMessage(t("bulkInboundSelectContextAndFile"));
      return;
    }

    setIsPreviewing(true);
    setErrorMessage("");
    try {
      const nextPreview = await api.previewInboundBulkImport(file, selectedCustomerId);
      setPreview(nextPreview);
      setHasPreviewChanges(false);
      setStep("PREVIEW");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("bulkInboundPreviewFailed"));
    } finally {
      setIsPreviewing(false);
    }
  }

  function updatePreviewDocument(
    documentKey: string,
    updater: (document: InboundBulkImportDocumentPreview) => InboundBulkImportDocumentPreview
  ) {
    setPreview((current) => current ? {
      ...current,
      documents: current.documents.map((document) => document.documentKey === documentKey ? updater(document) : document)
    } : current);
    setHasPreviewChanges(true);
    setErrorMessage("");
  }

  function updateDocumentInput(documentKey: string, patch: Partial<InboundBulkImportDocumentPreview["input"]>) {
    updatePreviewDocument(documentKey, (document) => ({
      ...document,
      input: { ...document.input, ...patch }
    }));
  }

  function updateDocumentLine(documentKey: string, lineIndex: number, patch: Partial<InboundDocumentLinePayload>) {
    updatePreviewDocument(documentKey, (document) => ({
      ...document,
      input: {
        ...document.input,
        lines: document.input.lines.map((line, index) => index === lineIndex ? { ...line, ...patch } : line)
      }
    }));
  }

  function addDocumentLine(documentKey: string) {
    updatePreviewDocument(documentKey, (document) => ({
      ...document,
      input: {
        ...document.input,
        lines: [...document.input.lines, {
          sku: "",
          itemNumber: "",
          description: "",
          expectedQty: 0,
          receivedQty: 0,
          pallets: 0,
          storageSection: document.input.storageSection || "TEMP"
        }]
      }
    }));
  }

  function removeDocumentLine(documentKey: string, lineIndex: number) {
    updatePreviewDocument(documentKey, (document) => ({
      ...document,
      input: {
        ...document.input,
        lines: document.input.lines.filter((_, index) => index !== lineIndex)
      }
    }));
  }

  async function handleRevalidate() {
    if (!preview || !hasPreviewChanges) return;
    setIsRevalidating(true);
    setErrorMessage("");
    try {
      const nextPreview = await api.revalidateInboundBulkImport({
        importId: preview.importId,
        sourceFileName: preview.sourceFileName,
        customerId: preview.customerId,
        documents: preview.documents.map((document) => ({
          documentKey: document.documentKey,
          locationName: document.locationName,
          rowNumbers: document.rowNumbers,
          input: document.input
        }))
      });
      setPreview({ ...nextPreview, importBatchId: preview.importBatchId });
      setHasPreviewChanges(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("bulkInboundRevalidateFailed"));
    } finally {
      setIsRevalidating(false);
    }
  }

  async function handleImport() {
    if (!preview || preview.validDocuments === 0) return;
    setIsImporting(true);
    setErrorMessage("");
    try {
      const response = await api.commitInboundBulkImport({
        importId: preview.importId,
        sourceFileName: preview.sourceFileName,
        customerId: preview.customerId,
        documents: preview.documents
          .filter((document) => document.valid)
          .map((document) => ({ documentKey: document.documentKey, input: document.input }))
      });
      setResult(response);
      setStep("RESULT");
      if (response.createdDocuments > 0) {
        await onImported();
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("bulkInboundCommitFailed"));
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
        <div>
          <span>{t("bulkInboundEyebrow")}</span>
          <strong>{t("bulkInboundTitle")}</strong>
        </div>
        <IconButton aria-label={t("close")} onClick={closeDialog} disabled={isBusy}>
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers className="bulk-inbound-dialog__content">
        <div className="bulk-inbound-steps" aria-label={t("bulkInboundProgress")}>
          {(["UPLOAD", "PREVIEW", "RESULT"] as ImportStep[]).map((candidate, index) => {
            const activeIndex = ["UPLOAD", "PREVIEW", "RESULT"].indexOf(step);
            const isComplete = index < activeIndex;
            return (
              <div className={`bulk-inbound-step ${candidate === step ? "bulk-inbound-step--active" : ""} ${isComplete ? "bulk-inbound-step--complete" : ""}`} key={candidate}>
                <span>{isComplete ? <CheckCircleOutlineRoundedIcon fontSize="small" /> : index + 1}</span>
                <strong>{t(candidate === "UPLOAD" ? "bulkInboundStepUpload" : candidate === "PREVIEW" ? "bulkInboundStepPreview" : "bulkInboundStepResult")}</strong>
              </div>
            );
          })}
        </div>

        {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}

        {step === "UPLOAD" ? (
          <div className="bulk-inbound-upload-layout">
            <section className="bulk-inbound-context-panel">
              <div className="bulk-inbound-section-heading">
                <span>01</span>
                <div><strong>{t("bulkInboundImportContext")}</strong><p>{t("bulkInboundImportContextHint")}</p></div>
              </div>
              <div className="bulk-inbound-context-grid bulk-inbound-context-grid--single">
                <label>
                  {t("customer")}
                  <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} disabled={isBusy}>
                    <option value="">{t("selectCustomer")}</option>
                    {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
                  </select>
                </label>
              </div>
              <InlineAlert severity="info">{t("bulkInboundDraftOnlyNotice")}</InlineAlert>
              <InlineAlert severity="info">{t("bulkImportRetainedNotice")}</InlineAlert>
              <div className="bulk-inbound-template-card">
                <DescriptionOutlinedIcon />
                <div><strong>{t("bulkInboundTemplateTitle")}</strong><span>{t("bulkInboundTemplateHint")}</span></div>
                <div className="bulk-inbound-template-actions">
                  <Button variant="outlined" startIcon={<DownloadOutlinedIcon />} onClick={downloadInboundBulkImportTemplate}>
                    {t("bulkInboundDownloadBlankTemplate")}
                  </Button>
                  <Button variant="contained" startIcon={<DownloadOutlinedIcon />} onClick={() => downloadInboundBulkImportSample(locations)} disabled={locations.length === 0}>
                    {t("bulkInboundDownloadSampleTemplate")}
                  </Button>
                  <Button onClick={() => setHistoryOpen(true)}>{t("bulkImportHistory")}</Button>
                </div>
              </div>
            </section>

            <section className="bulk-inbound-file-panel">
              <div className="bulk-inbound-section-heading">
                <span>02</span>
                <div><strong>{t("bulkInboundUploadWorkbook")}</strong><p>{t("bulkInboundUploadWorkbookHint")}</p></div>
              </div>
              <label
                className={`bulk-inbound-dropzone ${isDragging ? "bulk-inbound-dropzone--dragging" : ""} ${file ? "bulk-inbound-dropzone--selected" : ""}`}
                onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => selectFile(event.target.files?.[0] ?? null)} disabled={isBusy} />
                {file ? <CheckCircleOutlineRoundedIcon className="bulk-inbound-dropzone__icon bulk-inbound-dropzone__icon--ready" /> : <CloudUploadOutlinedIcon className="bulk-inbound-dropzone__icon" />}
                <strong>{file ? file.name : t("bulkInboundDropFile")}</strong>
                <span>{file ? formatFileSize(file.size) : t("bulkInboundFileRules")}</span>
                <em>{file ? t("bulkInboundReplaceFile") : t("bulkInboundBrowseFile")}</em>
              </label>
              <div className="bulk-inbound-rule-grid">
                <div><strong>{t("bulkInboundGroupingRule")}</strong><span>{t("bulkInboundGroupingRuleHint")}</span></div>
                <div><strong>{t("bulkInboundQuantityRule")}</strong><span>{t("bulkInboundQuantityRuleHint")}</span></div>
                <div><strong>{t("bulkInboundHistoricalDateRule")}</strong><span>{t("bulkInboundHistoricalDateRuleHint")}</span></div>
              </div>
            </section>
          </div>
        ) : null}

        {step === "PREVIEW" && preview ? (
          <div className="bulk-inbound-preview">
            <div className="bulk-inbound-preview__banner">
              <div><span>{preview.sourceFileName}</span><strong>{preview.customerName} · {t("bulkInboundWarehouseCount", { count: preview.locationCount })}</strong></div>
              <p>{t("bulkInboundPreviewHint")}</p>
            </div>
            <div className="bulk-inbound-metrics">
              <div><strong>{preview.totalDocuments}</strong><span>{t("bulkInboundReceiptsFound")}</span></div>
              <div className="bulk-inbound-metric--success"><strong>{preview.validDocuments}</strong><span>{t("bulkInboundReadyDrafts")}</span></div>
              <div className={preview.invalidDocuments > 0 ? "bulk-inbound-metric--danger" : ""}><strong>{preview.invalidDocuments}</strong><span>{t("bulkInboundBlockedDrafts")}</span></div>
              <div><strong>{preview.totalLines}</strong><span>{t("skuLines")}</span></div>
            </div>
            {hasPreviewChanges ? <InlineAlert severity="warning">{t("bulkInboundChangesNeedValidation")}</InlineAlert> : null}
            {preview.invalidDocuments > 0 ? <InlineAlert severity="warning">{t("bulkInboundInvalidSkipped")}</InlineAlert> : null}
            <div className="bulk-inbound-document-list">
              {preview.documents.map((document) => (
                <details className={`bulk-inbound-document ${document.valid ? "bulk-inbound-document--valid" : "bulk-inbound-document--invalid"}`} key={document.documentKey} open={!document.valid}>
                  <summary>
                    <div className="bulk-inbound-document__identity">
                      {document.valid ? <CheckCircleOutlineRoundedIcon /> : <ErrorOutlineRoundedIcon />}
                      <div><strong>{document.input.containerNo || "—"}</strong><span>{document.locationName || t("bulkInboundWarehouseMissing")} · {t("actualArrivalDate")}: {document.input.actualArrivalDate || "—"} · {t("bulkInboundRows")}: {formatRows(document.rowNumbers)}</span></div>
                    </div>
                    <div className="bulk-inbound-document__totals">
                      <span><strong>{document.totalLines}</strong>{t("lines")}</span>
                      <span><strong>{document.totalReceivedQty || document.totalExpectedQty}</strong>CTN</span>
                      <span><strong>{document.totalPallets}</strong>{t("pallets")}</span>
                      <em>{document.valid ? t("bulkInboundReady") : t("bulkInboundBlocked")}</em>
                      <ExpandMoreRoundedIcon />
                    </div>
                  </summary>
                  <div className="bulk-inbound-document__body">
                    <div className="bulk-inbound-edit-grid">
                      <label>{t("containerNo")}<input aria-label={`${t("containerNo")} ${document.documentKey}`} value={document.input.containerNo || ""} onChange={(event) => updateDocumentInput(document.documentKey, { containerNo: event.target.value })} disabled={isBusy} /></label>
                      <label>{t("warehouse")}<select aria-label={`${t("warehouse")} ${document.documentKey}`} value={document.input.locationId || ""} onChange={(event) => {
                        const locationId = Number(event.target.value);
                        const location = locations.find((candidate) => candidate.id === locationId);
                        updatePreviewDocument(document.documentKey, (current) => ({ ...current, locationName: location?.name || "", input: { ...current.input, locationId } }));
                      }} disabled={isBusy}><option value="">{t("selectWarehouse")}</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
                      <label>{t("actualArrivalDate")}<input aria-label={`${t("actualArrivalDate")} ${document.documentKey}`} type="date" value={document.input.actualArrivalDate || ""} onChange={(event) => updateDocumentInput(document.documentKey, { actualArrivalDate: event.target.value })} disabled={isBusy} /></label>
                      <label>{t("containerType")}<select aria-label={`${t("containerType")} ${document.documentKey}`} value={document.input.containerType || "NORMAL"} onChange={(event) => updateDocumentInput(document.documentKey, { containerType: event.target.value as "NORMAL" | "WEST_COAST_TRANSFER" })} disabled={isBusy}><option value="NORMAL">NORMAL</option><option value="WEST_COAST_TRANSFER">WEST COAST TRANSFER</option></select></label>
                      <label>{t("handlingMode")}<select aria-label={`${t("handlingMode")} ${document.documentKey}`} value={document.input.handlingMode || "PALLETIZED"} onChange={(event) => updateDocumentInput(document.documentKey, { handlingMode: event.target.value })} disabled={isBusy}><option value="PALLETIZED">PALLETIZED</option><option value="SEALED_TRANSIT">SEALED TRANSIT</option></select></label>
                    </div>
                    {document.issues.length > 0 ? (
                      <div className="bulk-inbound-issue-list">
                        {document.issues.map((issue, index) => (
                          <div className={`bulk-inbound-issue bulk-inbound-issue--${issue.severity.toLowerCase()}`} key={`${issue.code}-${issue.rowNumber ?? 0}-${index}`}>
                            {issue.severity === "ERROR" ? <ErrorOutlineRoundedIcon /> : <WarningAmberRoundedIcon />}
                            <span>{issue.rowNumber ? `${t("bulkInboundRow")} ${issue.rowNumber}: ` : ""}{formatBulkImportIssue(issue, t)}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="bulk-inbound-table-wrap">
                      <table className="bulk-inbound-line-table">
                        <thead><tr><th>{t("sku")}</th><th>{t("itemCode")}</th><th>{t("description")}</th><th>{t("expectedQty")}</th><th>{t("receivedQty")}</th><th>{t("pallets")}</th><th>{t("ctnPerPallet")}</th><th>{t("storageSection")}</th><th>{t("bulkInboundActions")}</th></tr></thead>
                        <tbody>{document.input.lines.map((line, index) => (
                          <tr key={`${document.documentKey}-${index}`}>
                            <td><input aria-label={`${t("sku")} ${index + 1}`} value={line.sku} onChange={(event) => updateDocumentLine(document.documentKey, index, { sku: event.target.value })} disabled={isBusy} /></td>
                            <td><input aria-label={`${t("itemCode")} ${index + 1}`} value={line.itemNumber || ""} onChange={(event) => updateDocumentLine(document.documentKey, index, { itemNumber: event.target.value })} disabled={isBusy} /></td>
                            <td><input aria-label={`${t("description")} ${index + 1}`} value={line.description || ""} onChange={(event) => updateDocumentLine(document.documentKey, index, { description: event.target.value })} disabled={isBusy} /></td>
                            <td><input aria-label={`${t("expectedQty")} ${index + 1}`} type="number" min="0" value={line.expectedQty} onChange={(event) => updateDocumentLine(document.documentKey, index, { expectedQty: toNonNegativeNumber(event.target.value) })} disabled={isBusy} /></td>
                            <td><input aria-label={`${t("receivedQty")} ${index + 1}`} type="number" min="0" value={line.receivedQty} onChange={(event) => updateDocumentLine(document.documentKey, index, { receivedQty: toNonNegativeNumber(event.target.value) })} disabled={isBusy} /></td>
                            <td><input aria-label={`${t("pallets")} ${index + 1}`} type="number" min="0" value={line.pallets} onChange={(event) => updateDocumentLine(document.documentKey, index, { pallets: toNonNegativeNumber(event.target.value) })} disabled={isBusy} /></td>
                            <td><input aria-label={`${t("ctnPerPallet")} ${index + 1}`} type="number" min="0" value={line.inboundCtnsPerPallet || ""} onChange={(event) => updateDocumentLine(document.documentKey, index, { inboundCtnsPerPallet: event.target.value === "" ? undefined : toNonNegativeNumber(event.target.value) })} disabled={isBusy} /></td>
                            <td><input aria-label={`${t("storageSection")} ${index + 1}`} value={line.storageSection || ""} onChange={(event) => updateDocumentLine(document.documentKey, index, { storageSection: event.target.value })} disabled={isBusy} /></td>
                            <td><Button size="small" color="error" onClick={() => removeDocumentLine(document.documentKey, index)} disabled={isBusy || document.input.lines.length === 1}>{t("bulkInboundRemoveLine")}</Button></td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                    <div><Button size="small" variant="outlined" onClick={() => addDocumentLine(document.documentKey)} disabled={isBusy}>{t("bulkInboundAddLine")}</Button></div>
                  </div>
                </details>
              ))}
            </div>
          </div>
        ) : null}

        {step === "RESULT" && result ? (
          <div className="bulk-inbound-result">
            {result.retentionWarning ? <InlineAlert severity="warning">{result.retentionWarning}</InlineAlert> : null}
            <div className={`bulk-inbound-result__hero ${result.failedDocuments > 0 ? "bulk-inbound-result__hero--partial" : ""}`}>
              {result.failedDocuments > 0 ? <WarningAmberRoundedIcon /> : <CheckCircleOutlineRoundedIcon />}
              <div><span>{result.sourceFileName}</span><strong>{result.failedDocuments > 0 ? t("bulkInboundPartialComplete") : t("bulkInboundComplete")}</strong><p>{t("bulkInboundResultSummary", { created: result.createdDocuments, failed: result.failedDocuments })}</p></div>
            </div>
            <div className="bulk-inbound-result-list">
              {result.results.map((entry) => (
                <div className={`bulk-inbound-result-row ${entry.success ? "bulk-inbound-result-row--success" : "bulk-inbound-result-row--failed"}`} key={entry.documentKey}>
                  {entry.success ? <CheckCircleOutlineRoundedIcon /> : <ErrorOutlineRoundedIcon />}
                  <div><strong>{entry.containerNo || entry.documentKey}</strong><span>{entry.success ? t("bulkInboundDraftCreated", { id: entry.document?.id ?? "—" }) : entry.error || t("bulkInboundCommitFailed")}</span></div>
                  <em>{entry.containerNo || "—"}</em>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </DialogContent>
      <DialogActions className="bulk-inbound-dialog__actions">
        {step === "UPLOAD" ? (
          <>
            <Button onClick={closeDialog} disabled={isBusy}>{t("cancel")}</Button>
            <Button variant="contained" startIcon={isPreviewing ? <InlineLoadingIndicator /> : <CloudUploadOutlinedIcon />} disabled={isPreviewing || !file || !customerId} onClick={() => void handlePreview()}>
              {isPreviewing ? t("bulkInboundReadingWorkbook") : t("bulkInboundPreviewFile")}
            </Button>
          </>
        ) : null}
        {step === "PREVIEW" && preview ? (
          <>
            <Button onClick={() => { setStep("UPLOAD"); setPreview(null); setHasPreviewChanges(false); setErrorMessage(""); }} disabled={isBusy}>{t("back")}</Button>
            {hasPreviewChanges ? <Button variant="outlined" startIcon={isRevalidating ? <InlineLoadingIndicator /> : <CheckCircleOutlineRoundedIcon />} disabled={isBusy} onClick={() => void handleRevalidate()}>{isRevalidating ? t("bulkInboundRevalidating") : t("bulkInboundRevalidate")}</Button> : null}
            <Button variant="contained" startIcon={isImporting ? <InlineLoadingIndicator /> : <CheckCircleOutlineRoundedIcon />} disabled={isBusy || hasPreviewChanges || preview.validDocuments === 0} onClick={() => void handleImport()}>
              {isImporting ? t("bulkInboundCreatingDrafts") : t("bulkInboundImportDrafts", { count: preview.validDocuments })}
            </Button>
          </>
        ) : null}
        {step === "RESULT" ? <Button variant="contained" onClick={closeDialog}>{t("done")}</Button> : null}
      </DialogActions>
    </Dialog>
    <BulkImportHistoryDialog open={historyOpen} importType="INBOUND" onClose={() => setHistoryOpen(false)} />
    </>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toNonNegativeNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function formatRows(rows: number[]) {
  if (rows.length === 0) return "—";
  if (rows.length === 1) return String(rows[0]);
  return `${rows[0]}–${rows[rows.length - 1]}`;
}

function formatBulkImportIssue(issue: InboundBulkImportIssue, t: (key: string, params?: Record<string, string | number>) => string) {
  const keys: Record<string, string> = {
    MISSING_CONTAINER_NO: "bulkIssueMissingContainerNo",
    MISSING_WAREHOUSE: "bulkIssueMissingWarehouse",
    MISSING_ACTUAL_DATE: "bulkIssueMissingActualDate",
    MISSING_SKU: "bulkIssueMissingSku",
    MISSING_RECEIVED_QTY: "bulkIssueMissingReceivedQty",
    MISSING_PALLETS: "bulkIssueMissingPallets",
    INVALID_EXPECTED_QTY: "bulkIssueInvalidExpectedQty",
    INVALID_RECEIVED_QTY: "bulkIssueInvalidReceivedQty",
    INVALID_PALLETS: "bulkIssueInvalidPallets",
    INVALID_CTN_PER_PALLET: "bulkIssueInvalidCtnPerPallet",
    QUANTITY_REQUIRED: "bulkIssueQuantityRequired",
    INVALID_ACTUAL_DATE: "bulkIssueInvalidDate",
    INVALID_CONTAINER_TYPE: "bulkIssueInvalidContainerType",
    INVALID_HANDLING_MODE: "bulkIssueInvalidHandlingMode",
    HEADER_CONFLICT: "bulkIssueHeaderConflict",
    INVALID_WAREHOUSE: "bulkIssueInvalidWarehouse",
    INVALID_STORAGE_SECTION: "bulkIssueInvalidStorageSection",
    ITEM_CODE_SKU_CONFLICT: "bulkIssueItemCodeConflict",
    SKU_ITEM_CODE_MISMATCH: "bulkIssueSkuItemCodeMismatch",
    NEW_SKU_DESCRIPTION_REQUIRED: "bulkIssueNewSkuDescription",
    CTN_PER_PALLET_DEFAULT_MISMATCH: "bulkIssueCtnDefaultMismatch",
    SEALED_TRANSIT_PALLET_VALUES_IGNORED: "bulkIssueSealedPalletsIgnored",
    ZERO_PALLETS: "bulkIssueZeroPallets",
    EXISTING_CONTAINER: "bulkIssueExistingContainer",
  };
  const key = keys[issue.code];
  return key ? t(key, {
    value: issue.value || "—",
    currentSku: issue.currentSku || "—",
    currentItemCode: issue.currentItemCode || issue.value || "—",
    existingSku: issue.existingSku || "—",
    existingItemCode: issue.existingItemCode || "—"
  }) : issue.message;
}
