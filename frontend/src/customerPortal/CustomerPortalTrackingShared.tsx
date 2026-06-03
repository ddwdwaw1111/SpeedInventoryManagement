import type { ReactNode } from "react";

import {
  normalizeInboundTrackingStatus as normalizeInboundTrackingStatusValue,
  normalizeOutboundTrackingStatus as normalizeOutboundTrackingStatusValue,
  normalizeDocumentStatus
} from "../lib/documentTracking";
import { InfoTooltip } from "../components/ui/tooltip";
import { InlineAlert } from "./sharedUi";
import type { InboundDocument, OutboundDocument } from "./types";

export type CustomerPortalDetailTab = "details" | "documents";

export type CustomerPortalDetailTabRequest = {
  id: number;
  tab: CustomerPortalDetailTab;
};

export type PortalWorkflow = {
  steps: string[];
  activeIndex: number;
  progress: number;
};

export const documentStatusOptions = ["all", "DRAFT", "CONFIRMED", "DELETED"];
export const PACKING_LIST_RECEIVING_RECEIVED_STATUS = "RECEIVING_RECEIVED";
export const packingListTrackingStatusOptions = ["all", "SCHEDULED", "ARRIVED", PACKING_LIST_RECEIVING_RECEIVED_STATUS];
export const pickingOrderTrackingStatusOptions = ["all", "SCHEDULED", "PICKING", "PACKED", "SHIPPED", "BO_RECEIVED"];

