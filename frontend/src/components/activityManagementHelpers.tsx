import { Chip } from "@mui/material";

import { consumePendingActivityManagementLaunchContext, type ActivityManagementLaunchContext } from "../lib/activityManagementLaunchContext";
import { formatContainerDistributionSummary as formatContainerDistributionSummaryValue } from "../lib/containerBalances";
import { formatDateTimeValue, formatDateValue } from "../lib/dates";
import {
  normalizeDocumentStatus,
  normalizeInboundTrackingStatus as normalizeInboundTrackingStatusValue,
  normalizeOutboundTrackingStatus as normalizeOutboundTrackingStatusValue
} from "../lib/documentTracking";
import {
  DEFAULT_STORAGE_SECTION,
  getLocationSectionOptions,
  normalizeStorageSection,
  type InboundDocument,
  type Item,
  type Location,
  type OutboundDocument,
  type OutboundPickAllocation,
  type OutboundSourceReference,
  type SKUMaster
} from "../lib/types";
import type {
  ActivityMode,
  BatchOutboundLineState,
  InboundContainerWarningMatch,
  InboundReceiptVariance,
  OutboundAllocationLineSummary,
  OutboundAllocationPreviewResult,
  OutboundAllocationPreviewRow,
  OutboundInventoryCandidate,
  OutboundSourceOption
} from "./ActivityManagementPage";

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

function getActivityOutboundFulfillmentQuantity(
  line: Pick<BatchOutboundLineState, "plannedQuantity" | "quantity">
) {
  return Math.max(0, line.quantity || line.plannedQuantity);
}

export function displayDescription(item: Pick<Item, "description" | "name">) { return item.description || item.name; }
export function formatDate(value: string | null) { return formatDateValue(value, dateFormatter); }
export function numberInputValue(value: number) { return value === 0 ? "" : String(value); }
export function normalizeContainerNo(value: string) { return value.trim().toUpperCase(); }

export function levenshteinDistance(left: string, right: string) {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
    }
    for (let index = 0; index < current.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return previous[right.length];
}

export function getContainerSimilarity(left: string, right: string) {
  const normalizedLeft = normalizeContainerNo(left);
  const normalizedRight = normalizeContainerNo(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }
  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  const maxLength = Math.max(normalizedLeft.length, normalizedRight.length);
  if (maxLength === 0) {
    return 1;
  }

  return 1 - (levenshteinDistance(normalizedLeft, normalizedRight) / maxLength);
}

export function buildInboundContainerWarnings(
  containerNo: string,
  inboundDocuments: InboundDocument[],
  editingInboundDocumentId: number | null
) {
  const normalizedValue = normalizeContainerNo(containerNo);
  if (!normalizedValue) {
    return { exact: [] as InboundContainerWarningMatch[], similar: [] as InboundContainerWarningMatch[] };
  }

  const candidateDocuments = inboundDocuments.filter((document) =>
    document.id !== editingInboundDocumentId
    && normalizeDocumentStatus(document.status) !== "DELETED"
    && normalizeContainerNo(document.containerNo)
  );

  const exact = candidateDocuments
    .filter((document) => normalizeContainerNo(document.containerNo) === normalizedValue)
    .map((document) => ({
      documentId: document.id,
      containerNo: normalizeContainerNo(document.containerNo),
      customerName: document.customerName || "-",
      dateLabel: formatDate(document.actualArrivalDate || document.expectedArrivalDate || document.createdAt || ""),
      similarity: 1
    }));

  if (exact.length > 0) {
    return { exact, similar: [] as InboundContainerWarningMatch[] };
  }

  if (normalizedValue.length < 6) {
    return { exact, similar: [] as InboundContainerWarningMatch[] };
  }

  const uniqueSimilarMatches = new Map<string, InboundContainerWarningMatch>();
  for (const document of candidateDocuments) {
    const normalizedCandidate = normalizeContainerNo(document.containerNo);
    const similarity = getContainerSimilarity(normalizedValue, normalizedCandidate);
    if (similarity <= 0.9 || normalizedCandidate === normalizedValue) {
      continue;
    }

    const existingMatch = uniqueSimilarMatches.get(normalizedCandidate);
    const nextMatch = {
      documentId: document.id,
      containerNo: normalizedCandidate,
      customerName: document.customerName || "-",
      dateLabel: formatDate(document.actualArrivalDate || document.expectedArrivalDate || document.createdAt || ""),
      similarity
    };
    if (!existingMatch || nextMatch.similarity > existingMatch.similarity) {
      uniqueSimilarMatches.set(normalizedCandidate, nextMatch);
    }
  }

  const similar = Array.from(uniqueSimilarMatches.values())
    .sort((left, right) => right.similarity - left.similarity || left.containerNo.localeCompare(right.containerNo))
    .slice(0, 3);

  return { exact, similar };
}

