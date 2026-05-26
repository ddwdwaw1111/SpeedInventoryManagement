import AttachFileRoundedIcon from "@mui/icons-material/AttachFileRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import { useRef, useState } from "react";

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
  onPendingAttachmentsChange?: (attachments: PendingDocumentAttachment[]) => void;
  onUpload?: (file: File, displayName: string) => Promise<void>;
  onGetDownloadUrl: (attachment: DocumentAttachment) => Promise<string>;
  onDelete?: (attachment: DocumentAttachment) => Promise<void>;
};

type AttachmentPreviewState = {
  attachment: DocumentAttachment;
  url: string;
};

export function DocumentAttachmentsPanel({
  attachments,
  pendingAttachments = [],
  disabled = false,
  canUploadNow = true,
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
  const hasUploadControls = Boolean(onUpload && onPendingAttachmentsChange);
  const canUpload = hasUploadControls && canUploadNow && !disabled && pendingAttachments.length > 0 && !busyKey;

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
      setPreview({ attachment, url });
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

  return (
    <div className="document-attachments">
      <div className="document-attachments__header">
        <div>
          <strong>{t("attachments")}</strong>
          <span>{attachments.length > 0 ? `${attachments.length} ${t("files")}` : t("noAttachments")}</span>
        </div>
        {hasUploadControls ? (
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
              <AttachFileRoundedIcon fontSize="small" />
              {t("addFiles")}
            </button>
            <button
              className="button button--primary button--small"
              type="button"
              onClick={() => void uploadPendingAttachments()}
              disabled={!canUpload}
              aria-busy={isUploading}
            >
              {isUploading ? <InlineLoadingIndicator /> : <UploadFileRoundedIcon fontSize="small" />}
              {t("uploadFiles")}
            </button>
          </div>
        ) : null}
      </div>

      {panelError ? <div className="document-attachments__error">{panelError}</div> : null}

      {hasUploadControls && pendingAttachments.length > 0 ? (
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
              <button
                className="button button--ghost button--small"
                type="button"
                onClick={() => removePendingAttachment(entry.id)}
                disabled={disabled || Boolean(busyKey)}
              >
                {t("remove")}
              </button>
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
                  {busyKey === `preview-${attachment.id}` ? <InlineLoadingIndicator /> : <VisibilityRoundedIcon fontSize="small" />}
                </button>
                <button
                  className="button button--ghost button--small"
                  type="button"
                  onClick={() => void openAttachment(attachment)}
                  disabled={Boolean(busyKey)}
                  aria-label={t("openFile")}
                >
                  {busyKey === `open-${attachment.id}` ? <InlineLoadingIndicator /> : <OpenInNewRoundedIcon fontSize="small" />}
                </button>
                {onDelete ? (
                  <button
                    className="button button--danger button--small"
                    type="button"
                    onClick={() => void deleteAttachment(attachment)}
                    disabled={disabled || Boolean(busyKey)}
                    aria-label={t("removeFile")}
                  >
                    {busyKey === `delete-${attachment.id}` ? <InlineLoadingIndicator /> : <DeleteOutlineRoundedIcon fontSize="small" />}
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
                <strong>{preview.attachment.displayName || preview.attachment.originalFileName}</strong>
                <span>{[formatAttachmentType(preview.attachment.contentType), formatFileSize(preview.attachment.sizeBytes)].filter(Boolean).join(" | ")}</span>
              </div>
              <div className="attachment-preview__actions">
                <button
                  className="button button--ghost button--small"
                  type="button"
                  onClick={() => window.open(preview.url, "_blank", "noopener,noreferrer")}
                >
                  <OpenInNewRoundedIcon fontSize="small" />
                  {t("openFile")}
                </button>
                <button
                  className="button button--ghost button--small"
                  type="button"
                  onClick={() => setPreview(null)}
                  aria-label={t("close")}
                >
                  <CloseRoundedIcon fontSize="small" />
                </button>
              </div>
            </div>
            <div className="attachment-preview__body">
              {isPreviewImage(preview.attachment.contentType) ? (
                <img src={preview.url} alt={preview.attachment.displayName || preview.attachment.originalFileName} />
              ) : (
                <iframe title={preview.attachment.displayName || preview.attachment.originalFileName} src={preview.url} />
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
