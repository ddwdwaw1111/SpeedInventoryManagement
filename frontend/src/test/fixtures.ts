import type {
  Customer,
  InboundDocument,
  InboundDocumentLine,
  Item,
  Location,
  Movement,
  OutboundDocument,
  OutboundDocumentLine,
  OutboundPickAllocation,
  SKUMaster
} from "../lib/types";

const ISO_DATE = "2026-03-24";
const ISO_TIMESTAMP = "2026-03-24T10:00:00Z";

export function createLocation(overrides: Partial<Location> = {}): Location {
  return {
    id: 1,
    name: "NJ",
    address: "255 Route 1 & 9",
    description: "Primary warehouse",
    capacity: 1000,
    sectionNames: ["TEMP", "A", "B"],
    layoutBlocks: [],
    createdAt: ISO_TIMESTAMP,
    ...overrides
  };
}

export function createCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 1,
    name: "Imperial Bag & Paper",
    contactName: "Dock Team",
    email: "dock@example.com",
    phone: "201-555-0100",
    notes: "",
    createdAt: ISO_TIMESTAMP,
    updatedAt: ISO_TIMESTAMP,
    ...overrides
  };
}

export function createSkuMaster(overrides: Partial<SKUMaster> = {}): SKUMaster {
  return {
    id: 1,
    itemNumber: "608333",
    sku: "608333",
    name: "608333",
    category: "General",
    description: "VB22GC",
    unit: "ctn",
    reorderLevel: 5,
    defaultUnitsPerPallet: 10,
    createdAt: ISO_TIMESTAMP,
    updatedAt: ISO_TIMESTAMP,
    ...overrides
  };
}

export function createItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 1,
    skuMasterId: 1,
    itemNumber: "608333",
    sku: "608333",
    name: "608333",
    category: "General",
    description: "VB22GC",
    unit: "ctn",
    quantity: 10,
    availableQty: 10,
    allocatedQty: 0,
    damagedQty: 0,
    holdQty: 0,
    reorderLevel: 5,
    customerId: 1,
    customerName: "Imperial Bag & Paper",
    locationId: 1,
    locationName: "NJ",
    storageSection: "TEMP",
    deliveryDate: ISO_DATE,
    containerNo: "GCXU5817233",
    lastRestockedAt: ISO_TIMESTAMP,
    createdAt: ISO_TIMESTAMP,
    updatedAt: ISO_TIMESTAMP,
    ...overrides
  };
}

export function createMovement(overrides: Partial<Movement> = {}): Movement {
  return {
    id: 1,
    itemId: 1,
    inboundDocumentId: 1,
    inboundDocumentLineId: 1,
    outboundDocumentId: 0,
    outboundDocumentLineId: 0,
    itemName: "608333",
    sku: "608333",
    description: "VB22GC",
    customerId: 1,
    customerName: "Imperial Bag & Paper",
    locationName: "NJ",
    storageSection: "TEMP",
    movementType: "IN",
    quantityChange: 10,
    deliveryDate: ISO_DATE,
    containerNo: "GCXU5817233",
    packingListNo: "",
    orderRef: "",
    itemNumber: "608333",
    expectedQty: 10,
    receivedQty: 10,
    pallets: 1,
    palletsDetailCtns: "1*10",
    cartonSizeMm: "",
    cartonCount: 0,
    unitLabel: "CTN",
    netWeightKgs: 0,
    grossWeightKgs: 0,
    heightIn: 0,
    outDate: null,
    documentNote: "",
    reason: "",
    referenceCode: "",
    createdAt: ISO_TIMESTAMP,
    ...overrides
  };
}

export function createInboundDocumentLine(overrides: Partial<InboundDocumentLine> = {}): InboundDocumentLine {
  return {
    id: 1,
    documentId: 1,
    sku: "608333",
    description: "VB22GC",
    storageSection: "TEMP",
    reorderLevel: 5,
    expectedQty: 10,
    receivedQty: 10,
    pallets: 1,
    unitsPerPallet: 0,
    palletsDetailCtns: "1*10",
    unitLabel: "CTN",
    lineNote: "",
    createdAt: ISO_TIMESTAMP,
    ...overrides
  };
}

export function createInboundDocument(overrides: Partial<InboundDocument> = {}): InboundDocument {
  return {
    id: 1,
    customerId: 1,
    customerName: "Imperial Bag & Paper",
    locationId: 1,
    locationName: "NJ",
    expectedArrivalDate: ISO_DATE,
    actualArrivalDate: null,
    containerNo: "GCXU5817233",
    handlingMode: "PALLETIZED",
    storageSection: "TEMP",
    unitLabel: "CTN",
    documentNote: "",
    status: "DRAFT",
    trackingStatus: "SCHEDULED",
    confirmedAt: null,
    cancelNote: "",
    cancelledAt: null,
    archivedAt: null,
    totalLines: 1,
    totalExpectedQty: 10,
    totalReceivedQty: 10,
    createdAt: ISO_TIMESTAMP,
    updatedAt: ISO_TIMESTAMP,
    lines: [createInboundDocumentLine()],
    ...overrides
  };
}

export function createOutboundPickAllocation(overrides: Partial<OutboundPickAllocation> = {}): OutboundPickAllocation {
  return {
    id: 1,
    lineId: 1,
    itemNumber: "608333",
    locationId: 1,
    locationName: "NJ",
    storageSection: "TEMP",
    containerNo: "GCXU5817233",
    allocatedQty: 5,
    createdAt: ISO_TIMESTAMP,
    ...overrides
  };
}

export function createOutboundDocumentLine(overrides: Partial<OutboundDocumentLine> = {}): OutboundDocumentLine {
  return {
    id: 1,
    documentId: 1,
    skuMasterId: 1,
    itemNumber: "608333",
    locationId: 1,
    locationName: "NJ",
    storageSection: "TEMP",
    sku: "608333",
    description: "VB22GC",
    quantity: 5,
    pallets: 1,
    palletsDetailCtns: "",
    unitLabel: "CTN",
    cartonSizeMm: "",
    netWeightKgs: 0,
    grossWeightKgs: 0,
    lineNote: "",
    pickPallets: [],
    pickAllocations: [createOutboundPickAllocation()],
    createdAt: ISO_TIMESTAMP,
    ...overrides
  };
}

export function createOutboundDocument(overrides: Partial<OutboundDocument> = {}): OutboundDocument {
  return {
    id: 1,
    packingListNo: "PL-1001",
    orderRef: "SO-1001",
    customerId: 1,
    customerName: "Imperial Bag & Paper",
    expectedShipDate: ISO_DATE,
    actualShipDate: null,
    shipToName: "Jersey City",
    shipToAddress: "255 Route 1 & 9",
    shipToContact: "201-555-0100",
    carrierName: "Internal Fleet",
    documentNote: "",
    status: "DRAFT",
    trackingStatus: "SCHEDULED",
    confirmedAt: null,
    cancelNote: "",
    cancelledAt: null,
    archivedAt: null,
    totalLines: 1,
    totalQty: 5,
    totalNetWeightKgs: 0,
    totalGrossWeightKgs: 0,
    storages: "NJ / TEMP",
    createdAt: ISO_TIMESTAMP,
    updatedAt: ISO_TIMESTAMP,
    lines: [createOutboundDocumentLine()],
    ...overrides
  };
}