export function mergeDocumentsById<T extends { id: number }>(primary: T[], extra: T[]) {
  const merged = new Map<number, T>();
  for (const document of primary) {
    merged.set(document.id, document);
  }
  for (const document of extra) {
    if (!document) {
      continue;
    }
    if (!merged.has(document.id)) {
      merged.set(document.id, document);
    }
  }
  return Array.from(merged.values());
}

export function inboundDocumentMatchesSearch(document: InboundDocument, normalizedSearch: string) {
  if (normalizedSearch.length === 0) {
    return true;
  }

  const searchableFields = [
    document.containerNo,
    document.customerName,
    document.locationName,
    document.storageSection,
    document.documentNote,
    document.status,
    document.trackingStatus,
    ...document.lines.flatMap((line) => [
      line.sku,
      line.description,
      line.storageSection,
      line.palletsDetailCtns,
      line.lineNote
    ])
  ];

  return searchableFields.some((value) => String(value ?? "").toLowerCase().includes(normalizedSearch));
}

export function outboundDocumentMatchesSearch(document: OutboundDocument, normalizedSearch: string) {
  if (normalizedSearch.length === 0) {
    return true;
  }

  const searchableFields = [
    document.pickingOrderNo,
    document.orderRef,
    document.customerName,
    document.shipToName,
    document.shipToAddress,
    document.shipToContact,
    document.carrierName,
    document.documentNote,
    document.status,
    document.trackingStatus,
    document.storages,
    ...document.lines.flatMap((line) => [
      line.itemNumber,
      line.locationName,
      line.storageSection,
      line.sku,
      line.description,
      line.palletsDetailCtns,
      line.unitLabel,
      line.cartonSizeMm,
      line.lineNote,
      ...line.pickAllocations.flatMap((allocation) => [
        allocation.itemNumber,
        allocation.locationName,
        allocation.storageSection,
        allocation.containerNo
      ])
    ])
  ];

  return searchableFields.some((value) => String(value ?? "").toLowerCase().includes(normalizedSearch));
}

export function calculateSuggestedReorderLevel(expectedQty: number, receivedQty: number) {
  const baseQty = receivedQty > 0 ? receivedQty : expectedQty;
  if (baseQty <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(baseQty * 0.2));
}

export function getInboundReceiptVariance(expectedQty: number, receivedQty: number): InboundReceiptVariance {
  if (expectedQty <= 0 || receivedQty === expectedQty) {
    return "MATCHED";
  }
  if (receivedQty > expectedQty) {
    return "OVER";
  }
  return "SHORT";
}

export function getInboundReceiptVarianceLabelKey(variance: InboundReceiptVariance) {
  switch (variance) {
    case "OVER":
      return "overReceived";
    case "SHORT":
      return "shortReceived";
    default:
      return "matched";
  }
}

export function getInboundReceiptVarianceClassName(variance: InboundReceiptVariance) {
  switch (variance) {
    case "OVER":
      return "status-pill--danger";
    case "SHORT":
      return "status-pill--alert";
    default:
      return "status-pill--ok";
  }
}

export function summarizeInboundDocumentSections(document: InboundDocument) {
  const sections = Array.from(new Set(
    document.lines
      .map((line) => (line.storageSection || "").trim().toUpperCase())
      .filter(Boolean)
  ));

  if (sections.length === 0) {
    return normalizeStorageSection(document.storageSection);
  }

  return sections.join(", ");
}

export function renderInboundDocumentStatus(document: InboundDocument, t: (key: string) => string) {
  return renderDocumentStatus(document.status, t);
}

export function renderDocumentStatus(status: string, t: (key: string) => string) {
  const normalizedStatus = normalizeDocumentStatus(status);

  if (normalizedStatus === "DELETED") {
    return <Chip label={t("deleted")} color="error" size="small" />;
  }

  if (normalizedStatus === "CONFIRMED") {
    return <Chip label={t("confirmed")} color="success" size="small" />;
  }

  return <Chip label={t("draft")} color="default" size="small" />;
}

