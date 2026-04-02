import CloseIcon from "@mui/icons-material/Close";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { Box, Button, Dialog, DialogContent, DialogTitle, Drawer, IconButton, TextField } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useEffect, useMemo, useState } from "react";

import { ApiError, api } from "../lib/api";
import type { BillingInvoice, BillingInvoiceLine, CustomerRateCard, CustomerRateCardPayload } from "../lib/types";
import { formatDateTimeValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import { InlineAlert, useFeedbackToast } from "./Feedback";
import { buildWorkspaceGridSlots, WorkspaceDrawerLoadingState, WorkspacePanelHeader } from "./WorkspacePanelChrome";

type RateCardFormState = CustomerRateCardPayload;

function getCurrentBillingMonth() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

function createRateCardForm(rateCard: CustomerRateCard | null): RateCardFormState {
  return {
    inboundContainerFee: rateCard?.inboundContainerFee ?? 450,
    wrappingFeePerPallet: rateCard?.wrappingFeePerPallet ?? 10,
    storageFeePerPalletWeek: rateCard?.storageFeePerPalletWeek ?? 7,
    outboundFeePerPallet: rateCard?.outboundFeePerPallet ?? 10
  };
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value || 0);
}

function formatLineType(value: string, t: (key: string) => string) {
  switch (value) {
    case "INBOUND_CONTAINER":
      return t("billingInboundContainerFee");
    case "WRAPPING":
      return t("billingWrappingFee");
    case "STORAGE":
      return t("billingStorageFee");
    case "OUTBOUND":
      return t("billingOutboundFee");
    default:
      return value;
  }
}

