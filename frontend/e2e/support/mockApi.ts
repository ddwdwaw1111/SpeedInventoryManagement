import type { Page, Route } from "@playwright/test";
import type {
  AuthResponse,
  CycleCount,
  CycleCountPayload,
  Customer,
  InboundDocument,
  InboundDocumentPayload,
  InventoryAdjustment,
  InventoryAdjustmentPayload,
  InventoryTransfer,
  InventoryTransferPayload,
  Item,
  Location,
  Movement,
  OperationsReport,
  OutboundDocument,
  OutboundDocumentPayload,
  PalletLocationEvent,
  PalletTrace,
  UIPreference,
  User
} from "../../src/lib/types";

const NOW = "2026-04-25T09:30:00Z";

type OperationsReportResolver = OperationsReport | ((url: URL) => OperationsReport);

export type MockAppApiOptions = {
  session?: AuthResponse;
  customers?: Customer[];
  locations?: Location[];
  items?: Item[];
  movements?: Movement[];
  pallets?: PalletTrace[];
  palletLocationEvents?: PalletLocationEvent[];
  adjustments?: InventoryAdjustment[];
  inboundDocuments?: InboundDocument[];
  outboundDocuments?: OutboundDocument[];
  transfers?: InventoryTransfer[];
  cycleCounts?: CycleCount[];
  operationsReport?: OperationsReportResolver;
};

export type MockAppApiState = {
  operationsRequests: URL[];
  postedAdjustments: InventoryAdjustmentPayload[];
  postedInboundDocuments: InboundDocumentPayload[];
  postedOutboundDocuments: OutboundDocumentPayload[];
  postedTransfers: InventoryTransferPayload[];
  postedCycleCounts: CycleCountPayload[];
  updatedInboundTrackingStatuses: Array<{ documentId: number; trackingStatus: string }>;
  updatedOutboundTrackingStatuses: Array<{ documentId: number; trackingStatus: string }>;
  copiedInboundDocuments: Array<{ sourceDocumentId: number; copiedDocumentId: number }>;
  copiedOutboundDocuments: Array<{ sourceDocumentId: number; copiedDocumentId: number }>;
};