export function formatDocumentStatusAuditValue(
  status: string,
  deletedAt: string | null | undefined,
  resolvedTimeZone: string
) {
  if (deletedAt) {
    return `${status} | ${formatDateTimeValue(deletedAt, resolvedTimeZone)}`;
  }
  return status;
}

export function renderInboundTrackingStatus(trackingStatus: string, documentStatus: string, t: (key: string) => string) {
  const normalizedTrackingStatus = normalizeInboundTrackingStatusValue(trackingStatus, documentStatus);
  if (normalizedTrackingStatus === "RECEIVED") {
    return <Chip label={t("receivedTracking")} color="success" size="small" variant="outlined" />;
  }
  if (normalizedTrackingStatus === "RECEIVING") {
    return <Chip label={t("receiving")} color="primary" size="small" variant="outlined" />;
  }
  if (normalizedTrackingStatus === "ARRIVED") {
    return <Chip label={t("arrived")} color="info" size="small" variant="outlined" />;
  }
  return <Chip label={t("scheduled")} color="default" size="small" variant="outlined" />;
}

export function renderOutboundTrackingStatus(trackingStatus: string, documentStatus: string, t: (key: string) => string) {
  const normalizedTrackingStatus = normalizeOutboundTrackingStatusValue(trackingStatus, documentStatus);
  if (normalizedTrackingStatus === "BO_RECEIVED") {
    return <Chip label={t("boReceivedTracking")} color="success" size="small" variant="filled" />;
  }
  if (normalizedTrackingStatus === "SHIPPED") {
    return <Chip label={t("shipped")} color="success" size="small" variant="outlined" />;
  }
  if (normalizedTrackingStatus === "PACKED") {
    return <Chip label={t("packed")} color="primary" size="small" variant="outlined" />;
  }
  if (normalizedTrackingStatus === "PICKING") {
    return <Chip label={t("picking")} color="info" size="small" variant="outlined" />;
  }
  return <Chip label={t("scheduled")} color="default" size="small" variant="outlined" />;
}

export function getInboundDocumentActionKey(documentId: number, action: string) {
  return `inbound-${documentId}-${action}`;
}

export function getOutboundDocumentActionKey(documentId: number, action: string) {
  return `outbound-${documentId}-${action}`;
}

export function buildPickSheetExportDocument(document: OutboundDocument, sourceOptions: OutboundSourceOption[]): OutboundDocument {
  if (normalizeDocumentStatus(document.status) !== "DRAFT") {
    return document;
  }
  if (document.lines.every((line) => !outboundDocumentLineRequiresPickAllocation(line) || line.pickAllocations.length > 0)) {
    return document;
  }

  const preview = buildOutboundAllocationPreview(
    document.lines.map((line) => ({
      id: String(line.id),
      sourceKey: buildOutboundSourceKey(document.customerId, line.locationId, line.skuMasterId),
      sourceSearch: "",
      plannedQuantity: line.plannedQuantity ?? line.quantity,
      quantity: line.actualQuantity ?? line.quantity,
      pallets: Math.max(0, line.pallets || 0),
      palletsDetailCtns: line.palletsDetailCtns || "",
      unitLabel: line.unitLabel || "",
      cartonSizeMm: line.cartonSizeMm || "",
      netWeightKgs: line.netWeightKgs || 0,
      grossWeightKgs: line.grossWeightKgs || 0,
      reason: line.lineNote || ""
    })),
    sourceOptions
  );

  const previewRowsByLineId = new Map<string, OutboundAllocationPreviewRow[]>();
  for (const row of preview.rows) {
    const existing = previewRowsByLineId.get(row.lineId);
    if (existing) {
      existing.push(row);
      continue;
    }
    previewRowsByLineId.set(row.lineId, [row]);
  }

  return {
    ...document,
    lines: document.lines.map((line) => {
      if (!outboundDocumentLineRequiresPickAllocation(line) || line.pickAllocations.length > 0) {
        return line;
      }
      return {
        ...line,
        pickAllocations: buildPreviewPickAllocations(line, previewRowsByLineId.get(String(line.id)) ?? [])
      };
    })
  };
}

export function outboundDocumentLineRequiresPickAllocation(
  line: Pick<OutboundDocument["lines"][number], "quantity" | "actualQuantity">
) {
  return Math.max(0, line.actualQuantity ?? line.quantity) > 0;
}

