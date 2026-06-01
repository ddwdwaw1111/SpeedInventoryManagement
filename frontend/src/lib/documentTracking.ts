export type Translate = (key: string) => string;

export type InboundTrackingStatus = "SCHEDULED" | "ARRIVED" | "RECEIVING" | "RECEIVED";
export type OutboundTrackingStatus = "SCHEDULED" | "PICKING" | "PACKED" | "SHIPPED" | "BO_RECEIVED";
export type TrackingTone = "emerald" | "blue" | "amber" | "slate";

export type TrackingAction<TTrackingStatus extends string> = {
  trackingStatus: TTrackingStatus;
  label: string;
};

type WorkflowState<TTrackingStatus extends string> = {
  nextActionLabel: string | null;
  nextTrackingStatus: TTrackingStatus | null;
  workflowSteps: string[];
  workflowStepIndex: number;
};

type OutboundWorkflowState = WorkflowState<OutboundTrackingStatus> & {
  steps: string[];
  activeIndex: number;
  progress: number;
};

type LabelOptions = {
  workflowLabels?: boolean;
  cancelledAsCancelled?: boolean;
};

export function normalizeDocumentStatus(status?: string | null) {
  return (status || "").trim().toUpperCase();
}

export function normalizeInboundTrackingStatus(trackingStatus?: string | null, documentStatus?: string | null): InboundTrackingStatus {
  if (normalizeDocumentStatus(documentStatus) === "CONFIRMED") {
    return "RECEIVED";
  }
  const normalizedTrackingStatus = (trackingStatus || "").trim().toUpperCase();
  if (normalizedTrackingStatus === "ARRIVED" || normalizedTrackingStatus === "RECEIVING" || normalizedTrackingStatus === "RECEIVED") {
    return normalizedTrackingStatus;
  }
  return "SCHEDULED";
}

export function normalizeOutboundTrackingStatus(trackingStatus?: string | null, documentStatus?: string | null): OutboundTrackingStatus {
  const normalizedTrackingStatus = (trackingStatus || "").trim().toUpperCase();
  if (normalizedTrackingStatus === "PICKING" || normalizedTrackingStatus === "PACKED" || normalizedTrackingStatus === "SHIPPED" || normalizedTrackingStatus === "BO_RECEIVED") {
    return normalizedTrackingStatus;
  }
  if (normalizeDocumentStatus(documentStatus) === "CONFIRMED") {
    return "SHIPPED";
  }
  return "SCHEDULED";
}

