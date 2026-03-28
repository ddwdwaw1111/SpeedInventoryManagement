import { normalizeStorageSection, type Item } from "./types";

export type InventoryActionSourceOption = {
  key: string;
  customerId: number;
  customerName: string;
  sku: string;
  itemNumber: string;
  description: string;
  items: Item[];
  totalOnHand: number;
  totalAvailable: number;
  warehouseCount: number;
  containerCount: number;
};

export function buildInventoryActionSourceKey(customerId: number, sku: string) {
  return `${customerId}:${sku.trim().toUpperCase()}`;
}

export function buildInventoryActionSourceOptions(items: Item[]) {
  const sourceMap = new Map<string, InventoryActionSourceOption>();

  for (const item of items) {
    const sourceKey = buildInventoryActionSourceKey(item.customerId, item.sku);
    const existing = sourceMap.get(sourceKey);
    if (!existing) {
      sourceMap.set(sourceKey, {
        key: sourceKey,
        customerId: item.customerId,
        customerName: item.customerName,
        sku: item.sku,
        itemNumber: item.itemNumber,
        description: displayDescription(item),
        items: [item],
        totalOnHand: item.quantity,
        totalAvailable: item.availableQty,
        warehouseCount: 1,
        containerCount: item.containerNo.trim() ? 1 : 0
      });
      continue;
    }

    existing.items.push(item);
    existing.totalOnHand += item.quantity;
    existing.totalAvailable += item.availableQty;
    if (!existing.itemNumber && item.itemNumber) {
      existing.itemNumber = item.itemNumber;
    }
    if (!existing.description && displayDescription(item)) {
      existing.description = displayDescription(item);
    }
  }

  return [...sourceMap.values()]
    .map((source) => ({
      ...source,
      warehouseCount: new Set(source.items.map((item) => item.locationId)).size,
      containerCount: new Set(
        source.items.map((item) => item.containerNo.trim() || `${item.locationName}/${normalizeStorageSection(item.storageSection)}`)
      ).size
    }))
    .sort((left, right) => {
      const customerCompare = left.customerName.localeCompare(right.customerName);
      if (customerCompare !== 0) return customerCompare;
      return left.sku.localeCompare(right.sku);
    });
}

function displayDescription(item: Pick<Item, "description" | "name">) {
  return item.description || item.name;
}