export function buildPreviewPickAllocations(
  line: OutboundDocument["lines"][number],
  previewRows: OutboundAllocationPreviewRow[]
): OutboundPickAllocation[] {
  if (previewRows.length === 0) {
    return [];
  }

  return previewRows.map((row, index) => {
    const remainingPallets = row.allocatedQty >= row.startingQty ? 0 : row.startingPallets;
    return {
      id: -(index + 1),
      lineId: line.id,
      itemNumber: row.itemNumber || line.itemNumber || "",
      locationId: line.locationId,
      locationName: row.locationName || line.locationName,
      storageSection: row.storageSection || line.storageSection,
      containerNo: row.containerNo || "",
      allocatedQty: row.allocatedQty,
      pallets: Math.max(0, row.startingPallets - remainingPallets),
      inventoryPalletsUsed: Math.max(0, row.pallets),
      startingPallets: Math.max(0, row.startingPallets),
      remainingPallets: Math.max(0, remainingPallets),
      createdAt: line.createdAt
    };
  });
}

export function buildOutboundAllocationPreview(lines: BatchOutboundLineState[], sourceOptions: OutboundSourceOption[]): OutboundAllocationPreviewResult {
  const reservedBySourceId = new Map<string, number>();
  const reservedPalletsBySourceId = new Map<string, number>();
  const rows: OutboundAllocationPreviewRow[] = [];
  const summaries = new Map<string, OutboundAllocationLineSummary>();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fulfillmentQuantity = getActivityOutboundFulfillmentQuantity(line);
    if (!line.sourceKey.trim() || fulfillmentQuantity <= 0) {
      continue;
    }

    const selectedSource = findOutboundSourceOption(sourceOptions, line.sourceKey);
    if (!selectedSource) {
      continue;
    }

    const summary: OutboundAllocationLineSummary = {
      lineId: line.id,
      lineLabel: `#${index + 1}`,
      sourceKey: selectedSource.sourceKey,
      itemNumber: selectedSource.itemNumber || "",
      sku: selectedSource.sku,
      description: selectedSource.description,
      locationName: selectedSource.locationName,
      storageSection: selectedSource.storageSections[0] || DEFAULT_STORAGE_SECTION,
      requestedQty: fulfillmentQuantity,
      allocatedQty: 0,
      shortageQty: 0,
      containerCount: 0
    };

    let remainingQty = fulfillmentQuantity;
    for (const candidate of selectedSource.candidates) {
      const sourceId = candidate.id;
      const effectiveAvailable = candidate.availableQty - (reservedBySourceId.get(sourceId) ?? 0);
      const startingPallets = Math.max(0, candidate.onHandPallets - (reservedPalletsBySourceId.get(sourceId) ?? 0));
      const startingQty = Math.max(0, candidate.onHandQty - (reservedBySourceId.get(sourceId) ?? 0));
      if (effectiveAvailable <= 0) {
        continue;
      }

      const allocatedQty = Math.min(effectiveAvailable, remainingQty);
      if (allocatedQty <= 0) {
        continue;
      }

      const allocatedPallets = automaticInventoryPalletsForAllocation(
        effectiveAvailable,
        startingPallets,
        allocatedQty
      );
      const remainingPallets = startingQty - allocatedQty > 0 ? startingPallets : 0;
      rows.push({
        id: `${line.id}-${candidate.id}`,
        lineId: line.id,
        lineLabel: summary.lineLabel,
        itemNumber: selectedSource.itemNumber || summary.itemNumber,
        sku: selectedSource.sku,
        description: selectedSource.description,
        locationName: candidate.locationName,
        storageSection: normalizeStorageSection(candidate.storageSection),
        containerNo: candidate.containerNo || "",
        positionLabel: candidate.positionLabel,
        allocatedQty,
        pallets: allocatedPallets,
        startingQty,
        startingPallets,
        remainingPallets
      });
      reservedBySourceId.set(sourceId, (reservedBySourceId.get(sourceId) ?? 0) + allocatedQty);
      reservedPalletsBySourceId.set(sourceId, (reservedPalletsBySourceId.get(sourceId) ?? 0) + Math.max(0, startingPallets - remainingPallets));
      summary.allocatedQty += allocatedQty;
      remainingQty -= allocatedQty;

      if (remainingQty === 0) {
        break;
      }
    }

    const containers = new Set(
      rows
        .filter((row) => row.lineLabel === summary.lineLabel)
        .map((row) => row.containerNo || `${row.locationName}/${row.storageSection}`)
    );
    summary.containerCount = containers.size;
    summary.shortageQty = Math.max(0, remainingQty);
    summaries.set(line.id, summary);
  }

  return {
    rows,
    summaries,
    totalRequestedQty: Array.from(summaries.values()).reduce((sum, summary) => sum + summary.requestedQty, 0),
    totalAllocatedQty: Array.from(summaries.values()).reduce((sum, summary) => sum + summary.allocatedQty, 0),
    totalContainerCount: new Set(rows.map((row) => row.containerNo || `${row.locationName}/${row.storageSection}`)).size,
    splitLineCount: Array.from(summaries.values()).filter((summary) => summary.containerCount > 1).length,
    shortageLineCount: Array.from(summaries.values()).filter((summary) => summary.shortageQty > 0).length
  };
}

