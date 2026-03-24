import type { Item, Movement } from "./types";

export type ItemContainerBalance = {
  id: string;
  itemId: number;
  customerId: number;
  locationId: number;
  locationName: string;
  storageSection: string;
  containerNo: string;
  onHandQty: number;
  availableQty: number;
  sortAt: number;
};

type MovementBalanceGroup = {
  sourceKey: string;
  locationId: number;
  locationName: string;
  storageSection: string;
  containerNo: string;
  onHandQty: number;
  sortAt: number;
};

function parseMovementSortAt(movement: Movement) {
  return Date.parse(movement.deliveryDate || movement.outDate || movement.createdAt || "") || 0;
}

function parseItemSortAt(item: Item) {
  return Date.parse(item.deliveryDate || item.lastRestockedAt || item.createdAt || "") || 0;
}

function normalizeSku(value: string) {
  return value.trim().toUpperCase();
}

function normalizeLocationRef(value: string) {
  return value.trim().toUpperCase();
}

function buildItemSourceKey(item: Pick<Item, "customerId" | "locationName" | "sku">) {
  return `${item.customerId}|${normalizeLocationRef(item.locationName)}|${normalizeSku(item.sku)}`;
}

function buildMovementSourceKey(movement: Pick<Movement, "customerId" | "locationName" | "sku">) {
  return `${movement.customerId}|${normalizeLocationRef(movement.locationName)}|${normalizeSku(movement.sku)}`;
}

function containerBalanceKey(locationId: number, storageSection: string, containerNo: string) {
  return `${locationId}|${storageSection || "A"}|${containerNo || ""}`;
}

