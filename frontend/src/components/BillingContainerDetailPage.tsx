import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import { Button } from "@mui/material";
import { useEffect, useMemo, useState } from "react";

import { ApiError, api } from "../lib/api";
import { readBillingWorkspaceContext } from "../lib/billingWorkspaceContext";
import {
	buildBillingPreview,
	DEFAULT_BILLING_RATES,
	type BillingInvoiceLine,
	type BillingRates,
	type BillingStorageRow
} from "../lib/billingPreview";
import { formatDateTimeValue, parseDateLikeValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type { Customer, InboundDocument, Movement, OutboundDocument, PalletLocationEvent, PalletTrace } from "../lib/types";
import { WorkspacePanelHeader, WorkspaceTableEmptyState } from "./WorkspacePanelChrome";

type BillingContainerDetailPageProps = {
	routeKey: string;
	startDate: string;
	endDate: string;
	customerId: number | "all";
	containerNo: string | null;
	customers: Customer[];
	inboundDocuments: InboundDocument[];
	outboundDocuments: OutboundDocument[];
	movements: Movement[];
	onBackToBilling: () => void;
	onOpenContainerDetail: (containerNo: string) => void;
};

type ContainerTimelineRow = {
	id: string;
	palletId: number;
	palletCode: string;
	eventType: string;
	locationLabel: string;
	quantityDelta: number;
	palletDelta: number;
	runningQuantityDelta: number;
	runningPalletDelta: number;
	eventTime: string;
};

export function BillingContainerDetailPage({
	routeKey,
	startDate,
	endDate,
	customerId,
	containerNo,
	customers,
	inboundDocuments,
	outboundDocuments,
	movements,
	onBackToBilling,
	onOpenContainerDetail
}: BillingContainerDetailPageProps) {
	const { t } = useI18n();
	const { resolvedTimeZone } = useSettings();
	const normalizedContainerNo = normalizeContainerNo(containerNo);
	const [pallets, setPallets] = useState<PalletTrace[]>([]);
	const [palletLocationEvents, setPalletLocationEvents] = useState<PalletLocationEvent[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [errorMessage, setErrorMessage] = useState("");

	const workspaceContext = useMemo(() => readBillingWorkspaceContext(), [routeKey]);
	const activeRates: BillingRates = useMemo(() => {
		if (!workspaceContext) {
			return DEFAULT_BILLING_RATES;
		}
		if (workspaceContext.startDate !== startDate || workspaceContext.endDate !== endDate) {
			return DEFAULT_BILLING_RATES;
		}
		if (workspaceContext.customerId !== customerId) {
			return DEFAULT_BILLING_RATES;
		}
		return workspaceContext.rates;
	}, [customerId, endDate, startDate, workspaceContext]);

	useEffect(() => {
		let active = true;

		if (!normalizedContainerNo) {
			setPallets([]);
			setPalletLocationEvents([]);
			setIsLoading(false);
			setErrorMessage("");
			return () => {
				active = false;
			};
		}

		async function loadDetailData() {
			setIsLoading(true);
			setErrorMessage("");
			try {
				const [nextPallets, nextEvents] = await Promise.all([
					api.getPallets(50000),
					api.getPalletLocationEvents(50000, normalizedContainerNo)
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

		void loadDetailData();
		return () => {
			active = false;
		};
	}, [normalizedContainerNo, routeKey, t]);

	const billingPreview = useMemo(() => buildBillingPreview({
		startDate,
		endDate,
		customerId,
		customers,
		pallets,
		palletLocationEvents,
		inboundDocuments,
		outboundDocuments,
		rates: activeRates
	}), [activeRates, customerId, customers, endDate, inboundDocuments, outboundDocuments, palletLocationEvents, pallets, startDate]);

	const containerInvoiceLines = useMemo(
		() => billingPreview.invoiceLines.filter((line) => normalizeContainerNo(line.containerNo) === normalizedContainerNo),
		[billingPreview.invoiceLines, normalizedContainerNo]
	);
	const containerStorageRow = useMemo(
		() => billingPreview.storageRows.find((row) => normalizeContainerNo(row.containerNo) === normalizedContainerNo) ?? null,
		[billingPreview.storageRows, normalizedContainerNo]
	);
	const timelineRows = useMemo(
		() => buildContainerTimelineRows(palletLocationEvents, movements, normalizedContainerNo, startDate, endDate),
		[endDate, movements, normalizedContainerNo, palletLocationEvents, startDate]
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
	const timelineSummary = useMemo(() => summarizeTimeline(timelineRows), [timelineRows]);
	const hasContainerData = containerInvoiceLines.length > 0 || timelineRows.length > 0 || Boolean(containerStorageRow);
	const storageDailyRate = activeRates.storageFeePerPalletPerWeek / 7;

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
						errorMessage={errorMessage}
						actions={headerActions}
						notices={[
							<span key="billing-start"><strong>{t("fromDate")}:</strong> {startDate}</span>,
							<span key="billing-end"><strong>{t("toDate")}:</strong> {endDate}</span>,
							<span key="billing-scope"><strong>{t("billingCustomerScope")}:</strong> {billingPreview.customerName}</span>
						]}
					/>
				</div>

				{isLoading ? (
					<div className="empty-state">{t("loadingRecords")}</div>
				) : !hasContainerData ? (
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
								<span>{t("billingOutboundCharges")}</span>
								<strong>{formatMoney(summary.outboundAmount)}</strong>
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
									<strong>{t("currentStorage")}</strong>
									<br />
									{warehouseLabels.length > 0 ? warehouseLabels.join(", ") : "-"}
								</div>
							</article>

							<article className="report-card">
								<div className="report-card__header">
									<h3>{t("billingRatesSnapshot")}</h3>
									<p>{t("billingRatesSnapshotDesc")}</p>
								</div>
								<div className="report-bars report-bars--summary">
									{[
										{ label: t("billingInboundContainerFee"), value: activeRates.inboundContainerFee },
										{ label: t("billingWrappingFee"), value: activeRates.wrappingFeePerPallet },
										{ label: t("billingStorageRate"), value: activeRates.storageFeePerPalletPerWeek },
										{ label: t("billingOutboundFee"), value: activeRates.outboundFeePerPallet }
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
							<WorkspacePanelHeader title={t("billingPalletTimeline")} description={t("billingPalletTimelineDesc")} />
							<div className="metric-ribbon" style={{ padding: "0 0 1rem" }}>
								<article className="metric-card">
									<span>{t("billingTimelineEventCount")}</span>
									<strong>{formatNumber(timelineSummary.eventCount)}</strong>
								</article>
								<article className="metric-card">
									<span>{t("billingTimelineNetQuantity")}</span>
									<strong>{formatSignedNumber(timelineSummary.netQuantityDelta)}</strong>
								</article>
								<article className="metric-card">
									<span>{t("billingTimelineNetPallets")}</span>
									<strong>{formatSignedNumber(timelineSummary.netPalletDelta)}</strong>
								</article>
							</div>
							{timelineRows.length === 0 ? (
								<WorkspaceTableEmptyState title={t("billingNoPalletTimelineTitle")} description={t("billingNoPalletTimelineDesc")} />
							) : (
								<div className="sheet-table-wrap">
									<table className="sheet-table" aria-label={t("billingPalletTimeline")}>
										<thead>
											<tr>
												<th>{t("activityDate")}</th>
												<th>{t("palletCode")}</th>
												<th>{t("billingEventType")}</th>
												<th>{t("currentStorage")}</th>
												<th>{t("billingQuantityDelta")}</th>
												<th>{t("billingPalletDelta")}</th>
												<th>{t("billingRunningQuantityDelta")}</th>
												<th>{t("billingRunningPalletDelta")}</th>
											</tr>
										</thead>
										<tbody>
											{timelineRows.map((row) => (
												<tr key={row.id}>
													<td className="cell--mono">{formatDateTimeValue(row.eventTime, resolvedTimeZone, { dateStyle: "medium", timeStyle: "short" })}</td>
													<td className="cell--mono">{row.palletCode || `#${row.palletId}`}</td>
													<td>{row.eventType}</td>
													<td>{row.locationLabel}</td>
													<td className="cell--mono">{formatSignedNumber(row.quantityDelta)}</td>
													<td className="cell--mono">{formatSignedNumber(row.palletDelta)}</td>
													<td className="cell--mono">{formatSignedNumber(row.runningQuantityDelta)}</td>
													<td className="cell--mono">{formatSignedNumber(row.runningPalletDelta)}</td>
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

function buildContainerTimelineRows(events: PalletLocationEvent[], movements: Movement[], containerNo: string, startDate: string, endDate: string) {
	const filteredEvents = events
		.filter((event) => normalizeContainerNo(event.containerNo) === containerNo)
		.filter((event) => isWithinDateRange(event.eventTime, startDate, endDate))
		.map((event) => ({
			id: `ple-${event.id}`,
			palletId: event.palletId,
			palletCode: event.palletCode,
			eventType: event.eventType,
			locationLabel: summarizeLocation(event.locationName, event.storageSection),
			quantityDelta: event.quantityDelta,
			palletDelta: event.palletDelta,
			eventTime: event.eventTime
		}));

	const hasOutboundEvents = filteredEvents.some((event) => event.eventType === "OUTBOUND" || event.eventType === "REVERSAL");
	const fallbackOutboundRows = hasOutboundEvents
		? []
		: movements
			.filter((movement) => normalizeContainerNo(movement.containerNo) === containerNo)
			.filter((movement) => movement.movementType === "OUT" || movement.movementType === "REVERSAL")
			.filter((movement) => isWithinDateRange(movement.outDate ?? movement.createdAt, startDate, endDate))
			.map((movement) => ({
				id: `mv-${movement.id}`,
				palletId: 0,
				palletCode: movement.referenceCode || movement.itemNumber || movement.sku || "-",
				eventType: movement.movementType === "OUT" ? "OUTBOUND" : "REVERSAL",
				locationLabel: summarizeLocation(movement.locationName, movement.storageSection),
				quantityDelta: movement.quantityChange,
				palletDelta: movement.movementType === "OUT" ? -Math.abs(movement.pallets) : Math.abs(movement.pallets),
				eventTime: movement.outDate || movement.createdAt
			}));

	const mergedEvents = [...filteredEvents, ...fallbackOutboundRows].sort((left, right) => {
		const leftTime = parseDateLikeValue(left.eventTime)?.getTime() ?? 0;
		const rightTime = parseDateLikeValue(right.eventTime)?.getTime() ?? 0;
		if (leftTime !== rightTime) {
			return leftTime - rightTime;
		}
		return left.id.localeCompare(right.id);
	});

	let runningQuantityDelta = 0;
	let runningPalletDelta = 0;
	return mergedEvents.map((event) => {
		runningQuantityDelta += event.quantityDelta;
		runningPalletDelta += event.palletDelta;
		return {
			id: event.id,
			palletId: event.palletId,
			palletCode: event.palletCode,
			eventType: event.eventType,
			locationLabel: event.locationLabel,
			quantityDelta: event.quantityDelta,
			palletDelta: event.palletDelta,
			runningQuantityDelta,
			runningPalletDelta,
			eventTime: event.eventTime
		} satisfies ContainerTimelineRow;
	});
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

function summarizeTimeline(rows: ContainerTimelineRow[]) {
	return rows.reduce(
		(summary, row) => {
			summary.eventCount += 1;
			summary.netQuantityDelta += row.quantityDelta;
			summary.netPalletDelta += row.palletDelta;
			return summary;
		},
		{ eventCount: 0, netQuantityDelta: 0, netPalletDelta: 0 }
	);
}

function normalizeContainerNo(value: string | null | undefined) {
	return (value ?? "").trim().toUpperCase();
}

function summarizeLocation(locationName: string | null | undefined, storageSection: string | null | undefined) {
	const normalizedLocation = (locationName ?? "").trim();
	if (!normalizedLocation) {
		return "-";
	}
	const normalizedSection = (storageSection ?? "").trim().toUpperCase();
	return normalizedSection ? `${normalizedLocation} / ${normalizedSection}` : normalizedLocation;
}

function isWithinDateRange(value: string | null | undefined, startDate: string, endDate: string) {
	const parsed = parseDateLikeValue(value ?? undefined);
	if (!parsed) {
		return false;
	}
	const parsedStart = parseDateLikeValue(startDate);
	const parsedEnd = parseDateLikeValue(endDate);
	if (!parsedStart || !parsedEnd) {
		return false;
	}
	const [safeStart, safeEnd] = parsedStart.getTime() <= parsedEnd.getTime()
		? [parsedStart.getTime(), parsedEnd.getTime()]
		: [parsedEnd.getTime(), parsedStart.getTime()];
	const eventTime = parsed.getTime();
	return eventTime >= safeStart && eventTime <= safeEnd + 86400000 - 1;
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

function formatSignedNumber(value: number) {
	if (value > 0) {
		return `+${formatNumber(value)}`;
	}
	return formatNumber(value);
}

function isNavigableContainerNo(containerNo: string) {
	return containerNo.trim() !== "" && containerNo.trim() !== "-" && containerNo.trim().toUpperCase() !== "UNASSIGNED";
}

function getErrorMessage(error: unknown, fallbackMessage: string) {
	if (error instanceof ApiError || error instanceof Error) {
		return error.message || fallbackMessage;
	}
	return fallbackMessage;
}