export function compareOutboundInventoryCandidates(left: OutboundInventoryCandidate, right: OutboundInventoryCandidate) {
  const leftArrival = left.actualArrivalDate || left.createdAt || "";
  const rightArrival = right.actualArrivalDate || right.createdAt || "";
  if (!leftArrival && rightArrival) return 1;
  if (leftArrival && !rightArrival) return -1;
  if (leftArrival !== rightArrival) return leftArrival.localeCompare(rightArrival);
  if (left.locationName !== right.locationName) return left.locationName.localeCompare(right.locationName);
  if (left.storageSection !== right.storageSection) return left.storageSection.localeCompare(right.storageSection);
  if (left.containerNo !== right.containerNo) return left.containerNo.localeCompare(right.containerNo);
  return left.positionLabel.localeCompare(right.positionLabel);
}

export function buildOutboundSourceKey(customerId: number, locationId: number, skuMasterId: number) {
  return `${customerId}|${locationId}|${skuMasterId}`;
}

export function findOutboundSourceOption(sourceOptions: OutboundSourceOption[], sourceKey: string) {
  const normalizedSourceKey = sourceKey.trim();
  if (!normalizedSourceKey) {
    return undefined;
  }
  return sourceOptions.find((sourceOption) => sourceOption.sourceKey === normalizedSourceKey);
}

export function summarizeOutboundPickAllocations(document: OutboundDocument | null) {
  if (!document) {
    return {
      totalContainerCount: 0,
      totalPickRows: 0,
      splitLineCount: 0
    };
  }

  const allAllocations = document.lines.flatMap((line) => line.pickAllocations);
  return {
    totalContainerCount: new Set(allAllocations.map((allocation) => allocation.containerNo || `${allocation.locationName}/${normalizeStorageSection(allocation.storageSection)}`)).size,
    totalPickRows: allAllocations.length,
    splitLineCount: document.lines.filter((line) => {
      const containers = new Set(line.pickAllocations.map((allocation) => allocation.containerNo || `${allocation.locationName}/${normalizeStorageSection(allocation.storageSection)}`));
      return containers.size > 1;
    }).length
  };
}

export function buildPersistedOutboundSourceOptionsFromDocument(
  document: OutboundDocument | null,
  skuMastersByID: Map<number, SKUMaster>
) {
  const persistedSources = new Map<string, OutboundSourceOption>();
  if (!document) {
    return persistedSources;
  }

  for (const line of document.lines) {
    const sourceKey = buildOutboundSourceKey(document.customerId, line.locationId, line.skuMasterId);
    if (persistedSources.has(sourceKey)) {
      continue;
    }

    const uniqueContainers = new Set(
      line.pickAllocations.map((allocation) => allocation.containerNo || `${allocation.locationName}/${normalizeStorageSection(allocation.storageSection)}`)
    );
    const skuMasterUnit = skuMastersByID.get(line.skuMasterId)?.unit || "PCS";
    persistedSources.set(sourceKey, {
      sourceKey,
      customerId: document.customerId,
      customerName: document.customerName,
      locationId: line.locationId,
      locationName: line.locationName,
      skuMasterId: line.skuMasterId,
      sku: line.sku,
      itemNumber: line.itemNumber || "",
      description: line.description || "",
      unit: (line.unitLabel || skuMasterUnit).toUpperCase(),
      availableQty: 0,
      palletCount: Math.max(0, line.pallets || 0),
      storageSections: [normalizeStorageSection(line.storageSection || DEFAULT_STORAGE_SECTION)],
      containerCount: uniqueContainers.size,
      containerSummary: formatContainerDistributionSummaryValue(line.pickAllocations.map((allocation) => ({
        containerNo: allocation.containerNo,
        availableQty: allocation.allocatedQty,
        locationName: allocation.locationName,
        storageSection: allocation.storageSection
      }))),
      candidates: []
    });
  }

  return persistedSources;
}