export async function mockAppApi(page: Page, options: MockAppApiOptions = {}): Promise<MockAppApiState> {
  const state: MockAppApiState = {
    operationsRequests: [],
    postedAdjustments: [],
    postedInboundDocuments: [],
    postedOutboundDocuments: [],
    postedTransfers: [],
    postedCycleCounts: [],
    updatedInboundTrackingStatuses: [],
    updatedOutboundTrackingStatuses: [],
    copiedInboundDocuments: [],
    copiedOutboundDocuments: []
  };

  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("sim-language", "en");
  });

  const session = options.session ?? buildSession();
  const customers = options.customers ?? [buildCustomer()];
  const locations = options.locations ?? [buildLocation()];
  const items = options.items ?? [];
  const movements = options.movements ?? [];
  const pallets = options.pallets ?? [];
  const palletLocationEvents = options.palletLocationEvents ?? [];
  const adjustmentStore = [...(options.adjustments ?? [])];
  const inboundDocumentStore = [...(options.inboundDocuments ?? [])];
  const outboundDocumentStore = [...(options.outboundDocuments ?? [])];
  const transferStore = [...(options.transfers ?? [])];
  const cycleCountStore = [...(options.cycleCounts ?? [])];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const apiPath = url.pathname.startsWith("/api") ? url.pathname.slice(4) : url.pathname;

    if (request.method() === "GET" && apiPath === "/auth/me") {
      return json(route, session);
    }
    if (request.method() === "POST" && apiPath === "/auth/logout") {
      return route.fulfill({ status: 204 });
    }
    if (request.method() === "GET" && apiPath === "/locations") {
      return json(route, locations);
    }
    if (request.method() === "GET" && apiPath === "/customers") {
      return json(route, customers);
    }
    if (request.method() === "GET" && apiPath === "/sku-master") {
      return json(route, []);
    }
    if (request.method() === "GET" && apiPath === "/items") {
      return json(route, items);
    }
    if (request.method() === "GET" && apiPath === "/movements") {
      return json(route, movements);
    }
    if (request.method() === "GET" && apiPath === "/inbound-documents") {
      return json(route, inboundDocumentStore);
    }
    if (request.method() === "POST" && apiPath === "/inbound-documents") {
      const payload = request.postDataJSON() as InboundDocumentPayload;
      state.postedInboundDocuments.push(payload);
      const createdDocument = buildInboundDocument(payload, inboundDocumentStore.length + 1, customers, locations);
      inboundDocumentStore.unshift(createdDocument);
      return json(route, createdDocument, 201);
    }
    if (request.method() === "POST" && /^\/inbound-documents\/\d+\/tracking-status$/.test(apiPath)) {
      const documentId = Number(apiPath.match(/^\/inbound-documents\/(\d+)\/tracking-status$/)?.[1] ?? "0");
      const payload = request.postDataJSON() as { trackingStatus?: string };
      const document = inboundDocumentStore.find((entry) => entry.id === documentId);
      if (!document) {
        return route.fulfill({ status: 404 });
      }
      document.trackingStatus = payload.trackingStatus ?? document.trackingStatus;
      document.updatedAt = NOW;
      state.updatedInboundTrackingStatuses.push({
        documentId,
        trackingStatus: document.trackingStatus
      });
      return json(route, document);
    }
    if (request.method() === "POST" && /^\/inbound-documents\/\d+\/copy$/.test(apiPath)) {
      const documentId = Number(apiPath.match(/^\/inbound-documents\/(\d+)\/copy$/)?.[1] ?? "0");
      const sourceDocument = inboundDocumentStore.find((entry) => entry.id === documentId);
      if (!sourceDocument) {
        return route.fulfill({ status: 404 });
      }
      const copiedDocumentId = nextDocumentId(inboundDocumentStore);
      const copiedDocument = cloneInboundDocument(sourceDocument, copiedDocumentId);
      inboundDocumentStore.unshift(copiedDocument);
      state.copiedInboundDocuments.push({
        sourceDocumentId: documentId,
        copiedDocumentId
      });
      return json(route, copiedDocument);
    }
    if (request.method() === "GET" && apiPath === "/outbound-documents") {
      return json(route, outboundDocumentStore);
    }
    if (request.method() === "POST" && apiPath === "/outbound-documents") {
      const payload = request.postDataJSON() as OutboundDocumentPayload;
      state.postedOutboundDocuments.push(payload);
      const createdDocument = buildOutboundDocument(payload, outboundDocumentStore.length + 1, customers, locations);
      outboundDocumentStore.unshift(createdDocument);
      return json(route, createdDocument, 201);
    }
    if (request.method() === "POST" && /^\/outbound-documents\/\d+\/tracking-status$/.test(apiPath)) {
      const documentId = Number(apiPath.match(/^\/outbound-documents\/(\d+)\/tracking-status$/)?.[1] ?? "0");
      const payload = request.postDataJSON() as { trackingStatus?: string };
      const document = outboundDocumentStore.find((entry) => entry.id === documentId);
      if (!document) {
        return route.fulfill({ status: 404 });
      }
      document.trackingStatus = payload.trackingStatus ?? document.trackingStatus;
      document.updatedAt = NOW;
      state.updatedOutboundTrackingStatuses.push({
        documentId,
        trackingStatus: document.trackingStatus
      });
      return json(route, document);
    }
    if (request.method() === "POST" && /^\/outbound-documents\/\d+\/copy$/.test(apiPath)) {
      const documentId = Number(apiPath.match(/^\/outbound-documents\/(\d+)\/copy$/)?.[1] ?? "0");
      const sourceDocument = outboundDocumentStore.find((entry) => entry.id === documentId);
      if (!sourceDocument) {
        return route.fulfill({ status: 404 });
      }
      const copiedDocumentId = nextDocumentId(outboundDocumentStore);
      const copiedDocument = cloneOutboundDocument(sourceDocument, copiedDocumentId);
      outboundDocumentStore.unshift(copiedDocument);
      state.copiedOutboundDocuments.push({
        sourceDocumentId: documentId,
        copiedDocumentId
      });
      return json(route, copiedDocument);
    }
    if (request.method() === "GET" && apiPath === "/adjustments") {
      return json(route, adjustmentStore);
    }
    if (request.method() === "POST" && apiPath === "/adjustments") {
      const payload = request.postDataJSON() as InventoryAdjustmentPayload;
      state.postedAdjustments.push(payload);
      const createdAdjustment = buildInventoryAdjustment(payload, adjustmentStore.length + 1);
      adjustmentStore.unshift(createdAdjustment);
      return json(route, createdAdjustment, 201);
    }
    if (request.method() === "GET" && apiPath === "/transfers") {
      return json(route, transferStore);
    }
    if (request.method() === "POST" && apiPath === "/transfers") {
      const payload = request.postDataJSON() as InventoryTransferPayload;
      state.postedTransfers.push(payload);
      const createdTransfer = buildInventoryTransfer(payload, transferStore.length + 1, customers, locations, items);
      transferStore.unshift(createdTransfer);
      return json(route, createdTransfer, 201);
    }
    if (request.method() === "GET" && apiPath === "/cycle-counts") {
      return json(route, cycleCountStore);
    }
    if (request.method() === "POST" && apiPath === "/cycle-counts") {
      const payload = request.postDataJSON() as CycleCountPayload;
      state.postedCycleCounts.push(payload);
      const createdCycleCount = buildCycleCount(payload, cycleCountStore.length + 1, customers, locations, items, pallets);
      cycleCountStore.unshift(createdCycleCount);
      return json(route, createdCycleCount, 201);
    }
    if (request.method() === "GET" && apiPath === "/audit-logs") {
      return json(route, []);
    }
    if (request.method() === "GET" && apiPath === "/users") {
      return json(route, [session.user]);
    }
    if (request.method() === "GET" && apiPath === "/pallets") {
      const searchTerm = url.searchParams.get("search") ?? "";
      const sourceInboundDocumentId = Number(url.searchParams.get("sourceInboundDocumentId") ?? "");
      const limit = Number(url.searchParams.get("limit") ?? "");
      const filteredPallets = filterPallets(pallets, {
        searchTerm,
        sourceInboundDocumentId: Number.isFinite(sourceInboundDocumentId) ? sourceInboundDocumentId : undefined
      });
      const limitedPallets = Number.isFinite(limit) && limit > 0
        ? filteredPallets.slice(0, limit)
        : filteredPallets;
      return json(route, limitedPallets);
    }
    if (request.method() === "GET" && apiPath === "/pallet-location-events") {
      return json(route, palletLocationEvents);
    }
    if (request.method() === "GET" && apiPath.startsWith("/ui-preferences/")) {
      return json(route, buildUIPreference(apiPath.split("/").at(-1) ?? "", null));
    }
    if (request.method() === "PUT" && apiPath.startsWith("/ui-preferences/")) {
      const key = apiPath.split("/").at(-1) ?? "";
      const body = request.postDataJSON() as { value?: unknown };
      return json(route, buildUIPreference(key, body.value ?? null));
    }
    if (request.method() === "GET" && apiPath === "/reports/operations") {
      state.operationsRequests.push(new URL(url.toString()));
      const report = typeof options.operationsReport === "function"
        ? options.operationsReport(url)
        : (options.operationsReport ?? buildOperationsReport());
      return json(route, report);
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: `Unhandled mock endpoint: ${request.method()} ${apiPath}` })
    });
  });

  return state;
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

