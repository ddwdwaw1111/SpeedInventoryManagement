import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";
import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
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

import { api } from "../lib/api";
import { waitForNextPaint } from "../lib/asyncUi";
import {
  resolveBillingInvoiceContainerDetails,
  sumBillingContainerDetailTotals
} from "../lib/billingContainerLedger";
import {
  buildBillingContainerStatementRows,
  buildBillingContainerStatements,
  getUnreconciledBillingPalletMovementContainers,
  type BillingContainerStatement
} from "../lib/billingContainerStatement";
import { downloadExcelWorkbook, type ExcelExportCell, type ExcelExportColumn } from "../lib/excelExport";
import { downloadBillingInvoicePdf } from "../lib/billingInvoicePdf";
import { downloadBillingContainerZip } from "../lib/billingContainerZip";
import { getErrorMessage } from "../lib/errors";
import { formatDiscountMoney, formatMoney, formatNumber } from "../lib/formatters";
import { useI18n } from "../lib/i18n";
import { DEFAULT_BILLING_INVOICE_HEADER, useSettings } from "../lib/settings";
import { formatDateTimeValue } from "../lib/dates";
import type {
  BillingInvoice,
  BillingInvoiceHeader,
  BillingInvoiceLineData,
  BillingStorageSegmentDetail,
  AddBillingInvoiceLinePayload,
  UpdateBillingInvoiceLinePayload,
  UserRole
} from "../lib/types";
import { ExportExcelDialog } from "./ExportExcelDialog";
import { ExportLoadingScreen } from "./ExportLoadingScreen";
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