export function normalizeActivityOutboundSourceSearch(value: string) {
  return value.trim().toUpperCase();
}

export function formatActivityOutboundSourceSearchLabel(source: OutboundSourceOption) {
  return `${source.sku} | ${source.itemNumber || "-"} | ${source.customerName} | ${source.description}`;
}

export function filterActivityOutboundSources(
  sourceOptions: OutboundSourceOption[],
  searchValue: string,
  selectedSourceKey: string
) {
  const normalizedSearch = normalizeActivityOutboundSourceSearch(searchValue);
  if (!normalizedSearch) {
    return sourceOptions;
  }
  return sourceOptions.filter((source) => {
    if (source.sourceKey === selectedSourceKey) {
      return true;
    }
    const normalizedLabel = normalizeActivityOutboundSourceSearch(formatActivityOutboundSourceSearchLabel(source));
    return normalizedLabel.includes(normalizedSearch)
      || normalizeActivityOutboundSourceSearch(source.sku).includes(normalizedSearch)
      || normalizeActivityOutboundSourceSearch(source.itemNumber).includes(normalizedSearch);
  });
}

export function buildPlanOnlyOutboundSourceOptionsFromReferences(
  references: OutboundSourceReference[],
  locations: Location[],
  lines: Pick<BatchOutboundLineState, "sourceKey" | "sourceSearch">[]
) {
  const sources = new Map<string, OutboundSourceOption>();
  const locationsByID = new Map(locations.map((location) => [location.id, location] as const));
  const addSource = (reference: OutboundSourceReference, location: Location) => {
      const sourceKey = buildOutboundSourceKey(reference.customerId, location.id, reference.skuMasterId);
      sources.set(sourceKey, {
        sourceKey,
        customerId: reference.customerId,
        customerName: reference.customerName,
        locationId: location.id,
        locationName: location.name,
        skuMasterId: reference.skuMasterId,
        sku: reference.sku,
        itemNumber: reference.itemNumber,
        description: reference.description,
        unit: (reference.unit || "PCS").toUpperCase(),
        availableQty: 0,
        palletCount: 0,
        storageSections: getLocationSectionOptions(location),
        containerCount: 0,
        containerSummary: "",
        candidates: []
      });
  };

  for (const line of lines) {
    const [selectedCustomerID, selectedLocationID, selectedSKUMasterID] = line.sourceKey
      .split("|")
      .map((value) => Number(value));
    if (selectedCustomerID > 0 && selectedLocationID > 0 && selectedSKUMasterID > 0) {
      const selectedReference = references.find((reference) => (
        reference.customerId === selectedCustomerID && reference.skuMasterId === selectedSKUMasterID
      ));
      const selectedLocation = locationsByID.get(selectedLocationID);
      if (selectedReference && selectedLocation) {
        addSource(selectedReference, selectedLocation);
      }
    }

    const normalizedSearch = normalizeActivityOutboundSourceSearch(line.sourceSearch);
    if (!normalizedSearch) {
      continue;
    }
    const matchingReferences = references.filter((reference) => {
      const normalizedLabel = normalizeActivityOutboundSourceSearch(
        `${reference.sku} | ${reference.itemNumber || "-"} | ${reference.customerName} | ${reference.description}`
      );
      return normalizedLabel.includes(normalizedSearch)
        || normalizeActivityOutboundSourceSearch(reference.sku).includes(normalizedSearch)
        || normalizeActivityOutboundSourceSearch(reference.itemNumber).includes(normalizedSearch);
    });
    for (const reference of matchingReferences) {
      for (const location of locations) {
        addSource(reference, location);
      }
    }
  }

  return [...sources.values()];
}

