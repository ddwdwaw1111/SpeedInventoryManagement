import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import { Button } from "@mui/material";
import { useMemo } from "react";

import { readBillingWorkspaceContext } from "../lib/billingWorkspaceContext";
import {
	buildBillingPreview,
	DEFAULT_BILLING_RATES,
	type BillingInvoiceLine,
	type BillingRates,
	type BillingStorageRow
} from "../lib/billingPreview";
import { formatDateTimeValue } from "../lib/dates";
import { formatMoney, formatNumber } from "../lib/formatters";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type { Customer, InboundDocument, Location, OutboundDocument } from "../lib/types";
import { WorkspacePanelHeader, WorkspaceTableEmptyState } from "./WorkspacePanelChrome";

type BillingContainerDetailPageProps = {
	routeKey: string;
	startDate: string;
	endDate: string;
	customerId: number | "all";
	warehouseLocationId: number | "all";
	containerNo: string | null;
	customers: Customer[];
	locations: Location[];
	inboundDocuments: InboundDocument[];
	outboundDocuments: OutboundDocument[];
	onBackToBilling: () => void;
	onOpenContainerDetail: (containerNo: string) => void;
};

export function BillingContainerDetailPage({
	routeKey,
	startDate,
	endDate,
	customerId,
	warehouseLocationId,
	containerNo,
	customers,
	locations,
	inboundDocuments,
	outboundDocuments,
	onBackToBilling,
	onOpenContainerDetail
}: BillingContainerDetailPageProps) {
	const { t } = useI18n();
	const { resolvedTimeZone } = useSettings();
	const normalizedContainerNo = normalizeContainerNo(containerNo);
	const selectedWarehouse = warehouseLocationId === "all"
		? null
		: locations.find((location) => location.id === warehouseLocationId) ?? null;

	const workspaceContext = useMemo(() => readBillingWorkspaceContext(), [routeKey]);
	const activeWorkspaceContext = useMemo(() => {
		if (!workspaceContext) {
			return null;
		}
		if (workspaceContext.startDate !== startDate || workspaceContext.endDate !== endDate) {
			return null;
		}
		if (workspaceContext.customerId !== customerId) {
			return null;
		}
		if (workspaceContext.warehouseLocationId !== warehouseLocationId) {
			return null;
		}
		return workspaceContext;
	}, [customerId, endDate, startDate, warehouseLocationId, workspaceContext]);
	const activeRates: BillingRates = activeWorkspaceContext?.rates ?? DEFAULT_BILLING_RATES;
	const activeContainerType = activeWorkspaceContext?.containerType ?? "all";
	const activeNormalPalletGracePeriodEnabled = activeWorkspaceContext?.normalPalletGracePeriodEnabled ?? true;

	const billingPreview = useMemo(() => buildBillingPreview({
		startDate,
		endDate,
		customerId,
		customers,
		inboundDocuments,
		outboundDocuments,
		locationId: warehouseLocationId,
		containerType: activeContainerType,
		normalPalletGracePeriodEnabled: activeNormalPalletGracePeriodEnabled,
		rates: activeRates
	}), [activeContainerType, activeNormalPalletGracePeriodEnabled, activeRates, customerId, customers, endDate, inboundDocuments, outboundDocuments, startDate, warehouseLocationId]);

	const containerInvoiceLines = useMemo(
		() => billingPreview.invoiceLines.filter((line) => normalizeContainerNo(line.containerNo) === normalizedContainerNo),
		[billingPreview.invoiceLines, normalizedContainerNo]
	);
	const containerStorageRow = useMemo(
		() => billingPreview.storageRows.find((row) => normalizeContainerNo(row.containerNo) === normalizedContainerNo) ?? null,
		[billingPreview.storageRows, normalizedContainerNo]
	);
	const references = useMemo(
		() => uniqueStrings(containerInvoiceLines.map((line) => line.reference).filter(Boolean)),
		[containerInvoiceLines]
	);
	const warehouseLabels = useMemo(
		() => uniqueStrings([
			...containerInvoiceLines.map((line) => line.warehouseSummary),
			...(containerStorageRow?.warehousesTouched ?? [])
		].filter(Boolean)),
		[containerInvoiceLines, containerStorageRow]
	);
	const summary = useMemo(() => summarizeContainerBilling(containerInvoiceLines), [containerInvoiceLines]);
	const hasContainerData = containerInvoiceLines.length > 0 || Boolean(containerStorageRow);
	const effectiveContainerType = useMemo(() => {
		if (containerStorageRow) {
			return containerStorageRow.containerType;
		}
		const inboundMatch = inboundDocuments.find((document) => normalizeContainerNo(document.containerNo) === normalizedContainerNo);
		if (inboundMatch?.containerType === "WEST_COAST_TRANSFER") {
			return "WEST_COAST_TRANSFER" as const;
		}
		if (activeContainerType !== "all") {
			return activeContainerType;
		}
		return "NORMAL" as const;
	}, [activeContainerType, containerStorageRow, inboundDocuments, normalizedContainerNo]);
	const storageDailyRate = (
		effectiveContainerType === "WEST_COAST_TRANSFER"
			? activeRates.storageFeePerPalletPerWeekWestCoastTransfer
			: activeRates.storageFeePerPalletPerWeekNormal
	) / 7;

	const headerActions = (
		<div className="sheet-actions">
			<Button size="small" variant="outlined" startIcon={<ArrowBackOutlinedIcon fontSize="small" />} onClick={onBackToBilling}>
				{t("billingPage")}
			</Button>
			{isNavigableContainerNo(normalizedContainerNo) ? (
				<Button size="small" variant="text" startIcon={<OpenInNewRoundedIcon fontSize="small" />} onClick={() => onOpenContainerDetail(normalizedContainerNo)}>
					{t("viewContainerDetail")}
				</Button>
			) : null}
		</div>
	);

	return (
		<main className="workspace-main">
			<section className="workbook-panel workbook-panel--full">
				<div className="tab-strip">
					<WorkspacePanelHeader
						title={`${t("billingContainerDetailPage")} · ${normalizedContainerNo || "-"}`}
						description={t("billingContainerDetailPageDesc")}
						actions={headerActions}
						notices={[
							<span key="billing-start"><strong>{t("fromDate")}:</strong> {startDate}</span>,
							<span key="billing-end"><strong>{t("toDate")}:</strong> {endDate}</span>,
							<span key="billing-scope"><strong>{t("billingCustomerScope")}:</strong> {billingPreview.customerName}</span>,
							<span key="billing-warehouse"><strong>{t("billingWarehouseScope")}:</strong> {selectedWarehouse?.name ?? t("billingAllWarehouses")}</span>,
							<span key="billing-container-type"><strong>{t("billingContainerType")}:</strong> {activeContainerType === "all" ? t("billingAllContainerTypes") : activeContainerType === "WEST_COAST_TRANSFER" ? t("billingContainerTypeWestCoastTransfer") : t("billingContainerTypeNormal")}</span>
						]}
					/>
				</div>

				{!hasContainerData ? (
					<div style={{ padding: "0 1rem 1rem" }}>
						<WorkspaceTableEmptyState title={t("billingNoContainerTraceTitle")} description={t("billingNoContainerTraceDesc")} />
					</div>
				) : (
					<>
						<div className="metric-ribbon" style={{ padding: "0 1rem 1rem" }}>
							<article className="metric-card">
								<span>{t("billingInboundCharges")}</span>
								<strong>{formatMoney(summary.inboundAmount)}</strong>
							</article>
							<article className="metric-card">
								<span>{t("billingWrappingCharges")}</span>
								<strong>{formatMoney(summary.wrappingAmount)}</strong>
							</article>
							<article className="metric-card">
								<span>{t("billingStorageCharges")}</span>
								<strong>{formatMoney(summary.storageAmount)}</strong>
							</article>
							<article className="metric-card">
								<span>{t("billingGrandTotal")}</span>
								<strong>{formatMoney(summary.totalAmount)}</strong>
							</article>
						</div>

						<div className="report-grid" style={{ paddingTop: 0 }}>
							<article className="report-card">
								<div className="report-card__header">
									<h3>{t("billingReferences")}</h3>
									<p>{t("billingContainerTraceDesc")}</p>
								</div>
								<div className="sheet-note sheet-note--readonly">
									<strong>{t("reference")}</strong>
									<br />
									{references.length > 0 ? references.join(", ") : "-"}
								</div>
								<div className="sheet-note sheet-note--readonly" style={{ marginTop: "1rem" }}>
									<strong>{t("billingWarehouseScope")}</strong>
									<br />
									{selectedWarehouse?.name ?? (warehouseLabels.length > 0 ? warehouseLabels.join(", ") : t("billingAllWarehouses"))}
								</div>
							</article>

							<article className="report-card">
								<div className="report-card__header">
									<h3>{t("billingRatesSnapshot")}</h3>
									<p>{t("billingRatesSnapshotDesc")}</p>
								</div>
								<div className="report-bars report-bars--summary">
									{[
										{
											label: effectiveContainerType === "WEST_COAST_TRANSFER" ? t("billingTransferInboundFee") : t("billingInboundContainerFee"),
											value: effectiveContainerType === "WEST_COAST_TRANSFER" ? activeRates.transferInboundFeePerPallet : activeRates.inboundContainerFee
										},
										{
											label: t("billingWrappingFee"),
											value: effectiveContainerType === "WEST_COAST_TRANSFER" ? 0 : activeRates.wrappingFeePerPallet
										},
										{
											label: effectiveContainerType === "WEST_COAST_TRANSFER" ? t("billingStorageRateWestCoast") : t("billingStorageRateNormal"),
											value: effectiveContainerType === "WEST_COAST_TRANSFER"
												? activeRates.storageFeePerPalletPerWeekWestCoastTransfer
												: activeRates.storageFeePerPalletPerWeekNormal
										}
									].map((row) => (
										<div className="report-bars__row" key={row.label}>
											<div className="report-bars__labels"><strong>{row.label}</strong></div>
											<div className="report-bars__value">{formatMoney(row.value)}</div>
										</div>
									))}
								</div>
							</article>

							<article className="report-card">
								<div className="report-card__header">
									<h3>{t("billingStorageInsight")}</h3>
									<p>{t("billingStorageInsightDesc")}</p>
								</div>
								<div className="report-bars report-bars--summary">
									<div className="report-bars__row">
										<div className="report-bars__labels"><strong>{t("billingTrackedPallets")}</strong></div>
										<div className="report-bars__value">{formatNumber(containerStorageRow?.palletsTracked ?? 0)}</div>
									</div>
									<div className="report-bars__row">
										<div className="report-bars__labels"><strong>{t("palletDays")}</strong></div>
										<div className="report-bars__value">{formatNumber(containerStorageRow?.palletDays ?? 0)}</div>
									</div>
									<div className="report-bars__row">
										<div className="report-bars__labels"><strong>{t("billingDailyStorageRate")}</strong></div>
										<div className="report-bars__value">{formatMoney(storageDailyRate)}</div>
									</div>
									<div className="report-bars__row">
										<div className="report-bars__labels"><strong>{t("billingStorageCharges")}</strong></div>
										<div className="report-bars__value">{formatMoney(containerStorageRow?.amount ?? 0)}</div>
									</div>
								</div>
								<div className="sheet-note sheet-note--readonly" style={{ marginTop: "1rem" }}>
									<strong>{t("billingCalculationFormula")}</strong>
									<br />
									{t("billingStorageFormulaHint", {
										palletDays: formatNumber(containerStorageRow?.palletDays ?? 0),
										dailyRate: formatMoney(storageDailyRate)
									})}
								</div>
							</article>
						</div>

						<section className="workbook-panel" style={{ margin: "0 1rem 1rem" }}>
							<WorkspacePanelHeader title={t("billingStorageTimeline")} description={t("billingStorageTimelineDesc")} />
							{!containerStorageRow || containerStorageRow.segments.length === 0 ? (
								<WorkspaceTableEmptyState title={t("noBillingData")} description={t("billingStorageTimelineDesc")} />
							) : (
								<div className="sheet-table-wrap">
									<table className="sheet-table" aria-label={t("billingStorageTimeline")}>
										<thead>
											<tr>
												<th>{t("fromDate")}</th>
												<th>{t("toDate")}</th>
												<th>{t("billingDayEndPallets")}</th>
												<th>{t("billingBilledDays")}</th>
												<th>{t("palletDays")}</th>
												<th>{t("amount")}</th>
											</tr>
										</thead>
										<tbody>
											{containerStorageRow.segments.map((segment) => (
												<tr key={`${segment.startDate}-${segment.endDate}-${segment.dayEndPallets}`}>
													<td className="cell--mono">{formatDateTimeValue(segment.startDate, resolvedTimeZone, { dateStyle: "medium" })}</td>
													<td className="cell--mono">{formatDateTimeValue(segment.endDate, resolvedTimeZone, { dateStyle: "medium" })}</td>
													<td className="cell--mono">{formatNumber(segment.dayEndPallets)}</td>
													<td className="cell--mono">{formatNumber(segment.billedDays)}</td>
													<td className="cell--mono">{formatNumber(segment.palletDays)}</td>
													<td className="cell--mono">{formatMoney(segment.amount)}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							)}
						</section>

						<section className="workbook-panel" style={{ margin: "0 1rem 1rem" }}>
							<WorkspacePanelHeader title={t("billingInvoicePreview")} description={t("billingInvoicePreviewDesc")} />
							{containerInvoiceLines.length === 0 ? (
								<WorkspaceTableEmptyState title={t("noBillingData")} description={t("billingInvoicePreviewDesc")} />
							) : (
								<div className="sheet-table-wrap">
									<table className="sheet-table" aria-label={t("billingInvoicePreview")}>
										<thead>
											<tr>
												<th>{t("chargeType")}</th>
												<th>{t("reference")}</th>
												<th>{t("currentStorage")}</th>
												<th>{t("quantity")}</th>
												<th>{t("unitRate")}</th>
												<th>{t("amount")}</th>
												<th>{t("created")}</th>
											</tr>
										</thead>
										<tbody>
											{containerInvoiceLines.map((line) => (
												<tr key={line.id}>
													<td>{renderChargeTypeLabel(line.chargeType, t)}</td>
													<td className="cell--mono">{line.reference}</td>
													<td>{line.warehouseSummary || "-"}</td>
													<td className="cell--mono">{formatNumber(line.quantity)}</td>
													<td className="cell--mono">{formatMoney(line.unitRate)}</td>
													<td className="cell--mono">{formatMoney(line.amount)}</td>
													<td>{line.occurredOn ? formatDateTimeValue(line.occurredOn, resolvedTimeZone, { dateStyle: "medium" }) : "-"}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							)}
						</section>
					</>
				)}
			</section>
		</main>
	);
}

function summarizeContainerBilling(lines: BillingInvoiceLine[]) {
	return lines.reduce(
		(summary, line) => {
			switch (line.chargeType) {
				case "INBOUND":
					summary.inboundAmount += line.amount;
					break;
				case "WRAPPING":
					summary.wrappingAmount += line.amount;
					break;
				case "STORAGE":
					summary.storageAmount += line.amount;
					break;
				case "OUTBOUND":
					summary.outboundAmount += line.amount;
					break;
			}
			summary.totalAmount += line.amount;
			return summary;
		},
		{ inboundAmount: 0, wrappingAmount: 0, storageAmount: 0, outboundAmount: 0, totalAmount: 0 }
	);
}

function normalizeContainerNo(value: string | null | undefined) {
	return (value ?? "").trim().toUpperCase();
}

function uniqueStrings(values: string[]) {
	return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function renderChargeTypeLabel(chargeType: BillingInvoiceLine["chargeType"], t: (key: string) => string) {
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

function isNavigableContainerNo(containerNo: string) {
	return containerNo.trim() !== "" && containerNo.trim() !== "-" && containerNo.trim().toUpperCase() !== "UNASSIGNED";
}
