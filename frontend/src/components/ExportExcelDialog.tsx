import { useEffect, useState } from "react";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";

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

  return (
    <Dialog open={open} onClose={isExporting ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>{t("exportExcel")}</DialogTitle>
      <DialogContent>
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
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="text" onClick={onClose} disabled={isExporting}>
          {t("cancel")}
        </Button>
        <Button
          variant="text"
          disabled={isExporting}
          onClick={() => setColumns(defaultColumns.map((column) => ({ ...column, enabled: true })))}
        >
          {t("resetDefault")}
        </Button>
        <Button
          variant="contained"
          disabled={enabledColumns.length === 0 || isExporting}
          aria-busy={isExporting}
          onClick={() => void handleExport()}
        >
          {isExporting ? <InlineLoadingIndicator className="mr-1" /> : null}
          {t("downloadExcel")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