export function buildItemContainerBalances(items: Item[], movements: Movement[]) {
  if (items.length === 0) {
    return [];
  }

  const groupedItems = new Map<string, { items: Item[]; totalOnHand: number; totalAvailable: number; representative: Item }>();
  const relevantSourceKeys = new Set<string>();

  for (const item of items) {
    const itemSourceKey = buildItemSourceKey(item);
    relevantSourceKeys.add(itemSourceKey);

    const existing = groupedItems.get(itemSourceKey);
    if (!existing) {
      groupedItems.set(itemSourceKey, {
        items: [item],
        totalOnHand: item.quantity,
        totalAvailable: item.availableQty,
        representative: item
      });
      continue;
    }

    existing.items.push(item);
    existing.totalOnHand += item.quantity;
    existing.totalAvailable += item.availableQty;
    if (parseItemSortAt(item) < parseItemSortAt(existing.representative)) {
      existing.representative = item;
    }
  }

  const groupedBalances = new Map<string, MovementBalanceGroup>();

  for (const movement of movements) {
    const movementSourceKey = buildMovementSourceKey(movement);
    if (!relevantSourceKeys.has(movementSourceKey)) {
      continue;
    }

    const sourceGroup = groupedItems.get(movementSourceKey);
    if (!sourceGroup) {
      continue;
    }

    const storageSection = movement.storageSection || sourceGroup.representative.storageSection || "A";
    const containerNo = movement.containerNo || "";
    const key = `${movementSourceKey}|${storageSection}|${containerNo}`;
    const existing = groupedBalances.get(key);
    const sortAt = movement.quantityChange > 0 ? parseMovementSortAt(movement) : 0;

    if (!existing) {
      groupedBalances.set(key, {
        sourceKey: movementSourceKey,
        locationId: sourceGroup.representative.locationId,
        locationName: sourceGroup.representative.locationName,
        storageSection,
        containerNo,
        onHandQty: movement.quantityChange,
        sortAt
      });
      continue;
    }

    existing.onHandQty += movement.quantityChange;
    if (sortAt > 0 && (existing.sortAt === 0 || sortAt < existing.sortAt)) {
      existing.sortAt = sortAt;
    }
  }

  const groupedBalancesBySourceKey = new Map<string, MovementBalanceGroup[]>();
  for (const balance of groupedBalances.values()) {
    if (balance.onHandQty <= 0) {
      continue;
    }

    const existing = groupedBalancesBySourceKey.get(balance.sourceKey);
    if (!existing) {
      groupedBalancesBySourceKey.set(balance.sourceKey, [balance]);
      continue;
    }

    existing.push(balance);
  }

  const balances: ItemContainerBalance[] = [];

  for (const [itemSourceKey, sourceGroup] of groupedItems.entries()) {
    const movementSourceBalances = [...(groupedBalancesBySourceKey.get(itemSourceKey) ?? [])].sort((left, right) => {
      if (left.sortAt !== right.sortAt) return left.sortAt - right.sortAt;
      if (left.locationName !== right.locationName) return left.locationName.localeCompare(right.locationName);
      if (left.storageSection !== right.storageSection) return left.storageSection.localeCompare(right.storageSection);
      return left.containerNo.localeCompare(right.containerNo);
    });

    let remainingOnHand = sourceGroup.totalOnHand;
    let remainingAvailable = sourceGroup.totalAvailable;

    for (const balance of movementSourceBalances) {
      if (remainingOnHand <= 0) {
        break;
      }

      const onHandQty = Math.min(balance.onHandQty, remainingOnHand);
      const availableQty = Math.min(onHandQty, remainingAvailable);
      remainingOnHand -= onHandQty;
      remainingAvailable = Math.max(0, remainingAvailable - availableQty);

      balances.push({
        id: containerBalanceKey(balance.locationId, balance.storageSection, balance.containerNo),
        itemId: sourceGroup.representative.id,
        customerId: sourceGroup.representative.customerId,
        locationId: balance.locationId,
        locationName: balance.locationName,
        storageSection: balance.storageSection || sourceGroup.representative.storageSection || "A",
        containerNo: balance.containerNo || "",
        onHandQty,
        availableQty,
        sortAt: balance.sortAt || parseItemSortAt(sourceGroup.representative)
      });
    }

    if (remainingOnHand <= 0) {
      continue;
    }

    const fallbackGroups = new Map<string, { item: Item; onHandQty: number; availableQty: number }>();
    for (const item of sourceGroup.items) {
      const fallbackKey = containerBalanceKey(item.locationId, item.storageSection || "A", item.containerNo || "");
      const existing = fallbackGroups.get(fallbackKey);
      if (!existing) {
        fallbackGroups.set(fallbackKey, {
          item,
          onHandQty: item.quantity,
          availableQty: item.availableQty
        });
        continue;
      }

      existing.onHandQty += item.quantity;
      existing.availableQty += item.availableQty;
    }

    const sortedFallbacks = [...fallbackGroups.values()].sort((left, right) => {
      const leftSortAt = parseItemSortAt(left.item);
      const rightSortAt = parseItemSortAt(right.item);
      if (leftSortAt !== rightSortAt) return leftSortAt - rightSortAt;
      if (left.item.locationName !== right.item.locationName) return left.item.locationName.localeCompare(right.item.locationName);
      if ((left.item.storageSection || "A") !== (right.item.storageSection || "A")) return (left.item.storageSection || "A").localeCompare(right.item.storageSection || "A");
      return (left.item.containerNo || "").localeCompare(right.item.containerNo || "");
    });

    for (const fallback of sortedFallbacks) {
      if (remainingOnHand <= 0) {
        break;
      }

      const onHandQty = Math.min(fallback.onHandQty, remainingOnHand);
      const availableQty = Math.min(onHandQty, remainingAvailable, fallback.availableQty);
      remainingOnHand -= onHandQty;
      remainingAvailable = Math.max(0, remainingAvailable - availableQty);

      balances.push({
        id: containerBalanceKey(fallback.item.locationId, fallback.item.storageSection || "A", fallback.item.containerNo || ""),
        itemId: fallback.item.id,
        customerId: fallback.item.customerId,
        locationId: fallback.item.locationId,
        locationName: fallback.item.locationName,
        storageSection: fallback.item.storageSection || "A",
        containerNo: fallback.item.containerNo || "",
        onHandQty,
        availableQty,
        sortAt: parseItemSortAt(fallback.item)
      });
    }
  }

  return balances.sort((left, right) => {
    if (left.sortAt !== right.sortAt) return left.sortAt - right.sortAt;
    if (left.locationName !== right.locationName) return left.locationName.localeCompare(right.locationName);
    if (left.storageSection !== right.storageSection) return left.storageSection.localeCompare(right.storageSection);
    if (left.containerNo !== right.containerNo) return left.containerNo.localeCompare(right.containerNo);
    return left.itemId - right.itemId;
  });
}

export function formatContainerDistributionSummary(
  balances: Pick<ItemContainerBalance, "containerNo" | "availableQty" | "locationName" | "storageSection">[]
) {
  const containerTotals = new Map<string, number>();

  for (const balance of balances) {
    const label = balance.containerNo.trim() || `${balance.locationName}/${balance.storageSection || "A"}`;
    containerTotals.set(label, (containerTotals.get(label) ?? 0) + balance.availableQty);
  }

  if (containerTotals.size === 0) {
    return "";
  }

  return [...containerTotals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([containerLabel, quantity]) => `${containerLabel}:${quantity}`)
    .join(" | ");
}
