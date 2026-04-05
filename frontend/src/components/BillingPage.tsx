import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import { Button } from "@mui/material";
import { BarChart } from "@mui/x-charts";
import { useEffect, useMemo, useState } from "react";

import { ApiError, api } from "../lib/api";
import { setBillingWorkspaceContext } from "../lib/billingWorkspaceContext";
import {
  buildBillingPreview,
  DEFAULT_BILLING_RATES,
  getCurrentBillingDateRange,
  type BillingInvoiceLine,
  type BillingRates,
  type BillingStorageRow
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
  onOpenBillingContainerDetail: (startDate: string, endDate: string, customerId: number | "all", containerNo: string) => void;
};

type BillingContainerSummaryRow = {
  customerId: number;
  customerName: string;
  containerNo: string;
  references: string[];
  warehousesTouched: string[];
  inboundAmount: number;
  wrappingAmount: number;
  storageAmount: number;
  outboundAmount: number;
  totalAmount: number;
};

export function BillingPage({ customers, inboundDocuments, outboundDocuments, onOpenBillingContainerDetail }: BillingPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const [selectedStartDate, setSelectedStartDate] = useState(() => getCurrentBillingDateRange().startDate);
  const [selectedEndDate, setSelectedEndDate] = useState(() => getCurrentBillingDateRange().endDate);
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
          api.getPallets(50000),
          api.getPalletLocationEvents(50000)
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
  useEffect(() => {
    setBillingWorkspaceContext({
      startDate: selectedStartDate,
      endDate: selectedEndDate,
      customerId,
      rates
    });
  }, [customerId, rates, selectedEndDate, selectedStartDate]);

  const billingPreview = useMemo(() => buildBillingPreview({
    startDate: selectedStartDate,
    endDate: selectedEndDate,
    customerId,
    customers,
    pallets,
    palletLocationEvents,
    inboundDocuments,
    outboundDocuments,
    rates
  }), [customerId, customers, inboundDocuments, outboundDocuments, palletLocationEvents, pallets, rates, selectedEndDate, selectedStartDate]);
  const containerSummaryRows = useMemo(
    () => buildBillingContainerSummaryRows(billingPreview.invoiceLines, billingPreview.storageRows),
    [billingPreview.invoiceLines, billingPreview.storageRows]
  );

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
          void Promise.all([api.getPallets(50000), api.getPalletLocationEvents(50000)])
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
            {t("fromDate")}
            <input type="date" value={selectedStartDate} onChange={(event) => setSelectedStartDate(event.target.value)} />
          </label>
          <label>
            {t("toDate")}
            <input type="date" value={selectedEndDate} onChange={(event) => setSelectedEndDate(event.target.value)} />
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
                  series={[{ dataKey: "palletCount", label: t("billingDayEndPallets"), color: "#274c77" }]}
                  hideLegend
                  grid={{ horizontal: true }}
                />
              </div>
            ) : (
              <WorkspaceTableEmptyState title={t("noBillingData")} description={t("dailyPalletBalanceDesc")} />
            )}
            <div className="sheet-note sheet-note--readonly" style={{ marginTop: "1rem" }}>
              <strong>{t("billingCalculationFormula")}</strong>
              <br />
              {t("billingStorageFormulaHint", {
                palletDays: formatNumber(billingPreview.summary.palletDays),
                dailyRate: formatMoney(rates.storageFeePerPalletPerWeek / 7)
              })}
            </div>
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
            <h3>{t("billingContainerTrace")}</h3>
            <p>{t("billingContainerTraceDesc")}</p>
            </div>
          {containerSummaryRows.length === 0 ? (
            <WorkspaceTableEmptyState title={t("noBillingData")} description={t("billingContainerTraceDesc")} />
            ) : (
            <div className="sheet-table-wrap">
            <table className="sheet-table" aria-label={t("billingContainerTrace")}>
              <thead>
              <tr>
                <th>{t("containerNo")}</th>
                <th>{t("customer")}</th>
                <th>{t("reference")}</th>
                <th>{t("currentStorage")}</th>
                <th>{t("billingInboundCharges")}</th>
                <th>{t("billingWrappingCharges")}</th>
                <th>{t("billingStorageCharges")}</th>
                <th>{t("billingOutboundCharges")}</th>
                <th>{t("amount")}</th>
                <th>{t("actions")}</th>
              </tr>
              </thead>
              <tbody>
              {containerSummaryRows.map((row) => (
                <tr key={`${row.customerId}-${row.containerNo}`}>
                <td className="cell--mono">{row.containerNo}</td>
                <td>{row.customerName}</td>
                <td>{renderReferencePreview(row.references)}</td>
                <td>{row.warehousesTouched.join(", ") || "-"}</td>
                <td className="cell--mono">{formatMoney(row.inboundAmount)}</td>
                <td className="cell--mono">{formatMoney(row.wrappingAmount)}</td>
                <td className="cell--mono">{formatMoney(row.storageAmount)}</td>
                <td className="cell--mono">{formatMoney(row.outboundAmount)}</td>
                <td className="cell--mono">{formatMoney(row.totalAmount)}</td>
                <td>
                  {isNavigableContainerNo(row.containerNo) ? (
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => onOpenBillingContainerDetail(billingPreview.startDate, billingPreview.endDate, customerId, row.containerNo)}
                  >
                    {t("billingViewContainerInvoice")}
                  </Button>
                  ) : "-"}
                </td>
                </tr>
              ))}
              </tbody>
            </table>
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

function buildBillingContainerSummaryRows(invoiceLines: BillingInvoiceLine[], storageRows: BillingStorageRow[]) {
  const rowMap = new Map<string, BillingContainerSummaryRow & { referenceSet: Set<string>; warehouseSet: Set<string> }>();

  for (const line of invoiceLines) {
    const containerNo = normalizeContainerNo(line.containerNo);
    if (!isNavigableContainerNo(containerNo)) {
      continue;
    }
    const rowKey = `${line.customerId}|${containerNo}`;
    const row = rowMap.get(rowKey) ?? {
      customerId: line.customerId,
      customerName: line.customerName,
      containerNo,
      references: [],
      warehousesTouched: [],
      inboundAmount: 0,
      wrappingAmount: 0,
      storageAmount: 0,
      outboundAmount: 0,
      totalAmount: 0,
      referenceSet: new Set<string>(),
      warehouseSet: new Set<string>()
    };

    if (line.reference.trim()) {
      row.referenceSet.add(line.reference.trim());
    }
    if (line.warehouseSummary.trim() && line.warehouseSummary.trim() !== "-") {
      row.warehouseSet.add(line.warehouseSummary.trim());
    }

    switch (line.chargeType) {
      case "INBOUND":
        row.inboundAmount += line.amount;
        break;
      case "WRAPPING":
        row.wrappingAmount += line.amount;
        break;
      case "STORAGE":
        row.storageAmount += line.amount;
        break;
      case "OUTBOUND":
        row.outboundAmount += line.amount;
        break;
    }
    row.totalAmount += line.amount;
    rowMap.set(rowKey, row);
  }

  for (const storageRow of storageRows) {
    const containerNo = normalizeContainerNo(storageRow.containerNo);
    if (!isNavigableContainerNo(containerNo)) {
      continue;
    }
    const rowKey = `${storageRow.customerId}|${containerNo}`;
    const row = rowMap.get(rowKey) ?? {
      customerId: storageRow.customerId,
      customerName: storageRow.customerName,
      containerNo,
      references: [],
      warehousesTouched: [],
      inboundAmount: 0,
      wrappingAmount: 0,
      storageAmount: 0,
      outboundAmount: 0,
      totalAmount: 0,
      referenceSet: new Set<string>(),
      warehouseSet: new Set<string>()
    };
    for (const warehouse of storageRow.warehousesTouched) {
      if (warehouse.trim()) {
        row.warehouseSet.add(warehouse.trim());
      }
    }
    row.storageAmount = Math.max(row.storageAmount, storageRow.amount);
    row.totalAmount = row.inboundAmount + row.wrappingAmount + row.storageAmount + row.outboundAmount;
    rowMap.set(rowKey, row);
  }

  return [...rowMap.values()]
    .map((row) => ({
      customerId: row.customerId,
      customerName: row.customerName,
      containerNo: row.containerNo,
      references: [...row.referenceSet].sort((left, right) => left.localeCompare(right)),
      warehousesTouched: [...row.warehouseSet].sort((left, right) => left.localeCompare(right)),
      inboundAmount: row.inboundAmount,
      wrappingAmount: row.wrappingAmount,
      storageAmount: row.storageAmount,
      outboundAmount: row.outboundAmount,
      totalAmount: row.totalAmount
    }))
    .sort((left, right) => {
      if (left.customerName !== right.customerName) {
        return left.customerName.localeCompare(right.customerName);
      }
      if (left.totalAmount !== right.totalAmount) {
        return right.totalAmount - left.totalAmount;
      }
      return left.containerNo.localeCompare(right.containerNo);
    });
}

function renderReferencePreview(references: string[]) {
  if (references.length === 0) {
    return "-";
  }
  if (references.length <= 2) {
    return references.join(", ");
  }
  return `${references.slice(0, 2).join(", ")} +${references.length - 2}`;
}

function normalizeContainerNo(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase();
}

function isNavigableContainerNo(containerNo: string) {
  return containerNo.trim() !== "" && containerNo.trim() !== "-" && containerNo.trim().toUpperCase() !== "UNASSIGNED";
}
