import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import LabelImportantOutlinedIcon from "@mui/icons-material/LabelImportantOutlined";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import MoveToInboxOutlinedIcon from "@mui/icons-material/MoveToInboxOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { type ChangeEvent, type ReactNode, useMemo, useRef, useState } from "react";

import { api } from "../lib/api";
import { setPendingActivityManagementLaunchContext } from "../lib/activityManagementLaunchContext";
import { formatDateValue, normalizeCalendarDate, shiftIsoDate, toIsoDateString } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import type { PageKey } from "../lib/routes";
import type { InboundDocument, OutboundDocument, UserRole } from "../lib/types";
import { useFeedbackToast } from "./Feedback";
import { WorkspacePanelHeader } from "./WorkspacePanelChrome";

type DailyOperationsPageProps = {
  selectedDate: string;
  inboundDocuments: InboundDocument[];
  outboundDocuments: OutboundDocument[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onNavigate: (page: PageKey) => void;
  onOpenDate: (date: string) => void;
  onOpenInboundDetail: (documentId: number) => void;
  onOpenCreateInboundReceipt: (date: string) => void;
  onOpenCreateOutboundComposer: (date: string) => void;
  onOpenInboundReceiptEditor: (documentId?: number | null) => void;
};

type DailyOperationsRow = {
  rowKey: string;
  id: number;
  code: string;
  counterpart: string;
  warehouse: string;
  dateLabel: string;
  trackingLabel: string;
  metaLabel: string;
  tone: "emerald" | "blue" | "amber" | "slate";
  nextActionLabel: string | null;
  nextTrackingStatus: string | null;
  workflowSteps: string[];
  workflowStepIndex: number;
};

export function DailyOperationsPage({
  selectedDate,
  inboundDocuments,
  outboundDocuments,
  currentUserRole,
  isLoading,
  onRefresh,
  onNavigate,
  onOpenDate,
  onOpenInboundDetail,
  onOpenCreateInboundReceipt,
  onOpenCreateOutboundComposer,
  onOpenInboundReceiptEditor
}: DailyOperationsPageProps) {
  const { t } = useI18n();
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
  const canManage = currentUserRole === "admin" || currentUserRole === "operator";
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null);
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const activeDate = normalizeCalendarDate(selectedDate) ?? toIsoDateString(new Date());
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" }),
    []
  );
  const shortDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }),
    []
  );
  const activeDateLabel = formatDateValue(activeDate, dateFormatter);
  const isToday = activeDate === toIsoDateString(new Date());
  const previousDate = shiftIsoDate(activeDate, -1);
  const nextDate = shiftIsoDate(activeDate, 1);

  const inboundRows = useMemo(
    () =>
      inboundDocuments
        .filter((document) => isPendingDocument(document.status) && getInboundDateKey(document) === activeDate)
        .slice()
        .sort(compareDocumentsByUpdatedAt)
        .map((document) => ({
          ...getInboundWorkflowState(document, t),
          rowKey: `inbound-${document.id}`,
          id: document.id,
          code: document.containerNo || `RCV-${document.id}`,
          counterpart: document.customerName || "-",
          warehouse: `${document.locationName}${document.storageSection ? ` / ${document.storageSection}` : ""}`,
          dateLabel: formatDateValue(document.deliveryDate || activeDate, shortDateFormatter),
          trackingLabel: formatInboundTrackingStatusLabel(document.trackingStatus, document.status, t),
          metaLabel: t("dailyOperationsReceiptMeta", {
            lines: document.totalLines,
            qty: document.totalReceivedQty
          }),
          tone: toneFromInboundTracking(document.trackingStatus, document.status)
        })),
    [activeDate, inboundDocuments, shortDateFormatter, t]
  );

  const outboundRows = useMemo(
    () =>
      outboundDocuments
        .filter((document) => isPendingDocument(document.status) && getOutboundDateKey(document) === activeDate)
        .slice()
        .sort(compareDocumentsByUpdatedAt)
        .map((document) => ({
          ...getOutboundWorkflowState(document, t),
          rowKey: `outbound-${document.id}`,
          id: document.id,
          code: document.packingListNo || `SHP-${document.id}`,
          counterpart: document.shipToName || document.customerName || "-",
          warehouse: document.storages || "-",
          dateLabel: formatDateValue(document.outDate || activeDate, shortDateFormatter),
          trackingLabel: formatOutboundTrackingStatusLabel(document.trackingStatus, document.status, t),
          metaLabel: t("dailyOperationsShipmentMeta", {
            lines: document.totalLines,
            qty: document.totalQty
          }),
          tone: toneFromOutboundTracking(document.trackingStatus, document.status)
        })),
    [activeDate, outboundDocuments, shortDateFormatter, t]
  );

  const summaryCards = useMemo(
    () => [
      {
        key: "receipts",
        label: t("dailyOperationsReceipts"),
        value: inboundRows.length,
        meta: t("dailyOperationsSummaryScheduledMeta", { date: activeDateLabel }),
        tone: "emerald" as const,
        icon: <MoveToInboxOutlinedIcon sx={{ fontSize: 18 }} />
      },
      {
        key: "shipments",
        label: t("dailyOperationsShipments"),
        value: outboundRows.length,
        meta: t("dailyOperationsSummaryScheduledMeta", { date: activeDateLabel }),
        tone: "blue" as const,
        icon: <LocalShippingOutlinedIcon sx={{ fontSize: 18 }} />
      },
      {
        key: "receiving",
        label: t("dailyOperationsReceivingInProgress"),
        value: inboundRows.filter((row) => row.tone === "amber").length,
        meta: t("dailyOperationsSummaryReceivingMeta"),
        tone: "amber" as const,
        icon: <MoveToInboxOutlinedIcon sx={{ fontSize: 18 }} />
      },
      {
        key: "shipping",
        label: t("dailyOperationsShippingInProgress"),
        value: outboundRows.filter((row) => row.tone === "amber").length,
        meta: t("dailyOperationsSummaryShippingMeta"),
        tone: "slate" as const,
        icon: <LocalShippingOutlinedIcon sx={{ fontSize: 18 }} />
      }
    ],
    [activeDateLabel, inboundRows, outboundRows, t]
  );

  function handleCreateInbound() {
    onOpenCreateInboundReceipt(activeDate);
  }

  function handleCreateOutbound() {
    onOpenCreateOutboundComposer(activeDate);
  }

  function handleOpenInbound(documentId: number) {
    onOpenInboundDetail(documentId);
  }

  function handleOpenOutbound(documentId: number) {
    setPendingActivityManagementLaunchContext("OUT", { documentId });
    onNavigate("outbound-management");
  }

  function handleOpenDatePicker() {
    const input = dateInputRef.current;
    if (!input) {
      return;
    }

    if (typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }

    input.click();
  }

  function handleDateInputChange(event: ChangeEvent<HTMLInputElement>) {
    const value = normalizeCalendarDate(event.target.value);
    if (value) {
      onOpenDate(value);
    }
  }

  async function handleAdvanceInbound(row: DailyOperationsRow) {
    if (!canManage || !row.nextTrackingStatus) {
      return;
    }

    setBusyActionKey(`advance-${row.rowKey}`);
    try {
      await api.updateInboundDocumentTrackingStatus(row.id, { trackingStatus: row.nextTrackingStatus });
      await onRefresh();
      showSuccess(t("receiptTrackingUpdatedSuccess"));
    } catch (error) {
      showError(error instanceof Error && error.message ? error.message : t("couldNotUpdateDocumentStatus"));
    } finally {
      setBusyActionKey(null);
    }
  }

  async function handleAdvanceOutbound(row: DailyOperationsRow) {
    if (!canManage || !row.nextTrackingStatus) {
      return;
    }

    setBusyActionKey(`advance-${row.rowKey}`);
    try {
      await api.updateOutboundDocumentTrackingStatus(row.id, { trackingStatus: row.nextTrackingStatus });
      await onRefresh();
      showSuccess(t("shipmentTrackingUpdatedSuccess"));
    } catch (error) {
      showError(error instanceof Error && error.message ? error.message : t("couldNotUpdateDocumentStatus"));
    } finally {
      setBusyActionKey(null);
    }
  }

  async function handleCopyInbound(row: DailyOperationsRow) {
    if (!canManage) {
      return;
    }

    setBusyActionKey(`copy-${row.rowKey}`);
    try {
      const copiedDocument = await api.copyInboundDocument(row.id);
      await onRefresh();
      showSuccess(t("receiptCopiedSuccess"));
      onOpenInboundReceiptEditor(copiedDocument.id);
    } catch (error) {
      showError(error instanceof Error && error.message ? error.message : t("couldNotCopyDocument"));
    } finally {
      setBusyActionKey(null);
    }
  }

  async function handleCopyOutbound(row: DailyOperationsRow) {
    if (!canManage) {
      return;
    }

    setBusyActionKey(`copy-${row.rowKey}`);
    try {
      const copiedDocument = await api.copyOutboundDocument(row.id);
      await onRefresh();
      showSuccess(t("shipmentCopiedSuccess"));
      setPendingActivityManagementLaunchContext("OUT", { documentId: copiedDocument.id });
      onNavigate("outbound-management");
    } catch (error) {
      showError(error instanceof Error && error.message ? error.message : t("couldNotCopyDocument"));
    } finally {
      setBusyActionKey(null);
    }
  }

  return (
    <main className="workspace-main">
      <div className="space-y-6 pb-6">
        <section className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,#f3f8ff_0%,#eef4fb_100%)] px-5 py-5 shadow-[0_18px_48px_rgba(10,31,68,0.06)]">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2.5">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 ring-1 ring-slate-200/70">
                <span>{t("dashboardCalendarTitle")}</span>
              </div>
              <div>
                <h1 className="font-headline text-3xl font-extrabold tracking-tight text-[#0d2d63]">
                  {t("dailyOperationsTitle")}
                </h1>
                <p className="mt-1.5 max-w-3xl text-sm text-slate-600">
                  {t("dailyOperationsSubtitle", { date: activeDateLabel })}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onOpenDate(previousDate)}
                className="interactive-button-lift inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50"
                aria-label={t("previousDay")}
              >
                <ChevronLeftRoundedIcon fontSize="small" />
              </button>
              <button
                type="button"
                onClick={handleOpenDatePicker}
                className="interactive-button-lift rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#143569] ring-1 ring-slate-200 transition hover:bg-slate-50"
              >
                {activeDateLabel}
                {isToday ? (
                  <span className="ml-2 rounded-full bg-[#143569] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
                    {t("today")}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => onOpenDate(nextDate)}
                className="interactive-button-lift inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50"
                aria-label={t("nextDay")}
              >
                <ChevronRightRoundedIcon fontSize="small" />
              </button>
              <input
                ref={dateInputRef}
                type="date"
                value={activeDate}
                onChange={handleDateInputChange}
                className="sr-only"
                aria-hidden="true"
                tabIndex={-1}
              />
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {summaryCards.map((card) => (
              <article key={card.key} className="rounded-[18px] border border-slate-200/80 bg-white p-3 shadow-[0_10px_22px_rgba(15,23,42,0.04)]">
                <div className="flex items-start justify-between gap-4">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${summaryToneIconClass(card.tone)}`}>
                    <span className="text-[#143569]">{card.icon}</span>
                  </div>
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${summaryToneBadgeClass(card.tone)}`}>
                    {card.label}
                  </span>
                </div>
                <div className="mt-4">
                  <div className="text-2xl font-extrabold tracking-tight text-[#0d2d63]">{card.value}</div>
                  <div className="mt-1 text-xs text-slate-500">{card.meta}</div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-2">
          <DailyOperationsSection
            title={t("dailyOperationsReceipts")}
            description={t("dailyOperationsReceiptsDesc")}
            actionLabel={t("dailyOperationsCreateReceipt")}
            actionIcon={<AddCircleOutlineOutlinedIcon sx={{ fontSize: 18 }} />}
            actionDisabled={!canManage}
            onAction={handleCreateInbound}
            rows={inboundRows}
            isLoading={isLoading}
            emptyLabel={t("dailyOperationsNoReceipts")}
            onOpenRow={handleOpenInbound}
            copyLabel={null}
            canManage={canManage}
            onAdvanceRow={handleAdvanceInbound}
            onCopyRow={handleCopyInbound}
            busyActionKey={busyActionKey}
          />
          <DailyOperationsSection
            title={t("dailyOperationsShipments")}
            description={t("dailyOperationsShipmentsDesc")}
            actionLabel={t("dailyOperationsCreateShipment")}
            actionIcon={<AddCircleOutlineOutlinedIcon sx={{ fontSize: 18 }} />}
            actionDisabled={!canManage}
            onAction={handleCreateOutbound}
            rows={outboundRows}
            isLoading={isLoading}
            emptyLabel={t("dailyOperationsNoShipments")}
            onOpenRow={handleOpenOutbound}
            copyLabel={t("copyShipment")}
            canManage={canManage}
            onAdvanceRow={handleAdvanceOutbound}
            onCopyRow={handleCopyOutbound}
            busyActionKey={busyActionKey}
          />
        </div>
        {feedbackToast}
      </div>
    </main>
  );
}

function DailyOperationsSection({
  title,
  description,
  actionLabel,
  actionIcon,
  actionDisabled,
  onAction,
  rows,
  isLoading,
  emptyLabel,
  onOpenRow,
  copyLabel,
  canManage,
  onAdvanceRow,
  onCopyRow,
  busyActionKey
}: {
  title: string;
  description: string;
  actionLabel: string;
  actionIcon: ReactNode;
  actionDisabled: boolean;
  onAction: () => void;
  rows: DailyOperationsRow[];
  isLoading: boolean;
  emptyLabel: string;
  onOpenRow: (documentId: number) => void;
  copyLabel: string | null;
  canManage: boolean;
  onAdvanceRow: (row: DailyOperationsRow) => void;
  onCopyRow: (row: DailyOperationsRow) => void;
  busyActionKey: string | null;
}) {
  const { t } = useI18n();

  return (
    <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_16px_34px_rgba(15,23,42,0.05)]">
      <WorkspacePanelHeader
        title={title}
        description={description}
        actions={(
          <button
            type="button"
            onClick={onAction}
            disabled={actionDisabled}
            className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-[#143569] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(20,53,105,0.18)] transition hover:bg-[#102f5f] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {actionIcon}
            {actionLabel}
          </button>
        )}
      />

      {isLoading ? (
        <div className="mt-4 space-y-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="rounded-[18px] border border-slate-200/80 bg-slate-50/80 px-4 py-4 animate-pulse">
              <div className="flex items-center justify-between gap-3">
                <div className="h-5 w-28 rounded-full bg-slate-200" />
                <div className="h-9 w-24 rounded-xl bg-slate-200" />
              </div>
              <div className="mt-4 h-4 w-3/5 rounded-full bg-slate-200" />
              <div className="mt-2 h-3 w-4/5 rounded-full bg-slate-200" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-4 rounded-[18px] border border-dashed border-slate-300 bg-slate-50/80 px-5 py-10 text-center text-sm text-slate-500">
          {emptyLabel}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((row) => (
            <article
              key={row.id}
              className="interactive-block interactive-block--slate rounded-[18px] border border-slate-200/80 bg-slate-50/80 px-4 py-4 shadow-[0_8px_22px_rgba(15,23,42,0.03)]"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-[#143569] ring-1 ring-slate-200">
                      {row.code}
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${toneBadgeClass(row.tone)}`}>
                      {row.trackingLabel}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-slate-900">{row.counterpart}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {row.warehouse} / {row.dateLabel} / {row.metaLabel}
                  </p>
                  <MinimalWorkflowStepper
                    steps={row.workflowSteps}
                    currentStepIndex={row.workflowStepIndex}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {canManage && row.nextActionLabel ? (
                    <button
                      type="button"
                      onClick={() => onAdvanceRow(row)}
                      disabled={busyActionKey === `advance-${row.rowKey}`}
                      className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-[#143569] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(20,53,105,0.14)] transition hover:bg-[#102f5f] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <ChevronRightRoundedIcon sx={{ fontSize: 18 }} />
                      {row.nextActionLabel}
                    </button>
                  ) : null}
                  {canManage && copyLabel ? (
                    <button
                      type="button"
                      onClick={() => onCopyRow(row)}
                      disabled={busyActionKey === `copy-${row.rowKey}`}
                      className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#143569] ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <ContentCopyOutlinedIcon sx={{ fontSize: 18 }} />
                      {copyLabel}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onOpenRow(row.id)}
                    className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#143569] ring-1 ring-slate-200 transition hover:bg-slate-50"
                  >
                    <VisibilityOutlinedIcon sx={{ fontSize: 18 }} />
                    {t("details")}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function MinimalWorkflowStepper({
  steps,
  currentStepIndex
}: {
  steps: string[];
  currentStepIndex: number;
}) {
  return (
    <div className="mt-3.5">
      <div className="grid grid-cols-2 gap-0 md:grid-cols-4">
        {steps.map((step, index) => {
          const isComplete = index < currentStepIndex;
          const isCurrent = index === currentStepIndex;

          return (
              <div key={`${step}-${index}`} className="min-w-0">
                <div className="flex min-w-0 items-center gap-0">
                  <span
                    className={`inline-flex min-h-7 items-center rounded-md px-2 py-1 text-[9px] font-semibold uppercase leading-none tracking-[0.12em] ${
                      isCurrent
                        ? "bg-[#e9ddc8] text-[#143569]"
                        : isComplete
                        ? "bg-[rgb(209_250_229_/_var(--tw-bg-opacity,1))] text-[#143569]"
                        : "bg-[#e4e8ed] text-[#143569]"
                  }`}
                >
                  {step}
                  </span>
                  {index < steps.length - 1 ? (
                    <LabelImportantOutlinedIcon
                      aria-hidden="true"
                      className="shrink-0 text-[#143569]"
                      sx={{ fontSize: 14 }}
                    />
                  ) : null}
                </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function normalizeDocumentStatus(status: string) {
  return (status || "").trim().toUpperCase();
}

function isPendingDocument(status: string) {
  const normalizedStatus = normalizeDocumentStatus(status);
  return normalizedStatus !== "CONFIRMED" && normalizedStatus !== "CANCELLED" && normalizedStatus !== "ARCHIVED";
}

function normalizeInboundTrackingStatus(trackingStatus: string, documentStatus: string) {
  if (normalizeDocumentStatus(documentStatus) === "CONFIRMED") {
    return "RECEIVED";
  }
  const normalizedTrackingStatus = (trackingStatus || "").trim().toUpperCase();
  if (normalizedTrackingStatus === "ARRIVED" || normalizedTrackingStatus === "RECEIVING" || normalizedTrackingStatus === "RECEIVED") {
    return normalizedTrackingStatus;
  }
  return "SCHEDULED";
}

function normalizeOutboundTrackingStatus(trackingStatus: string, documentStatus: string) {
  if (normalizeDocumentStatus(documentStatus) === "CONFIRMED") {
    return "SHIPPED";
  }
  const normalizedTrackingStatus = (trackingStatus || "").trim().toUpperCase();
  if (normalizedTrackingStatus === "PICKING" || normalizedTrackingStatus === "PACKED" || normalizedTrackingStatus === "SHIPPED") {
    return normalizedTrackingStatus;
  }
  return "SCHEDULED";
}

function formatInboundTrackingStatusLabel(trackingStatus: string, documentStatus: string, t: (key: string) => string) {
  switch (normalizeInboundTrackingStatus(trackingStatus, documentStatus)) {
    case "ARRIVED":
      return t("arrived");
    case "RECEIVING":
      return t("receiving");
    case "RECEIVED":
      return t("receivedTracking");
    default:
      return t("scheduled");
  }
}

function formatOutboundTrackingStatusLabel(trackingStatus: string, documentStatus: string, t: (key: string) => string) {
  switch (normalizeOutboundTrackingStatus(trackingStatus, documentStatus)) {
    case "PICKING":
      return t("picking");
    case "PACKED":
      return t("packed");
    case "SHIPPED":
      return t("shipped");
    default:
      return t("scheduled");
  }
}

function toneFromInboundTracking(trackingStatus: string, documentStatus: string) {
  switch (normalizeInboundTrackingStatus(trackingStatus, documentStatus)) {
    case "ARRIVED":
    case "RECEIVING":
      return "amber" as const;
    case "RECEIVED":
      return "emerald" as const;
    default:
      return "blue" as const;
  }
}

function toneFromOutboundTracking(trackingStatus: string, documentStatus: string) {
  switch (normalizeOutboundTrackingStatus(trackingStatus, documentStatus)) {
    case "PICKING":
    case "PACKED":
      return "amber" as const;
    case "SHIPPED":
      return "emerald" as const;
    default:
      return "slate" as const;
  }
}

function summaryToneIconClass(tone: "emerald" | "blue" | "amber" | "slate") {
  switch (tone) {
    case "emerald":
      return "bg-emerald-100 text-emerald-700";
    case "amber":
      return "bg-amber-100 text-amber-700";
    case "slate":
      return "bg-slate-200 text-slate-700";
    default:
      return "bg-blue-100 text-blue-700";
  }
}

function summaryToneBadgeClass(tone: "emerald" | "blue" | "amber" | "slate") {
  switch (tone) {
    case "emerald":
      return "bg-emerald-50 text-emerald-700";
    case "amber":
      return "bg-amber-50 text-amber-700";
    case "slate":
      return "bg-slate-100 text-slate-600";
    default:
      return "bg-blue-50 text-[#143569]";
  }
}

function toneBadgeClass(tone: "emerald" | "blue" | "amber" | "slate") {
  switch (tone) {
    case "emerald":
      return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100";
    case "amber":
      return "bg-amber-50 text-amber-700 ring-1 ring-amber-100";
    case "slate":
      return "bg-slate-100 text-slate-600 ring-1 ring-slate-200";
    default:
      return "bg-blue-50 text-[#143569] ring-1 ring-blue-100";
  }
}

function getInboundTrackingAction(document: Pick<InboundDocument, "trackingStatus" | "status">, t: (key: string) => string) {
  switch (normalizeInboundTrackingStatus(document.trackingStatus, document.status)) {
    case "SCHEDULED":
      return { trackingStatus: "ARRIVED", label: t("markArrived") };
    case "ARRIVED":
      return { trackingStatus: "RECEIVING", label: t("startReceiving") };
    case "RECEIVING":
      return { trackingStatus: "RECEIVED", label: t("completeReceipt") };
    default:
      return null;
  }
}

function getOutboundTrackingAction(document: Pick<OutboundDocument, "trackingStatus" | "status">, t: (key: string) => string) {
  switch (normalizeOutboundTrackingStatus(document.trackingStatus, document.status)) {
    case "SCHEDULED":
      return { trackingStatus: "PICKING", label: t("startPicking") };
    case "PICKING":
      return { trackingStatus: "PACKED", label: t("markPacked") };
    case "PACKED":
      return { trackingStatus: "SHIPPED", label: t("shipOut") };
    default:
      return null;
  }
}

function getInboundWorkflowState(document: Pick<InboundDocument, "trackingStatus" | "status">, t: (key: string) => string) {
  const normalizedTracking = normalizeInboundTrackingStatus(document.trackingStatus, document.status);
  const workflowSteps = [t("scheduled"), t("arrived"), t("receiving"), t("receivedTracking")];
  const workflowStepIndex = normalizedTracking === "ARRIVED"
    ? 1
    : normalizedTracking === "RECEIVING"
      ? 2
      : normalizedTracking === "RECEIVED"
        ? 3
        : 0;

  return {
    nextActionLabel: getInboundTrackingAction(document, t)?.label ?? null,
    nextTrackingStatus: getInboundTrackingAction(document, t)?.trackingStatus ?? null,
    workflowSteps,
    workflowStepIndex
  };
}

function getOutboundWorkflowState(document: Pick<OutboundDocument, "trackingStatus" | "status">, t: (key: string) => string) {
  const normalizedTracking = normalizeOutboundTrackingStatus(document.trackingStatus, document.status);
  const workflowSteps = [t("scheduled"), t("picking"), t("packed"), t("shipped")];
  const workflowStepIndex = normalizedTracking === "PICKING"
    ? 1
    : normalizedTracking === "PACKED"
      ? 2
      : normalizedTracking === "SHIPPED"
        ? 3
        : 0;

  return {
    nextActionLabel: getOutboundTrackingAction(document, t)?.label ?? null,
    nextTrackingStatus: getOutboundTrackingAction(document, t)?.trackingStatus ?? null,
    workflowSteps,
    workflowStepIndex
  };
}

function compareDocumentsByUpdatedAt<
  T extends {
    updatedAt: string;
    createdAt: string;
  }
>(left: T, right: T) {
  return getDocumentTime(right.updatedAt || right.createdAt) - getDocumentTime(left.updatedAt || left.createdAt);
}

function getDocumentTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function getInboundDateKey(document: InboundDocument) {
  return getDateKey(document.deliveryDate || document.createdAt);
}

function getOutboundDateKey(document: OutboundDocument) {
  return getDateKey(document.outDate || document.createdAt);
}

function getDateKey(value: string | null | undefined) {
  return normalizeCalendarDate(value) || "";
}
