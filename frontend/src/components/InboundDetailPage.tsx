import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import MoveToInboxOutlinedIcon from "@mui/icons-material/MoveToInboxOutlined";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import WarehouseOutlinedIcon from "@mui/icons-material/WarehouseOutlined";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { ApiError, api } from "../lib/api";
import { setPendingActivityManagementLaunchContext } from "../lib/activityManagementLaunchContext";
import type { InboundReceiptEditorLaunchContext } from "../lib/inboundReceiptEditorLaunchContext";
import { useI18n } from "../lib/i18n";
import { setPendingPalletTraceLaunchContext } from "../lib/palletTraceLaunchContext";
import type { PageKey } from "../lib/routes";
import type { InboundDocument, InboundDocumentLine, PalletTrace, UserRole } from "../lib/types";
import { useFeedbackToast } from "./Feedback";
import { WorkspacePanelHeader } from "./WorkspacePanelChrome";

type InboundDetailPageProps = {
  document: InboundDocument | null;
  currentUserRole: UserRole;
  isLoading: boolean;
  onNavigate: (page: PageKey) => void;
  onOpenReceiptEditor: (documentId?: number | null, context?: InboundReceiptEditorLaunchContext) => void;
};

type ActivityEvent = {
  key: string;
  label: string;
  detail: string;
  timestamp: string | null;
  tone: "emerald" | "blue" | "amber" | "slate";
};

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function InboundDetailPage({
  document,
  currentUserRole,
  isLoading,
  onNavigate,
  onOpenReceiptEditor
}: InboundDetailPageProps) {
  const { t } = useI18n();
  const { showError, showSuccess, feedbackToast } = useFeedbackToast();
  const canManage = currentUserRole === "admin" || currentUserRole === "operator";
  const [pallets, setPallets] = useState<PalletTrace[]>([]);
  const [isPalletsLoading, setIsPalletsLoading] = useState(false);
  const [palletErrorMessage, setPalletErrorMessage] = useState("");
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }),
    []
  );
  const dateTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }),
    []
  );

  const workflowSteps = [t("scheduled"), t("arrived"), t("receiving"), t("receivedTracking")];
  const workflowStepIndex = document ? getInboundWorkflowStepIndex(document) : 0;
  const sectionSummary = document ? summarizeSections(document) : "-";
  const totalPallets = document ? document.lines.reduce((sum, line) => sum + line.pallets, 0) : 0;
  const quantityVariance = document ? document.totalReceivedQty - document.totalExpectedQty : 0;
  const activityLog = useMemo(() => (document ? buildActivityLog(document, t) : []), [document, t]);
  const palletCount = pallets.length;

  useEffect(() => {
    let active = true;

    async function loadPallets() {
      if (!document?.id) {
        setPallets([]);
        setPalletErrorMessage("");
        setIsPalletsLoading(false);
        return;
      }

      setIsPalletsLoading(true);
      setPalletErrorMessage("");
      try {
        const nextPallets = await api.getPallets(200, "", document.id);
        if (!active) return;
        setPallets(nextPallets);
      } catch (error) {
        if (!active) return;
        setPalletErrorMessage(getErrorMessage(error, t("couldNotLoadReport")));
      } finally {
        if (active) {
          setIsPalletsLoading(false);
        }
      }
    }

    void loadPallets();
    return () => {
      active = false;
    };
  }, [document?.id, t]);

  function handleOpenWorkspace() {
    if (!document) {
      return;
    }

    setPendingActivityManagementLaunchContext("IN", { documentId: document.id });
    onNavigate("inbound-management");
  }

  function handleOpenPalletWorkspace() {
    if (!document) {
      return;
    }

    setPendingPalletTraceLaunchContext({ sourceInboundDocumentId: document.id });
    onNavigate("pallet-trace");
  }

  function handleConvertToPalletized() {
    if (!document) {
      return;
    }

    onOpenReceiptEditor(document.id, {
      forceHandlingMode: "PALLETIZED",
      inboundIntent: "convert-sealed-transit"
    });
  }

  async function handleCopyReceipt() {
    if (!document?.id) {
      return;
    }

    try {
      const copiedDocument = await api.copyInboundDocument(document.id);
      showSuccess(t("receiptCopiedSuccess"));
      onOpenReceiptEditor(copiedDocument.id);
    } catch (error) {
      showError(getErrorMessage(error, t("couldNotSaveActivity")));
    }
  }

  const canConvertSealedTransit =
    canManage
    && !document?.archivedAt
    && normalizeDocumentStatus(document?.status ?? "") === "DRAFT"
    && document?.handlingMode === "SEALED_TRANSIT";

  return (
    <main className="workspace-main">
      <div className="space-y-6 pb-6">
        <section className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,#f4f8ff_0%,#eef4fb_100%)] px-5 py-5 shadow-[0_18px_48px_rgba(10,31,68,0.06)]">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2.5">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 ring-1 ring-slate-200/70">
                <span>{t("inboundDetailEyebrow")}</span>
              </div>
              <div>
                <h1 className="font-headline text-3xl font-extrabold tracking-tight text-[#0d2d63]">
                  {document?.containerNo || t("inboundDetailMissingTitle")}
                </h1>
                {document ? (
                  <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#143569] ring-1 ring-slate-200/80">
                    <span>{t("handlingMode")}</span>
                    <span>{document.handlingMode === "SEALED_TRANSIT" ? t("handlingModeSealedTransit") : t("handlingModePalletized")}</span>
                  </div>
                ) : null}
                <p className="mt-1.5 max-w-3xl text-sm text-slate-600">
                  {document
                    ? t("inboundDetailSubtitle", {
                      customer: document.customerName || "-",
                      warehouse: document.locationName || "-"
                    })
                    : t("inboundDetailMissingDesc")}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleOpenPalletWorkspace}
                disabled={!document}
                className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#143569] ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <WarehouseOutlinedIcon sx={{ fontSize: 18 }} />
                {t("openPalletWorkspace")}
              </button>
              <button
                type="button"
                onClick={handleOpenWorkspace}
                disabled={!document}
                className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#143569] ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <OpenInNewRoundedIcon sx={{ fontSize: 18 }} />
                {t("inboundDetailOpenWorkspace")}
              </button>
              {canConvertSealedTransit ? (
                <button
                  type="button"
                  onClick={handleConvertToPalletized}
                  className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-[#143569] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(20,53,105,0.18)] transition hover:bg-[#102f5f]"
                >
                  <MoveToInboxOutlinedIcon sx={{ fontSize: 18 }} />
                  {t("convertToPalletized")}
                </button>
              ) : null}
              {canManage && normalizeDocumentStatus(document?.status ?? "") === "DRAFT" ? (
                <button
                  type="button"
                  onClick={() => onOpenReceiptEditor(document?.id ?? null)}
                  disabled={!document}
                  className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-[#143569] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(20,53,105,0.18)] transition hover:bg-[#102f5f] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <MoveToInboxOutlinedIcon sx={{ fontSize: 18 }} />
                  {t("editDraft")}
                </button>
              ) : null}
              {canManage && normalizeDocumentStatus(document?.status ?? "") === "CONFIRMED" ? (
                <button
                  type="button"
                  onClick={() => void handleCopyReceipt()}
                  disabled={!document}
                  className="interactive-button-lift inline-flex items-center gap-2 rounded-xl bg-[#143569] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(20,53,105,0.18)] transition hover:bg-[#102f5f] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ContentCopyOutlinedIcon sx={{ fontSize: 18 }} />
                  {t("reEnterReceipt")}
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-5 rounded-[22px] border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_32px_rgba(15,23,42,0.04)]">
            {isLoading ? (
              <div className="grid gap-4 md:grid-cols-4 animate-pulse">
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="rounded-[18px] border border-slate-200/80 bg-slate-50/80 p-4">
                    <div className="h-4 w-24 rounded-full bg-slate-200" />
                    <div className="mt-4 h-8 w-20 rounded-full bg-slate-200" />
                    <div className="mt-3 h-3 w-full rounded-full bg-slate-200" />
                  </div>
                ))}
              </div>
            ) : document ? (
              <>
                <div className="grid gap-3 md:grid-cols-4">
                  <OverviewStatCard
                    icon={<MoveToInboxOutlinedIcon sx={{ fontSize: 18 }} />}
                    label={t("totalLines")}
                    value={String(document.totalLines)}
                    meta={t("skuLines")}
                  />
                  <OverviewStatCard
                    icon={<WarehouseOutlinedIcon sx={{ fontSize: 18 }} />}
                    label={t("expectedQty")}
                    value={String(document.totalExpectedQty)}
                    meta={t("receivedQty")}
                    secondaryValue={String(document.totalReceivedQty)}
                  />
                  <OverviewStatCard
                    icon={<WarehouseOutlinedIcon sx={{ fontSize: 18 }} />}
                    label={t("currentStorage")}
                    value={sectionSummary}
                    meta={document.locationName || "-"}
                  />
                  <OverviewStatCard
                    icon={<HistoryOutlinedIcon sx={{ fontSize: 18 }} />}
                    label={t("pallets")}
                    value={String(totalPallets)}
                    meta={t("inboundDetailVariance", { variance: quantityVariance })}
                    secondaryValue={palletCount > 0 ? `${palletCount}` : undefined}
                  />
                </div>

                <div className="mt-6 grid gap-3 md:grid-cols-4">
                  {workflowSteps.map((step, index) => {
                    const isComplete = index < workflowStepIndex;
                    const isCurrent = index === workflowStepIndex;
                    return (
                      <div key={step} className="flex items-center gap-3">
                        <div
                          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset ${
                            isComplete
                              ? "bg-emerald-400/15 text-emerald-700 ring-emerald-400/20"
                              : isCurrent
                                ? "bg-amber-100 text-amber-700 ring-amber-300/60 shadow-[0_12px_24px_rgba(217,119,6,0.12)]"
                                : "bg-slate-100 text-slate-400 ring-slate-200"
                          }`}
                        >
                          <span className="h-2.5 w-2.5 rounded-full bg-current opacity-80" />
                        </div>
                        <div className="min-w-0">
                          <div
                            className={`text-sm font-semibold ${
                              isCurrent ? "text-amber-700" : isComplete ? "text-emerald-700" : "text-slate-400"
                            }`}
                          >
                            {step}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {index === workflowStepIndex
                              ? formatInboundTrackingStatusLabel(document.trackingStatus, document.status, t)
                              : index < workflowStepIndex
                                ? t("completed")
                                : t("pending")}
                          </div>
                        </div>
                        {index < workflowSteps.length - 1 ? (
                          <div className={`hidden h-px flex-1 md:block ${index < workflowStepIndex ? "bg-emerald-300" : "bg-slate-200"}`} />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="rounded-[18px] border border-dashed border-slate-300 bg-slate-50/80 px-5 py-10 text-center">
                <div className="text-base font-semibold text-slate-800">{t("inboundDetailMissingTitle")}</div>
                <p className="mt-2 text-sm text-slate-500">{t("inboundDetailMissingDesc")}</p>
              </div>
            )}
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.85fr)]">
          <div className="space-y-5">
            <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_16px_34px_rgba(15,23,42,0.05)]">
              <WorkspacePanelHeader
                title={t("inboundDetailManifest")}
                description={t("inboundDetailManifestDesc")}
              />
              {isLoading ? (
                <div className="space-y-3 animate-pulse">
                  {Array.from({ length: 4 }, (_, index) => (
                    <div key={index} className="rounded-[18px] border border-slate-200/80 bg-slate-50/80 px-4 py-4">
                      <div className="grid gap-3 md:grid-cols-[0.8fr_1.4fr_0.5fr_0.5fr_0.7fr]">
                        <div className="h-4 rounded-full bg-slate-200" />
                        <div className="h-4 rounded-full bg-slate-200" />
                        <div className="h-4 rounded-full bg-slate-200" />
                        <div className="h-4 rounded-full bg-slate-200" />
                        <div className="h-4 rounded-full bg-slate-200" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : document ? (
                <div className="overflow-hidden rounded-[18px] border border-slate-200/80">
                  <div className="grid grid-cols-[0.85fr_1.5fr_0.6fr_0.6fr_0.7fr] gap-3 bg-slate-100/90 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    <span>{t("sku")}</span>
                    <span>{t("description")}</span>
                    <span>{t("expectedQty")}</span>
                    <span>{t("receivedQty")}</span>
                    <span>{t("receiptVariance")}</span>
                  </div>
                  <div className="divide-y divide-slate-200/80">
                    {document.lines.map((line) => (
                      <div key={line.id} className="grid grid-cols-[0.85fr_1.5fr_0.6fr_0.6fr_0.7fr] gap-3 px-4 py-4">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-[#0d2d63]">{line.sku || "-"}</div>
                          <div className="mt-1 text-xs text-slate-500">{line.storageSection || document.storageSection || "-"}</div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900">{line.description || "-"}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {t("pallets")}: {line.pallets} / {line.palletsDetailCtns || "-"}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">{line.lineNote || t("inboundDetailNoLineNote")}</div>
                        </div>
                        <div className="text-sm font-semibold text-slate-900">{line.expectedQty}</div>
                        <div className="text-sm font-semibold text-slate-900">{line.receivedQty}</div>
                        <div className="flex items-start">
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${getLineReceiptVarianceToneClass(line)}`}>
                            {getLineReceiptVarianceLabel(line, t)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_16px_34px_rgba(15,23,42,0.05)]">
              <WorkspacePanelHeader
                title={t("inboundDetailPalletManifest")}
                description={t("inboundDetailPalletManifestDesc")}
              />
              {isPalletsLoading ? (
                <div className="grid gap-3 md:grid-cols-2 animate-pulse">
                  {Array.from({ length: 4 }, (_, index) => (
                    <div key={index} className="rounded-[18px] border border-slate-200/80 bg-slate-50/80 p-4">
                      <div className="h-4 w-32 rounded-full bg-slate-200" />
                      <div className="mt-3 h-3 w-24 rounded-full bg-slate-200" />
                      <div className="mt-4 h-12 rounded-2xl bg-slate-200" />
                    </div>
                  ))}
                </div>
              ) : palletErrorMessage ? (
                <div className="rounded-[18px] border border-dashed border-rose-200 bg-rose-50/80 px-4 py-8 text-center text-sm text-rose-700">
                  {palletErrorMessage}
                </div>
              ) : palletCount > 0 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {pallets.map((pallet) => {
                    const totalQuantity = pallet.contents.reduce((sum, content) => sum + content.quantity, 0);
                    return (
                      <article key={pallet.id} className="rounded-[18px] border border-slate-200/80 bg-slate-50/70 p-4 shadow-[0_8px_18px_rgba(15,23,42,0.03)]">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-[#0d2d63]">{pallet.palletCode}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {pallet.currentLocationName || "-"} / {pallet.currentStorageSection || "-"}
                            </div>
                          </div>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${getPalletStatusToneClass(pallet.status)}`}>
                            {getPalletStatusLabel(t, pallet.status)}
                          </span>
                        </div>

                        <div className="mt-4 grid grid-cols-3 gap-3 text-xs text-slate-500">
                          <div>
                            <div className="font-semibold uppercase tracking-[0.18em] text-slate-400">{t("containerNo")}</div>
                            <div className="mt-1 font-medium text-slate-700">{pallet.currentContainerNo || "-"}</div>
                          </div>
                          <div>
                            <div className="font-semibold uppercase tracking-[0.18em] text-slate-400">{t("palletContents")}</div>
                            <div className="mt-1 font-medium text-slate-700">{pallet.contents.length}</div>
                          </div>
                          <div>
                            <div className="font-semibold uppercase tracking-[0.18em] text-slate-400">{t("quantity")}</div>
                            <div className="mt-1 font-medium text-slate-700">{totalQuantity}</div>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {pallet.contents.map((content) => (
                            <span
                              key={content.id}
                              className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200"
                            >
                              {(content.itemNumber || content.sku || "-")} · {content.quantity}
                            </span>
                          ))}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-[18px] border border-dashed border-slate-300 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">
                  {t("inboundDetailNoPallets")}
                </div>
              )}
            </section>
          </div>

          <div className="space-y-5">
            <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_16px_34px_rgba(15,23,42,0.05)]">
              <WorkspacePanelHeader
                title={t("inboundDetailActivityLog")}
                description={t("inboundDetailActivityLogDesc")}
              />
              {isLoading ? (
                <div className="space-y-4 animate-pulse">
                  {Array.from({ length: 4 }, (_, index) => (
                    <div key={index} className="flex gap-3">
                      <div className="mt-1 h-3 w-3 rounded-full bg-slate-200" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 w-40 rounded-full bg-slate-200" />
                        <div className="h-3 w-full rounded-full bg-slate-200" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : activityLog.length > 0 ? (
                <div className="space-y-4">
                  {activityLog.map((event, index) => (
                    <div key={event.key} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span className={`mt-1 h-3 w-3 rounded-full ${getEventToneClass(event.tone)}`} />
                        {index < activityLog.length - 1 ? <span className="mt-2 h-full w-px bg-slate-200" /> : null}
                      </div>
                      <div className="min-w-0 pb-1">
                        <div className="text-sm font-semibold text-slate-900">{event.label}</div>
                        <div className="mt-1 text-sm text-slate-600">{event.detail}</div>
                        <div className="mt-1 text-xs text-slate-400">{formatDateTime(event.timestamp, dateTimeFormatter)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[18px] border border-dashed border-slate-300 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">
                  {t("inboundDetailNoActivity")}
                </div>
              )}
            </section>

            <section className="rounded-[24px] border border-slate-200/80 bg-[#143569] p-4 text-white shadow-[0_20px_40px_rgba(20,53,105,0.22)]">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-100/80">{t("receiptSummary")}</div>
              <div className="mt-4 grid gap-4">
                <DetailStatRow label={t("customer")} value={document?.customerName || "-"} />
                <DetailStatRow label={t("expectedArrivalDate")} value={document ? formatDate(document.expectedArrivalDate, dateFormatter) : "-"} />
                <DetailStatRow label={t("actualArrivalDate")} value={document ? formatDate(document.actualArrivalDate, dateFormatter) : "-"} />
                <DetailStatRow label={t("currentStorage")} value={document ? `${document.locationName || "-"} / ${sectionSummary}` : "-"} />
                <DetailStatRow label={t("trackingStatus")} value={document ? formatInboundTrackingStatusLabel(document.trackingStatus, document.status, t) : "-"} />
                <DetailStatRow label={t("documentNotes")} value={document?.documentNote || "-"} multiline />
              </div>
            </section>
          </div>
        </div>
      </div>
      {feedbackToast}
    </main>
  );
}

function OverviewStatCard({
  icon,
  label,
  value,
  meta,
  secondaryValue
}: {
  icon: ReactNode;
  label: string;
  value: string;
  meta: string;
  secondaryValue?: string;
}) {
  return (
    <article className="rounded-[18px] border border-slate-200/80 bg-slate-50/70 p-3 shadow-[0_8px_18px_rgba(15,23,42,0.03)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-[#143569]">
          {icon}
        </div>
        {secondaryValue ? <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{secondaryValue}</span> : null}
      </div>
      <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="mt-1.5 text-xl font-extrabold tracking-tight text-[#0d2d63]">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{meta}</div>
    </article>
  );
}

function DetailStatRow({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className={`grid gap-1 ${multiline ? "" : "grid-cols-[110px_minmax(0,1fr)] items-start"}`}>
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-100/75">{label}</span>
      <span className="text-sm font-semibold text-white/95 break-words">{value}</span>
    </div>
  );
}

function getInboundWorkflowStepIndex(document: Pick<InboundDocument, "trackingStatus" | "status">) {
  const normalizedTracking = normalizeInboundTrackingStatus(document.trackingStatus, document.status);
  if (normalizedTracking === "ARRIVED") return 1;
  if (normalizedTracking === "RECEIVING") return 2;
  if (normalizedTracking === "RECEIVED") return 3;
  return 0;
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

function normalizeDocumentStatus(status: string) {
  return (status || "").trim().toUpperCase();
}

function formatInboundTrackingStatusLabel(trackingStatus: string, documentStatus: string, t: Translate) {
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

function summarizeSections(document: InboundDocument) {
  const sectionSet = new Set(
    [document.storageSection, ...document.lines.map((line) => line.storageSection)]
      .map((value) => (value || "").trim())
      .filter(Boolean)
  );
  return sectionSet.size > 0 ? Array.from(sectionSet).join(", ") : "-";
}

function buildActivityLog(document: InboundDocument, t: Translate): ActivityEvent[] {
  const events: ActivityEvent[] = [
    {
      key: "created",
      label: t("inboundDetailEventCreated"),
      detail: t("inboundDetailEventCreatedDesc", { lines: document.totalLines }),
      timestamp: document.createdAt,
      tone: "blue"
    }
  ];

  const trackingStatus = normalizeInboundTrackingStatus(document.trackingStatus, document.status);
  if (trackingStatus === "ARRIVED" || trackingStatus === "RECEIVING" || trackingStatus === "RECEIVED") {
    events.push({
      key: "arrived",
      label: t("inboundDetailEventArrived"),
      detail: t("inboundDetailEventArrivedDesc", { container: document.containerNo || "-" }),
      timestamp: document.updatedAt,
      tone: "amber"
    });
  }
  if (trackingStatus === "RECEIVING" || trackingStatus === "RECEIVED") {
    events.push({
      key: "receiving",
      label: t("inboundDetailEventReceiving"),
      detail: t("inboundDetailEventReceivingDesc", { warehouse: document.locationName || "-" }),
      timestamp: document.updatedAt,
      tone: "amber"
    });
  }
  if (document.confirmedAt) {
    events.push({
      key: "confirmed",
      label: t("inboundDetailEventConfirmed"),
      detail: t("inboundDetailEventConfirmedDesc", { qty: document.totalReceivedQty }),
      timestamp: document.confirmedAt,
      tone: "emerald"
    });
  }
  if (document.deletedAt) {
    events.push({
      key: "cancelled",
      label: t("inboundDetailEventCancelled"),
      detail: t("cancelReceipt"),
      timestamp: document.deletedAt,
      tone: "slate"
    });
  }
  if (document.archivedAt) {
    events.push({
      key: "archived",
      label: t("inboundDetailEventArchived"),
      detail: t("archiveReceipt"),
      timestamp: document.archivedAt,
      tone: "slate"
    });
  }

  return events.sort((left, right) => getTime(right.timestamp) - getTime(left.timestamp));
}

function getTime(value: string | null) {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function formatDate(value: string | null, formatter: Intl.DateTimeFormat) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return formatter.format(parsed);
}

function formatDateTime(value: string | null, formatter: Intl.DateTimeFormat) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return formatter.format(parsed);
}

function getLineReceiptVarianceLabel(line: InboundDocumentLine, t: Translate) {
  if (line.receivedQty === line.expectedQty) {
    return t("matched");
  }
  if (line.receivedQty < line.expectedQty) {
    return t("shortReceived");
  }
  return t("overReceived");
}

function getLineReceiptVarianceToneClass(line: InboundDocumentLine) {
  if (line.receivedQty === line.expectedQty) {
    return "bg-[rgb(209_250_229_/_var(--tw-bg-opacity,1))] text-[#143569] ring-1 ring-emerald-100";
  }
  if (line.receivedQty < line.expectedQty) {
    return "bg-[#f1e6d2] text-[#143569] ring-1 ring-[#e5d3ac]";
  }
  return "bg-[#dce8f6] text-[#143569] ring-1 ring-[#c5d8ee]";
}

function getPalletStatusLabel(t: Translate, status: string) {
  switch ((status || "").trim().toUpperCase()) {
    case "OPEN":
      return t("palletOpen");
    case "PARTIAL":
      return t("palletPartial");
    case "SHIPPED":
      return t("palletShipped");
    case "CANCELLED":
      return t("palletCancelled");
    default:
      return status || t("pending");
  }
}

function getPalletStatusToneClass(status: string) {
  switch ((status || "").trim().toUpperCase()) {
    case "OPEN":
      return "bg-emerald-100 text-emerald-700";
    case "PARTIAL":
      return "bg-amber-100 text-amber-700";
    case "SHIPPED":
      return "bg-slate-100 text-slate-600";
    case "CANCELLED":
      return "bg-rose-100 text-rose-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function getErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message || fallbackMessage;
  }
  return fallbackMessage;
}

function getEventToneClass(tone: ActivityEvent["tone"]) {
  switch (tone) {
    case "emerald":
      return "bg-emerald-500";
    case "amber":
      return "bg-amber-500";
    case "slate":
      return "bg-slate-400";
    default:
      return "bg-[#143569]";
  }
}