function buildSession(overrides: Partial<AuthResponse> = {}): AuthResponse {
  return {
    user: buildUser(),
    expiresAt: "2026-04-26T09:30:00Z",
    ...overrides
  };
}

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    email: "playwright@example.com",
    fullName: "Playwright Admin",
    role: "admin",
    isActive: true,
    createdAt: NOW,
    ...overrides
  };
}

function buildUIPreference<T>(key: string, value: T | null): UIPreference<T> {
  return {
    id: 1,
    scopeType: "system",
    scopeId: 0,
    key: decodeURIComponent(key),
    value,
    updatedByUserId: 1,
    createdAt: NOW,
    updatedAt: NOW
  };
}

export function buildCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 1,
    name: "Play Customer",
    contactName: "Taylor",
    email: "customer@example.com",
    phone: "555-0100",
    notes: "",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

export function buildLocation(overrides: Partial<Location> = {}): Location {
  return {
    id: 1,
    name: "NJ Warehouse",
    address: "1 Dock Way",
    description: "Primary warehouse",
    capacity: 1200,
    sectionNames: ["TEMP", "A"],
    layoutBlocks: [],
    createdAt: NOW,
    ...overrides
  };
}

export function buildItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 1,
    skuMasterId: 101,
    itemNumber: "ITEM-100",
    sku: "SKU-PLAY",
    name: "Play SKU",
    category: "General",
    description: "Playwright test stock",
    unit: "EA",
    quantity: 25,
    availableQty: 25,
    allocatedQty: 0,
    damagedQty: 0,
    holdQty: 0,
    reorderLevel: 5,
    customerId: 1,
    customerName: "Play Customer",
    locationId: 1,
    locationName: "NJ Warehouse",
    storageSection: "TEMP",
    deliveryDate: "2026-04-20",
    containerNo: "CONT-PLAY-1",
    lastRestockedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

