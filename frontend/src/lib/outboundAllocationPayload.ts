import type { OutboundPickAllocationPayload } from "./types";

export type OutboundAllocationPayloadSource = {
  locationId: number;
  locationName: string;
  itemNumber: string;
};

export type OutboundAllocationPayloadRow = {
  itemNumber: string;
  locationName: string;
  storageSection: string;
  containerNo: string;
  allocatedQty: number;
  pallets: number;
  startingPallets: number;
  remainingPallets: number;
};

export function buildOutboundPickAllocationPayloads(
  source: OutboundAllocationPayloadSource,
  rows: OutboundAllocationPayloadRow[]
): OutboundPickAllocationPayload[] | undefined {
  if (rows.length === 0) {
    return undefined;
  }

  return rows.map((row) => ({
    itemNumber: row.itemNumber || source.itemNumber || undefined,
    locationId: source.locationId,
    locationName: row.locationName || source.locationName || undefined,
    storageSection: row.storageSection || undefined,
    containerNo: row.containerNo || undefined,
    allocatedQty: Math.max(0, row.allocatedQty),
    pallets: Math.max(0, row.startingPallets - row.remainingPallets),
    inventoryPalletsUsed: Math.max(0, row.pallets),
    startingPallets: Math.max(0, row.startingPallets),
    remainingPallets: Math.max(0, row.remainingPallets)
  }));
}
