import { ExternalLink, Eye, Paperclip, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "../lib/i18n";
import type { DocumentAttachment } from "../lib/types";
import { InlineLoadingIndicator } from "./InlineLoadingIndicator";

export type PendingDocumentAttachment = {
  id: string;
  file: File;
  displayName: string;
};

type DocumentAttachmentsPanelProps = {
  attachments: DocumentAttachment[];
  pendingAttachments?: PendingDocumentAttachment[];
  disabled?: boolean;
  canUploadNow?: boolean;
  showUploadButton?: boolean;
  onPendingAttachmentsChange?: (attachments: PendingDocumentAttachment[]) => void;
  onUpload?: (file: File, displayName: string) => Promise<void>;
  onGetDownloadUrl: (attachment: DocumentAttachment) => Promise<string>;
  onDelete?: (attachment: DocumentAttachment) => Promise<void>;
};

type AttachmentPreviewState = {
  name: string;
  contentType: string;
  sizeBytes: number;
  url: string;
  pendingId?: string;
  isObjectUrl?: boolean;
};

export function DocumentAttachmentsPanel({
  attachments,
  pendingAttachments = [],
  disabled = false,
  canUploadNow = true,
  showUploadButton = true,
  onPendingAttachmentsChange,
  onUpload,
  onGetDownloadUrl,
  onDelete
}: DocumentAttachmentsPanelProps) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busyKey, setBusyKey] = useState("");
  const [panelError, setPanelError] = useState("");
  const [preview, setPreview] = useState<AttachmentPreviewState | null>(null);

  const isUploading = busyKey === "upload";
  const hasPendingControls = Boolean(onPendingAttachmentsChange);
  const hasUploadAction = Boolean(onUpload && showUploadButton);
  const canUpload = hasUploadAction && canUploadNow && !disabled && pendingAttachments.length > 0 && !busyKey;
  const attachmentSummaryCount = attachments.length + pendingAttachments.length;

  useEffect(() => {
    return () => {
      if (preview?.isObjectUrl) {
        URL.revokeObjectURL(preview.url);
      }
    };
  }, [preview]);

  function handleFilesSelected(files: FileList | null) {
    if (!files || disabled || !onPendingAttachmentsChange) {
      return;
    }
    const nextAttachments = Array.from(files).map((file) => ({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      file,
      displayName: defaultAttachmentDisplayName(file.name)
    }));
    onPendingAttachmentsChange([...pendingAttachments, ...nextAttachments]);
    setPanelError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function updatePendingDisplayName(id: string, displayName: string) {
    if (!onPendingAttachmentsChange) {
      return;
    }
    onPendingAttachmentsChange(pendingAttachments.map((entry) => (
      entry.id === id ? { ...entry, displayName } : entry
    )));
  }

  function removePendingAttachment(id: string) {
    if (!onPendingAttachmentsChange) {
      return;
    }
    if (preview?.pendingId === id) {
      closePreview();
    }
    onPendingAttachmentsChange(pendingAttachments.filter((entry) => entry.id !== id));
  }

  async function uploadPendingAttachments() {
    if (!canUpload || !onUpload || !onPendingAttachmentsChange) {
      return;
    }
    setBusyKey("upload");
    setPanelError("");
    try {
      let remainingAttachments = [...pendingAttachments];
      for (const pendingAttachment of pendingAttachments) {
        await onUpload(pendingAttachment.file, pendingAttachment.displayName.trim() || pendingAttachment.file.name);
        remainingAttachments = remainingAttachments.filter((entry) => entry.id !== pendingAttachment.id);
        onPendingAttachmentsChange(remainingAttachments);
      }
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : t("attachmentUploadFailed"));
    } finally {
      setBusyKey("");
    }
  }

  async function previewAttachment(attachment: DocumentAttachment) {
    const busyID = `preview-${attachment.id}`;
    if (busyKey) {
      return;
    }
    setBusyKey(busyID);
    setPanelError("");
    try {
      const url = await onGetDownloadUrl(attachment);
      setPreview({
        name: attachment.displayName || attachment.originalFileName,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
        url
      });
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : t("attachmentDownloadFailed"));
    } finally {
      setBusyKey("");
    }
  }

  async function openAttachment(attachment: DocumentAttachment) {
    const busyID = `open-${attachment.id}`;
    if (busyKey) {
      return;
    }
    setBusyKey(busyID);
    setPanelError("");
    try {
      const url = await onGetDownloadUrl(attachment);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : t("attachmentDownloadFailed"));
    } finally {
      setBusyKey("");
    }
  }

  async function deleteAttachment(attachment: DocumentAttachment) {
    if (!onDelete || disabled || busyKey) {
      return;
    }
    const busyID = `delete-${attachment.id}`;
    setBusyKey(busyID);
    setPanelError("");
    try {
      await onDelete(attachment);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : t("attachmentDeleteFailed"));
    } finally {
      setBusyKey("");
    }
  }

  function previewPendingAttachment(attachment: PendingDocumentAttachment) {
    if (busyKey) {
      return;
    }
    setPanelError("");
    const url = URL.createObjectURL(attachment.file);
    setPreview({
      pendingId: attachment.id,
      name: attachment.displayName.trim() || attachment.file.name,
      contentType: attachment.file.type || "application/octet-stream",
      sizeBytes: attachment.file.size,
      url,
      isObjectUrl: true
    });
  }

  function closePreview() {
    setPreview(null);
  }

  return (
    <div className="document-attachments">
      <div className="document-attachments__header">
        <div>
          <strong>{t("attachments")}</strong>
          <span>{attachmentSummaryCount > 0 ? `${attachmentSummaryCount} ${t("files")}` : t("noAttachments")}</span>
        </div>
        {hasPendingControls ? (
          <div className="document-attachments__actions">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="document-attachments__file-input"
              onChange={(event) => handleFilesSelected(event.target.files)}
              disabled={disabled || Boolean(busyKey)}
            />
            <button
              className="button button--ghost button--small"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || Boolean(busyKey)}
            >
              <Paperclip size={16} strokeWidth={2.1} />
              {t("addFiles")}
            </button>
            {hasUploadAction ? (
              <button
                className="button button--primary button--small"
                type="button"
                onClick={() => void uploadPendingAttachments()}
                disabled={!canUpload}
                aria-busy={isUploading}
              >
                {isUploading ? <InlineLoadingIndicator /> : <Upload size={16} strokeWidth={2.1} />}
                {t("uploadFiles")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {panelError ? <div className="document-attachments__error">{panelError}</div> : null}

      {hasPendingControls && pendingAttachments.length > 0 ? (
        <div className="document-attachments__pending">
          {pendingAttachments.map((entry) => (
            <div className="document-attachments__pending-row" key={entry.id}>
              <div className="document-attachments__file-meta">
                <span className="document-attachments__file-name">{entry.file.name}</span>
                <span>{formatFileSize(entry.file.size)}</span>
              </div>
              <label>
                <span>{t("fileDisplayName")}</span>
                <input
                  value={entry.displayName}
                  onChange={(event) => updatePendingDisplayName(entry.id, event.target.value)}
                  disabled={disabled || Boolean(busyKey)}
                />
              </label>
              <div className="document-attachments__row-actions">
                <button
                  className="button button--ghost button--small"
                  type="button"
                  onClick={() => previewPendingAttachment(entry)}
                  disabled={Boolean(busyKey)}
                  aria-label={t("previewFile")}
                >
                  <Eye size={16} strokeWidth={2.1} />
                </button>
                <button
                  className="button button--ghost button--small"
                  type="button"
                  onClick={() => removePendingAttachment(entry.id)}
                  disabled={disabled || Boolean(busyKey)}
                >
                  {t("remove")}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <div className="document-attachments__list">
          {attachments.map((attachment) => (
            <div className="document-attachments__row" key={attachment.id}>
              <div className="document-attachments__file-meta">
                <span className="document-attachments__file-name">{attachment.displayName || attachment.originalFileName}</span>
                <span>{[formatAttachmentType(attachment.contentType), formatFileSize(attachment.sizeBytes)].filter(Boolean).join(" | ")}</span>
              </div>
              <div className="document-attachments__row-actions">
                <button
                  className="button button--ghost button--small"
                  type="button"
                  onClick={() => void previewAttachment(attachment)}
                  disabled={Boolean(busyKey)}
                  aria-label={t("previewFile")}
                >
                  {busyKey === `preview-${attachment.id}` ? <InlineLoadingIndicator /> : <Eye size={16} strokeWidth={2.1} />}
                </button>
                <button
                  className="button button--ghost button--small"
                  type="button"
                  onClick={() => void openAttachment(attachment)}
                  disabled={Boolean(busyKey)}
                  aria-label={t("openFile")}
                >
                  {busyKey === `open-${attachment.id}` ? <InlineLoadingIndicator /> : <ExternalLink size={16} strokeWidth={2.1} />}
                </button>
                {onDelete ? (
                  <button
                    className="button button--danger button--small"
                    type="button"
                    onClick={() => void deleteAttachment(attachment)}
                    disabled={disabled || Boolean(busyKey)}
                    aria-label={t("removeFile")}
                  >
                    {busyKey === `delete-${attachment.id}` ? <InlineLoadingIndicator /> : <Trash2 size={16} strokeWidth={2.1} />}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {preview ? (
        <div className="attachment-preview" role="dialog" aria-modal="true" aria-label={t("attachmentPreview")}>
          <div className="attachment-preview__panel">
            <div className="attachment-preview__header">
              <div>
                <strong>{preview.name}</strong>
                <span>{[formatAttachmentType(preview.contentType), formatFileSize(preview.sizeBytes)].filter(Boolean).join(" | ")}</span>
              </div>
              <div className="attachment-preview__actions">
                <button
                  className="button button--ghost button--small"
                  type="button"
                  onClick={() => window.open(preview.url, "_blank", "noopener,noreferrer")}
                >
                  <ExternalLink size={16} strokeWidth={2.1} />
                  {t("openFile")}
                </button>
                <button
                  className="button button--ghost button--small"
                  type="button"
                  onClick={closePreview}
                  aria-label={t("close")}
                >
                  <X size={16} strokeWidth={2.1} />
                </button>
              </div>
            </div>
            <div className="attachment-preview__body">
              {isPreviewImage(preview.contentType) ? (
                <img src={preview.url} alt={preview.name} />
              ) : (
                <iframe title={preview.name} src={preview.url} />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function defaultAttachmentDisplayName(fileName: string) {
  return fileName.trim() || "attachment";
}

function formatAttachmentType(contentType: string) {
  switch (contentType) {
    case "application/pdf":
      return "PDF";
    case "image/jpeg":
      return "JPG";
    case "image/png":
      return "PNG";
    case "image/webp":
      return "WebP";
    default:
      return contentType;
  }
}

function formatFileSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "0 KB";
  }
  if (sizeBytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPreviewImage(contentType: string) {
  return contentType === "image/jpeg" || contentType === "image/png" || contentType === "image/webp";
}
