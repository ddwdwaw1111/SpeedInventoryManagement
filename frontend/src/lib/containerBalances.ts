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

  const groupedItems = new Map<string, { items: Item[]; representative: Item }>();
  const relevantSourceKeys = new Set<string>();

  for (const item of items) {
    const itemSourceKey = buildItemSourceKey(item);
    relevantSourceKeys.add(itemSourceKey);

    const existing = groupedItems.get(itemSourceKey);
    if (!existing) {
      groupedItems.set(itemSourceKey, {
        items: [item],
        representative: item
      });
      continue;
    }

    existing.items.push(item);
    if (parseItemSortAt(item) < parseItemSortAt(existing.representative)) {
      existing.representative = item;
    }
  }

  const balances: ItemContainerBalance[] = [];

  for (const [itemSourceKey, sourceGroup] of groupedItems.entries()) {
    const groupedByCurrentContainer = new Map<string, ItemContainerBalance>();
    for (const item of sourceGroup.items) {
      const storageSection = item.storageSection || "A";
      const containerNo = item.containerNo || "";
      const sourceKey = containerBalanceKey(item.locationId, storageSection, containerNo);
      const existing = groupedByCurrentContainer.get(sourceKey);
      if (!existing) {
        groupedByCurrentContainer.set(sourceKey, {
          id: sourceKey,
          itemId: item.id,
          customerId: item.customerId,
          locationId: item.locationId,
          locationName: item.locationName,
          storageSection,
          containerNo,
          onHandQty: item.quantity,
          availableQty: item.availableQty,
          sortAt: parseItemSortAt(item)
        });
        continue;
      }

      existing.onHandQty += item.quantity;
      existing.availableQty += item.availableQty;
      const itemSortAt = parseItemSortAt(item);
      if (itemSortAt > 0 && (existing.sortAt === 0 || itemSortAt < existing.sortAt)) {
        existing.sortAt = itemSortAt;
      }
    }

    const currentContainerBalances = [...groupedByCurrentContainer.values()];

    const movementContainerBalances = new Map<string, MovementBalanceGroup>();
    for (const movement of movements) {
      if (buildMovementSourceKey(movement) !== itemSourceKey) {
        continue;
      }

      const storageSection = movement.storageSection || sourceGroup.representative.storageSection || "A";
      const containerNo = movement.containerNo || "";
      const key = containerBalanceKey(sourceGroup.representative.locationId, storageSection, containerNo);
      const existing = movementContainerBalances.get(key);
      const nextSortAt = parseMovementSortAt(movement) || parseItemSortAt(sourceGroup.representative);

      if (!existing) {
        movementContainerBalances.set(key, {
          id: key,
          itemId: sourceGroup.representative.id,
          customerId: sourceGroup.representative.customerId,
          locationId: sourceGroup.representative.locationId,
          locationName: sourceGroup.representative.locationName,
          storageSection,
          containerNo,
          onHandQty: movement.quantityChange,
          availableQty: 0,
          sortAt: nextSortAt
        });
        continue;
      }

      existing.onHandQty += movement.quantityChange;
      if (nextSortAt > 0 && (existing.sortAt === 0 || nextSortAt < existing.sortAt)) {
        existing.sortAt = nextSortAt;
      }
    }

    const normalizedMovementBalances = [...movementContainerBalances.values()]
      .filter((balance) => balance.onHandQty > 0)
      .sort((left, right) => {
        if (left.sortAt !== right.sortAt) return left.sortAt - right.sortAt;
        if (left.locationName !== right.locationName) return left.locationName.localeCompare(right.locationName);
        if (left.storageSection !== right.storageSection) return left.storageSection.localeCompare(right.storageSection);
        return left.containerNo.localeCompare(right.containerNo);
      });

    let remainingAvailableQty = Math.max(0, sourceGroup.items.reduce((sum, item) => sum + item.availableQty, 0));
    for (const balance of normalizedMovementBalances) {
      const availableQty = Math.min(balance.onHandQty, remainingAvailableQty);
      balance.availableQty = Math.max(0, availableQty);
      remainingAvailableQty = Math.max(0, remainingAvailableQty - availableQty);
    }

    const movementDerivedBalances: ItemContainerBalance[] = normalizedMovementBalances
      .filter((balance) => balance.availableQty > 0 || balance.onHandQty > 0)
      .map((balance) => ({
        id: balance.id,
        itemId: balance.itemId,
        customerId: balance.customerId,
        locationId: balance.locationId,
        locationName: balance.locationName,
        storageSection: balance.storageSection,
        containerNo: balance.containerNo,
        onHandQty: balance.onHandQty,
        availableQty: balance.availableQty,
        sortAt: balance.sortAt
      }));

    const currentNamedContainerCount = currentContainerBalances.filter((balance) => balance.containerNo.trim()).length;
    const useCurrentContainerBalances = movementDerivedBalances.length <= 1 || currentNamedContainerCount > 1;
    const selectedBalances = useCurrentContainerBalances ? currentContainerBalances : movementDerivedBalances;

    const sortedContainers = [...selectedBalances].sort((left, right) => {
      if (left.sortAt !== right.sortAt) return left.sortAt - right.sortAt;
      if (left.locationName !== right.locationName) return left.locationName.localeCompare(right.locationName);
      if (left.storageSection !== right.storageSection) return left.storageSection.localeCompare(right.storageSection);
      return left.containerNo.localeCompare(right.containerNo);
    });

    for (const groupedContainer of sortedContainers) {
      balances.push(groupedContainer);
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