export function buildMovement(overrides: Partial<Movement> = {}): Movement {
  return {
    id: 801,
    itemId: 1,
    inboundDocumentId: 1,
    inboundDocumentLineId: 1,
    outboundDocumentId: 0,
    outboundDocumentLineId: 0,
    itemName: "ITEM-100",
    sku: "SKU-PLAY",
    description: "Playwright test stock",
    customerId: 1,
    customerName: "Play Customer",
    locationName: "NJ Warehouse",
    storageSection: "TEMP",
    movementType: "IN",
    quantityChange: 25,
    deliveryDate: "2026-04-20",
    containerNo: "CONT-PLAY-1",
    packingListNo: "",
    orderRef: "",
    itemNumber: "ITEM-100",
    expectedQty: 25,
    receivedQty: 25,
    pallets: 1,
    palletsDetailCtns: "1*25",
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
    createdAt: NOW,
    ...overrides
  };
}

export function buildPalletTrace(overrides: Partial<PalletTrace> = {}): PalletTrace {
  return {
    id: 501,
    parentPalletId: 0,
    palletCode: "PLT-PLAY-001",
    containerVisitId: 90,
    sourceInboundDocumentId: 91,
    sourceInboundLineId: 92,
    actualArrivalDate: "2026-04-20",
    containerType: "NORMAL",
    customerId: 1,
    customerName: "Play Customer",
    skuMasterId: 101,
    sku: "SKU-PLAY",
    description: "Playwright test stock",
    currentLocationId: 1,
    currentLocationName: "NJ Warehouse",
    currentStorageSection: "TEMP",
    currentContainerNo: "CONT-PLAY-1",
    status: "OPEN",
    createdAt: NOW,
    updatedAt: NOW,
    contents: [
      {
        id: 601,
        palletId: 501,
        skuMasterId: 101,
        itemNumber: "ITEM-100",
        sku: "SKU-PLAY",
        description: "Playwright test stock",
        quantity: 25,
        allocatedQty: 0,
        damagedQty: 0,
        holdQty: 0,
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    ...overrides
  };
}

export function buildPalletLocationEvent(overrides: Partial<PalletLocationEvent> = {}): PalletLocationEvent {
  return {
    id: 701,
    palletId: 501,
    palletCode: "PLT-PLAY-001",
    containerVisitId: 90,
    customerId: 1,
    customerName: "Play Customer",
    locationId: 1,
    locationName: "NJ Warehouse",
    storageSection: "TEMP",
    containerNo: "CONT-PLAY-1",
    eventType: "RECEIVED",
    quantityDelta: 25,
    palletDelta: 1,
    eventTime: NOW,
    createdAt: NOW,
    ...overrides
  };
}

function filterPallets(
  pallets: PalletTrace[],
  filters: {
    searchTerm?: string;
    sourceInboundDocumentId?: number;
  }
) {
  const normalizedSearch = filters.searchTerm?.trim().toUpperCase() ?? "";
  const hasSearch = normalizedSearch.length > 0;
  const sourceInboundDocumentId = filters.sourceInboundDocumentId && filters.sourceInboundDocumentId > 0
    ? filters.sourceInboundDocumentId
    : undefined;

  return pallets.filter((pallet) => {
    if (sourceInboundDocumentId && pallet.sourceInboundDocumentId !== sourceInboundDocumentId) {
      return false;
    }

    if (!hasSearch) {
      return true;
    }

    const searchableValues = [
      pallet.palletCode,
      pallet.customerName,
      pallet.sku,
      pallet.description,
      pallet.currentLocationName,
      pallet.currentStorageSection,
      pallet.currentContainerNo,
      ...pallet.contents.flatMap((content) => [
        content.itemNumber,
        content.sku,
        content.description
      ])
    ];

    return searchableValues.some((value) => normalizeValue(value).includes(normalizedSearch));
  });
}

function nextDocumentId(documents: Array<{ id: number }>) {
  return documents.reduce((maxId, document) => Math.max(maxId, document.id), 0) + 1;
}

function cloneInboundDocument(document: InboundDocument, id: number): InboundDocument {
  return {
    ...document,
    id,
    status: "DRAFT",
    trackingStatus: "SCHEDULED",
    confirmedAt: null,
    deletedAt: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    lines: document.lines.map((line, index) => ({
      ...line,
      id: id * 100 + index + 1,
      documentId: id,
      createdAt: NOW
    }))
  };
}

function cloneOutboundDocument(document: OutboundDocument, id: number): OutboundDocument {
  return {
    ...document,
    id,
    status: "DRAFT",
    trackingStatus: "SCHEDULED",
    confirmedAt: null,
    deletedAt: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    lines: document.lines.map((line, index) => ({
      ...line,
      id: id * 100 + index + 1,
      documentId: id,
      createdAt: NOW
    }))
  };
}

export function buildOperationsReport(overrides: Partial<OperationsReport> = {}): OperationsReport {
  return {
    startDate: "2026-04-01",
    endDate: "2026-04-30",
    granularity: "day",
    summary: {
      onHandUnits: 125,
      activeContainers: 3,
      palletsIn: 10,
      palletsOut: 4,
      netPalletFlow: 6,
      activeSkuCount: 2,
      activeWarehouseCount: 1,
      lowStockCount: 1,
      endingBalance: 18,
      peakBalance: 21,
      averageBalance: 15.5
    },
    locationInventoryRows: [
      { label: "NJ Warehouse", value: 125, skuCount: 2 }
    ],
    topSkuRows: [
      { label: "SKU-PLAY", value: 90, description: "Playwright test stock" },
      { label: "SKU-LOW", value: 35, description: "Low stock SKU" }
    ],
    lowStockRows: [
      { label: "SKU-LOW", value: 35, available: 3, reorder: 5 }
    ],
    palletFlowRows: [
      { dateKey: "2026-04-01", inbound: 4, outbound: 1, adjustmentDelta: 0, endOfDay: 12 },
      { dateKey: "2026-04-02", inbound: 6, outbound: 3, adjustmentDelta: 1, endOfDay: 16 }
    ],
    movementTrendRows: [
      { key: "2026-04-01", inbound: 80, outbound: 20 },
      { key: "2026-04-02", inbound: 45, outbound: 15 }
    ],
    ...overrides
  };
}

function buildInventoryAdjustment(payload: InventoryAdjustmentPayload, id: number): InventoryAdjustment {
  const createdAt = "2026-04-25T10:15:00Z";
  const lines = payload.lines.map((line, index) => ({
    id: id * 100 + index + 1,
    adjustmentId: id,
    customerId: line.customerId,
    customerName: line.customerId === 1 ? "Play Customer" : `Customer #${line.customerId}`,
    locationId: line.locationId,
    locationName: line.locationId === 1 ? "NJ Warehouse" : `Warehouse #${line.locationId}`,
    storageSection: line.storageSection,
    sku: line.skuMasterId === 101 ? "SKU-PLAY" : `SKU-${line.skuMasterId}`,
    description: line.skuMasterId === 101 ? "Playwright test stock" : "Inventory adjustment line",
    beforeQty: 25,
    adjustQty: line.adjustQty,
    afterQty: 25 + line.adjustQty,
    lineNote: line.lineNote ?? "",
    createdAt
  }));

  return {
    id,
    adjustmentNo: payload.adjustmentNo ?? `ADJ-PW-${String(id).padStart(3, "0")}`,
    reasonCode: payload.reasonCode,
    actualAdjustedAt: payload.actualAdjustedAt ?? createdAt,
    notes: payload.notes ?? "",
    status: "POSTED",
    totalLines: lines.length,
    totalAdjustQty: lines.reduce((sum, line) => sum + line.adjustQty, 0),
    createdAt,
    updatedAt: createdAt,
    lines
  };
}

function buildInventoryTransfer(
  payload: InventoryTransferPayload,
  id: number,
  customers: Customer[],
  locations: Location[],
  items: Item[]
): InventoryTransfer {
  const createdAt = "2026-04-25T10:50:00Z";
  const lines = payload.lines.map((line, index) => {
    const customer = customers.find((entry) => entry.id === line.customerId);
    const fromLocation = locations.find((entry) => entry.id === line.locationId);
    const toLocation = locations.find((entry) => entry.id === line.toLocationId);
    const item = findMatchingItem(items, line.customerId, line.locationId, line.storageSection, line.containerNo, line.skuMasterId);

    return {
      id: id * 100 + index + 1,
      transferId: id,
      customerId: line.customerId,
      customerName: customer?.name ?? `Customer #${line.customerId}`,
      fromLocationId: line.locationId,
      fromLocationName: fromLocation?.name ?? `Warehouse #${line.locationId}`,
      fromStorageSection: line.storageSection,
      toLocationId: line.toLocationId,
      toLocationName: toLocation?.name ?? `Warehouse #${line.toLocationId}`,
      toStorageSection: line.toStorageSection ?? "TEMP",
      sku: item?.sku ?? `SKU-${line.skuMasterId}`,
      description: item?.description || item?.name || "Inventory transfer line",
      quantity: line.quantity,
      lineNote: line.lineNote ?? "",
      createdAt
    };
  });

  return {
    id,
    transferNo: payload.transferNo ?? `TR-PW-${String(id).padStart(3, "0")}`,
    actualTransferredAt: payload.actualTransferredAt ?? null,
    notes: payload.notes ?? "",
    status: "POSTED",
    totalLines: lines.length,
    totalQty: lines.reduce((sum, line) => sum + line.quantity, 0),
    routes: Array.from(new Set(lines.map((line) => `${line.fromLocationName} -> ${line.toLocationName}`))).join(", "),
    createdAt,
    updatedAt: createdAt,
    lines
  };
}

function buildCycleCount(
  payload: CycleCountPayload,
  id: number,
  customers: Customer[],
  locations: Location[],
  items: Item[],
  pallets: PalletTrace[]
): CycleCount {
  const createdAt = "2026-04-25T11:00:00Z";
  const lines = payload.lines.map((line, index) => {
    const customer = customers.find((entry) => entry.id === line.customerId);
    const location = locations.find((entry) => entry.id === line.locationId);
    const item = findMatchingItem(items, line.customerId, line.locationId, line.storageSection, line.containerNo, line.skuMasterId);
    const pallet = line.palletId ? pallets.find((entry) => entry.id === line.palletId) : undefined;
    const systemQty = line.createPallet
      ? 0
      : getPalletSkuQuantity(pallet, line.skuMasterId) || item?.quantity || 0;
    const countedQty = Math.max(0, line.countedQty);

    return {
      id: id * 100 + index + 1,
      cycleCountId: id,
      customerId: line.customerId,
      customerName: customer?.name ?? `Customer #${line.customerId}`,
      locationId: line.locationId,
      locationName: location?.name ?? `Warehouse #${line.locationId}`,
      storageSection: line.storageSection,
      sku: item?.sku ?? `SKU-${line.skuMasterId}`,
      description: item?.description || item?.name || "Cycle count line",
      systemQty,
      countedQty,
      varianceQty: countedQty - systemQty,
      lineNote: line.lineNote ?? "",
      createdAt
    };
  });

  return {
    id,
    countNo: payload.countNo ?? `COUNT-PW-${String(id).padStart(3, "0")}`,
    notes: payload.notes ?? "",
    status: "POSTED",
    totalLines: lines.length,
    totalVariance: lines.reduce((sum, line) => sum + line.varianceQty, 0),
    createdAt,
    updatedAt: createdAt,
    lines
  };
}

export function buildInboundDocument(
  payload: InboundDocumentPayload,
  id: number,
  customers: Customer[],
  locations: Location[]
): InboundDocument {
  const createdAt = "2026-04-25T10:30:00Z";
  const customer = customers.find((entry) => entry.id === payload.customerId);
  const location = locations.find((entry) => entry.id === payload.locationId);
  const lines = payload.lines.map((line, index) => ({
    id: id * 100 + index + 1,
    documentId: id,
    sku: line.sku,
    description: line.description,
    storageSection: line.storageSection ?? "TEMP",
    reorderLevel: line.reorderLevel,
    expectedQty: line.expectedQty,
    receivedQty: line.receivedQty,
    pallets: line.pallets,
    unitsPerPallet: line.unitsPerPallet ?? 0,
    palletsDetailCtns: line.palletsDetailCtns ?? "",
    palletBreakdown: line.palletBreakdown ?? [],
    unitLabel: payload.unitLabel ?? "CTN",
    lineNote: line.lineNote ?? "",
    createdAt
  }));

  return {
    id,
    customerId: payload.customerId,
    customerName: customer?.name ?? `Customer #${payload.customerId}`,
    locationId: payload.locationId,
    locationName: location?.name ?? `Warehouse #${payload.locationId}`,
    expectedArrivalDate: payload.expectedArrivalDate ?? null,
    actualArrivalDate: payload.actualArrivalDate ?? null,
    containerNo: payload.containerNo ?? "",
    containerType: payload.containerType ?? "NORMAL",
    handlingMode: payload.handlingMode === "SEALED_TRANSIT" ? "SEALED_TRANSIT" : "PALLETIZED",
    storageSection: payload.storageSection ?? "TEMP",
    unitLabel: payload.unitLabel ?? "CTN",
    documentNote: payload.documentNote ?? "",
    status: payload.status ?? "DRAFT",
    trackingStatus: payload.trackingStatus ?? ((payload.status ?? "DRAFT") === "CONFIRMED" ? "RECEIVED" : "SCHEDULED"),
    confirmedAt: (payload.status ?? "DRAFT") === "CONFIRMED" ? createdAt : null,
    deletedAt: null,
    archivedAt: null,
    totalLines: lines.length,
    totalExpectedQty: lines.reduce((sum, line) => sum + line.expectedQty, 0),
    totalReceivedQty: lines.reduce((sum, line) => sum + line.receivedQty, 0),
    createdAt,
    updatedAt: createdAt,
    lines
  };
}

function findMatchingItem(
  items: Item[],
  customerId: number,
  locationId: number,
  storageSection: string,
  containerNo: string,
  skuMasterId: number
) {
  const normalizedSection = normalizeValue(storageSection);
  const normalizedContainerNo = normalizeValue(containerNo);
  return items.find((entry) => (
    entry.customerId === customerId
    && entry.locationId === locationId
    && normalizeValue(entry.storageSection) === normalizedSection
    && normalizeValue(entry.containerNo) === normalizedContainerNo
    && entry.skuMasterId === skuMasterId
  ));
}

function getPalletSkuQuantity(pallet: PalletTrace | undefined, skuMasterId: number) {
  if (!pallet) {
    return 0;
  }

  return pallet.contents
    .filter((content) => content.skuMasterId === skuMasterId)
    .reduce((sum, content) => sum + Math.max(0, content.quantity), 0);
}

function normalizeValue(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase();
}

export function buildOutboundDocument(
  payload: OutboundDocumentPayload,
  id: number,
  customers: Customer[],
  locations: Location[]
): OutboundDocument {
  const createdAt = "2026-04-25T10:45:00Z";
  const customerID = payload.lines[0]?.customerId ?? 1;
  const customer = customers.find((entry) => entry.id === customerID);
  const lines = payload.lines.map((line, index) => {
    const location = locations.find((entry) => entry.id === line.locationId);
    return {
      id: id * 100 + index + 1,
      documentId: id,
      skuMasterId: line.skuMasterId,
      itemNumber: line.skuMasterId === 101 ? "ITEM-101" : String(line.skuMasterId),
      locationId: line.locationId,
      locationName: location?.name ?? `Warehouse #${line.locationId}`,
      storageSection: "TEMP",
      sku: line.skuMasterId === 101 ? "SKU-PLAY" : `SKU-${line.skuMasterId}`,
      description: line.skuMasterId === 101 ? "Playwright test stock" : "Scheduled shipment line",
      quantity: line.quantity,
      pallets: line.pallets,
      palletsDetailCtns: line.palletsDetailCtns ?? "",
      unitLabel: line.unitLabel ?? "PCS",
      cartonSizeMm: line.cartonSizeMm ?? "",
      netWeightKgs: line.netWeightKgs ?? 0,
      grossWeightKgs: line.grossWeightKgs ?? 0,
      lineNote: line.lineNote ?? "",
      pickPallets: line.pickPallets ?? [],
      pickAllocations: [],
      createdAt
    };
  });

  return {
    id,
    packingListNo: payload.packingListNo ?? `PL-PW-${String(id).padStart(3, "0")}`,
    orderRef: payload.orderRef ?? "",
    customerId: customerID,
    customerName: customer?.name ?? `Customer #${customerID}`,
    expectedShipDate: payload.expectedShipDate ?? null,
    actualShipDate: payload.actualShipDate ?? null,
    shipToName: payload.shipToName ?? "",
    shipToAddress: payload.shipToAddress ?? "",
    shipToContact: payload.shipToContact ?? "",
    carrierName: payload.carrierName ?? "",
    documentNote: payload.documentNote ?? "",
    status: payload.status ?? "DRAFT",
    trackingStatus: payload.trackingStatus ?? ((payload.status ?? "DRAFT") === "CONFIRMED" ? "SHIPPED" : "SCHEDULED"),
    confirmedAt: (payload.status ?? "DRAFT") === "CONFIRMED" ? createdAt : null,
    deletedAt: null,
    archivedAt: null,
    totalLines: lines.length,
    totalQty: lines.reduce((sum, line) => sum + line.quantity, 0),
    totalNetWeightKgs: lines.reduce((sum, line) => sum + line.netWeightKgs, 0),
    totalGrossWeightKgs: lines.reduce((sum, line) => sum + line.grossWeightKgs, 0),
    storages: Array.from(new Set(lines.map((line) => line.locationName))).join(", "),
    createdAt,
    updatedAt: createdAt,
    lines
  };
}
