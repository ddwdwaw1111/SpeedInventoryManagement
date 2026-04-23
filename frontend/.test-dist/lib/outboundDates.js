export function getOutboundExpectedShipDate(document) {
    return document.expectedShipDate ?? document.outDate ?? null;
}
export function getOutboundScheduledShipDate(document) {
    return getOutboundExpectedShipDate(document) ?? document.actualShipDate ?? document.createdAt ?? null;
}
export function getOutboundDisplayShipDate(document) {
    return document.actualShipDate ?? getOutboundExpectedShipDate(document) ?? document.confirmedAt ?? document.createdAt ?? null;
}
