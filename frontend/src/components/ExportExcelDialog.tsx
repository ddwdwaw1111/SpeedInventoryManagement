import { useEffect, useState } from "react";

import { waitForNextPaint } from "../lib/asyncUi";
import type { ExcelExportColumn } from "../lib/excelExport";
import { useI18n } from "../lib/i18n";
import { InlineLoadingIndicator } from "./InlineLoadingIndicator";

type ExportExcelDialogColumn = ExcelExportColumn & {
  enabled: boolean;
};

type ExportExcelDialogProps = {
  open: boolean;
  defaultTitle: string;
  defaultColumns: ExcelExportColumn[];
  onClose: () => void;
  onExport: (payload: { title: string; columns: ExcelExportColumn[] }) => void | Promise<void>;
};

export function ExportExcelDialog({
  open,
  defaultTitle,
  defaultColumns,
  onClose,
  onExport
}: ExportExcelDialogProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState(defaultTitle);
  const [columns, setColumns] = useState<ExportExcelDialogColumn[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(defaultTitle);
      setColumns(defaultColumns.map((column) => ({ ...column, enabled: true })));
      setIsExporting(false);
    }
  }, [defaultColumns, defaultTitle, open]);

  useEffect(() => {
    if (!open || isExporting) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isExporting, onClose, open]);

  const enabledColumns = columns.filter((column) => column.enabled).map(({ key, label, numberFormat }) => (
    numberFormat ? { key, label, numberFormat } : { key, label }
  ));

  async function handleExport() {
    if (isExporting || enabledColumns.length === 0) {
      return;
    }

    setIsExporting(true);
    try {
      await waitForNextPaint();
      await onExport({
        title: title.trim() || defaultTitle,
        columns: enabledColumns
      });
    } finally {
      setIsExporting(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div
      className="export-dialog__backdrop"
      onMouseDown={(event) => {
        if (!isExporting && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title">
        <header className="export-dialog__header">
          <h2 id="export-dialog-title">{t("exportExcel")}</h2>
        </header>
        <div className="export-dialog__body">
        <div className="export-dialog__form">
          <label>
            {t("exportTitle")}
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("exportTitlePlaceholder")}
              autoFocus
              disabled={isExporting}
            />
          </label>

          <div className="export-dialog__section">
            <div className="export-dialog__section-title">{t("exportColumns")}</div>
            <div className="export-dialog__columns">
              {columns.map((column) => (
                <div className="export-dialog__column-row" key={column.key}>
                  <label className="export-dialog__column-toggle">
                    <input
                      type="checkbox"
                      checked={column.enabled}
                      disabled={isExporting}
                      onChange={(event) => setColumns((current) => current.map((candidate) => (
                        candidate.key === column.key
                          ? { ...candidate, enabled: event.target.checked }
                          : candidate
                      )))}
                    />
                    <span>{column.key}</span>
                  </label>
                  <input
                    value={column.label}
                    disabled={isExporting}
                    onChange={(event) => setColumns((current) => current.map((candidate) => (
                      candidate.key === column.key
                        ? { ...candidate, label: event.target.value }
                        : candidate
                    )))}
                    placeholder={t("columnHeader")}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        </div>
        <footer className="export-dialog__actions">
        <button className="button button--ghost" type="button" onClick={onClose} disabled={isExporting}>
          {t("cancel")}
        </button>
        <button
          className="button button--ghost"
          type="button"
          disabled={isExporting}
          onClick={() => setColumns(defaultColumns.map((column) => ({ ...column, enabled: true })))}
        >
          {t("resetDefault")}
        </button>
        <button
          className="button button--primary"
          type="button"
          disabled={enabledColumns.length === 0 || isExporting}
          aria-busy={isExporting}
          onClick={() => void handleExport()}
        >
          {isExporting ? <InlineLoadingIndicator className="mr-1" /> : null}
          {t("downloadExcel")}
        </button>
        </footer>
      </section>
    </div>
  );
}
