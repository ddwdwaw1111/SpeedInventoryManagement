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
  startingQty: number;
  startingPallets: number;
};

export function buildOutboundPickAllocationPayloads(
  source: OutboundAllocationPayloadSource,
  rows: OutboundAllocationPayloadRow[]
): OutboundPickAllocationPayload[] | undefined {
  if (rows.length === 0) {
    return undefined;
  }

  return rows.map((row) => {
    const allocatedQty = Math.max(0, row.allocatedQty);
    const startingQty = Math.max(0, row.startingQty);
    const startingPallets = Math.max(0, row.startingPallets);
    const remainingPallets = allocatedQty >= startingQty ? 0 : startingPallets;
    return {
      itemNumber: row.itemNumber || source.itemNumber || undefined,
      locationId: source.locationId,
      locationName: row.locationName || source.locationName || undefined,
      storageSection: row.storageSection || undefined,
      containerNo: row.containerNo || undefined,
      allocatedQty,
      pallets: Math.max(0, startingPallets - remainingPallets),
      inventoryPalletsUsed: Math.max(0, row.pallets),
      startingPallets,
      remainingPallets
    };
  });
}
