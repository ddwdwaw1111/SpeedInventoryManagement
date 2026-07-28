import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import HistoryRoundedIcon from "@mui/icons-material/HistoryRounded";
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton
} from "@mui/material";
import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { BulkImportBatch, BulkImportType } from "../lib/types";
import { InlineAlert } from "./Feedback";
import { InlineLoadingIndicator } from "./InlineLoadingIndicator";

type Props = {
  open: boolean;
  importType: BulkImportType;
  onClose: () => void;
};

const historyPageSize = 50;

export function BulkImportHistoryDialog({ open, importType, onClose }: Props) {
  const { language, t } = useI18n();
  const [batches, setBatches] = useState<BulkImportBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setBatches([]);
    setHasMore(false);
    setError("");
    void api.getBulkImportBatches(importType, historyPageSize)
      .then((response) => {
        if (cancelled) return;
        const nextBatches = Array.isArray(response) ? response : [];
        setBatches(nextBatches);
        setHasMore(nextBatches.length === historyPageSize);
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : t("bulkImportHistoryLoadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, importType, t]);

  async function loadMore() {
    const beforeId = batches[batches.length - 1]?.id;
    if (!beforeId || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const response = await api.getBulkImportBatches(importType, historyPageSize, undefined, beforeId);
      const nextBatches = Array.isArray(response) ? response : [];
      setBatches((current) => [...current, ...nextBatches]);
      setHasMore(nextBatches.length === historyPageSize);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("bulkImportHistoryLoadFailed"));
    } finally {
      setLoadingMore(false);
    }
  }

  async function downloadOriginal(batch: BulkImportBatch) {
    setDownloadingId(batch.id);
    setError("");
    try {
      const { blob, fileName } = await api.downloadBulkImportBatchFile(batch.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName || batch.sourceFileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("bulkImportDownloadFailed"));
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <HistoryRoundedIcon color="primary" sx={{ mt: 0.4 }} />
          <div>
            <strong style={{ display: "block" }}>{t("bulkImportHistoryTitle")}</strong>
            <span style={{ display: "block", marginTop: 4, fontSize: 13, fontWeight: 400, color: "var(--muted-text, #64748b)" }}>
              {t("bulkImportHistoryHint")}
            </span>
          </div>
        </div>
        <IconButton aria-label={t("close")} onClick={onClose}><CloseRoundedIcon /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 32 }}><InlineLoadingIndicator /></div>
        ) : batches.length === 0 ? (
          <InlineAlert severity="info">{t("bulkImportHistoryEmpty")}</InlineAlert>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {batches.map((batch) => (
              <article key={batch.id} style={{ border: "1px solid #dbe3ee", borderRadius: 12, padding: 16, background: "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0, flex: "1 1 380px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <strong style={{ overflowWrap: "anywhere" }}>{batch.sourceFileName}</strong>
                      <Chip size="small" color={statusColor(batch.status)} label={statusLabel(batch.status, t)} />
                    </div>
                    <div style={{ marginTop: 8, display: "flex", gap: "6px 18px", flexWrap: "wrap", color: "#526173", fontSize: 13 }}>
                      <span>{batch.customerName}</span>
                      <span>{t("bulkImportUploadedBy")}: {batch.createdByName || batch.createdByEmail || `#${batch.createdByUserId}`}</span>
                      <span>{t("bulkImportUploadedAt")}: {formatDateTime(batch.createdAt, language)}</span>
                      <span>{t("bulkImportFileSize")}: {formatFileSize(batch.fileSizeBytes)}</span>
                    </div>
                  </div>
                  <Button
                    variant="outlined"
                    startIcon={downloadingId === batch.id ? <InlineLoadingIndicator /> : <DownloadOutlinedIcon />}
                    disabled={downloadingId !== null}
                    onClick={() => void downloadOriginal(batch)}
                  >
                    {t("bulkImportDownloadOriginal")}
                  </Button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, marginTop: 14 }}>
                  <div style={summaryStyle}>
                    <span>{t("bulkImportValidationResult")}</span>
                    <strong>{batch.validDocuments} / {batch.totalDocuments}</strong>
                    <small>{batch.invalidDocuments} {t("bulkImportBlockedDocuments")} · {batch.totalLines} {t("lines")}</small>
                  </div>
                  <div style={summaryStyle}>
                    <span>{t("bulkImportCommitResult")}</span>
                    <strong>{batch.createdDocuments} / {batch.totalDocuments}</strong>
                    <small>{batch.failedDocuments} {t("bulkImportFailedDocuments")}</small>
                  </div>
                </div>

                {batch.errorMessage ? <div style={{ marginTop: 10 }}><InlineAlert>{batch.errorMessage}</InlineAlert></div> : null}
                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: "pointer", fontWeight: 650 }}>{t("bulkImportDocuments")} ({batch.documents?.length ?? 0})</summary>
                  {batch.documents?.length ? (
                    <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                      {batch.documents.map((document) => (
                        <div key={document.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 10px", borderRadius: 8, background: "#f6f8fb", flexWrap: "wrap" }}>
                          <strong>{document.referenceCode || document.documentKey}</strong>
                          <span>{document.status === "CREATED" ? t("bulkImportDocumentCreated", { id: document.documentId }) : document.errorMessage || statusLabel(document.status, t)}</span>
                        </div>
                      ))}
                    </div>
                  ) : <p style={{ margin: "8px 0 0", color: "#64748b" }}>{t("bulkImportNoDocumentResults")}</p>}
                </details>
              </article>
            ))}
            {hasMore ? (
              <div style={{ display: "flex", justifyContent: "center", paddingTop: 4 }}>
                <Button variant="outlined" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? t("bulkImportLoadingMore") : t("bulkImportLoadMore")}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>{t("close")}</Button></DialogActions>
    </Dialog>
  );
}

const summaryStyle = {
  display: "grid",
  gap: 3,
  padding: "10px 12px",
  borderRadius: 9,
  background: "#f6f8fb"
} as const;

function statusLabel(status: string, t: (key: string, params?: Record<string, string | number>) => string) {
  const labels: Record<string, string> = {
    UPLOADED: "bulkImportStatusUploaded",
    PREVIEWED: "bulkImportStatusPreviewed",
    PREVIEW_FAILED: "bulkImportStatusPreviewFailed",
    COMMITTING: "bulkImportStatusCommitting",
    COMPLETED: "bulkImportStatusCompleted",
    PARTIAL: "bulkImportStatusPartial",
    FAILED: "bulkImportStatusFailed",
    CREATED: "bulkImportStatusCompleted"
  };
  return t(labels[status] ?? status);
}

function statusColor(status: string): "default" | "success" | "warning" | "error" | "info" {
  if (status === "COMPLETED") return "success";
  if (status === "PARTIAL") return "warning";
  if (status === "FAILED" || status === "PREVIEW_FAILED") return "error";
  if (status === "COMMITTING") return "info";
  return "default";
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value: string, language: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}