function parseDetails(detailsJson: string) {
  if (!detailsJson) return null;
  try {
    return JSON.parse(detailsJson) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function FinanceBillingPage() {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
  const [billingMonth, setBillingMonth] = useState(getCurrentBillingMonth);
  const [selectedCustomerId, setSelectedCustomerId] = useState("all");
  const [rateCards, setRateCards] = useState<CustomerRateCard[]>([]);
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [isRateCardsLoading, setIsRateCardsLoading] = useState(true);
  const [isInvoicesLoading, setIsInvoicesLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingRateCard, setIsSavingRateCard] = useState(false);
  const [pageError, setPageError] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState<BillingInvoice | null>(null);
  const [editingRateCard, setEditingRateCard] = useState<CustomerRateCard | null>(null);
  const [rateCardForm, setRateCardForm] = useState<RateCardFormState>(() => createRateCardForm(null));

  useEffect(() => {
    let active = true;

    async function loadRateCards() {
      setIsRateCardsLoading(true);
      try {
        const nextRateCards = await api.getCustomerRateCards();
        if (!active) return;
        setRateCards(nextRateCards);
      } catch (error) {
        if (!active) return;
        setPageError(getErrorMessage(error, t("couldNotLoadBilling")));
      } finally {
        if (active) {
          setIsRateCardsLoading(false);
        }
      }
    }

    void loadRateCards();
    return () => {
      active = false;
    };
  }, [t]);

  useEffect(() => {
    let active = true;

    async function loadInvoices() {
      setIsInvoicesLoading(true);
      try {
        const nextInvoices = await api.getBillingInvoices(billingMonth);
        if (!active) return;
        setInvoices(nextInvoices);
      } catch (error) {
        if (!active) return;
        setPageError(getErrorMessage(error, t("couldNotLoadBilling")));
      } finally {
        if (active) {
          setIsInvoicesLoading(false);
        }
      }
    }

    void loadInvoices();
    return () => {
      active = false;
    };
  }, [billingMonth, t]);

  const normalizedCustomerId = selectedCustomerId === "all" ? 0 : Number(selectedCustomerId);
  const filteredInvoices = useMemo(
    () => normalizedCustomerId > 0 ? invoices.filter((invoice) => invoice.customerId === normalizedCustomerId) : invoices,
    [invoices, normalizedCustomerId]
  );
  const activeRateCard = useMemo(
    () => normalizedCustomerId > 0 ? rateCards.find((rateCard) => rateCard.customerId === normalizedCustomerId) ?? null : null,
    [normalizedCustomerId, rateCards]
  );
  const totalBilled = useMemo(
    () => filteredInvoices.reduce((total, invoice) => total + invoice.totalAmount, 0),
    [filteredInvoices]
  );
  const storagePalletDays = useMemo(
    () => filteredInvoices.reduce((total, invoice) => total + invoice.storagePalletDays, 0),
    [filteredInvoices]
  );
  const outboundPallets = useMemo(
    () => filteredInvoices.reduce((total, invoice) => total + invoice.outboundPallets, 0),
    [filteredInvoices]
  );

  const invoiceGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noBillingInvoices"),
    emptyDescription: t("financeBillingDesc"),
    loadingTitle: t("loadingRecords"),
    loadingDescription: t("financeBillingDesc")
  });
  const rateCardGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noRateCards"),
    emptyDescription: t("rateCardsDesc"),
    loadingTitle: t("loadingRecords"),
    loadingDescription: t("rateCardsDesc")
  });
  const lineGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noBillingLines"),
    emptyDescription: t("billingLinesDesc"),
    loadingTitle: t("loadingRecords"),
    loadingDescription: t("billingLinesDesc")
  });

  const invoiceColumns = useMemo<GridColDef<BillingInvoice>[]>(() => [
    {
      field: "invoiceNo",
      headerName: t("invoiceNo"),
      minWidth: 180,
      renderCell: (params) => <span className="cell--mono">{params.row.invoiceNo}</span>
    },
    {
      field: "customerName",
      headerName: t("customer"),
      minWidth: 190,
      flex: 1
    },
    {
      field: "billingMonth",
      headerName: t("billingMonth"),
      minWidth: 120,
      renderCell: (params) => <span className="cell--mono">{params.row.billingMonth}</span>
    },
    {
      field: "status",
      headerName: t("status"),
      minWidth: 110,
      renderCell: (params) => (
        <span className="table-status table-status--neutral">{params.row.status}</span>
      )
    },
    {
      field: "storagePalletDays",
      headerName: t("storagePalletDays"),
      minWidth: 140,
      type: "number",
      valueFormatter: (value) => Number(value ?? 0).toFixed(2)
    },
    {
      field: "totalAmount",
      headerName: t("invoiceTotal"),
      minWidth: 140,
      renderCell: (params) => <strong>{formatCurrency(params.row.totalAmount, params.row.currency)}</strong>
    },
    {
      field: "generatedAt",
      headerName: t("generated"),
      minWidth: 190,
      renderCell: (params) => formatDateTimeValue(params.row.generatedAt, resolvedTimeZone)
    },
    {
      field: "actions",
      headerName: t("actions"),
      minWidth: 110,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Button
          size="small"
          variant="text"
          startIcon={<VisibilityOutlinedIcon fontSize="small" />}
          onClick={() => setSelectedInvoice(params.row)}
        >
          {t("viewDetails")}
        </Button>
      )
    }
  ], [resolvedTimeZone, t]);

  const rateCardColumns = useMemo<GridColDef<CustomerRateCard>[]>(() => [
    { field: "customerName", headerName: t("customer"), minWidth: 200, flex: 1 },
    {
      field: "inboundContainerFee",
      headerName: t("inboundContainerFee"),
      minWidth: 150,
      renderCell: (params) => formatCurrency(params.row.inboundContainerFee, "USD")
    },
    {
      field: "wrappingFeePerPallet",
      headerName: t("wrappingFeePerPallet"),
      minWidth: 150,
      renderCell: (params) => formatCurrency(params.row.wrappingFeePerPallet, "USD")
    },
    {
      field: "storageFeePerPalletWeek",
      headerName: t("storageFeePerPalletWeek"),
      minWidth: 180,
      renderCell: (params) => formatCurrency(params.row.storageFeePerPalletWeek, "USD")
    },
    {
      field: "outboundFeePerPallet",
      headerName: t("outboundFeePerPallet"),
      minWidth: 150,
      renderCell: (params) => formatCurrency(params.row.outboundFeePerPallet, "USD")
    },
    {
      field: "isDefault",
      headerName: t("rateSource"),
      minWidth: 130,
      renderCell: (params) => (
        <span className={`table-status ${params.row.isDefault ? "table-status--neutral" : "table-status--success"}`}>
          {params.row.isDefault ? t("defaultRateCard") : t("customRateCard")}
        </span>
      )
    },
    {
      field: "actions",
      headerName: t("actions"),
      minWidth: 110,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Button
          size="small"
          variant="text"
          startIcon={<EditOutlinedIcon fontSize="small" />}
          onClick={() => {
            setEditingRateCard(params.row);
            setRateCardForm(createRateCardForm(params.row));
          }}
        >
          {t("edit")}
        </Button>
      )
    }
  ], [t]);

  const lineColumns = useMemo<GridColDef<BillingInvoiceLine>[]>(() => [
    {
      field: "lineType",
      headerName: t("lineType"),
      minWidth: 160,
      renderCell: (params) => formatLineType(params.row.lineType, t)
    },
    {
      field: "label",
      headerName: t("description"),
      minWidth: 260,
      flex: 1.2
    },
    {
      field: "containerNo",
      headerName: t("containerNo"),
      minWidth: 150,
      renderCell: (params) => params.row.containerNo || "-"
    },
    {
      field: "servicePeriod",
      headerName: t("servicePeriod"),
      minWidth: 220,
      valueGetter: (_, row) => {
        if (!row.servicePeriodStart && !row.servicePeriodEnd) {
          return "-";
        }
        return `${row.servicePeriodStart ?? "-"} -> ${row.servicePeriodEnd ?? "-"}`;
      }
    },
    {
      field: "quantity",
      headerName: t("quantity"),
      minWidth: 110,
      type: "number",
      valueFormatter: (value) => Number(value ?? 0).toFixed(2)
    },
    {
      field: "unitRate",
      headerName: t("unitRate"),
      minWidth: 120,
      renderCell: (params) => formatCurrency(params.row.unitRate, selectedInvoice?.currency ?? "USD")
    },
    {
      field: "amount",
      headerName: t("amount"),
      minWidth: 120,
      renderCell: (params) => formatCurrency(params.row.amount, selectedInvoice?.currency ?? "USD")
    }
  ], [selectedInvoice?.currency, t]);

  async function reloadRateCards() {
    setIsRateCardsLoading(true);
    try {
      const nextRateCards = await api.getCustomerRateCards();
      setRateCards(nextRateCards);
      setPageError("");
    } catch (error) {
      setPageError(getErrorMessage(error, t("couldNotLoadBilling")));
    } finally {
      setIsRateCardsLoading(false);
    }
  }

  async function reloadInvoices() {
    setIsInvoicesLoading(true);
    try {
      const nextInvoices = await api.getBillingInvoices(billingMonth);
      setInvoices(nextInvoices);
      setPageError("");
    } catch (error) {
      setPageError(getErrorMessage(error, t("couldNotLoadBilling")));
    } finally {
      setIsInvoicesLoading(false);
    }
  }

  async function handleGenerateInvoices() {
    setIsGenerating(true);
    try {
      await api.generateBillingInvoices({
        billingMonth,
        customerId: normalizedCustomerId > 0 ? normalizedCustomerId : undefined
      });
      const refreshedInvoices = await api.getBillingInvoices(billingMonth);
      setInvoices(refreshedInvoices);
      showSuccess(t("generatedInvoicesSuccess"));
      setPageError("");
    } catch (error) {
      const message = getErrorMessage(error, t("couldNotGenerateInvoices"));
      setPageError(message);
      showError(message);
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSaveRateCard() {
    if (!editingRateCard) return;

    setIsSavingRateCard(true);
    try {
      const saved = await api.updateCustomerRateCard(editingRateCard.customerId, rateCardForm);
      setRateCards((current) => current.map((rateCard) => rateCard.customerId === saved.customerId ? saved : rateCard));
      setEditingRateCard(null);
      showSuccess(t("rateCardSavedSuccess"));
      setPageError("");
    } catch (error) {
      const message = getErrorMessage(error, t("couldNotSaveRateCard"));
      setPageError(message);
      showError(message);
    } finally {
      setIsSavingRateCard(false);
    }
  }

  const selectedInvoiceDetails = useMemo(
    () => selectedInvoice?.lines.map((line) => ({
      ...line,
      parsedDetails: parseDetails(line.detailsJson)
    })) ?? [],
    [selectedInvoice]
  );

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <WorkspacePanelHeader
          title={t("financeBilling")}
          description={t("financeBillingDesc")}
          errorMessage={pageError}
          actions={(
            <div className="report-toolbar">
              <label className="report-toolbar__field">
                <span>{t("billingMonth")}</span>
                <input
                  type="month"
                  value={billingMonth}
                  onChange={(event) => setBillingMonth(event.target.value || getCurrentBillingMonth())}
                />
              </label>
              <label className="report-toolbar__field">
                <span>{t("customer")}</span>
                <select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}>
                  <option value="all">{t("allCustomers")}</option>
                  {rateCards.map((rateCard) => (
                    <option key={rateCard.customerId} value={String(rateCard.customerId)}>
                      {rateCard.customerName}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                size="small"
                variant="outlined"
                startIcon={<RefreshOutlinedIcon fontSize="small" />}
                onClick={() => {
                  void reloadRateCards();
                  void reloadInvoices();
                }}
              >
                {t("refresh")}
              </Button>
              <Button
                size="small"
                variant="contained"
                onClick={() => void handleGenerateInvoices()}
                disabled={isGenerating || !billingMonth}
              >
                {isGenerating ? t("loadingRecords") : t("generateInvoices")}
              </Button>
            </div>
          )}
        />

        <div className="report-card-grid" style={{ marginBottom: "1rem" }}>
          <article className="metric-card">
            <span>{t("invoiceCount")}</span>
            <strong>{filteredInvoices.length}</strong>
          </article>
          <article className="metric-card">
            <span>{t("invoiceTotal")}</span>
            <strong>{formatCurrency(totalBilled, "USD")}</strong>
          </article>
          <article className="metric-card">
            <span>{t("storagePalletDays")}</span>
            <strong>{storagePalletDays.toFixed(2)}</strong>
          </article>
          <article className="metric-card">
            <span>{t("outboundPallets")}</span>
            <strong>{outboundPallets.toFixed(2)}</strong>
          </article>
        </div>

        {activeRateCard ? (
          <Box sx={{ mb: 2 }} className="status-panel">
            <div className="status-panel__header">
              <div>
                <strong>{t("activeRateCard")}</strong>
                <p>{activeRateCard.customerName}</p>
              </div>
              <Button
                size="small"
                variant="text"
                startIcon={<EditOutlinedIcon fontSize="small" />}
                onClick={() => {
                  setEditingRateCard(activeRateCard);
                  setRateCardForm(createRateCardForm(activeRateCard));
                }}
              >
                {t("editRateCard")}
              </Button>
            </div>
            <div className="status-panel__metrics">
              <span>{t("inboundContainerFee")}: {formatCurrency(activeRateCard.inboundContainerFee, "USD")}</span>
              <span>{t("wrappingFeePerPallet")}: {formatCurrency(activeRateCard.wrappingFeePerPallet, "USD")}</span>
              <span>{t("storageFeePerPalletWeek")}: {formatCurrency(activeRateCard.storageFeePerPalletWeek, "USD")}</span>
              <span>{t("outboundFeePerPallet")}: {formatCurrency(activeRateCard.outboundFeePerPallet, "USD")}</span>
            </div>
          </Box>
        ) : null}

        <div className="report-detail-grid">
          <section className="report-detail-grid__main">
            <div className="workbook-panel workbook-panel--nested">
              <WorkspacePanelHeader
                title={t("customerInvoices")}
                description={t("customerInvoicesDesc")}
              />
              <DataGrid
                autoHeight
                disableRowSelectionOnClick
                density="compact"
                loading={isInvoicesLoading}
                rows={filteredInvoices}
                columns={invoiceColumns}
                getRowId={(row) => row.id}
                pageSizeOptions={[10, 25, 50]}
                initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                slots={invoiceGridSlots}
              />
            </div>
          </section>

          <aside className="report-detail-grid__side">
            <div className="workbook-panel workbook-panel--nested">
              <WorkspacePanelHeader
                title={t("rateCards")}
                description={t("rateCardsDesc")}
              />
              <DataGrid
                autoHeight
                disableRowSelectionOnClick
                density="compact"
                loading={isRateCardsLoading}
                rows={rateCards}
                columns={rateCardColumns}
                getRowId={(row) => row.customerId}
                hideFooter
                slots={rateCardGridSlots}
              />
            </div>
          </aside>
        </div>

        {feedbackToast}
      </section>

      <Drawer anchor="right" open={Boolean(selectedInvoice)} onClose={() => setSelectedInvoice(null)}>
        <div className="document-drawer">
          <div className="document-drawer__header">
            <div>
              <p className="document-drawer__eyebrow">{t("financeBilling")}</p>
              <h2>{selectedInvoice?.invoiceNo ?? t("invoiceNo")}</h2>
              <p className="document-drawer__meta">
                {selectedInvoice ? `${selectedInvoice.customerName} · ${selectedInvoice.billingMonth}` : ""}
              </p>
            </div>
            <IconButton onClick={() => setSelectedInvoice(null)} size="small">
              <CloseIcon fontSize="small" />
            </IconButton>
          </div>

          {!selectedInvoice ? (
            <WorkspaceDrawerLoadingState />
          ) : (
            <div className="document-drawer__content">
              <div className="document-drawer__summary-grid">
                <article className="document-drawer__summary-card">
                  <span>{t("invoiceTotal")}</span>
                  <strong>{formatCurrency(selectedInvoice.totalAmount, selectedInvoice.currency)}</strong>
                </article>
                <article className="document-drawer__summary-card">
                  <span>{t("storagePalletDays")}</span>
                  <strong>{selectedInvoice.storagePalletDays.toFixed(2)}</strong>
                </article>
                <article className="document-drawer__summary-card">
                  <span>{t("generated")}</span>
                  <strong>{formatDateTimeValue(selectedInvoice.generatedAt, resolvedTimeZone)}</strong>
                </article>
              </div>

              <DataGrid
                autoHeight
                disableRowSelectionOnClick
                density="compact"
                rows={selectedInvoiceDetails}
                columns={lineColumns}
                getRowId={(row) => row.id || `${row.lineType}-${row.sortOrder}`}
                hideFooter
                slots={lineGridSlots}
              />

              <div className="status-panel" style={{ marginTop: "1rem" }}>
                <div className="status-panel__header">
                  <div>
                    <strong>{t("billingDetails")}</strong>
                    <p>{t("billingDetailsDesc")}</p>
                  </div>
                </div>
                <div className="status-panel__list">
                  {selectedInvoiceDetails.map((line) => (
                    <div key={`${line.lineType}-${line.sortOrder}`} className="status-panel__list-item">
                      <div>
                        <strong>{line.label}</strong>
                        <p>{formatLineType(line.lineType, t)}</p>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <strong>{formatCurrency(line.amount, selectedInvoice.currency)}</strong>
                        <p>{line.parsedDetails ? JSON.stringify(line.parsedDetails) : "-"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </Drawer>

      <Dialog open={Boolean(editingRateCard)} onClose={() => setEditingRateCard(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{t("editRateCard")}</DialogTitle>
        <DialogContent sx={{ display: "grid", gap: 2, pt: 2 }}>
          {editingRateCard ? (
            <InlineAlert>{editingRateCard.customerName}</InlineAlert>
          ) : null}
          <TextField
            label={t("inboundContainerFee")}
            type="number"
            value={rateCardForm.inboundContainerFee}
            onChange={(event) => setRateCardForm((current) => ({ ...current, inboundContainerFee: Number(event.target.value || 0) }))}
            inputProps={{ step: "0.01", min: 0 }}
          />
          <TextField
            label={t("wrappingFeePerPallet")}
            type="number"
            value={rateCardForm.wrappingFeePerPallet}
            onChange={(event) => setRateCardForm((current) => ({ ...current, wrappingFeePerPallet: Number(event.target.value || 0) }))}
            inputProps={{ step: "0.01", min: 0 }}
          />
          <TextField
            label={t("storageFeePerPalletWeek")}
            type="number"
            value={rateCardForm.storageFeePerPalletWeek}
            onChange={(event) => setRateCardForm((current) => ({ ...current, storageFeePerPalletWeek: Number(event.target.value || 0) }))}
            inputProps={{ step: "0.01", min: 0 }}
          />
          <TextField
            label={t("outboundFeePerPallet")}
            type="number"
            value={rateCardForm.outboundFeePerPallet}
            onChange={(event) => setRateCardForm((current) => ({ ...current, outboundFeePerPallet: Number(event.target.value || 0) }))}
            inputProps={{ step: "0.01", min: 0 }}
          />
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, pt: 1 }}>
            <Button variant="text" onClick={() => setEditingRateCard(null)}>{t("cancel")}</Button>
            <Button variant="contained" onClick={() => void handleSaveRateCard()} disabled={isSavingRateCard}>
              {isSavingRateCard ? t("loadingRecords") : t("saveChanges")}
            </Button>
          </Box>
        </DialogContent>
      </Dialog>
    </main>
  );
}
