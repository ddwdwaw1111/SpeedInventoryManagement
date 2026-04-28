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
import { DEFAULT_BILLING_INVOICE_HEADER, useSettings } from "../lib/settings";
import { formatDateTimeValue } from "../lib/dates";
import type {
  BillingInvoice,
  BillingInvoiceHeader,
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

type HeaderFormState = {
  sellerName: string;
  subtitle: string;
  remitTo: string;
  terms: string;
  paymentDueDays: string;
  paymentInstructions: string;
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
  const { resolvedTimeZone, billingTermOptions } = useSettings();
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

  // Header and notes editing
  const [isEditingHeader, setIsEditingHeader] = useState(false);
  const [headerForm, setHeaderForm] = useState<HeaderFormState>(() => headerToForm(DEFAULT_BILLING_INVOICE_HEADER));
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportMenuAnchor, setExportMenuAnchor] = useState<HTMLElement | null>(null);

  const isDraft = invoice?.status === "DRAFT";
  const isAdmin = currentUserRole === "admin";
  const isBusy = busyActionKey !== null;
  const isPdfExportBusy = busyActionKey?.startsWith("export-pdf-") ?? false;
  const isSaveHeaderBusy = busyActionKey === "save-header";
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
      setHeaderForm(headerToForm(getEditableInvoiceHeader(data)));
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
        setIsEditingHeader(false);
        setIsEditingNotes(false);
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

  function handleStartEditHeader() {
    if (!invoice) return;
    setHeaderForm(headerToForm(getEditableInvoiceHeader(invoice)));
    setIsEditingHeader(true);
  }

  async function handleSaveHeader(event: FormEvent) {
    event.preventDefault();
    if (!invoice) return;
    await runBusyAction("save-header", async () => {
      try {
        const updated = await api.updateBillingInvoice(invoice.id, { header: formToHeader(headerForm) });
        setInvoice(updated);
        setHeaderForm(headerToForm(getEditableInvoiceHeader(updated)));
        setIsEditingHeader(false);
      } catch (error) {
        setErrorMessage(getErrorMessage(error, "Could not save invoice header."));
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

  const invoiceDisplayTotals = getBillingInvoiceDisplayTotals(invoice);
  const editableHeader = getEditableInvoiceHeader(invoice);
  const showStorageDiscountColumn = invoice.invoiceType === "STORAGE_SETTLEMENT";
  const totalsLabelColSpan = showStorageDiscountColumn ? 10 : 9;
  const exportColumns = buildBillingInvoiceExportColumns(invoice);

  function handleExportExcel({ title, columns }: { title: string; columns: ExcelExportColumn[] }) {
    if (!invoice) {
      return;
    }

    const rows = buildBillingInvoiceExportRows(invoice, resolvedTimeZone);

    downloadExcelWorkbook({
      title,
      sheetName: "Billing Invoice",
      fileName: title,
      columns,
        rows,
        summaryRows: [
          ...(invoiceDisplayTotals.subtotal !== invoiceDisplayTotals.grandTotal
          ? [{ label: "Subtotal", value: invoiceDisplayTotals.subtotal, numberFormat: "currency" as const }]
          : []),
        ...(invoiceDisplayTotals.discountTotal !== 0
          ? [{ label: "Discount", value: invoiceDisplayTotals.discountTotal, numberFormat: "currency" as const }]
          : []),
        { label: "Grand Total", value: invoiceDisplayTotals.grandTotal, numberFormat: "currency", bold: true }
      ]
    });
    setIsExportDialogOpen(false);
  }

  function handleDownloadPdf() {
    if (!invoice) {
      return Promise.resolve();
    }

    return downloadBillingInvoicePdf({
      invoice,
      timeZone: resolvedTimeZone
    });
  }

  async function handleDownloadPdfWithFeedback() {
    setExportMenuAnchor(null);
    await runBusyAction("export-pdf", () => {
      return handleDownloadPdf();
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
            setIsExportDialogOpen(true);
          }}
        >
          <ListItemIcon><FileDownloadOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t("exportExcel")} secondary={t("exportExcelDesc")} />
        </MenuItem>
        <MenuItem
          disabled={isBusy}
          onClick={() => void handleDownloadPdfWithFeedback()}
        >
          <ListItemIcon><PictureAsPdfOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t("downloadPdf")} secondary={t("downloadPdfDesc")} />
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
            title={`${t("billingInvoiceEditor")} - ${invoice.invoiceNo}`}
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
            <strong>{invoice.periodStart} - {invoice.periodEnd}</strong>
          </article>
          <article className="metric-card">
            <span>{t("billingInvoiceSubtotal")}</span>
            <strong>{formatMoney(invoiceDisplayTotals.subtotal)}</strong>
          </article>
          <article className="metric-card">
            <span>{t("billingDiscount")}</span>
            <strong style={{ color: invoiceDisplayTotals.discountTotal < 0 ? "#d32f2f" : undefined }}>{formatMoney(invoiceDisplayTotals.discountTotal)}</strong>
          </article>
          <article className="metric-card">
            <span>{t("billingGrandTotal")}</span>
            <strong style={{ fontSize: "1.125rem" }}>{formatMoney(invoiceDisplayTotals.grandTotal)}</strong>
          </article>
        </div>

        {/* Invoice header */}
        <section className="workbook-panel" style={{ margin: "0 1rem 1rem" }}>
          <WorkspacePanelHeader
            title={t("billingInvoiceHeader")}
            description={t("billingInvoiceHeaderDesc")}
            actions={isDraft && !isEditingHeader ? (
              <Button size="small" variant="outlined" startIcon={<EditOutlinedIcon fontSize="small" />} onClick={handleStartEditHeader} disabled={isBusy}>
                {t("edit")}
              </Button>
            ) : undefined}
          />
          {isEditingHeader ? (
            <form className="sheet-form sheet-form--compact" style={{ padding: "0 1rem 1rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }} onSubmit={handleSaveHeader}>
              <label>
                {t("billingInvoiceSellerName")}
                <input type="text" value={headerForm.sellerName} onChange={(event) => setHeaderForm((form) => ({ ...form, sellerName: event.target.value }))} />
              </label>
              <label>
                {t("billingInvoiceSubtitle")}
                <input type="text" value={headerForm.subtitle} onChange={(event) => setHeaderForm((form) => ({ ...form, subtitle: event.target.value }))} />
              </label>
              <label>
                {t("billingInvoiceRemitTo")}
                <input type="text" value={headerForm.remitTo} onChange={(event) => setHeaderForm((form) => ({ ...form, remitTo: event.target.value }))} />
              </label>
              <label>
                {t("billingInvoiceTerms")}
                <select value={headerForm.terms} onChange={(event) => {
                  const terms = event.target.value;
                  const option = billingTermOptions.find((candidate) => candidate.terms === terms);
                  setHeaderForm((form) => ({
                    ...form,
                    terms,
                    paymentDueDays: option ? String(option.paymentDueDays) : form.paymentDueDays
                  }));
                }}>
                  {billingTermOptions.map((option) => (
                    <option key={option.label} value={option.terms}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                {t("billingInvoicePaymentDueDays")}
                <input type="number" min={0} step={1} value={headerForm.paymentDueDays} onChange={(event) => setHeaderForm((form) => ({ ...form, paymentDueDays: event.target.value }))} />
              </label>
              <label className="sheet-form__wide">
                {t("billingInvoicePaymentInstructions")}
                <textarea rows={3} value={headerForm.paymentInstructions} onChange={(event) => setHeaderForm((form) => ({ ...form, paymentInstructions: event.target.value }))} />
              </label>
              <div className="sheet-form__actions sheet-form__wide">
                <Button type="submit" size="small" variant="contained" disabled={isBusy} aria-busy={isSaveHeaderBusy}>
                  {isSaveHeaderBusy ? <InlineLoadingIndicator className="mr-1" /> : null}
                  {t("save")}
                </Button>
                <Button size="small" variant="outlined" onClick={() => setIsEditingHeader(false)} disabled={isBusy}>{t("cancel")}</Button>
              </div>
            </form>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem", padding: "0 1rem 1rem" }}>
              <InvoiceHeaderValue label={t("billingInvoiceSellerName")} value={editableHeader.sellerName} />
              <InvoiceHeaderValue label={t("billingInvoiceSubtitle")} value={editableHeader.subtitle} />
              <InvoiceHeaderValue label={t("billingInvoiceRemitTo")} value={editableHeader.remitTo} />
              <InvoiceHeaderValue label={t("billingInvoiceTerms")} value={editableHeader.terms} />
              <InvoiceHeaderValue label={t("billingInvoicePaymentDueDays")} value={String(editableHeader.paymentDueDays)} />
              <InvoiceHeaderValue label={t("billingInvoicePaymentInstructions")} value={editableHeader.paymentInstructions} wide />
            </div>
          )}
        </section>

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
                    {showStorageDiscountColumn && <th>{t("billingDiscount")}</th>}
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
                      {showStorageDiscountColumn && (
                        <td className="cell--mono" style={getInvoiceLineStorageDiscount(line) > 0 ? { color: "#d32f2f" } : undefined}>
                          {formatDiscountMoney(getInvoiceLineStorageDiscount(line))}
                        </td>
                      )}
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
                    <td colSpan={totalsLabelColSpan} style={{ textAlign: "right" }}>{t("billingInvoiceSubtotal")}</td>
                    <td className="cell--mono">{formatMoney(invoiceDisplayTotals.subtotal)}</td>
                    <td colSpan={isDraft ? 3 : 2} />
                  </tr>
                  {invoiceDisplayTotals.discountTotal !== 0 && (
                    <tr style={{ fontWeight: 600, color: "#d32f2f" }}>
                      <td colSpan={totalsLabelColSpan} style={{ textAlign: "right" }}>{t("billingDiscount")}</td>
                      <td className="cell--mono">{formatMoney(invoiceDisplayTotals.discountTotal)}</td>
                      <td colSpan={isDraft ? 3 : 2} />
                    </tr>
                  )}
                  <tr style={{ fontWeight: 700 }}>
                    <td colSpan={totalsLabelColSpan} style={{ textAlign: "right" }}>{t("billingGrandTotal")}</td>
                    <td className="cell--mono">{formatMoney(invoiceDisplayTotals.grandTotal)}</td>
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

function InvoiceHeaderValue({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className="sheet-note sheet-note--readonly" style={{ minHeight: "4rem", gridColumn: wide ? "1 / -1" : undefined }}>
      <strong>{label}</strong>
      <div style={{ marginTop: "0.25rem", whiteSpace: "pre-wrap" }}>{value || "-"}</div>
    </div>
  );
}

function getEditableInvoiceHeader(invoice: BillingInvoice): BillingInvoiceHeader {
  return normalizeInvoiceHeader(invoice.header);
}

function headerToForm(header: BillingInvoiceHeader): HeaderFormState {
  return {
    sellerName: header.sellerName,
    subtitle: header.subtitle,
    remitTo: header.remitTo,
    terms: header.terms,
    paymentDueDays: String(header.paymentDueDays),
    paymentInstructions: header.paymentInstructions
  };
}

function formToHeader(form: HeaderFormState): BillingInvoiceHeader {
  return normalizeInvoiceHeader({
    ...form,
    paymentDueDays: Math.max(0, Math.round(toNumber(form.paymentDueDays)))
  });
}

function normalizeInvoiceHeader(header?: Partial<BillingInvoiceHeader> | null): BillingInvoiceHeader {
  if (!header) {
    return DEFAULT_BILLING_INVOICE_HEADER;
  }
  return {
    sellerName: typeof header.sellerName === "string" ? header.sellerName.trim() : DEFAULT_BILLING_INVOICE_HEADER.sellerName,
    subtitle: typeof header.subtitle === "string" ? header.subtitle.trim() : DEFAULT_BILLING_INVOICE_HEADER.subtitle,
    remitTo: typeof header.remitTo === "string" ? header.remitTo.trim() : DEFAULT_BILLING_INVOICE_HEADER.remitTo,
    terms: typeof header.terms === "string" ? header.terms.trim() : DEFAULT_BILLING_INVOICE_HEADER.terms,
    paymentDueDays: typeof header.paymentDueDays === "number" && Number.isFinite(header.paymentDueDays) && header.paymentDueDays >= 0
      ? Math.round(header.paymentDueDays)
      : DEFAULT_BILLING_INVOICE_HEADER.paymentDueDays,
    paymentInstructions: typeof header.paymentInstructions === "string"
      ? header.paymentInstructions.trim()
      : DEFAULT_BILLING_INVOICE_HEADER.paymentInstructions
  };
}

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

function chargeTypeExportLabel(chargeType: string) {
  switch (chargeType) {
    case "INBOUND": return "Inbound Charges";
    case "WRAPPING": return "Wrapping Charges";
    case "STORAGE": return "Storage Charges";
    case "OUTBOUND": return "Outbound Charges";
    case "DISCOUNT": return "Discount";
    case "MANUAL": return "Manual Charge";
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

function buildBillingInvoiceExportColumns(invoice: BillingInvoice): ExcelExportColumn[] {
  const base: ExcelExportColumn[] = [
    { key: "rowType", label: "Row Type" },
    { key: "chargeType", label: "Charge Type" },
    { key: "description", label: "Description" },
    { key: "reference", label: "Reference" },
    { key: "containerNo", label: "Container No." },
    { key: "warehouse", label: "Warehouse" },
    { key: "occurredOn", label: "Occurred On" },
    { key: "quantity", label: "Quantity", numberFormat: "number" },
    { key: "unitRate", label: "Unit Rate", numberFormat: "currency" },
    ...(invoice.invoiceType === "STORAGE_SETTLEMENT"
      ? [{ key: "discountAmount", label: "Discount", numberFormat: "currency" as const }]
      : []),
    { key: "amount", label: "Amount", numberFormat: "currency" },
    { key: "sourceType", label: "Source Type" },
    { key: "notes", label: "Notes" }
  ];

  if (invoice.invoiceType === "STORAGE_SETTLEMENT") {
    return [
      ...base,
      { key: "segmentStart", label: "Segment Start" },
      { key: "segmentEnd", label: "Segment End" },
      { key: "dayEndPallets", label: "Day-End Pallets", numberFormat: "number" },
      { key: "billedDays", label: "Billed Days", numberFormat: "number" },
      { key: "segmentPalletDays", label: "Pallet-Days", numberFormat: "number" },
      { key: "segmentDiscountAmount", label: "Discount", numberFormat: "currency" },
      { key: "segmentAmount", label: "Storage Charges", numberFormat: "currency" }
    ];
  }

  return base;
}

function buildBillingInvoiceExportRows(
  invoice: BillingInvoice,
  timeZone: string
): Array<Record<string, ExcelExportCell>> {
  const rows: Array<Record<string, ExcelExportCell>> = invoice.lines.map((line) => ({
    rowType: "Invoice Line",
    chargeType: chargeTypeExportLabel(line.chargeType),
    description: line.description || "-",
    reference: line.reference || "-",
    containerNo: line.containerNo || "-",
    warehouse: line.warehouse || "-",
    occurredOn: line.occurredOn ? formatDateTimeValue(line.occurredOn, timeZone, { dateStyle: "medium" }) : "-",
    quantity: line.quantity,
    unitRate: line.unitRate,
    amount: line.amount,
    discountAmount: line.details?.kind === "STORAGE_CONTAINER_SUMMARY" ? -Math.abs(line.details.discountAmount ?? 0) : undefined,
    sourceType: line.sourceType === "AUTO" ? "Auto" : "Manual",
    notes: line.notes || "-"
  }));

  if (invoice.invoiceType === "STORAGE_SETTLEMENT") {
    for (const line of invoice.lines) {
      if (!line.details || line.details.kind !== "STORAGE_CONTAINER_SUMMARY") {
        continue;
      }
      for (const segment of line.details.segments) {
        rows.push({
          rowType: "Storage Segment",
          chargeType: chargeTypeExportLabel(line.chargeType),
          description: line.description || "-",
          reference: line.reference || "-",
          containerNo: line.containerNo || "-",
          warehouse: line.details.warehousesTouched.join(", ") || line.warehouse || "-",
          occurredOn: segment.endDate,
          quantity: segment.palletDays,
          unitRate: segment.palletDays > 0 ? segment.amount / segment.palletDays : 0,
          amount: segment.amount,
          sourceType: line.sourceType === "AUTO" ? "Auto" : "Manual",
          notes: `${segment.dayEndPallets} day-end pallets`,
          segmentStart: segment.startDate,
          segmentEnd: segment.endDate,
          dayEndPallets: segment.dayEndPallets,
          billedDays: segment.billedDays,
          segmentPalletDays: segment.palletDays,
          segmentDiscountAmount: -Math.abs(segment.discountAmount ?? 0),
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

function getBillingInvoiceDisplayTotals(invoice: BillingInvoice) {
  const storageGraceDiscount = sumStorageGraceDiscount(invoice.lines);
  return {
    subtotal: roundCurrency(invoice.subtotal + storageGraceDiscount),
    discountTotal: roundCurrency(invoice.discountTotal - storageGraceDiscount),
    grandTotal: roundCurrency(invoice.grandTotal)
  };
}

function sumStorageGraceDiscount(lines: BillingInvoiceLineData[]) {
  return roundCurrency(lines.reduce((total, line) => total + (line.details?.discountAmount ?? 0), 0));
}

function getInvoiceLineStorageDiscount(line: BillingInvoiceLineData) {
  return roundCurrency(line.details?.discountAmount ?? 0);
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function formatDiscountMoney(value: number) {
  return value === 0 ? formatMoney(0) : formatMoney(-Math.abs(value));
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
