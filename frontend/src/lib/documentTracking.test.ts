import { describe, expect, it } from "vitest";

import {
  formatOutboundTrackingStatusLabel,
  getInboundTrackingAction,
  getInboundTrackingProgress,
  getInboundTrackingTone,
  getOutboundTrackingAction,
  getOutboundTrackingProgress,
  getOutboundTrackingTone,
  getOutboundWorkflowState,
  isOperationalInboundDocument,
  normalizeInboundTrackingStatus,
  normalizeOutboundTrackingStatus
} from "./documentTracking";

const t = (key: string) => key;

describe("document tracking helpers", () => {
  it("normalizes inbound tracking status with confirmed documents treated as received", () => {
    expect(normalizeInboundTrackingStatus("", "DRAFT")).toBe("SCHEDULED");
    expect(normalizeInboundTrackingStatus("receiving", "DRAFT")).toBe("RECEIVING");
    expect(normalizeInboundTrackingStatus("SCHEDULED", "CONFIRMED")).toBe("RECEIVED");
  });

  it("normalizes outbound tracking status with confirmed documents treated as shipped", () => {
    expect(normalizeOutboundTrackingStatus("", "DRAFT")).toBe("SCHEDULED");
    expect(normalizeOutboundTrackingStatus("packed", "DRAFT")).toBe("PACKED");
    expect(normalizeOutboundTrackingStatus("", "CONFIRMED")).toBe("SHIPPED");
    expect(normalizeOutboundTrackingStatus("BO_RECEIVED", "CONFIRMED")).toBe("BO_RECEIVED");
  });

  it("returns the next inbound and outbound tracking actions", () => {
    expect(getInboundTrackingAction({ trackingStatus: "ARRIVED", status: "DRAFT" }, t)).toEqual({
      trackingStatus: "RECEIVING",
      label: "startReceiving"
    });
    expect(getOutboundTrackingAction({ trackingStatus: "PACKED", status: "DRAFT" }, t)).toEqual({
      trackingStatus: "SHIPPED",
      label: "shipOut"
    });
  });

  it("supports draft-only action guards for management pages", () => {
    expect(getInboundTrackingAction({ trackingStatus: "SCHEDULED", status: "ARCHIVED" }, t, { draftOnly: true })).toBeNull();
    expect(getOutboundTrackingAction({ trackingStatus: "SCHEDULED", status: "ARCHIVED" }, t, { draftOrShippedOnly: true })).toBeNull();
    expect(getOutboundTrackingAction({ trackingStatus: "SHIPPED", status: "CONFIRMED" }, t, { draftOrShippedOnly: true })).toEqual({
      trackingStatus: "BO_RECEIVED",
      label: "markBoReceived"
    });
  });

  it("maps progress and tone consistently", () => {
    expect(getInboundTrackingProgress("RECEIVING", "DRAFT")).toBe(75);
    expect(getInboundTrackingTone("RECEIVING", "DRAFT")).toBe("amber");
    expect(getOutboundTrackingProgress("PACKED", "DRAFT")).toBe(80);
    expect(getOutboundTrackingTone("SHIPPED", "CONFIRMED")).toBe("emerald");
  });

  it("supports customer portal workflow labels and cancelled documents", () => {
    expect(formatOutboundTrackingStatusLabel("PICKING", "DRAFT", t, { workflowLabels: true })).toBe("pickingTracking");
    expect(formatOutboundTrackingStatusLabel("PICKING", "DELETED", t, { cancelledAsCancelled: true })).toBe("cancelled");
    expect(getOutboundWorkflowState({ trackingStatus: "PACKED", status: "DRAFT" }, t, { workflowLabels: true })).toMatchObject({
      steps: ["scheduledTracking", "pickingTracking", "packedTracking", "shippedTracking", "boReceivedTracking"],
      activeIndex: 2,
      progress: 60
    });
    expect(getOutboundWorkflowState({ trackingStatus: "PACKED", status: "CANCELLED" }, t, { workflowLabels: true, cancelledStops: true })).toMatchObject({
      activeIndex: -1,
      progress: 0
    });
  });

  it("keeps pending correction drafts out of operational views", () => {
    expect(isOperationalInboundDocument({ status: "DRAFT" })).toBe(true);
    expect(isOperationalInboundDocument({ status: "DRAFT", correctsDocumentId: 12 })).toBe(false);
    expect(isOperationalInboundDocument({ status: "CONFIRMED", correctsDocumentId: 12 })).toBe(true);
    expect(isOperationalInboundDocument({ status: "CONFIRMED", correctedAt: "2026-07-15T10:00:00Z" })).toBe(false);
  });
});
