import { useEffect, useState } from "react";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";

import type { ExcelExportColumn } from "../lib/excelExport";
import { useI18n } from "../lib/i18n";

type ExportExcelDialogColumn = ExcelExportColumn & {
  enabled: boolean;
};

type ExportExcelDialogProps = {
  open: boolean;
  defaultTitle: string;
  defaultColumns: ExcelExportColumn[];
  onClose: () => void;
  onExport: (payload: { title: string; columns: ExcelExportColumn[] }) => void;
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

  useEffect(() => {
    if (open) {
      setTitle(defaultTitle);
      setColumns(defaultColumns.map((column) => ({ ...column, enabled: true })));
    }
  }, [defaultColumns, defaultTitle, open]);

  const enabledColumns = columns.filter((column) => column.enabled).map(({ key, label }) => ({ key, label }));

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
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
        <Button variant="text" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button
          variant="text"
          onClick={() => setColumns(defaultColumns.map((column) => ({ ...column, enabled: true })))}
        >
          {t("resetDefault")}
        </Button>
        <Button
          variant="contained"
          disabled={enabledColumns.length === 0}
          onClick={() => onExport({
            title: title.trim() || defaultTitle,
            columns: enabledColumns
          })}
        >
          {t("downloadExcel")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
