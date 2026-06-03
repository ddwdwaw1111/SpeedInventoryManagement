import { Eye, FileText, FolderOpen, Paperclip, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../components/ui/button";
import { InlineLoadingIndicator } from "../components/InlineLoadingIndicator";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import type { DocumentAttachment } from "../lib/types";
import { useI18n } from "../lib/i18n";

export type PendingDocumentAttachment = {
  id: string;
  file: File;
  displayName: string;
};

type PortalAttachmentsPanelProps = {
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

export function PortalAttachmentsPanel({
  attachments,
  pendingAttachments = [],
  disabled = false,
  canUploadNow = true,
  showUploadButton = true,
  onPendingAttachmentsChange,
  onUpload,
  onGetDownloadUrl,
  onDelete
}: PortalAttachmentsPanelProps) {
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
      displayName: file.name.trim() || "attachment"
    }));
    onPendingAttachmentsChange([...pendingAttachments, ...nextAttachments]);
    setPanelError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function updatePendingDisplayName(id: string, displayName: string) {
    onPendingAttachmentsChange?.(
      pendingAttachments.map((entry) => entry.id === id ? { ...entry, displayName } : entry)
    );
  }

  function removePendingAttachment(id: string) {
    if (preview?.pendingId === id) {
      closePreview();
    }
    onPendingAttachmentsChange?.(pendingAttachments.filter((entry) => entry.id !== id));
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
    const busyId = `preview-${attachment.id}`;
    if (busyKey) {
      return;
    }
    setBusyKey(busyId);
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
    const busyId = `open-${attachment.id}`;
    if (busyKey) {
      return;
    }
    setBusyKey(busyId);
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
    const busyId = `delete-${attachment.id}`;
    setBusyKey(busyId);
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
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <strong className="block text-sm font-semibold text-slate-950">{t("attachments")}</strong>
          <span className="text-sm text-slate-500">
            {attachmentSummaryCount > 0 ? `${attachmentSummaryCount} ${t("files")}` : t("noAttachments")}
          </span>
        </div>
        {hasPendingControls ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(event) => handleFilesSelected(event.target.files)}
              disabled={disabled || Boolean(busyKey)}
            />
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || Boolean(busyKey)}
            >
              <Paperclip className="h-4 w-4" />
              {t("addFiles")}
            </Button>
            {hasUploadAction ? (
              <Button
                size="sm"
                type="button"
                onClick={() => void uploadPendingAttachments()}
                disabled={!canUpload}
                aria-busy={isUploading}
              >
                {isUploading ? <InlineLoadingIndicator /> : <Upload className="h-4 w-4" />}
                {t("uploadFiles")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {panelError ? (
        <div className="m-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{panelError}</div>
      ) : null}

      {hasPendingControls && pendingAttachments.length > 0 ? (
        <div className="grid gap-3 border-b border-slate-100 p-4">
          {pendingAttachments.map((entry) => (
            <div className="grid gap-3 rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.7fr)_auto]" key={entry.id}>
              <AttachmentMeta name={entry.file.name} meta={formatFileSize(entry.file.size)} />
              <label className="grid gap-1.5 text-xs font-medium text-slate-600">
                {t("fileDisplayName")}
                <Input
                  value={entry.displayName}
                  onChange={(event) => updatePendingDisplayName(entry.id, event.target.value)}
                  disabled={disabled || Boolean(busyKey)}
                  aria-label={t("fileDisplayName")}
                />
              </label>
              <div className="flex items-end gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  onClick={() => previewPendingAttachment(entry)}
                  disabled={Boolean(busyKey)}
                  aria-label={t("previewFile")}
                >
                  <Eye className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => removePendingAttachment(entry.id)}
                  disabled={disabled || Boolean(busyKey)}
                >
                  {t("remove")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <div className="divide-y divide-slate-100">
          {attachments.map((attachment) => (
            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" key={attachment.id}>
              <AttachmentMeta
                name={attachment.displayName || attachment.originalFileName}
                meta={[formatAttachmentType(attachment.contentType), formatFileSize(attachment.sizeBytes)].filter(Boolean).join(" | ")}
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  onClick={() => void previewAttachment(attachment)}
                  disabled={Boolean(busyKey)}
                  aria-label={t("previewFile")}
                >
                  {busyKey === `preview-${attachment.id}` ? <InlineLoadingIndicator /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  onClick={() => void openAttachment(attachment)}
                  disabled={Boolean(busyKey)}
                  aria-label={t("openFile")}
                >
                  {busyKey === `open-${attachment.id}` ? <InlineLoadingIndicator /> : <FolderOpen className="h-4 w-4" />}
                </Button>
                {onDelete ? (
                  <Button
                    variant="destructive"
                    size="icon"
                    type="button"
                    onClick={() => void deleteAttachment(attachment)}
                    disabled={disabled || Boolean(busyKey)}
                    aria-label={t("removeFile")}
                  >
                    {busyKey === `delete-${attachment.id}` ? <InlineLoadingIndicator /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {attachments.length === 0 && pendingAttachments.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-500">{t("noAttachments")}</div>
      ) : null}

      {preview ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label={t("attachmentPreview")}>
          <div className="grid max-h-[calc(100vh-2rem)] min-w-0 w-full max-w-5xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-4">
              <div>
                <strong className="block text-sm font-semibold text-slate-950">{preview.name}</strong>
                <span className="text-sm text-slate-500">{[formatAttachmentType(preview.contentType), formatFileSize(preview.sizeBytes)].filter(Boolean).join(" | ")}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" type="button" onClick={() => window.open(preview.url, "_blank", "noopener,noreferrer")}>
                  <FolderOpen className="h-4 w-4" />
                  {t("openFile")}
                </Button>
                <Button variant="ghost" size="icon" type="button" onClick={closePreview} aria-label={t("close")}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="min-h-0 bg-slate-100 p-4">
              {isPreviewImage(preview.contentType) ? (
                <img className="mx-auto max-h-[72vh] rounded-md bg-white object-contain" src={preview.url} alt={preview.name} />
              ) : (
                <iframe className="h-[72vh] w-full rounded-md border border-slate-200 bg-white" title={preview.name} src={preview.url} />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AttachmentMeta({ name, meta, className }: { name: string; meta: string; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-start gap-3", className)}>
      <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
        <FileText className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <span className="block truncate text-sm font-semibold text-slate-900">{name}</span>
        <span className="block text-xs text-slate-500">{meta}</span>
      </div>
    </div>
  );
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