export function PortalPanelHeader({
  title,
  description,
  infoTooltip,
  icon,
  actions,
  errorMessage
}: {
  title: string;
  description?: string;
  infoTooltip?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  errorMessage?: string;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-950">
          {icon ? <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-700">{icon}</span> : null}
          <span>{title}</span>
          {infoTooltip ? <InfoTooltip content={infoTooltip} /> : null}
        </h2>
        {description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{description}</p> : null}
        {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function getStatusBadgeVariant(className: string) {
  if (className.includes("danger")) {
    return "destructive" as const;
  }
  if (className.includes("ok")) {
    return "success" as const;
  }
  if (className.includes("alert")) {
    return "warning" as const;
  }
  return "secondary" as const;
}

export function formatNullableDate(value?: string | null) {
  if (!value) {
    return "-";
  }
  const dateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return dateMatch?.[1] ?? value;
}

export function formatPackingListTrackingStatusFilterLabel(status: string, t: (key: string) => string) {
  if (status === "all") {
    return t("all");
  }
  return formatPackingListTrackingStatus(status, "DRAFT", t);
}

export function formatPickingOrderTrackingStatusFilterLabel(status: string, t: (key: string) => string) {
  if (status === "all") {
    return t("all");
  }
  return formatPickingOrderTrackingStatus(status, "DRAFT", t);
}

export function formatPackingListTrackingStatus(trackingStatus: string, documentStatus: string, t: (key: string) => string) {
  if (normalizeDocumentStatusForPortal(documentStatus) === "DELETED") {
    return t("cancelled");
  }
  if (trackingStatus.trim().toUpperCase() === PACKING_LIST_RECEIVING_RECEIVED_STATUS) {
    return t("receivingReceivedTracking");
  }
  switch (normalizeInboundTrackingStatusValue(trackingStatus, documentStatus)) {
    case "ARRIVED":
      return t("arrived");
    case "RECEIVING":
    case "RECEIVED":
      return t("receivingReceivedTracking");
    default:
      return t("submittedTracking");
  }
}

export function formatPickingOrderTrackingStatus(trackingStatus: string, documentStatus: string, t: (key: string) => string) {
  if (normalizeDocumentStatusForPortal(documentStatus) === "DELETED") {
    return t("cancelled");
  }
  switch (normalizeOutboundTrackingStatusValue(trackingStatus, documentStatus)) {
    case "BO_RECEIVED":
      return t("boReceivedTracking");
    case "PICKING":
      return t("pickingTracking");
    case "PACKED":
      return t("packedTracking");
    case "SHIPPED":
      return t("shippedTracking");
    default:
      return t("submittedTracking");
  }
}

export function getPackingListTrackingStatusPillClass(document: Pick<InboundDocument, "status" | "trackingStatus">) {
  if (normalizeDocumentStatusForPortal(document.status) === "DELETED") {
    return "status-pill--danger";
  }
  const normalizedTrackingStatus = normalizeInboundTrackingStatusValue(document.trackingStatus, document.status);
  if (normalizedTrackingStatus === "RECEIVED") {
    return "status-pill--ok";
  }
  if (normalizedTrackingStatus === "ARRIVED" || normalizedTrackingStatus === "RECEIVING") {
    return "status-pill--alert";
  }
  return "";
}

export function getPickingOrderTrackingStatusPillClass(document: Pick<OutboundDocument, "status" | "trackingStatus">) {
  if (normalizeDocumentStatusForPortal(document.status) === "DELETED") {
    return "status-pill--danger";
  }
  const normalizedTrackingStatus = normalizeOutboundTrackingStatusValue(document.trackingStatus, document.status);
  if (normalizedTrackingStatus === "BO_RECEIVED" || normalizedTrackingStatus === "SHIPPED") {
    return "status-pill--ok";
  }
  if (normalizedTrackingStatus === "PICKING" || normalizedTrackingStatus === "PACKED") {
    return "status-pill--alert";
  }
  return "";
}

export function getDocumentStatusPillClass(status: string) {
  const normalizedStatus = normalizeDocumentStatusForPortal(status);
  if (normalizedStatus === "DELETED") {
    return "status-pill--danger";
  }
  if (normalizedStatus === "CONFIRMED") {
    return "status-pill--ok";
  }
  return "status-pill--alert";
}

export function isCompletedPackingList(document: Pick<InboundDocument, "status" | "trackingStatus">) {
  return normalizeDocumentStatusForPortal(document.status) !== "DELETED"
    && normalizeInboundTrackingStatusValue(document.trackingStatus, document.status) === "RECEIVED";
}

export function isOpenPackingList(document: Pick<InboundDocument, "status" | "trackingStatus">) {
  return normalizeDocumentStatusForPortal(document.status) !== "DELETED"
    && !isCompletedPackingList(document);
}

export function formatPackingListCompletionStatus(document: Pick<InboundDocument, "status" | "trackingStatus">, t: (key: string) => string) {
  if (normalizeDocumentStatusForPortal(document.status) === "DELETED") {
    return t("cancelled");
  }
  return isCompletedPackingList(document) ? t("completed") : t("receiving");
}

export function isCompletedPickingOrder(document: Pick<OutboundDocument, "status" | "trackingStatus">) {
  return normalizeDocumentStatusForPortal(document.status) !== "DELETED"
    && normalizeOutboundTrackingStatusValue(document.trackingStatus, document.status) === "BO_RECEIVED";
}

export function isOpenPickingOrder(document: Pick<OutboundDocument, "status" | "trackingStatus">) {
  return normalizeDocumentStatusForPortal(document.status) !== "DELETED"
    && !isCompletedPickingOrder(document);
}

export function formatPickingOrderCompletionStatus(document: Pick<OutboundDocument, "status" | "trackingStatus">, t: (key: string) => string) {
  if (normalizeDocumentStatusForPortal(document.status) === "DELETED") {
    return t("cancelled");
  }
  return isCompletedPickingOrder(document) ? t("completed") : t("customerPortalAwaitingBO");
}

export function getPackingListPortalWorkflow(document: Pick<InboundDocument, "status" | "trackingStatus">, t: (key: string) => string): PortalWorkflow {
  const normalizedTrackingStatus = normalizeInboundTrackingStatusValue(document.trackingStatus, document.status);
  const activeIndex = normalizedTrackingStatus === "RECEIVED" || normalizedTrackingStatus === "RECEIVING"
    ? 2
    : normalizedTrackingStatus === "ARRIVED"
      ? 1
      : 0;
  return buildPortalWorkflow([t("submittedTracking"), t("arrived"), t("receivingReceivedTracking")], activeIndex);
}

export function getPickingOrderPortalWorkflow(document: Pick<OutboundDocument, "status" | "trackingStatus">, t: (key: string) => string): PortalWorkflow {
  const normalizedTrackingStatus = normalizeOutboundTrackingStatusValue(document.trackingStatus, document.status);
  const activeIndex = normalizedTrackingStatus === "BO_RECEIVED"
    ? 4
    : normalizedTrackingStatus === "SHIPPED"
      ? 3
      : normalizedTrackingStatus === "PACKED"
        ? 2
        : normalizedTrackingStatus === "PICKING"
          ? 1
          : 0;
  return buildPortalWorkflow([t("submittedTracking"), t("pickingTracking"), t("packedTracking"), t("shippedTracking"), t("boReceivedTracking")], activeIndex);
}

function buildPortalWorkflow(steps: string[], activeIndex: number): PortalWorkflow {
  return {
    steps,
    activeIndex,
    progress: Math.round(((activeIndex + 1) / steps.length) * 100)
  };
}

function normalizeDocumentStatusForPortal(status: string) {
  const normalized = normalizeDocumentStatus(status);
  return normalized === "CANCELLED" ? "DELETED" : normalized;
}
