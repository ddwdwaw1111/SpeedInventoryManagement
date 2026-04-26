import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";
import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import PaidOutlinedIcon from "@mui/icons-material/PaidOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import BlockOutlinedIcon from "@mui/icons-material/BlockOutlined";
import { useState, useEffect, useCallback, type FormEvent } from "react";
import { Button, Chip, Dialog, DialogTitle, DialogContent, DialogActions, Divider, ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material";

import { ApiError, api } from "../lib/api";
import { waitForNextPaint } from "../lib/asyncUi";
import { downloadExcelWorkbook, type ExcelExportCell, type ExcelExportColumn } from "../lib/excelExport";
import { downloadBillingInvoicePdf } from "../lib/billingInvoicePdf";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import { formatDateTimeValue } from "../lib/dates";
import type {
  BillingExportMode,
  BillingInvoice,
  BillingInvoiceLineData,
  AddBillingInvoiceLinePayload,
  ContainerType,
  UpdateBillingInvoiceLinePayload,
  UserRole
} from "../lib/types";
import { ExportExcelDialog } from "./ExportExcelDialog";
import { InlineLoadingIndicator } from "./InlineLoadingIndicator";
import { WorkspacePanelHeader, WorkspaceTableEmptyState } from "./WorkspacePanelChrome";

type BillingInvoiceEditorPageProps = {
  invoiceId: number;
  currentUserRole: UserRole;
  onBackToBilling: () => void;
};

type LineFormState = {
  chargeType: string;
  description: string;
  reference: string;
  containerNo: string;
  warehouse: string;
  occurredOn: string;
  quantity: string;
  unitRate: string;
  amount: string;
  notes: string;
};

const emptyLineForm: LineFormState = {
  chargeType: "MANUAL",
  description: "",
  reference: "",
  containerNo: "",
  warehouse: "",
  occurredOn: "",
  quantity: "1",
  unitRate: "0",
  amount: "0",
  notes: ""
};

const CHARGE_TYPE_OPTIONS = ["INBOUND", "WRAPPING", "STORAGE", "OUTBOUND", "DISCOUNT", "MANUAL"];

export function BillingInvoiceEditorPage({ invoiceId, currentUserRole, onBackToBilling }: BillingInvoiceEditorPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const [invoice, setInvoice] = useState<BillingInvoice | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null);

  // Line editor state
  const [lineDialogOpen, setLineDialogOpen] = useState(false);
  const [lineDialogMode, setLineDialogMode] = useState<"add" | "edit">("add");
  const [editingLineId, setEditingLineId] = useState<number | null>(null);
  const [lineForm, setLineForm] = useState<LineFormState>(emptyLineForm);

  // Confirm dialogs
  const [confirmAction, setConfirmAction] = useState<"finalize" | "mark-paid" | "void" | "delete" | "delete-line" | null>(null);
  const [deletingLineId, setDeletingLineId] = useState<number | null>(null);

  // Notes editing
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportMenuAnchor, setExportMenuAnchor] = useState<HTMLElement | null>(null);
  const [pendingExportMode, setPendingExportMode] = useState<BillingExportMode>("SUMMARY");

  const isDraft = invoice?.status === "DRAFT";
  const isAdmin = currentUserRole === "admin";
  const isBusy = busyActionKey !== null;
  const isPdfExportBusy = busyActionKey?.startsWith("export-pdf-") ?? false;
  const isSaveLineBusy = busyActionKey === "save-line";
  const isSaveNotesBusy = busyActionKey === "save-notes";
  const isFinalizeBusy = busyActionKey === "finalize";
  const isMarkPaidBusy = busyActionKey === "mark-paid";
  const isVoidBusy = busyActionKey === "void";
  const isDeleteInvoiceBusy = busyActionKey === "delete";
  const isDeleteLineBusy = busyActionKey === "delete-line";

  const loadInvoice = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const data = await api.getBillingInvoice(invoiceId);
      setInvoice(data);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Could not load invoice."));
    } finally {
      setIsLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    void loadInvoice();
  }, [loadInvoice]);

  async function runBusyAction<T>(actionKey: string, action: () => Promise<T> | T) {
    if (busyActionKey) {
      return null;
    }

    setBusyActionKey(actionKey);
    try {
      await waitForNextPaint();
      return await action();
    } finally {
      setBusyActionKey((current) => current === actionKey ? null : current);
    }
  }

  // --- Line add/edit ---
  function handleOpenAddLine(chargeType?: string) {
    setLineForm({
      ...emptyLineForm,
      chargeType: chargeType ?? "MANUAL"
    });
    setLineDialogMode("add");
    setEditingLineId(null);
    setLineDialogOpen(true);
  }

  function handleOpenEditLine(line: BillingInvoiceLineData) {
    setLineForm({
      chargeType: line.chargeType,
      description: line.description,
      reference: line.reference,
      containerNo: line.containerNo,
      warehouse: line.warehouse,
      occurredOn: line.occurredOn,
      quantity: String(line.quantity),
      unitRate: String(line.unitRate),
      amount: String(line.amount),
      notes: line.notes
    });
    setLineDialogMode("edit");
    setEditingLineId(line.id);
    setLineDialogOpen(true);
  }

  async function handleSaveLine(event: FormEvent) {
    event.preventDefault();
    if (!invoice) return;
    await runBusyAction("save-line", async () => {
      try {
        const payload: AddBillingInvoiceLinePayload & UpdateBillingInvoiceLinePayload = {
          chargeType: lineForm.chargeType,
          description: lineForm.description,
          reference: lineForm.reference,
          containerNo: lineForm.containerNo,
          warehouse: lineForm.warehouse,
          occurredOn: lineForm.occurredOn,
          quantity: toNumber(lineForm.quantity),
          unitRate: toNumber(lineForm.unitRate),
          amount: toNumber(lineForm.amount),
          notes: lineForm.notes
        };

        let updated: BillingInvoice;
        if (lineDialogMode === "edit" && editingLineId !== null) {
          updated = await api.updateBillingInvoiceLine(invoice.id, editingLineId, payload);
        } else {
          updated = await api.addBillingInvoiceLine(invoice.id, payload);
        }
        setInvoice(updated);
        setLineDialogOpen(false);
      } catch (error) {
        setErrorMessage(getErrorMessage(error, "Could not save line."));
      }
    });
  }

  async function handleDeleteLine() {
    if (!invoice || deletingLineId === null) return;
    await runBusyAction("delete-line", async () => {
      try {
        const updated = await api.deleteBillingInvoiceLine(invoice.id, deletingLineId);
        setInvoice(updated);
      } catch (error) {
        setErrorMessage(getErrorMessage(error, "Could not delete line."));
      } finally {
        setConfirmAction(null);
        setDeletingLineId(null);
      }
    });
  }

  // --- Status actions ---
  async function handleFinalize() {
    if (!invoice) return;
    await runBusyAction("finalize", async () => {
      try {
        const updated = await api.finalizeBillingInvoice(invoice.id);
        setInvoice(updated);
      } catch (error) {
        setErrorMessage(getErrorMessage(error, "Could not finalize invoice."));
      } finally {
        setConfirmAction(null);
      }
    });
  }

  async function handleMarkPaid() {
    if (!invoice) return;
    await runBusyAction("mark-paid", async () => {
      try {
        const updated = await api.markBillingInvoicePaid(invoice.id);
        setInvoice(updated);
      } catch (error) {
        setErrorMessage(getErrorMessage(error, "Could not mark invoice paid."));
      } finally {
        setConfirmAction(null);
      }
    });
  }

  async function handleVoid() {
    if (!invoice) return;
    await runBusyAction("void", async () => {
      try {
        const updated = await api.voidBillingInvoice(invoice.id);
        setInvoice(updated);
      } catch (error) {
        setErrorMessage(getErrorMessage(error, "Could not void invoice."));
      } finally {
        setConfirmAction(null);
      }
    });
  }

  async function handleDelete() {
    if (!invoice) return;
    await runBusyAction("delete", async () => {
      try {
        await api.deleteBillingInvoice(invoice.id);
        onBackToBilling();
      } catch (error) {
        setErrorMessage(getErrorMessage(error, "Could not delete invoice."));
      } finally {
        setConfirmAction(null);
      }
    });
  }

  async function handleSaveNotes() {
    if (!invoice) return;
    await runBusyAction("save-notes", async () => {
      try {
        const updated = await api.updateBillingInvoice(invoice.id, { notes: notesValue });
        setInvoice(updated);
        setIsEditingNotes(false);
      } catch (error) {
        setErrorMessage(getErrorMessage(error, "Could not save notes."));
      }
    });
  }

  // --- Render ---
  if (isLoading) {
    return (
      <main className="workspace-main">
        <section className="workbook-panel workbook-panel--full">
          <div className="empty-state">{t("loadingRecords")}</div>
        </section>
      </main>
    );
  }

  if (!invoice) {
    return (
      <main className="workspace-main">
        <section className="workbook-panel workbook-panel--full">
          <div className="tab-strip">
            <WorkspacePanelHeader
              title={t("billingInvoiceEditor")}
              description={t("billingInvoiceEditorDesc")}
              errorMessage={errorMessage}
              actions={
                <div className="sheet-actions">
                  <Button size="small" variant="outlined" startIcon={<ArrowBackOutlinedIcon fontSize="small" />} onClick={onBackToBilling}>
                    {t("billingBackToPreview")}
                  </Button>
                </div>
              }
            />
          </div>
          <WorkspaceTableEmptyState title={t("billingNoInvoiceFoundTitle")} description={t("billingNoInvoiceFoundDesc")} />
        </section>
      </main>
    );
  }

  const statusChip = (
    <Chip
      size="small"
      label={billingStatusLabel(invoice.status, t)}
      color={billingStatusColor(invoice.status)}
      variant="outlined"
    />
  );

  const exportColumns = buildBillingInvoiceExportColumns(invoice, pendingExportMode, t);

  function handleExportExcel({ title, columns }: { title: string; columns: ExcelExportColumn[] }) {
    if (!invoice) {
      return;
    }

    const rows = buildBillingInvoiceExportRows(invoice, pendingExportMode, resolvedTimeZone, t);

    downloadExcelWorkbook({
      title,
      sheetName: "Billing Invoice",
      fileName: title,
      columns,
      rows,
      summaryRows: [
        ...(invoice.subtotal !== invoice.grandTotal
          ? [{ label: t("billingInvoiceSubtotal"), value: invoice.subtotal, numberFormat: "currency" as const }]
          : []),
        ...(invoice.discountTotal !== 0
          ? [{ label: t("billingDiscount"), value: invoice.discountTotal, numberFormat: "currency" as const }]
          : []),
        { label: t("billingGrandTotal"), value: invoice.grandTotal, numberFormat: "currency", bold: true }
      ]
    });
    setIsExportDialogOpen(false);
  }

  function handleDownloadPdf(exportMode: BillingExportMode = pendingExportMode) {
    if (!invoice) {
      return;
    }

    downloadBillingInvoicePdf({
      invoice,
      timeZone: resolvedTimeZone,
      exportMode
    });
  }

  async function handleDownloadPdfWithFeedback(exportMode: BillingExportMode) {
    setExportMenuAnchor(null);
    setPendingExportMode(exportMode);
    await runBusyAction(`export-pdf-${exportMode.toLowerCase()}`, () => {
      handleDownloadPdf(exportMode);
    });
  }

  const headerActions = (
    <div className="sheet-actions">
      <Button size="small" variant="outlined" startIcon={<ArrowBackOutlinedIcon fontSize="small" />} onClick={onBackToBilling}>
        {t("billingBackToPreview")}
      </Button>
      <Divider orientation="vertical" flexItem />
      <Button
        size="small"
        variant="outlined"
        startIcon={isPdfExportBusy ? <InlineLoadingIndicator /> : <FileDownloadOutlinedIcon fontSize="small" />}
        endIcon={<ExpandMoreOutlinedIcon fontSize="small" />}
        onClick={(event) => setExportMenuAnchor(event.currentTarget)}
        disabled={invoice.lines.length === 0 || isBusy}
        aria-busy={isPdfExportBusy}
      >
        {t("export")}
      </Button>
      <Menu
        anchorEl={exportMenuAnchor}
        open={Boolean(exportMenuAnchor)}
        onClose={() => setExportMenuAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem
          disabled={isBusy}
          onClick={() => {
            setExportMenuAnchor(null);
            setPendingExportMode("SUMMARY");
            setIsExportDialogOpen(true);
          }}
        >
          <ListItemIcon><FileDownloadOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t("billingExportExcelSummary")} secondary={t("billingExportSummaryDesc")} />
        </MenuItem>
        <MenuItem
          disabled={isBusy}
          onClick={() => {
            setExportMenuAnchor(null);
            setPendingExportMode("DETAILED");
            setIsExportDialogOpen(true);
          }}
        >
          <ListItemIcon><FileDownloadOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t("billingExportExcelDetailed")} secondary={t("billingExportDetailedDesc")} />
        </MenuItem>
        <MenuItem
          disabled={isBusy}
          onClick={() => void handleDownloadPdfWithFeedback("SUMMARY")}
        >
          <ListItemIcon><PictureAsPdfOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t("billingDownloadPdfSummary")} secondary={t("billingExportSummaryDesc")} />
        </MenuItem>
        <MenuItem
          disabled={isBusy}
          onClick={() => void handleDownloadPdfWithFeedback("DETAILED")}
        >
          <ListItemIcon><PictureAsPdfOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t("billingDownloadPdfDetailed")} secondary={t("billingExportDetailedDesc")} />
        </MenuItem>
      </Menu>
      {isDraft && (
        <>
          <Divider orientation="vertical" flexItem />
          <Button size="small" variant="outlined" startIcon={<AddCircleOutlineOutlinedIcon fontSize="small" />} onClick={() => handleOpenAddLine("MANUAL")} disabled={isBusy}>
            {t("billingAddLine")}
          </Button>
          <Button size="small" variant="outlined" color="secondary" startIcon={<AddCircleOutlineOutlinedIcon fontSize="small" />} onClick={() => handleOpenAddLine("DISCOUNT")} disabled={isBusy}>
            {t("billingAddDiscount")}
          </Button>
        </>
      )}
    </div>
  );

  const statusActions = (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
      {isDraft && isAdmin && (
        <Button size="small" variant="contained" color="primary" startIcon={isFinalizeBusy ? <InlineLoadingIndicator /> : <CheckCircleOutlineOutlinedIcon fontSize="small" />} onClick={() => setConfirmAction("finalize")} disabled={isBusy} aria-busy={isFinalizeBusy}>
          {t("billingFinalizeInvoice")}
        </Button>
      )}
      {invoice.status === "FINALIZED" && isAdmin && (
        <Button size="small" variant="contained" color="success" startIcon={isMarkPaidBusy ? <InlineLoadingIndicator /> : <PaidOutlinedIcon fontSize="small" />} onClick={() => setConfirmAction("mark-paid")} disabled={isBusy} aria-busy={isMarkPaidBusy}>
          {t("billingMarkPaid")}
        </Button>
      )}
      {invoice.status !== "VOID" && isAdmin && (
        <Button size="small" variant="outlined" color="error" startIcon={isVoidBusy ? <InlineLoadingIndicator /> : <BlockOutlinedIcon fontSize="small" />} onClick={() => setConfirmAction("void")} disabled={isBusy} aria-busy={isVoidBusy}>
          {t("billingVoidInvoice")}
        </Button>
      )}
      {isDraft && isAdmin && (
        <Button size="small" variant="outlined" color="error" startIcon={isDeleteInvoiceBusy ? <InlineLoadingIndicator /> : <DeleteOutlineOutlinedIcon fontSize="small" />} onClick={() => setConfirmAction("delete")} disabled={isBusy} aria-busy={isDeleteInvoiceBusy}>
          {t("billingDeleteInvoice")}
        </Button>
      )}
    </div>
  );

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <WorkspacePanelHeader
            title={`${t("billingInvoiceEditor")} — ${invoice.invoiceNo}`}
            description={t("billingInvoiceEditorDesc")}
            errorMessage={errorMessage}
            actions={headerActions}
          />
        </div>

        {/* Status banner with lifecycle actions */}
        <div className="billing-status-banner" style={{
          margin: "0 1rem 1rem",
          padding: "0.75rem 1.25rem",
          borderRadius: "var(--radius-md)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
          background: invoice.status === "DRAFT" ? "rgba(0,0,0,0.03)"
            : invoice.status === "FINALIZED" ? "rgba(25,118,210,0.06)"
            : invoice.status === "PAID" ? "rgba(46,125,50,0.06)"
            : "rgba(211,47,47,0.06)",
          border: `1px solid ${
            invoice.status === "DRAFT" ? "var(--gray-4)"
            : invoice.status === "FINALIZED" ? "rgba(25,118,210,0.2)"
            : invoice.status === "PAID" ? "rgba(46,125,50,0.2)"
            : "rgba(211,47,47,0.2)"
          }`
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            {statusChip}
            <span style={{ fontSize: "0.875rem", color: "var(--ink-soft)" }}>
              {invoice.status === "DRAFT" && t("billingInvoiceEditorDesc")}
              {invoice.status === "FINALIZED" && (invoice.finalizedAt ? `${t("billingInvoiceFinalizedAt")}: ${formatDateTimeValue(invoice.finalizedAt, resolvedTimeZone)}` : t("billingInvoiceStatusFinalized"))}
              {invoice.status === "PAID" && (invoice.paidAt ? `${t("billingInvoicePaidAt")}: ${formatDateTimeValue(invoice.paidAt, resolvedTimeZone)}` : t("billingInvoiceStatusPaid"))}
              {invoice.status === "VOID" && t("billingInvoiceStatusVoid")}
            </span>
          </div>
          {statusActions}
        </div>

        {/* Invoice metadata */}
        <div className="metric-ribbon" style={{ padding: "0 1rem 1rem" }}>
          <article className="metric-card">
            <span>{t("customer")}</span>
            <strong>{invoice.customerNameSnapshot}</strong>
          </article>
          <article className="metric-card">
            <span>{t("billingInvoiceType")}</span>
            <strong>{invoiceTypeLabel(invoice.invoiceType, t)}</strong>
          </article>
          <article className="metric-card">
            <span>{t("billingWarehouseScope")}</span>
            <strong>{invoice.warehouseNameSnapshot || t("billingAllWarehouses")}</strong>
          </article>
          <article className="metric-card">
            <span>{t("billingContainerType")}</span>
            <strong>{invoice.containerType ? containerTypeLabel(invoice.containerType as ContainerType, t) : "-"}</strong>
          </article>
          <article className="metric-card">
            <span>{t("billingPeriod")}</span>
            <strong>{invoice.periodStart} — {invoice.periodEnd}</strong>
          </article>
          <article className="metric-card">
            <span>{t("billingInvoiceSubtotal")}</span>
            <strong>{formatMoney(invoice.subtotal)}</strong>
          </article>
          <article className="metric-card">
            <span>{t("billingDiscount")}</span>
            <strong style={{ color: invoice.discountTotal < 0 ? "#d32f2f" : undefined }}>{formatMoney(invoice.discountTotal)}</strong>
          </article>
          <article className="metric-card">
            <span>{t("billingGrandTotal")}</span>
            <strong style={{ fontSize: "1.125rem" }}>{formatMoney(invoice.grandTotal)}</strong>
          </article>
        </div>

        {/* Invoice notes */}
        <div style={{ padding: "0 1rem 1rem" }}>
          {isEditingNotes ? (
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
              <textarea
                className="input"
                rows={2}
                style={{ flex: 1 }}
                value={notesValue}
                onChange={(event) => setNotesValue(event.target.value)}
              />
              <Button size="small" variant="contained" disabled={isBusy} onClick={handleSaveNotes} aria-busy={isSaveNotesBusy}>
                {isSaveNotesBusy ? <InlineLoadingIndicator className="mr-1" /> : null}
                {t("save")}
              </Button>
              <Button size="small" variant="outlined" onClick={() => setIsEditingNotes(false)} disabled={isBusy}>{t("cancel")}</Button>
            </div>
          ) : (
            <div className="sheet-note sheet-note--readonly" style={{ cursor: isDraft ? "pointer" : undefined }} onClick={isDraft ? () => { setNotesValue(invoice.notes); setIsEditingNotes(true); } : undefined}>
              <strong>{t("billingInvoiceNotes")}:</strong> {invoice.notes || "-"}
              {isDraft && <EditOutlinedIcon fontSize="inherit" style={{ marginLeft: "0.25rem", opacity: 0.5 }} />}
            </div>
          )}
        </div>

        {/* Rate snapshot */}
        <div className="report-grid" style={{ padding: "0 1rem 1rem" }}>
          <article className="report-card">
            <div className="report-card__header">
              <h3>{t("billingRatesSnapshot")}</h3>
            </div>
            <div className="report-bars report-bars--summary">
              <div className="report-bars__row">
                <div className="report-bars__labels"><strong>{t("billingInboundContainerFee")}</strong></div>
                <div className="report-bars__value">{formatMoney(invoice.rates.inboundContainerFee)}</div>
              </div>
              <div className="report-bars__row">
                <div className="report-bars__labels"><strong>{t("billingTransferInboundFee")}</strong></div>
                <div className="report-bars__value">{formatMoney(invoice.rates.transferInboundFeePerPallet)}</div>
              </div>
              <div className="report-bars__row">
                <div className="report-bars__labels"><strong>{t("billingWrappingFee")}</strong></div>
                <div className="report-bars__value">{formatMoney(invoice.rates.wrappingFeePerPallet)}</div>
              </div>
              <div className="report-bars__row">
                <div className="report-bars__labels"><strong>{t("billingStorageRateNormal")}</strong></div>
                <div className="report-bars__value">{formatMoney(invoice.rates.storageFeePerPalletPerWeekNormal)}</div>
              </div>
              <div className="report-bars__row">
                <div className="report-bars__labels"><strong>{t("billingStorageRateWestCoast")}</strong></div>
                <div className="report-bars__value">{formatMoney(invoice.rates.storageFeePerPalletPerWeekWestCoastTransfer)}</div>
              </div>
              <div className="report-bars__row">
                <div className="report-bars__labels"><strong>{t("billingOutboundFee")}</strong></div>
                <div className="report-bars__value">{formatMoney(invoice.rates.outboundFeePerPallet)}</div>
              </div>
            </div>
          </article>
        </div>

        {/* Invoice lines table */}
        <section className="workbook-panel" style={{ margin: "0 1rem 1rem" }}>
          <WorkspacePanelHeader
            title={t("billingInvoicePreview")}
            description={`${invoice.lineCount || invoice.lines.length} ${t("billingLineCount").toLowerCase()}`}
          />
          {invoice.lines.length === 0 ? (
            <WorkspaceTableEmptyState title={t("noBillingData")} description={t("billingInvoicePreviewDesc")} />
          ) : (
            <div className="sheet-table-wrap">
              <table className="sheet-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t("billingChargeType")}</th>
                    <th>{t("description")}</th>
                    <th>{t("reference")}</th>
                    <th>{t("containerNo")}</th>
                    <th>{t("currentStorage")}</th>
                    <th>{t("billingOccurredAt")}</th>
                    <th>{t("quantity")}</th>
                    <th>{t("unitRate")}</th>
                    <th>{t("amount")}</th>
                    <th>{t("billingSourceType")}</th>
                    <th>{t("notes")}</th>
                    {isDraft && <th>{t("actions")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines.map((line, index) => (
                    <tr key={line.id} style={line.chargeType === "DISCOUNT" ? { backgroundColor: "rgba(211,47,47,0.04)" } : undefined}>
                      <td>{index + 1}</td>
                      <td>
                        <Chip
                          size="small"
                          label={chargeTypeLabel(line.chargeType, t)}
                          color={line.chargeType === "DISCOUNT" ? "error" : "default"}
                          variant="outlined"
                        />
                      </td>
                      <td>{line.description || "-"}</td>
                      <td className="cell--mono">{line.reference || "-"}</td>
                      <td className="cell--mono">{line.containerNo || "-"}</td>
                      <td>{line.warehouse || "-"}</td>
                      <td>{line.occurredOn || "-"}</td>
                      <td className="cell--mono">{formatNumber(line.quantity)}</td>
                      <td className="cell--mono">{formatMoney(line.unitRate)}</td>
                      <td className="cell--mono" style={line.chargeType === "DISCOUNT" ? { color: "#d32f2f" } : undefined}>
                        {formatMoney(line.amount)}
                      </td>
                      <td>
                        <Chip
                          size="small"
                          label={line.sourceType === "AUTO" ? t("billingSourceTypeAuto") : t("billingSourceTypeManual")}
                          variant="outlined"
                          color={line.sourceType === "AUTO" ? "info" : "warning"}
                        />
                      </td>
                      <td>{line.notes || "-"}</td>
                      {isDraft && (
                        <td>
                          <Button size="small" variant="text" onClick={() => handleOpenEditLine(line)} startIcon={<EditOutlinedIcon fontSize="small" />} disabled={isBusy}>
                            {t("edit")}
                          </Button>
                          <Button size="small" variant="text" color="error" onClick={() => { setDeletingLineId(line.id); setConfirmAction("delete-line"); }} startIcon={<DeleteOutlineOutlinedIcon fontSize="small" />} disabled={isBusy}>
                            {t("delete")}
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 600 }}>
                    <td colSpan={9} style={{ textAlign: "right" }}>{t("billingInvoiceSubtotal")}</td>
                    <td className="cell--mono">{formatMoney(invoice.subtotal)}</td>
                    <td colSpan={isDraft ? 3 : 2} />
                  </tr>
                  {invoice.discountTotal !== 0 && (
                    <tr style={{ fontWeight: 600, color: "#d32f2f" }}>
                      <td colSpan={9} style={{ textAlign: "right" }}>{t("billingDiscount")}</td>
                      <td className="cell--mono">{formatMoney(invoice.discountTotal)}</td>
                      <td colSpan={isDraft ? 3 : 2} />
                    </tr>
                  )}
                  <tr style={{ fontWeight: 700 }}>
                    <td colSpan={9} style={{ textAlign: "right" }}>{t("billingGrandTotal")}</td>
                    <td className="cell--mono">{formatMoney(invoice.grandTotal)}</td>
                    <td colSpan={isDraft ? 3 : 2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      </section>

      {/* Line add/edit dialog */}
      <Dialog open={lineDialogOpen} onClose={isBusy ? undefined : () => setLineDialogOpen(false)} fullWidth maxWidth="sm">
        <form onSubmit={handleSaveLine}>
          <DialogTitle>{lineDialogMode === "add" ? t("billingAddLine") : t("billingEditLine")}</DialogTitle>
          <DialogContent>
            <div className="sheet-form" style={{ display: "flex", flexDirection: "column", gap: "0.75rem", paddingTop: "0.5rem" }}>
              <label>
                {t("billingChargeType")}
                <select value={lineForm.chargeType} onChange={(event) => setLineForm((f) => ({ ...f, chargeType: event.target.value }))}>
                  {CHARGE_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>{chargeTypeLabel(option, t)}</option>
                  ))}
                </select>
              </label>
              <label>
                {t("description")}
                <input type="text" value={lineForm.description} onChange={(event) => setLineForm((f) => ({ ...f, description: event.target.value }))} />
              </label>
              <label>
                {t("reference")}
                <input type="text" value={lineForm.reference} onChange={(event) => setLineForm((f) => ({ ...f, reference: event.target.value }))} />
              </label>
              <label>
                {t("containerNo")}
                <input type="text" value={lineForm.containerNo} onChange={(event) => setLineForm((f) => ({ ...f, containerNo: event.target.value }))} />
              </label>
              <label>
                {t("currentStorage")}
                <input type="text" value={lineForm.warehouse} onChange={(event) => setLineForm((f) => ({ ...f, warehouse: event.target.value }))} />
              </label>
              <label>
                {t("billingOccurredAt")}
                <input type="date" value={lineForm.occurredOn} onChange={(event) => setLineForm((f) => ({ ...f, occurredOn: event.target.value }))} />
              </label>
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <label style={{ flex: 1 }}>
                  {t("quantity")}
                  <input type="number" step="any" value={lineForm.quantity} onChange={(event) => {
                    const quantity = event.target.value;
                    setLineForm((f) => ({ ...f, quantity, amount: String(roundCurrency(toNumber(quantity) * toNumber(f.unitRate))) }));
                  }} />
                </label>
                <label style={{ flex: 1 }}>
                  {t("unitRate")}
                  <input type="number" step="any" value={lineForm.unitRate} onChange={(event) => {
                    const unitRate = event.target.value;
                    setLineForm((f) => ({ ...f, unitRate, amount: String(roundCurrency(toNumber(f.quantity) * toNumber(unitRate))) }));
                  }} />
                </label>
                <label style={{ flex: 1 }}>
                  {t("amount")}
                  <input type="number" step="any" value={lineForm.amount} onChange={(event) => setLineForm((f) => ({ ...f, amount: event.target.value }))} />
                </label>
              </div>
              <label>
                {t("notes")}
                <input type="text" value={lineForm.notes} onChange={(event) => setLineForm((f) => ({ ...f, notes: event.target.value }))} />
              </label>
            </div>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setLineDialogOpen(false)} disabled={isBusy}>{t("cancel")}</Button>
            <Button type="submit" variant="contained" disabled={isBusy} aria-busy={isSaveLineBusy}>
              {isSaveLineBusy ? <InlineLoadingIndicator className="mr-1" /> : null}
              {t("save")}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Confirm dialog */}
      <Dialog open={confirmAction !== null} onClose={isBusy ? undefined : () => { setConfirmAction(null); setDeletingLineId(null); }}>
        <DialogTitle>{confirmDialogTitle(confirmAction, t)}</DialogTitle>
        <DialogContent>{confirmDialogMessage(confirmAction, t)}</DialogContent>
        <DialogActions>
          <Button onClick={() => { setConfirmAction(null); setDeletingLineId(null); }} disabled={isBusy}>{t("cancel")}</Button>
          <Button
            variant="contained"
            color={confirmAction === "mark-paid" ? "success" : confirmAction === "finalize" ? "primary" : "error"}
            disabled={isBusy}
            aria-busy={isBusy}
            onClick={() => {
              switch (confirmAction) {
                case "finalize": void handleFinalize(); break;
                case "mark-paid": void handleMarkPaid(); break;
                case "void": void handleVoid(); break;
                case "delete": void handleDelete(); break;
                case "delete-line": void handleDeleteLine(); break;
              }
            }}
          >
            {isBusy ? <InlineLoadingIndicator className="mr-1" /> : null}
            {t("confirm")}
          </Button>
        </DialogActions>
      </Dialog>
      <ExportExcelDialog
        open={isExportDialogOpen}
        defaultTitle={invoice ? `Billing Invoice ${invoice.invoiceNo}` : t("billingInvoiceEditor")}
        defaultColumns={exportColumns}
        onClose={() => setIsExportDialogOpen(false)}
        onExport={handleExportExcel}
      />
    </main>
  );
}

// --- helpers ---

function chargeTypeLabel(chargeType: string, t: (key: string) => string) {
  switch (chargeType) {
    case "INBOUND": return t("billingInboundCharges");
    case "WRAPPING": return t("billingWrappingCharges");
    case "STORAGE": return t("billingStorageCharges");
    case "OUTBOUND": return t("billingOutboundCharges");
    case "DISCOUNT": return t("billingDiscount");
    case "MANUAL": return t("billingManualCharge");
    default: return chargeType;
  }
}

function invoiceTypeLabel(invoiceType: BillingInvoice["invoiceType"], t: (key: string) => string) {
  switch (invoiceType) {
    case "STORAGE_SETTLEMENT":
      return t("billingInvoiceTypeStorageSettlement");
    case "MIXED":
    default:
      return t("billingInvoiceTypeMixed");
  }
}

function containerTypeLabel(containerType: ContainerType, t: (key: string) => string) {
  return containerType === "WEST_COAST_TRANSFER"
    ? t("billingContainerTypeWestCoastTransfer")
    : t("billingContainerTypeNormal");
}

function buildBillingInvoiceExportColumns(
  invoice: BillingInvoice,
  exportMode: BillingExportMode,
  t: (key: string) => string
): ExcelExportColumn[] {
  const base: ExcelExportColumn[] = [
    { key: "rowType", label: t("billingRowType") },
    { key: "chargeType", label: t("billingChargeType") },
    { key: "description", label: t("description") },
    { key: "reference", label: t("reference") },
    { key: "containerNo", label: t("containerNo") },
    { key: "warehouse", label: t("currentStorage") },
    { key: "occurredOn", label: t("billingOccurredAt") },
    { key: "quantity", label: t("quantity"), numberFormat: "number" },
    { key: "unitRate", label: t("unitRate"), numberFormat: "currency" },
    { key: "amount", label: t("amount"), numberFormat: "currency" },
    { key: "sourceType", label: t("billingSourceType") },
    { key: "notes", label: t("notes") }
  ];

  if (exportMode === "DETAILED" && invoice.invoiceType === "STORAGE_SETTLEMENT") {
    return [
      ...base,
      { key: "segmentStart", label: t("billingSegmentStart") },
      { key: "segmentEnd", label: t("billingSegmentEnd") },
      { key: "dayEndPallets", label: t("billingDayEndPallets"), numberFormat: "number" },
      { key: "billedDays", label: t("billingBilledDays"), numberFormat: "number" },
      { key: "segmentPalletDays", label: t("palletDays"), numberFormat: "number" },
      { key: "segmentAmount", label: t("billingStorageCharges"), numberFormat: "currency" }
    ];
  }

  return base.filter((column) => column.key !== "rowType");
}

function buildBillingInvoiceExportRows(
  invoice: BillingInvoice,
  exportMode: BillingExportMode,
  timeZone: string,
  t: (key: string) => string
): Array<Record<string, ExcelExportCell>> {
  const rows: Array<Record<string, ExcelExportCell>> = invoice.lines.map((line) => ({
    rowType: t("billingRowTypeInvoiceLine"),
    chargeType: chargeTypeLabel(line.chargeType, t),
    description: line.description || "-",
    reference: line.reference || "-",
    containerNo: line.containerNo || "-",
    warehouse: line.warehouse || "-",
    occurredOn: line.occurredOn ? formatDateTimeValue(line.occurredOn, timeZone, { dateStyle: "medium" }) : "-",
    quantity: line.quantity,
    unitRate: line.unitRate,
    amount: line.amount,
    sourceType: line.sourceType === "AUTO" ? t("billingSourceTypeAuto") : t("billingSourceTypeManual"),
    notes: line.notes || "-"
  }));

  if (exportMode === "DETAILED" && invoice.invoiceType === "STORAGE_SETTLEMENT") {
    for (const line of invoice.lines) {
      if (!line.details || line.details.kind !== "STORAGE_CONTAINER_SUMMARY") {
        continue;
      }
      for (const segment of line.details.segments) {
        rows.push({
          rowType: t("billingRowTypeStorageSegment"),
          chargeType: chargeTypeLabel(line.chargeType, t),
          description: line.description || "-",
          reference: line.reference || "-",
          containerNo: line.containerNo || "-",
          warehouse: line.details.warehousesTouched.join(", ") || line.warehouse || "-",
          occurredOn: segment.endDate,
          quantity: segment.palletDays,
          unitRate: segment.palletDays > 0 ? segment.amount / segment.palletDays : 0,
          amount: segment.amount,
          sourceType: line.sourceType === "AUTO" ? t("billingSourceTypeAuto") : t("billingSourceTypeManual"),
          notes: `${segment.dayEndPallets} ${t("billingDayEndPallets").toLowerCase()}`,
          segmentStart: segment.startDate,
          segmentEnd: segment.endDate,
          dayEndPallets: segment.dayEndPallets,
          billedDays: segment.billedDays,
          segmentPalletDays: segment.palletDays,
          segmentAmount: segment.amount
        });
      }
    }
  }

  return rows;
}

function billingStatusLabel(status: string, t: (key: string) => string) {
  switch (status) {
    case "DRAFT": return t("billingInvoiceStatusDraft");
    case "FINALIZED": return t("billingInvoiceStatusFinalized");
    case "PAID": return t("billingInvoiceStatusPaid");
    case "VOID": return t("billingInvoiceStatusVoid");
    default: return status;
  }
}

function billingStatusColor(status: string): "default" | "primary" | "success" | "error" | "warning" {
  switch (status) {
    case "DRAFT": return "default";
    case "FINALIZED": return "primary";
    case "PAID": return "success";
    case "VOID": return "error";
    default: return "default";
  }
}

function confirmDialogTitle(action: string | null, t: (key: string) => string) {
  switch (action) {
    case "finalize": return t("billingFinalizeInvoice");
    case "mark-paid": return t("billingMarkPaid");
    case "void": return t("billingVoidInvoice");
    case "delete": return t("billingDeleteInvoice");
    case "delete-line": return t("billingDeleteLine");
    default: return "";
  }
}

function confirmDialogMessage(action: string | null, t: (key: string) => string) {
  switch (action) {
    case "finalize": return t("billingFinalizeInvoiceConfirm");
    case "mark-paid": return t("billingMarkPaidConfirm");
    case "void": return t("billingVoidInvoiceConfirm");
    case "delete": return t("billingDeleteInvoiceConfirm");
    case "delete-line": return t("billingDeleteLine") + "?";
    default: return "";
  }
}

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(value);
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message || fallback;
  }
  return fallback;
}
