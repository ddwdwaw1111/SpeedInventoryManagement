import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import { Button } from "@mui/material";
import { BarChart } from "@mui/x-charts";
import { useEffect, useMemo, useState } from "react";

import { ApiError, api } from "../lib/api";
import {
  buildBillingPreview,
  DEFAULT_BILLING_RATES,
  getCurrentMonthInputValue,
  type BillingRates
} from "../lib/billingPreview";
import { formatDateTimeValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type { Customer, InboundDocument, OutboundDocument, PalletLocationEvent, PalletTrace } from "../lib/types";
import { WorkspacePanelHeader, WorkspaceTableEmptyState } from "./WorkspacePanelChrome";

type BillingPageProps = {
  customers: Customer[];
  inboundDocuments: InboundDocument[];
  outboundDocuments: OutboundDocument[];
};

export function BillingPage({ customers, inboundDocuments, outboundDocuments }: BillingPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const [selectedMonth, setSelectedMonth] = useState(() => getCurrentMonthInputValue());
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("all");
  const [rates, setRates] = useState<BillingRates>(DEFAULT_BILLING_RATES);
  const [pallets, setPallets] = useState<PalletTrace[]>([]);
  const [palletLocationEvents, setPalletLocationEvents] = useState<PalletLocationEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function loadBillingData() {
      setIsLoading(true);
      setErrorMessage("");
      try {
        const [nextPallets, nextEvents] = await Promise.all([
          api.getPallets(5000),
          api.getPalletLocationEvents(5000)
        ]);
        if (!active) {
          return;
        }
        setPallets(nextPallets);
        setPalletLocationEvents(nextEvents);
      } catch (error) {
        if (!active) {
          return;
        }
        setErrorMessage(getErrorMessage(error, t("couldNotLoadReport")));
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadBillingData();
    return () => {
      active = false;
    };
  }, [t]);

  const customerId = selectedCustomerId === "all" ? "all" : Number(selectedCustomerId);
  const billingPreview = useMemo(() => buildBillingPreview({
    month: selectedMonth,
    customerId,
    customers,
    pallets,
    palletLocationEvents,
    inboundDocuments,
    outboundDocuments,
    rates
  }), [customerId, customers, inboundDocuments, outboundDocuments, palletLocationEvents, pallets, rates, selectedMonth]);

  const dailyBalanceDataset = useMemo(
    () => billingPreview.dailyBalanceRows.map((row) => ({
      label: row.date.slice(-2),
      palletCount: row.palletCount
    })),
    [billingPreview.dailyBalanceRows]
  );

  const rateActions = (
    <div className="sheet-actions">
      <Button
        size="small"
        variant="outlined"
        startIcon={<RefreshOutlinedIcon fontSize="small" />}
        onClick={() => {
          setIsLoading(true);
          void Promise.all([api.getPallets(5000), api.getPalletLocationEvents(5000)])
            .then(([nextPallets, nextEvents]) => {
              setPallets(nextPallets);
              setPalletLocationEvents(nextEvents);
              setErrorMessage("");
            })
            .catch((error) => setErrorMessage(getErrorMessage(error, t("couldNotLoadReport"))))
            .finally(() => setIsLoading(false));
        }}
      >
        {t("refresh")}
      </Button>
    </div>
  );

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <WorkspacePanelHeader
            title={t("billingPage")}
            description={t("billingPageDesc")}
            errorMessage={errorMessage}
            notices={[
              <span key="assumption">{t("billingDayEndNotice")}</span>
            ]}
            actions={rateActions}
          />
        </div>

        <div className="filter-bar">
          <label>
            {t("billingMonth")}
            <input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} />
          </label>
          <label>
            {t("customer")}
            <select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}>
              <option value="all">{t("allCustomers")}</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="report-grid">
          <article className="report-card">
            <div className="report-card__header">
              <h3>{t("billingRateCard")}</h3>
              <p>{t("billingRateCardDesc")}</p>
            </div>
            <div className="sheet-form">
              <label>
                {t("billingInboundContainerFee")}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={rates.inboundContainerFee}
                  onChange={(event) => setRates((current) => ({ ...current, inboundContainerFee: toNumber(event.target.value) }))}
                />
              </label>
              <label>
                {t("billingWrappingFee")}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={rates.wrappingFeePerPallet}
                  onChange={(event) => setRates((current) => ({ ...current, wrappingFeePerPallet: toNumber(event.target.value) }))}
                />
              </label>
              <label>
                {t("billingStorageRate")}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={rates.storageFeePerPalletPerWeek}
                  onChange={(event) => setRates((current) => ({ ...current, storageFeePerPalletPerWeek: toNumber(event.target.value) }))}
                />
              </label>
              <label>
                {t("billingOutboundFee")}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={rates.outboundFeePerPallet}
                  onChange={(event) => setRates((current) => ({ ...current, outboundFeePerPallet: toNumber(event.target.value) }))}
                />
              </label>
            </div>
            <div className="sheet-note" style={{ marginTop: "1rem" }}>
              <strong>{t("billingCustomerScope")}</strong>
              <br />
              {billingPreview.customerName}
            </div>
          </article>

          <article className="report-card">
            <div className="report-card__header">
              <h3>{t("dailyPalletBalance")}</h3>
              <p>{t("dailyPalletBalanceDesc")}</p>
            </div>
            {isLoading ? (
              <div className="empty-state">{t("loadingRecords")}</div>
            ) : billingPreview.dailyBalanceRows.some((row) => row.palletCount > 0) ? (
              <div className="report-chart-wrap">
                <BarChart
                  dataset={dailyBalanceDataset}
                  height={300}
                  margin={{ top: 20, bottom: 20, left: 36, right: 12 }}
                  xAxis={[{ scaleType: "band", dataKey: "label" }]}
                  series={[{ dataKey: "palletCount", label: t("palletDays"), color: "#274c77" }]}
                  hideLegend
                  grid={{ horizontal: true }}
                />
              </div>
            ) : (
              <WorkspaceTableEmptyState title={t("noBillingData")} description={t("dailyPalletBalanceDesc")} />
            )}
          </article>
        </div>

        <div className="metric-ribbon" style={{ padding: "0 1rem 1rem" }}>
          <article className="metric-card">
            <span>{t("billingReceivedContainers")}</span>
            <strong>{formatNumber(billingPreview.summary.receivedContainers)}</strong>
          </article>
          <article className="metric-card">
            <span>{t("billingReceivedPallets")}</span>
            <strong>{formatNumber(billingPreview.summary.receivedPallets)}</strong>
          </article>
          <article className="metric-card">
            <span>{t("palletDays")}</span>
            <strong>{formatNumber(billingPreview.summary.palletDays)}</strong>
          </article>
          <article className="metric-card">
            <span>{t("billingGrandTotal")}</span>
            <strong>{formatMoney(billingPreview.summary.grandTotal)}</strong>
          </article>
        </div>

        <div className="report-grid" style={{ paddingTop: 0 }}>
          <article className="report-card">
            <div className="report-card__header">
              <h3>{t("billingChargeSummary")}</h3>
              <p>{t("billingChargeSummaryDesc")}</p>
            </div>
            <div className="report-bars report-bars--summary">
              {[
                { label: t("billingInboundCharges"), value: billingPreview.summary.inboundAmount },
                { label: t("billingWrappingCharges"), value: billingPreview.summary.wrappingAmount },
                { label: t("billingStorageCharges"), value: billingPreview.summary.storageAmount },
                { label: t("billingOutboundCharges"), value: billingPreview.summary.outboundAmount }
              ].map((row) => (
                <div className="report-bars__row" key={row.label}>
                  <div className="report-bars__labels">
                    <strong>{row.label}</strong>
                  </div>
                  <div className="report-bars__value">{formatMoney(row.value)}</div>
                </div>
              ))}
            </div>
          </article>

          <article className="report-card">
            <div className="report-card__header">
              <h3>{t("billingStorageCharges")}</h3>
              <p>{t("billingStorageChargesDesc")}</p>
            </div>
            {billingPreview.storageRows.length === 0 ? (
              <WorkspaceTableEmptyState title={t("noBillingData")} description={t("billingStorageChargesDesc")} />
            ) : (
              <div className="report-bars report-bars--summary">
                {billingPreview.storageRows.map((row) => (
                  <div className="report-bars__row" key={`${row.customerId}-${row.containerNo}`}>
                    <div className="report-bars__labels">
                      <strong>{row.containerNo}</strong>
                      <span>{row.warehousesTouched.join(", ") || "-"}</span>
                    </div>
                    <div className="report-bars__value">
                      {formatNumber(row.palletDays)} PD / {formatMoney(row.amount)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>

        <section className="workbook-panel" style={{ margin: "0 1rem 1rem" }}>
          <WorkspacePanelHeader
            title={t("billingInvoicePreview")}
            description={t("billingInvoicePreviewDesc")}
          />
          {billingPreview.invoiceLines.length === 0 ? (
            <WorkspaceTableEmptyState title={t("noBillingData")} description={t("billingInvoicePreviewDesc")} />
          ) : (
            <div className="sheet-table-wrap">
              <table className="sheet-table">
                <thead>
                  <tr>
                    <th>{t("customer")}</th>
                    <th>{t("chargeType")}</th>
                    <th>{t("reference")}</th>
                    <th>{t("containerNo")}</th>
                    <th>{t("currentStorage")}</th>
                    <th>{t("quantity")}</th>
                    <th>{t("unitRate")}</th>
                    <th>{t("amount")}</th>
                    <th>{t("notes")}</th>
                    <th>{t("created")}</th>
                  </tr>
                </thead>
                <tbody>
                  {billingPreview.invoiceLines.map((line) => (
                    <tr key={line.id}>
                      <td>{line.customerName}</td>
                      <td>{renderChargeTypeLabel(line.chargeType, t)}</td>
                      <td className="cell--mono">{line.reference}</td>
                      <td className="cell--mono">{line.containerNo}</td>
                      <td>{line.warehouseSummary}</td>
                      <td className="cell--mono">{formatNumber(line.quantity)}</td>
                      <td className="cell--mono">{formatMoney(line.unitRate)}</td>
                      <td className="cell--mono">{formatMoney(line.amount)}</td>
                      <td>{line.meta}</td>
                      <td>{line.occurredOn ? formatDateTimeValue(line.occurredOn, resolvedTimeZone, { dateStyle: "medium" }) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function renderChargeTypeLabel(chargeType: "INBOUND" | "WRAPPING" | "STORAGE" | "OUTBOUND", t: (key: string) => string) {
  switch (chargeType) {
    case "INBOUND":
      return t("billingInboundCharges");
    case "WRAPPING":
      return t("billingWrappingCharges");
    case "STORAGE":
      return t("billingStorageCharges");
    case "OUTBOUND":
      return t("billingOutboundCharges");
    default:
      return chargeType;
  }
}

function toNumber(value: string) {
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
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

function getErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message || fallbackMessage;
  }
  return fallbackMessage;
}