type InvoiceStorageSegmentDisplayRow = {
  line: BillingInvoiceLineData;
  segment: BillingStorageSegmentDetail;
  warehouseLabel: string;
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

const CHARGE_TYPE_OPTIONS = ["INBOUND", "WRAPPING", "STORAGE", "DISCOUNT", "MANUAL"];

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
  const [customerNameValue, setCustomerNameValue] = useState("");
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportMenuAnchor, setExportMenuAnchor] = useState<HTMLElement | null>(null);

  const isDraft = invoice?.status === "DRAFT";
  const isAdmin = currentUserRole === "admin";
  const isBusy = busyActionKey !== null;
  const isPdfExportBusy = busyActionKey === "export-pdf";
  const isContainerZipExportBusy = busyActionKey === "export-container-zip";
  const isDocumentExportBusy = isPdfExportBusy || isContainerZipExportBusy;
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
      setCustomerNameValue(data.customerNameSnapshot);
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
        const chargeType = lineForm.chargeType.trim().toUpperCase();
        const amount = toNumber(lineForm.amount);
        if (chargeType === "DISCOUNT" && roundCurrency(amount) === 0) {
          if (lineDialogMode === "edit" && editingLineId !== null) {
            const updated = await api.deleteBillingInvoiceLine(invoice.id, editingLineId);
            setInvoice(updated);
          }
          setLineDialogOpen(false);
          setEditingLineId(null);
          return;
        }

        const payload: AddBillingInvoiceLinePayload & UpdateBillingInvoiceLinePayload = {
          chargeType,
          description: lineForm.description,
          reference: lineForm.reference,
          containerNo: lineForm.containerNo,
          warehouse: lineForm.warehouse,
          occurredOn: lineForm.occurredOn,
          quantity: toNumber(lineForm.quantity),
          unitRate: toNumber(lineForm.unitRate),
          amount,
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
    setCustomerNameValue(invoice.customerNameSnapshot);
    setIsEditingHeader(true);
  }

  async function handleSaveHeader(event: FormEvent) {
    event.preventDefault();
    if (!invoice) return;
    await runBusyAction("save-header", async () => {
      try {
        const updated = await api.updateBillingInvoice(invoice.id, {
          customerName: customerNameValue,
          header: formToHeader(headerForm)
        });
        setInvoice(updated);
        setHeaderForm(headerToForm(getEditableInvoiceHeader(updated)));
        setCustomerNameValue(updated.customerNameSnapshot);
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
  const visibleInvoiceLines = filterVisibleInvoiceLines(invoice.lines);
  const invoiceContainerDetails = resolveBillingInvoiceContainerDetails(invoice);
  const containerStatements = buildBillingContainerStatements(invoice);
  const containerDetailTotal = sumBillingContainerDetailTotals(invoiceContainerDetails);
  const containerLedgerReconciles = roundCurrency(containerDetailTotal) === roundCurrency(invoiceDisplayTotals.grandTotal);
  const billedContainerCount = containerStatements.filter((statement) => statement.containerNo.trim() !== "").length;
  const totalStorageCharges = roundCurrency(containerStatements.reduce((sum, statement) => sum + statement.storageAmount, 0));
  const totalOtherCharges = roundCurrency(containerStatements.reduce((sum, statement) => sum + statement.otherAmount, 0));
  const totalBillablePalletDays = roundQuantity(containerStatements.reduce((sum, statement) => sum + statement.billablePalletDays, 0));
  const palletMovementMismatchContainers = getUnreconciledBillingPalletMovementContainers(containerStatements);
  const palletMovementReconciles = palletMovementMismatchContainers.length === 0;
  const invoiceStorageSegmentRows = buildInvoiceStorageSegmentRows(visibleInvoiceLines);
  const showInvoiceDiscount = invoiceDisplayTotals.discountTotal !== 0;
  const showStorageDiscountColumn = hasInvoiceStorageDiscount(invoice);
  const showStorageSegmentDiscountColumns = invoiceStorageSegmentRows.some((row) =>
    (row.segment.discountAmount ?? 0) > 0 || (row.segment.freePalletDays ?? 0) > 0
  );
  const totalsLabelColSpan = showStorageDiscountColumn ? 10 : 9;
  const exportColumns = buildBillingTemplateContainerLedgerColumns();

  function handleExportExcel({ title, columns }: { title: string; columns: ExcelExportColumn[] }) {
    if (!invoice) {
      return;
    }

    const chargeLineRows = buildBillingTemplateContainerDetailRows(invoice);
    const containerLedgerRows = buildBillingTemplateContainerLedgerRows(containerStatements);
    const storageDetailRows = buildBillingContainerStatementRows(invoice, containerStatements).map((row) => ({
      ...row,
      storageDiscount: row.storageDiscountAmount === null
        ? null
        : -Math.abs(row.storageDiscountAmount)
    }));

    downloadExcelWorkbook({
      title: `Warehouse Invoice\n${invoice.header.sellerName} | ${invoice.invoiceNo}\n${invoice.customerNameSnapshot} | ${invoice.periodStart} to ${invoice.periodEnd}`,
      sheetName: "Container Reconciliation",
      fileName: title,
      columns,
      rows: containerLedgerRows,
      summaryRows: [
        { label: "Invoice Total", value: containerDetailTotal, numberFormat: "currency", bold: true }
      ],
      additionalSheets: [
        {
          title: `Supporting Charge Lines: ${invoice.periodStart} to ${invoice.periodEnd}`,
          sheetName: "Charge Lines",
          columns: buildBillingTemplateContainerDetailColumns(),
          rows: chargeLineRows,
          summaryRows: [
            ...(invoiceDisplayTotals.subtotal !== invoiceDisplayTotals.grandTotal
              ? [{ label: "Subtotal", value: invoiceDisplayTotals.subtotal, numberFormat: "currency" as const }]
              : []),
            ...(showInvoiceDiscount
              ? [{ label: "Discount", value: invoiceDisplayTotals.discountTotal, numberFormat: "currency" as const }]
              : []),
            { label: "Total Fee", value: invoiceDisplayTotals.grandTotal, numberFormat: "currency", bold: true }
          ]
        },
        {
          title: `Storage Billing Period: ${invoice.periodStart} to ${invoice.periodEnd}`,
          sheetName: "Storage Fee",
          columns: buildBillingTemplateStorageColumns(),
          rows: storageDetailRows,
          summaryRows: [{
            label: "Total",
            value: roundCurrency(containerStatements.reduce((sum, statement) => sum + statement.storageAmount, 0)),
            numberFormat: "currency",
            bold: true
          }]
        }
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
    await runBusyAction("export-pdf", async () => {
      try {
        setErrorMessage("");
        await handleDownloadPdf();
      } catch (error) {
        setErrorMessage(getErrorMessage(error, t("billingPdfExportError")));
      }
    });
  }

  async function handleDownloadContainerZipWithFeedback() {
    if (!invoice) {
      return;
    }
    setExportMenuAnchor(null);
    await runBusyAction("export-container-zip", async () => {
      try {
        await downloadBillingContainerZip({
          invoice,
          timeZone: resolvedTimeZone
        });
      } catch (error) {
        setErrorMessage(getErrorMessage(error, t("billingContainerZipError")));
      }
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
        startIcon={isDocumentExportBusy ? <InlineLoadingIndicator /> : <FileDownloadOutlinedIcon fontSize="small" />}
        endIcon={<ExpandMoreOutlinedIcon fontSize="small" />}
        onClick={(event) => setExportMenuAnchor(event.currentTarget)}
        disabled={visibleInvoiceLines.length === 0 || isBusy}
        aria-busy={isDocumentExportBusy}
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
          disabled={isBusy || !palletMovementReconciles}
          onClick={() => void handleDownloadPdfWithFeedback()}
        >
          <ListItemIcon><PictureAsPdfOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t("downloadPdf")} secondary={t("downloadPdfDesc")} />
        </MenuItem>
        <MenuItem
          disabled={isBusy || containerStatements.length === 0 || !palletMovementReconciles}
          onClick={() => void handleDownloadContainerZipWithFeedback()}
        >
          <ListItemIcon><ArchiveOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t("billingDownloadContainerZip")} secondary={t("billingDownloadContainerZipDesc")} />
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
        <Button size="small" variant="contained" color="primary" startIcon={isFinalizeBusy ? <InlineLoadingIndicator /> : <CheckCircleOutlineOutlinedIcon fontSize="small" />} onClick={() => setConfirmAction("finalize")} disabled={isBusy || !palletMovementReconciles} aria-busy={isFinalizeBusy}>
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

        {/* Invoice-first overview */}
        <section className="billing-invoice-overview" aria-label={t("billingInvoiceOverview")}>
          <div className="billing-invoice-overview__identity">
            <div className="billing-invoice-overview__eyebrow">
              <span>{t("billingInvoiceNo")}</span>
              <strong>{invoice.invoiceNo}</strong>
            </div>
            <h2>{invoice.customerNameSnapshot}</h2>
            <div className="billing-invoice-overview__meta">
              <span><small>{t("billingPeriod")}</small>{invoice.periodStart} - {invoice.periodEnd}</span>
              <span><small>{t("billingInvoiceType")}</small>{invoiceTypeLabel(invoice.invoiceType, t)}</span>
              <span><small>{t("billingWarehouseScope")}</small>{invoice.warehouseNameSnapshot || t("billingAllWarehouses")}</span>
            </div>
          </div>
          <div className="billing-invoice-overview__amount">
            <span>{t("billingAmountDue")}</span>
            <strong>{formatMoney(invoiceDisplayTotals.grandTotal)}</strong>
            <dl>
              <div><dt>{t("billingInvoiceSubtotal")}</dt><dd>{formatMoney(invoiceDisplayTotals.subtotal)}</dd></div>
              {showInvoiceDiscount && (
                <div className="billing-invoice-overview__discount"><dt>{t("billingDiscount")}</dt><dd>{formatMoney(invoiceDisplayTotals.discountTotal)}</dd></div>
              )}
            </dl>
          </div>
        </section>

        <div className="billing-invoice-facts" aria-label={t("billingChargeBreakdown")}>
          <article>
            <span>{t("billingBilledContainers")}</span>
            <strong>{formatNumber(billedContainerCount)}</strong>
            <small>{t("billingBilledContainersDesc")}</small>
          </article>
          <article>
            <span>{t("billingStorageCharges")}</span>
            <strong>{formatMoney(totalStorageCharges)}</strong>
            <small>{formatNumber(totalBillablePalletDays)} {t("palletDays")}</small>
          </article>
          <article>
            <span>{t("billingOtherCharges")}</span>
            <strong>{formatMoney(totalOtherCharges)}</strong>
            <small>{t("billingOtherChargesDesc")}</small>
          </article>
          <article className="billing-invoice-facts__total">
            <span>{t("billingGrandTotal")}</span>
            <strong>{formatMoney(invoiceDisplayTotals.grandTotal)}</strong>
            <small>{invoice.currencyCode}</small>
          </article>
        </div>

        {/* Status banner with lifecycle actions */}
        <div className={`billing-status-banner billing-status-banner--${invoice.status.toLowerCase()}`}>
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
                {t("customer")}
                <input type="text" required value={customerNameValue} onChange={(event) => setCustomerNameValue(event.target.value)} />
              </label>
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
              <InvoiceHeaderValue label={t("customer")} value={invoice.customerNameSnapshot} />
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
        <details className="billing-invoice-disclosure">
          <summary>
            <span>
              <strong>{t("billingRatesSnapshot")}</strong>
              <small>{t("billingRatesSnapshotInvoiceDesc")}</small>
            </span>
          </summary>
          <div className="report-grid billing-invoice-disclosure__content">
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
                <div className="report-bars__labels"><strong>{t("billingExcludeUnderfilledPallets")}</strong></div>
                <div className="report-bars__value">
                  {invoice.rates.excludeUnderfilledPallets
                    ? `${t("yes")} · ${formatNumber(invoice.rates.minimumQtyPerPallet ?? 0)} Qty`
                    : t("no")}
                </div>
              </div>
            </div>
            </article>
          </div>
        </details>

        {/* Container billing ledger */}
        <section className="workbook-panel" style={{ margin: "0 1rem 1rem" }}>
          <WorkspacePanelHeader
            title={t("billingContainerLedger")}
            description={t("billingContainerLedgerDesc")}
            actions={(
              <Chip
                size="small"
                variant="outlined"
                color={containerLedgerReconciles ? "success" : "error"}
                label={containerLedgerReconciles ? t("billingContainerLedgerReconciled") : t("billingContainerLedgerMismatchShort")}
              />
            )}
          />
          {!containerLedgerReconciles && (
            <div className="sheet-note" style={{ margin: "0 1rem 1rem", color: "#b42318", borderColor: "rgba(180,35,24,0.35)" }}>
              {t("billingContainerLedgerMismatch", {
                containerTotal: formatMoney(containerDetailTotal),
                invoiceTotal: formatMoney(invoiceDisplayTotals.grandTotal)
              })}
            </div>
          )}
          {!palletMovementReconciles && (
            <div className="sheet-note" style={{ margin: "0 1rem 1rem", color: "#b42318", borderColor: "rgba(180,35,24,0.35)" }}>
              {t("billingPalletMovementMismatch", {
                containers: palletMovementMismatchContainers.join(", ")
              })}
            </div>
          )}
          {invoiceContainerDetails.length === 0 ? (
            <WorkspaceTableEmptyState title={t("noBillingData")} description={t("billingContainerLedgerDesc")} />
          ) : (
            <div className="sheet-table-wrap">
              <table className="sheet-table billing-container-ledger-table" aria-label={t("billingContainerLedger")}>
                <thead>
                  <tr>
                    <th>{t("billingReceivedOn")}</th>
                    <th>{t("containerNo")}</th>
                    <th>{t("currentStorage")}</th>
                    <th>{t("billingOpeningPallets")}</th>
                    <th>{t("billingReceivedPalletsDuringPeriod")}</th>
                    <th>{t("billingReleasedPallets")}</th>
                    <th>{t("billingClosingPallets")}</th>
                    <th>{t("billingReleaseActivity")}</th>
                    <th>{t("billingInboundCharges")}</th>
                    <th>{t("billingWrappingCharges")}</th>
                    <th>{t("billingOutboundCharges")}</th>
                    <th>{t("billingStorageGross")}</th>
                    <th>{t("billingStorageDiscount")}</th>
                    <th>{t("billingStorageNet")}</th>
                    <th>{t("billingOtherAdjustments")}</th>
                    <th>{t("billingContainerTotal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {containerStatements.map((detail) => (
                    <tr key={detail.containerNo || "invoice-level"}>
                      <td className="cell--mono">{detail.receivedOn || "-"}</td>
                      <td className="cell--mono"><strong>{detail.containerNo || t("billingInvoiceLevel")}</strong></td>
                      <td>{detail.warehouses.join(", ") || "-"}</td>
                      <td className="cell--mono">{detail.palletMovementAvailable ? formatNumber(detail.openingPallets) : "-"}</td>
                      <td className="cell--mono">{detail.palletMovementAvailable ? formatNumber(detail.receivedPallets) : "-"}</td>
                      <td className="cell--mono">{detail.palletMovementAvailable ? formatNumber(detail.releasedPallets) : "-"}</td>
                      <td className="cell--mono">{detail.palletMovementAvailable ? formatNumber(detail.closingPallets) : "-"}</td>
                      <td className="cell--mono">
                        {detail.releaseEvents.length > 0
                          ? detail.releaseEvents.map((event) => (
                            <small key={`${event.date}-${event.pallets}`} style={{ display: "block" }}>
                              {event.date} · {formatNumber(event.pallets)} {t("pallets")}
                            </small>
                          ))
                          : "-"}
                      </td>
                      <td className="cell--mono">{formatMoneyOrDash(detail.inboundAmount)}</td>
                      <td className="cell--mono">{formatMoneyOrDash(detail.wrappingAmount)}</td>
                      <td className="cell--mono">{formatMoneyOrDash(detail.outboundAmount)}</td>
                      <td className="cell--mono">
                        {formatMoneyOrDash(detail.storageGrossAmount)}
                        {detail.palletDays > 0 && <small className="sheet-table__subtle">{formatNumber(detail.palletDays)} {t("palletDays")}</small>}
                      </td>
                      <td className="cell--mono billing-amount--discount">{detail.storageDiscountAmount > 0 ? formatDiscountMoney(detail.storageDiscountAmount) : "-"}</td>
                      <td className="cell--mono">
                        <strong>{formatMoneyOrDash(detail.storageAmount)}</strong>
                        {detail.billablePalletDays > 0 && <small className="sheet-table__subtle">{formatNumber(detail.billablePalletDays)} {t("palletDays")}</small>}
                      </td>
                      <td className="cell--mono">{formatMoneyOrDash(detail.adjustmentAmount)}</td>
                      <td className="cell--mono billing-container-total"><strong>{formatMoney(detail.totalAmount)}</strong></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700 }}>
                    <td colSpan={15} style={{ textAlign: "right" }}>{t("billingGrandTotal")}</td>
                    <td className="cell--mono">{formatMoney(containerDetailTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        {/* Supporting line-level audit detail */}
        <details className="billing-invoice-disclosure">
          <summary>
            <span>
              <strong>{t("billingInvoicePreview")}</strong>
              <small>{t("billingInvoiceLineItemsSummary", { count: visibleInvoiceLines.length })}</small>
            </span>
          </summary>
          <section className="workbook-panel billing-invoice-disclosure__panel">
            {visibleInvoiceLines.length === 0 ? (
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
                  {visibleInvoiceLines.map((line, index) => (
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
                  {showInvoiceDiscount && (
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
        </details>

        {invoiceStorageSegmentRows.length > 0 && (
          <details className="billing-invoice-disclosure">
            <summary>
              <span>
                <strong>{t("billingStorageTimeline")}</strong>
                <small>{t("billingStorageTimelineSummary", { count: invoiceStorageSegmentRows.length })}</small>
              </span>
            </summary>
            <section className="workbook-panel billing-invoice-disclosure__panel">
              <div className="sheet-table-wrap">
              <table className="sheet-table" aria-label={t("billingStorageTimeline")}>
                <thead>
                  <tr>
                    <th>{t("containerNo")}</th>
                    <th>{t("currentStorage")}</th>
                    <th>{t("fromDate")}</th>
                    <th>{t("toDate")}</th>
                    <th>{t("billingDayEndPallets")}</th>
                    <th>{t("billingBilledDays")}</th>
                    <th>{t("palletDays")}</th>
                    {showStorageSegmentDiscountColumns && <th>{t("billingFreePalletDays")}</th>}
                    {showStorageSegmentDiscountColumns && <th>{t("billingInvoiceSubtotal")}</th>}
                    {showStorageSegmentDiscountColumns && <th>{t("billingDiscount")}</th>}
                    <th>{t("billingStorageCharges")}</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceStorageSegmentRows.map((row) => (
                    <tr key={`${row.line.id}-${row.segment.startDate}-${row.segment.endDate}-${row.segment.dayEndPallets}`}>
                      <td className="cell--mono">{row.line.containerNo || "-"}</td>
                      <td>{row.warehouseLabel}</td>
                      <td className="cell--mono">{row.segment.startDate}</td>
                      <td className="cell--mono">{row.segment.endDate}</td>
                      <td className="cell--mono">{formatNumber(row.segment.dayEndPallets)}</td>
                      <td className="cell--mono">{formatNumber(row.segment.billedDays)}</td>
                      <td className="cell--mono">{formatNumber(row.segment.palletDays)}</td>
                      {showStorageSegmentDiscountColumns && <td className="cell--mono">{(row.segment.freePalletDays ?? 0) > 0 ? formatNumber(row.segment.freePalletDays ?? 0) : "-"}</td>}
                      {showStorageSegmentDiscountColumns && <td className="cell--mono">{formatMoney(row.segment.grossAmount ?? row.segment.amount + (row.segment.discountAmount ?? 0))}</td>}
                      {showStorageSegmentDiscountColumns && <td className="cell--mono">{(row.segment.discountAmount ?? 0) > 0 ? formatDiscountMoney(row.segment.discountAmount ?? 0) : "-"}</td>}
                      <td className="cell--mono">{formatMoney(row.segment.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </section>
          </details>
        )}
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
                  {(CHARGE_TYPE_OPTIONS.includes(lineForm.chargeType) ? CHARGE_TYPE_OPTIONS : [lineForm.chargeType, ...CHARGE_TYPE_OPTIONS]).map((option) => (
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
      <ExportLoadingScreen open={isDocumentExportBusy} />
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

function invoiceTypeLabel(invoiceType: BillingInvoice["invoiceType"], t: (key: string) => string) {
  switch (invoiceType) {
    case "STORAGE_SETTLEMENT":
      return t("billingInvoiceTypeStorageSettlement");
    case "MIXED":
    default:
      return t("billingInvoiceTypeMixed");
  }
}

function buildBillingTemplateContainerDetailColumns(): ExcelExportColumn[] {
  return [
    { key: "containerNo", label: "Container No." },
    { key: "chargeType", label: "Charge Type" },
    { key: "description", label: "Description" },
    { key: "reference", label: "Reference" },
    { key: "warehouse", label: "Warehouse" },
    { key: "occurredOn", label: "Occurred On" },
    { key: "unitRate", label: "Unit Price", numberFormat: "currency" },
    { key: "quantity", label: "Qty", numberFormat: "number" },
    { key: "currency", label: "Currency" },
    { key: "amount", label: "Confirmed Amount", numberFormat: "currency" }
  ];
}

function buildBillingTemplateContainerDetailRows(invoice: BillingInvoice): Array<Record<string, ExcelExportCell>> {
  return [...filterVisibleInvoiceLines(invoice.lines)]
    .sort(compareBillingInvoiceLinesByContainer)
    .map((line) => ({
      containerNo: line.containerNo || "Invoice-level",
      chargeType: invoiceChargeTypeLabel(line.chargeType),
      description: line.description || "-",
      reference: line.reference || "-",
      warehouse: line.warehouse || "-",
      occurredOn: line.occurredOn || "-",
      unitRate: line.unitRate,
      quantity: line.quantity,
      currency: invoice.currencyCode,
      amount: line.amount
    }));
}

function buildBillingTemplateContainerLedgerColumns(): ExcelExportColumn[] {
  return [
    { key: "receivedOn", label: "Received On" },
    { key: "containerNo", label: "Container No." },
    { key: "warehouses", label: "Warehouse" },
    { key: "openingPallets", label: "Opening Pallets", numberFormat: "number" },
    { key: "receivedPallets", label: "Received Pallets During Period", numberFormat: "number" },
    { key: "releasedPallets", label: "Inventory Pallets Released", numberFormat: "number" },
    { key: "closingPallets", label: "Closing Pallets", numberFormat: "number" },
    { key: "releaseDates", label: "Release Date" },
    { key: "billablePalletDays", label: "Billable Pallet-Days", numberFormat: "number" },
    { key: "inboundAmount", label: "Inbound Fee", numberFormat: "currency" },
    { key: "wrappingAmount", label: "Wrapping Fee", numberFormat: "currency" },
    { key: "outboundAmount", label: "Outbound Fee", numberFormat: "currency" },
    { key: "storageGrossAmount", label: "Gross Storage Fee", numberFormat: "currency" },
    { key: "storageDiscount", label: "Storage Discount", numberFormat: "currency" },
    { key: "storageAmount", label: "Net Storage Fee", numberFormat: "currency" },
    { key: "adjustmentAmount", label: "Adjustments", numberFormat: "currency" },
    { key: "totalAmount", label: "Container Total", numberFormat: "currency" }
  ];
}

function buildBillingTemplateContainerLedgerRows(
  details: BillingContainerStatement[]
): Array<Record<string, ExcelExportCell>> {
  return details.map((detail) => ({
    receivedOn: detail.receivedOn || "-",
    containerNo: detail.containerNo || "Invoice-level",
    warehouses: detail.warehouses.join(", ") || "-",
    openingPallets: detail.palletMovementAvailable ? detail.openingPallets : null,
    receivedPallets: detail.palletMovementAvailable ? detail.receivedPallets : null,
    releasedPallets: detail.palletMovementAvailable ? detail.releasedPallets : null,
    closingPallets: detail.palletMovementAvailable ? detail.closingPallets : null,
    releaseDates: detail.releaseEvents.map((event) => `${event.date} (-${event.pallets})`).join(", ") || "-",
    billablePalletDays: detail.billablePalletDays,
    inboundAmount: detail.inboundAmount,
    wrappingAmount: detail.wrappingAmount,
    outboundAmount: detail.outboundAmount,
    storageGrossAmount: detail.storageGrossAmount,
    storageDiscount: -Math.abs(detail.storageDiscountAmount),
    storageAmount: detail.storageAmount,
    adjustmentAmount: detail.adjustmentAmount,
    totalAmount: detail.totalAmount
  }));
}

function compareBillingInvoiceLinesByContainer(
  left: BillingInvoice["lines"][number],
  right: BillingInvoice["lines"][number]
) {
  const leftContainer = normalizeBillingExportContainer(left.containerNo);
  const rightContainer = normalizeBillingExportContainer(right.containerNo);
  if (leftContainer === "" || rightContainer === "") {
    if (leftContainer !== rightContainer) {
      return leftContainer === "" ? 1 : -1;
    }
  }
  if (leftContainer !== rightContainer) {
    return leftContainer.localeCompare(rightContainer);
  }
  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }
  return left.id - right.id;
}

function normalizeBillingExportContainer(containerNo: string) {
  return containerNo.trim().toUpperCase();
}

function invoiceChargeTypeLabel(chargeType: string) {
  switch (chargeType) {
    case "INBOUND": return "Inbound Fee";
    case "WRAPPING": return "Wrapping Fee";
    case "STORAGE": return "Storage Fee";
    case "OUTBOUND": return "Outbound Fee";
    case "DISCOUNT": return "Discount";
    case "MANUAL": return "Manual Charge";
    default: return chargeType;
  }
}

function buildBillingTemplateStorageColumns(): ExcelExportColumn[] {
  return [
    { key: "receivedOn", label: "Received On" },
    { key: "containerNo", label: "Container No." },
    { key: "openingPallets", label: "Opening Pallets", numberFormat: "number" },
    { key: "receivedPallets", label: "Received Pallets During Period", numberFormat: "number" },
    { key: "releasedPallets", label: "Inventory Pallets Released", numberFormat: "number" },
    { key: "closingPallets", label: "Closing Pallets", numberFormat: "number" },
    { key: "releaseDate", label: "Release Date" },
    { key: "segmentStartDate", label: "Charge Start" },
    { key: "segmentEndDate", label: "Charge End" },
    { key: "palletsOnHand", label: "Billable Pallets on Hand", numberFormat: "number" },
    { key: "palletDays", label: "Pallet-Days", numberFormat: "number" },
    { key: "freePalletDays", label: "Free Pallet-Days", numberFormat: "number" },
    { key: "billablePalletDays", label: "Billable Pallet-Days", numberFormat: "number" },
    { key: "storageGrossAmount", label: "Gross Storage Fee", numberFormat: "currency" },
    { key: "storageDiscount", label: "Storage Discount", numberFormat: "currency" },
    { key: "storageFee", label: "Storage Fee", numberFormat: "currency" }
  ];
}

function filterVisibleInvoiceLines(lines: BillingInvoiceLineData[]) {
  return lines.filter(isVisibleInvoiceLine);
}

function isVisibleInvoiceLine(line: BillingInvoiceLineData) {
  return line.chargeType !== "DISCOUNT" || roundCurrency(line.amount) !== 0;
}

function buildInvoiceStorageSegmentRows(lines: BillingInvoiceLineData[]): InvoiceStorageSegmentDisplayRow[] {
  return lines.flatMap((line) => {
    if (!line.details || line.details.kind !== "STORAGE_CONTAINER_SUMMARY") {
      return [];
    }
    const warehouseLabel = line.details.warehousesTouched.join(", ") || line.warehouse || "-";
    return line.details.segments.map((segment) => ({ line, segment, warehouseLabel }));
  });
}

function hasInvoiceStorageDiscount(invoice: BillingInvoice) {
  return invoice.lines.some((line) => getInvoiceLineStorageDiscount(line) > 0);
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

function formatMoneyOrDash(value: number) {
  return roundCurrency(value) === 0 ? "-" : formatMoney(value);
}

function roundQuantity(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