export function buildOutboundSourceOptionsFromItems(items: Item[], skuMastersByID: Map<number, SKUMaster>): OutboundSourceOption[] {
  const grouped = new Map<string, OutboundSourceOption>();
  for (const item of items) {
    if (item.availableQty <= 0 || !item.containerNo.trim()) {
      continue;
    }
    const storageSection = normalizeStorageSection(item.storageSection);
    const containerNo = item.containerNo.trim().toUpperCase();
    const sourceKey = buildOutboundSourceKey(item.customerId, item.locationId, item.skuMasterId);
    const candidate: OutboundInventoryCandidate = {
      id: `item-${item.id}`,
      inventoryItemId: item.id,
      positionLabel: containerNo,
      customerId: item.customerId,
      customerName: item.customerName,
      locationId: item.locationId,
      locationName: item.locationName,
      storageSection,
      containerNo,
      skuMasterId: item.skuMasterId,
      sku: item.sku,
      itemNumber: item.itemNumber || "",
      description: item.description || item.name || "",
      unit: (item.unit || skuMastersByID.get(item.skuMasterId)?.unit || "PCS").toUpperCase(),
      availableQty: item.availableQty,
      availablePallets: Math.max(0, item.availablePallets),
      onHandQty: Math.max(0, item.quantity ?? 0, item.availableQty + (item.allocatedQty ?? 0)),
      onHandPallets: Math.max(0, item.pallets ?? 0, item.availablePallets + (item.allocatedPallets ?? 0)),
      actualArrivalDate: item.deliveryDate,
      createdAt: item.createdAt
    };
    const existing = grouped.get(sourceKey);
    if (!existing) {
      grouped.set(sourceKey, {
        sourceKey,
        customerId: item.customerId,
        customerName: item.customerName,
        locationId: item.locationId,
        locationName: item.locationName,
        skuMasterId: item.skuMasterId,
        sku: item.sku,
        itemNumber: item.itemNumber || "",
        description: item.description || item.name || "",
        unit: candidate.unit,
        availableQty: item.availableQty,
        palletCount: candidate.availablePallets,
        storageSections: [storageSection],
        containerCount: 1,
        containerSummary: "",
        candidates: [candidate]
      });
      continue;
    }
    existing.availableQty += item.availableQty;
    existing.palletCount += candidate.availablePallets;
    if (!existing.storageSections.includes(storageSection)) {
      existing.storageSections.push(storageSection);
    }
    existing.candidates.push(candidate);
  }

  return [...grouped.values()].map((source) => {
    const sortedCandidates = [...source.candidates].sort(compareOutboundInventoryCandidates);
    return {
      ...source,
      storageSections: [...source.storageSections].sort(),
      containerCount: new Set(sortedCandidates.map((candidate) => candidate.containerNo)).size,
      containerSummary: formatContainerDistributionSummaryValue(sortedCandidates.map((candidate) => ({
        containerNo: candidate.containerNo,
        availableQty: candidate.availableQty,
        locationName: candidate.locationName,
        storageSection: candidate.storageSection
      }))),
      candidates: sortedCandidates
    };
  }).sort((left, right) => left.customerName.localeCompare(right.customerName)
    || left.locationName.localeCompare(right.locationName)
    || left.sku.localeCompare(right.sku));
}

export function automaticInventoryPalletsForAllocation(availableQty: number, availablePallets: number, allocatedQty: number) {
  if (availableQty <= 0 || availablePallets <= 0 || allocatedQty <= 0) {
    return 0;
  }
  if (allocatedQty >= availableQty) {
    return availablePallets;
  }
  return Math.min(availablePallets, Math.max(1, Math.ceil(availablePallets * allocatedQty / availableQty)));
}
export function consumeHistoryLaunchContext(mode: ActivityMode): ActivityManagementLaunchContext | null {
  const state = window.history.state;
  if (!state || typeof state !== "object") {
    return null;
  }

  const page = typeof (state as { page?: unknown }).page === "string"
    ? String((state as { page?: unknown }).page)
    : "";
  const documentId = typeof (state as { documentId?: unknown }).documentId === "number"
    ? Number((state as { documentId?: unknown }).documentId)
    : 0;
  const expectedPage = mode === "IN" ? "inbound-management" : "outbound-management";

  if (page !== expectedPage || documentId <= 0) {
    return null;
  }

  const nextState = { ...(state as Record<string, unknown>) };
  delete nextState.documentId;
  window.history.replaceState(nextState, "", window.location.pathname);

  return { documentId };
}

export function formatContainerDistributionSummary(containers: Map<string, number>) {
  if (containers.size === 0) {
    return "";
  }

  return [...containers.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([containerNo, quantity]) => `${containerNo}:${quantity}`)
    .join(" · ");
}