export function formatInboundTrackingStatusLabel(trackingStatus: string, documentStatus: string, t: Translate) {
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

export function formatOutboundTrackingStatusLabel(trackingStatus: string, documentStatus: string, t: Translate, options: LabelOptions = {}) {
  const normalizedStatus = normalizeDocumentStatus(documentStatus);
  if (options.cancelledAsCancelled && (normalizedStatus === "DELETED" || normalizedStatus === "CANCELLED")) {
    return t("cancelled");
  }
  switch (normalizeOutboundTrackingStatus(trackingStatus, documentStatus)) {
    case "BO_RECEIVED":
      return t("boReceivedTracking");
    case "PICKING":
      return t(options.workflowLabels ? "pickingTracking" : "picking");
    case "PACKED":
      return t(options.workflowLabels ? "packedTracking" : "packed");
    case "SHIPPED":
      return t(options.workflowLabels ? "shippedTracking" : "shipped");
    default:
      return t(options.workflowLabels ? "scheduledTracking" : "scheduled");
  }
}

export function getInboundTrackingAction(
  document: PickDocumentTrackingFields,
  t: Translate,
  options: { draftOnly?: boolean } = {}
): TrackingAction<InboundTrackingStatus> | null {
  if (options.draftOnly && normalizeDocumentStatus(document.status) !== "DRAFT") {
    return null;
  }
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

export function getOutboundTrackingAction(
  document: PickDocumentTrackingFields,
  t: Translate,
  options: { draftOrShippedOnly?: boolean } = {}
): TrackingAction<OutboundTrackingStatus> | null {
  const normalizedStatus = normalizeDocumentStatus(document.status);
  const normalizedTracking = normalizeOutboundTrackingStatus(document.trackingStatus, document.status);
  if (options.draftOrShippedOnly && normalizedStatus !== "DRAFT" && normalizedTracking !== "SHIPPED") {
    return null;
  }
  switch (normalizedTracking) {
    case "SCHEDULED":
      return { trackingStatus: "PICKING", label: t("startPicking") };
    case "PICKING":
      return { trackingStatus: "PACKED", label: t("markPacked") };
    case "PACKED":
      return { trackingStatus: "SHIPPED", label: t("shipOut") };
    case "SHIPPED":
      return { trackingStatus: "BO_RECEIVED", label: t("markBoReceived") };
    default:
      return null;
  }
}

export function getInboundTrackingProgress(trackingStatus: string, documentStatus: string) {
  switch (normalizeInboundTrackingStatus(trackingStatus, documentStatus)) {
    case "ARRIVED":
      return 50;
    case "RECEIVING":
      return 75;
    case "RECEIVED":
      return 100;
    default:
      return 25;
  }
}

export function getOutboundTrackingProgress(trackingStatus: string, documentStatus: string) {
  switch (normalizeOutboundTrackingStatus(trackingStatus, documentStatus)) {
    case "BO_RECEIVED":
    case "SHIPPED":
      return 100;
    case "PICKING":
      return 55;
    case "PACKED":
      return 80;
    default:
      return 25;
  }
}

export function getInboundTrackingTone(trackingStatus: string, documentStatus: string): TrackingTone {
  switch (normalizeInboundTrackingStatus(trackingStatus, documentStatus)) {
    case "ARRIVED":
    case "RECEIVING":
      return "amber";
    case "RECEIVED":
      return "emerald";
    default:
      return "blue";
  }
}

export function getOutboundTrackingTone(trackingStatus: string, documentStatus: string): TrackingTone {
  switch (normalizeOutboundTrackingStatus(trackingStatus, documentStatus)) {
    case "BO_RECEIVED":
    case "SHIPPED":
      return "emerald";
    case "PICKING":
    case "PACKED":
      return "amber";
    default:
      return "slate";
  }
}

export function getInboundWorkflowStepIndex(document: PickDocumentTrackingFields) {
  const normalizedTracking = normalizeInboundTrackingStatus(document.trackingStatus, document.status);
  if (normalizedTracking === "ARRIVED") return 1;
  if (normalizedTracking === "RECEIVING") return 2;
  if (normalizedTracking === "RECEIVED") return 3;
  return 0;
}

export function getInboundWorkflowState(document: PickDocumentTrackingFields, t: Translate): WorkflowState<InboundTrackingStatus> {
  const action = getInboundTrackingAction(document, t);
  return {
    nextActionLabel: action?.label ?? null,
    nextTrackingStatus: action?.trackingStatus ?? null,
    workflowSteps: [t("scheduled"), t("arrived"), t("receiving"), t("receivedTracking")],
    workflowStepIndex: getInboundWorkflowStepIndex(document)
  };
}

export function getOutboundWorkflowStepIndex(document: PickDocumentTrackingFields) {
  const normalizedTracking = normalizeOutboundTrackingStatus(document.trackingStatus, document.status);
  if (normalizedTracking === "PICKING") return 1;
  if (normalizedTracking === "PACKED") return 2;
  if (normalizedTracking === "SHIPPED") return 3;
  if (normalizedTracking === "BO_RECEIVED") return 4;
  return 0;
}

export function getOutboundWorkflowState(
  document: PickDocumentTrackingFields,
  t: Translate,
  options: { workflowLabels?: boolean; cancelledStops?: boolean } = {}
): OutboundWorkflowState {
  const workflowSteps = options.workflowLabels
    ? [t("scheduledTracking"), t("pickingTracking"), t("packedTracking"), t("shippedTracking"), t("boReceivedTracking")]
    : [t("scheduled"), t("picking"), t("packed"), t("shipped"), t("boReceivedTracking")];
  const normalizedStatus = normalizeDocumentStatus(document.status);
  const workflowStepIndex = options.cancelledStops && (normalizedStatus === "DELETED" || normalizedStatus === "CANCELLED")
    ? -1
    : getOutboundWorkflowStepIndex(document);
  const action = getOutboundTrackingAction(document, t);
  const progress = workflowStepIndex < 0 ? 0 : Math.round(((workflowStepIndex + 1) / workflowSteps.length) * 100);
  return {
    nextActionLabel: action?.label ?? null,
    nextTrackingStatus: action?.trackingStatus ?? null,
    workflowSteps,
    workflowStepIndex,
    steps: workflowSteps,
    activeIndex: workflowStepIndex,
    progress
  };
}

type PickDocumentTrackingFields = {
  trackingStatus: string;
  status: string;
};
