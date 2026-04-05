import { formatDateTimeValue, formatDateValue, parseDateLikeValue } from "./dates";
import { normalizeStorageSection, type Item, type Location, type Movement } from "./types";

export type ContainerContentsRow = {
  id: string;
  containerNo: string;
  warehouseSummary: string;
  pickLocationSummary: string;
  customerSummary: string;
  customerIds: number[];
  locationIds: number[];
  skuCount: number;
  rowCount: number;
  contentsPreview: string;
  onHand: number;
  availableQty: number;
  damagedQty: number;
  receivedAt: string | null;
  shippedAt: string | null;
  items: Item[];
};

export type ContainerSkuCard = {
  id: string;
  customerId: number;
  sku: string;
  itemNumber: string;
  description: string;
  customerSummary: string;
  storageSummary: string;
  onHand: number;
  availableQty: number;
  damagedQty: number;
  holdQty: number;
  rowCount: number;
};

type ContainerContentsDraftRow = ContainerContentsRow & {
  warehouseNames: string[];
  pickLocations: string[];
  customerNames: string[];
  skuSet: Set<string>;
  itemNumbers: Set<string>;
  descriptionSet: Set<string>;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

export function normalizeContainerNumber(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase();
}

export function displayContainerItemDescription(item: Pick<Item, "description" | "name">) {
  return item.description?.trim() || item.name?.trim() || "-";
}

export function formatContainerTimelineValue(value: string | null, resolvedTimeZone: string, emptyValue = "-") {
  if (!value) {
    return emptyValue;
  }

  return isCalendarDateValue(value)
    ? formatDateValue(value, dateFormatter)
    : formatDateTimeValue(value, resolvedTimeZone);
}

export function buildAllContainerContentsRows(items: Item[], movements: Movement[], locations: Location[]) {
  return buildContainerContentsRows(items, movements, locations, "", "all", "all");
}

export function buildContainerContentsRows(
  items: Item[],
  movements: Movement[],
  locations: Location[],
  normalizedSearch: string,
  selectedCustomerId: string,
  selectedLocationId: string
) {
  const containerMovementSummaryMap = buildContainerMovementSummaryMap(items, movements, locations);
  const filteredItems = items.filter((item) => {
    const normalizedContainerNo = normalizeContainerNumber(item.containerNo);
    if (!normalizedContainerNo) {
      return false;
    }

    const matchesSearch = normalizedSearch.length === 0
      || normalizedContainerNo.toLowerCase().includes(normalizedSearch)
      || item.sku.toLowerCase().includes(normalizedSearch)
      || item.itemNumber.toLowerCase().includes(normalizedSearch)
      || displayContainerItemDescription(item).toLowerCase().includes(normalizedSearch)
      || item.customerName.toLowerCase().includes(normalizedSearch)
      || item.locationName.toLowerCase().includes(normalizedSearch)
      || normalizeStorageSection(item.storageSection).toLowerCase().includes(normalizedSearch);
    const matchesCustomer = selectedCustomerId === "all" || item.customerId === Number(selectedCustomerId);
    const matchesLocation = selectedLocationId === "all" || item.locationId === Number(selectedLocationId);
    return matchesSearch && matchesCustomer && matchesLocation;
  });

  const rowMap = new Map<string, ContainerContentsDraftRow>();

  for (const item of filteredItems) {
    const containerNo = normalizeContainerNumber(item.containerNo);
    const existing = rowMap.get(containerNo);
    const timeline = containerMovementSummaryMap.get(containerNo);
    const receiptDate = timeline?.receivedAt ?? getFallbackItemReceivedAt(item);
    const shippedAt = timeline?.shippedAt ?? null;
    const pickLocation = `${item.locationName} / ${normalizeStorageSection(item.storageSection)}`;
    const description = displayContainerItemDescription(item);

    if (!existing) {
      rowMap.set(containerNo, {
        id: containerNo,
        containerNo,
        warehouseSummary: item.locationName,
        pickLocationSummary: pickLocation,
        customerSummary: item.customerName,
        customerIds: [item.customerId],
        locationIds: [item.locationId],
        skuCount: 1,
        rowCount: 1,
        contentsPreview: item.sku,
        onHand: item.quantity,
        availableQty: item.availableQty,
        damagedQty: item.damagedQty,
        receivedAt: receiptDate,
        shippedAt,
        items: [item],
        warehouseNames: [item.locationName],
        pickLocations: [pickLocation],
        customerNames: [item.customerName],
        skuSet: new Set([item.sku]),
        itemNumbers: new Set(item.itemNumber ? [item.itemNumber] : []),
        descriptionSet: new Set(description !== "-" ? [description] : [])
      });
      continue;
    }

    existing.onHand += item.quantity;
    existing.availableQty += item.availableQty;
    existing.damagedQty += item.damagedQty;
    existing.rowCount += 1;
    existing.items.push(item);
    existing.receivedAt = getEarliestDate(existing.receivedAt, receiptDate);
    existing.shippedAt = getLatestDate(existing.shippedAt, shippedAt);
    if (!existing.customerIds.includes(item.customerId)) {
      existing.customerIds.push(item.customerId);
    }
    if (!existing.locationIds.includes(item.locationId)) {
      existing.locationIds.push(item.locationId);
    }
    if (!existing.warehouseNames.includes(item.locationName)) {
      existing.warehouseNames.push(item.locationName);
    }
    if (!existing.pickLocations.includes(pickLocation)) {
      existing.pickLocations.push(pickLocation);
    }
    if (!existing.customerNames.includes(item.customerName)) {
      existing.customerNames.push(item.customerName);
    }
    existing.skuSet.add(item.sku);
    if (item.itemNumber.trim()) {
      existing.itemNumbers.add(item.itemNumber.trim());
    }
    if (description !== "-") {
      existing.descriptionSet.add(description);
    }
  }

  for (const [containerNo, summary] of containerMovementSummaryMap.entries()) {
    if (rowMap.has(containerNo)) {
      continue;
    }

    const matchesSearch = matchesContainerSearch(normalizedSearch, {
      containerNo,
      skuValues: [...summary.skuSet],
      itemNumbers: [...summary.itemNumbers],
      descriptions: [...summary.descriptionSet],
      customerNames: summary.customerNames,
      warehouseNames: summary.warehouseNames,
      pickLocations: summary.pickLocations
    });
    const matchesCustomer = selectedCustomerId === "all" || summary.customerIds.includes(Number(selectedCustomerId));
    const matchesLocation = selectedLocationId === "all" || summary.locationIds.includes(Number(selectedLocationId));

    if (!matchesSearch || !matchesCustomer || !matchesLocation) {
      continue;
    }

    rowMap.set(containerNo, {
      id: containerNo,
      containerNo,
      warehouseSummary: summarizeLabels(summary.warehouseNames),
      pickLocationSummary: summarizeLabels(summary.pickLocations, 3),
      customerSummary: summarizeLabels(summary.customerNames),
      customerIds: [...summary.customerIds],
      locationIds: [...summary.locationIds],
      skuCount: summary.skuSet.size,
      rowCount: 0,
      contentsPreview: summarizeLabels([...summary.skuSet], 3),
      onHand: 0,
      availableQty: 0,
      damagedQty: 0,
      receivedAt: summary.receivedAt,
      shippedAt: summary.shippedAt,
      items: [],
      warehouseNames: [...summary.warehouseNames],
      pickLocations: [...summary.pickLocations],
      customerNames: [...summary.customerNames],
      skuSet: new Set(summary.skuSet),
      itemNumbers: new Set(summary.itemNumbers),
      descriptionSet: new Set(summary.descriptionSet)
    });
  }

  return [...rowMap.values()]
    .map((row) => ({
      ...row,
      warehouseSummary: summarizeLabels(row.warehouseNames),
      pickLocationSummary: summarizeLabels(row.pickLocations, 3),
      customerSummary: summarizeLabels(row.customerNames),
      skuCount: row.skuSet.size,
      contentsPreview: summarizeLabels([...row.skuSet], 3)
    }))
    .sort((left, right) => {
      const leftHistorical = left.rowCount === 0 ? 1 : 0;
      const rightHistorical = right.rowCount === 0 ? 1 : 0;
      if (leftHistorical !== rightHistorical) {
        return leftHistorical - rightHistorical;
      }

      return left.containerNo.localeCompare(right.containerNo);
    });
}

export function buildContainerSkuCards(items: Item[]): ContainerSkuCard[] {
  const cardMap = new Map<string, {
    id: string;
    sku: string;
    itemNumber: string;
    description: string;
    customerNames: string[];
    storageLabels: string[];
    onHand: number;
    availableQty: number;
    damagedQty: number;
    holdQty: number;
    rowCount: number;
  }>();

  for (const item of items) {
    const key = `${item.customerId}:${item.sku.trim().toUpperCase()}`;
    const storageLabel = `${item.locationName} / ${normalizeStorageSection(item.storageSection)}`;
    const existing = cardMap.get(key);
    if (!existing) {
      cardMap.set(key, {
        id: key,
        sku: item.sku.trim().toUpperCase(),
        itemNumber: item.itemNumber?.trim() || "-",
        description: displayContainerItemDescription(item),
        customerNames: [item.customerName],
        storageLabels: [storageLabel],
        onHand: item.quantity,
        availableQty: item.availableQty,
        damagedQty: item.damagedQty,
        holdQty: item.holdQty,
        rowCount: 1
      });
      continue;
    }

    existing.onHand += item.quantity;
    existing.availableQty += item.availableQty;
    existing.damagedQty += item.damagedQty;
    existing.holdQty += item.holdQty;
    existing.rowCount += 1;
    if (!existing.customerNames.includes(item.customerName)) {
      existing.customerNames.push(item.customerName);
    }
    if (!existing.storageLabels.includes(storageLabel)) {
      existing.storageLabels.push(storageLabel);
    }
  }

  return [...cardMap.values()]
    .map((card) => ({
      id: card.id,
      customerId: Number(card.id.split(":")[0] || 0),
      sku: card.sku,
      itemNumber: card.itemNumber,
      description: card.description,
      customerSummary: summarizeLabels(card.customerNames),
      storageSummary: summarizeLabels(card.storageLabels, 3),
      onHand: card.onHand,
      availableQty: card.availableQty,
      damagedQty: card.damagedQty,
      holdQty: card.holdQty,
      rowCount: card.rowCount
    }))
    .sort((left, right) => left.customerSummary.localeCompare(right.customerSummary) || left.sku.localeCompare(right.sku));
}

function matchesContainerSearch(
  normalizedSearch: string,
  input: {
    containerNo: string;
    skuValues: string[];
    itemNumbers: string[];
    descriptions: string[];
    customerNames: string[];
    warehouseNames: string[];
    pickLocations: string[];
  }
) {
  if (!normalizedSearch) {
    return true;
  }

  return [
    input.containerNo,
    ...input.skuValues,
    ...input.itemNumbers,
    ...input.descriptions,
    ...input.customerNames,
    ...input.warehouseNames,
    ...input.pickLocations
  ].some((value) => value.toLowerCase().includes(normalizedSearch));
}

function summarizeLabels(values: string[], maxVisible = 2) {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  if (normalized.length === 0) {
    return "-";
  }

  const uniqueValues = [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
  if (uniqueValues.length <= maxVisible) {
    return uniqueValues.join(", ");
  }

  return `${uniqueValues.slice(0, maxVisible).join(", ")} +${uniqueValues.length - maxVisible}`;
}

function buildContainerMovementSummaryMap(items: Item[], movements: Movement[], locations: Location[]) {
  const activeContainers = new Set(
    items
      .map((item) => normalizeContainerNumber(item.containerNo))
      .filter(Boolean)
  );
  const locationNameToId = new Map(
    locations.map((location) => [location.name.trim().toLowerCase(), location.id] as const)
  );
  const draftMap = new Map<string, {
    receivedAt: string | null;
    lastOutboundAt: string | null;
    hasInboundReceipt: boolean;
    warehouseNames: string[];
    pickLocations: string[];
    customerNames: string[];
    customerIds: number[];
    locationIds: number[];
    skuSet: Set<string>;
    itemNumbers: Set<string>;
    descriptionSet: Set<string>;
  }>();

  for (const movement of movements) {
    const containerNo = normalizeContainerNumber(movement.containerNo);
    if (!containerNo) {
      continue;
    }

    const current = draftMap.get(containerNo) ?? {
      receivedAt: null,
      lastOutboundAt: null,
      hasInboundReceipt: false,
      warehouseNames: [],
      pickLocations: [],
      customerNames: [],
      customerIds: [],
      locationIds: [],
      skuSet: new Set<string>(),
      itemNumbers: new Set<string>(),
      descriptionSet: new Set<string>()
    };
    const movementTimestamp = getMovementTimestamp(movement);
    const locationName = movement.locationName.trim();
    const pickLocation = locationName ? `${locationName} / ${normalizeStorageSection(movement.storageSection)}` : "";
    const description = getDescriptionLabel(movement.description, movement.itemName);

    if (movement.customerId > 0 && !current.customerIds.includes(movement.customerId)) {
      current.customerIds.push(movement.customerId);
    }
    if (movement.customerName.trim() && !current.customerNames.includes(movement.customerName)) {
      current.customerNames.push(movement.customerName);
    }
    if (locationName && !current.warehouseNames.includes(locationName)) {
      current.warehouseNames.push(locationName);
    }
    if (pickLocation && !current.pickLocations.includes(pickLocation)) {
      current.pickLocations.push(pickLocation);
    }

    const locationId = locationNameToId.get(locationName.toLowerCase());
    if (locationId && !current.locationIds.includes(locationId)) {
      current.locationIds.push(locationId);
    }
    if (movement.sku.trim()) {
      current.skuSet.add(movement.sku.trim().toUpperCase());
    }
    if (movement.itemNumber.trim()) {
      current.itemNumbers.add(movement.itemNumber.trim());
    }
    if (description !== "-") {
      current.descriptionSet.add(description);
    }

    if (movement.movementType === "IN") {
      current.receivedAt = getEarliestDate(current.receivedAt, movementTimestamp);
      current.hasInboundReceipt = true;
    } else if (movement.movementType === "TRANSFER_IN" && !current.hasInboundReceipt) {
      current.receivedAt = getEarliestDate(current.receivedAt, movementTimestamp);
    } else if (movement.movementType === "OUT" || movement.movementType === "TRANSFER_OUT") {
      current.lastOutboundAt = getLatestDate(current.lastOutboundAt, movementTimestamp);
    }

    draftMap.set(containerNo, current);
  }

  const timelineMap = new Map<string, {
    receivedAt: string | null;
    shippedAt: string | null;
    warehouseNames: string[];
    pickLocations: string[];
    customerNames: string[];
    customerIds: number[];
    locationIds: number[];
    skuSet: Set<string>;
    itemNumbers: Set<string>;
    descriptionSet: Set<string>;
  }>();
  for (const [containerNo, timeline] of draftMap.entries()) {
    timelineMap.set(containerNo, {
      receivedAt: timeline.receivedAt,
      shippedAt: activeContainers.has(containerNo) ? null : timeline.lastOutboundAt,
      warehouseNames: timeline.warehouseNames,
      pickLocations: timeline.pickLocations,
      customerNames: timeline.customerNames,
      customerIds: timeline.customerIds,
      locationIds: timeline.locationIds,
      skuSet: timeline.skuSet,
      itemNumbers: timeline.itemNumbers,
      descriptionSet: timeline.descriptionSet
    });
  }

  return timelineMap;
}

function getMovementTimestamp(movement: Movement) {
  return movement.createdAt || movement.outDate || movement.deliveryDate || null;
}

function getFallbackItemReceivedAt(item: Item) {
  return item.lastRestockedAt || item.createdAt || null;
}

function getDescriptionLabel(description: string | null | undefined, fallbackName: string | null | undefined) {
  return description?.trim() || fallbackName?.trim() || "-";
}

function isCalendarDateValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?Z)?$/.test(value.trim());
}

function getEarliestDate(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;

  const leftTime = parseDateLikeValue(left)?.getTime() ?? Number.NaN;
  const rightTime = parseDateLikeValue(right)?.getTime() ?? Number.NaN;
  if (Number.isNaN(leftTime)) return right;
  if (Number.isNaN(rightTime)) return left;
  return rightTime < leftTime ? right : left;
}

function getLatestDate(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;

  const leftTime = parseDateLikeValue(left)?.getTime() ?? Number.NaN;
  const rightTime = parseDateLikeValue(right)?.getTime() ?? Number.NaN;
  if (Number.isNaN(leftTime)) return right;
  if (Number.isNaN(rightTime)) return left;
  return rightTime > leftTime ? right : left;
}
