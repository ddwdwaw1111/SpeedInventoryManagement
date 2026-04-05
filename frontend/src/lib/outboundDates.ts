import type { OutboundDocument } from "./types";

type OutboundDateLike = Pick<OutboundDocument, "expectedShipDate" | "actualShipDate" | "confirmedAt" | "createdAt"> & {
  outDate?: string | null;
};

export function getOutboundExpectedShipDate(document: OutboundDateLike) {
  return document.expectedShipDate ?? document.outDate ?? null;
}

export function getOutboundScheduledShipDate(document: OutboundDateLike) {
  return getOutboundExpectedShipDate(document) ?? document.actualShipDate ?? document.createdAt ?? null;
}

export function getOutboundDisplayShipDate(document: OutboundDateLike) {
  return document.actualShipDate ?? getOutboundExpectedShipDate(document) ?? document.confirmedAt ?? document.createdAt ?? null;
}
