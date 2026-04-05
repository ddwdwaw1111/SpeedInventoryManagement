export type UserRole = "admin" | "operator" | "viewer";

export type DashboardData = {
  totalItems: number;
  totalUnits: number;
  lowStockItems: number;
  locationsInUse: number;
  recentMovements: Movement[];
};

export type UIPreference<T = unknown> = {
  id: number;
  scopeType: string;
  scopeId: number;
  key: string;
  value: T | null;
  updatedByUserId: number;
  createdAt: string;
  updatedAt: string;
};

export type AuditLog = {
  id: number;
  actorUserId: number;
  actorEmail: string;
  actorName: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: number;
  targetLabel: string;
  summary: string;
  detailsJson: string;
  requestMethod: string;
  requestPath: string;
  createdAt: string;
};

export type User = {
  id: number;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
};

export type CreateUserPayload = {
  email: string;
  fullName: string;
  password: string;
  role: UserRole;
  isActive: boolean;
};

export type UpdateUserAccessPayload = {
  role: UserRole;
  isActive: boolean;
};

export type AuthResponse = {
  user: User;
  expiresAt: string;
};

export type LoginPayload = {
  email: string;
  password: string;
};

export type SignUpPayload = {
  email: string;
  fullName: string;
  password: string;
};

export type Location = {
  id: number;
  name: string;
  address: string;
  description: string;
  capacity: number;
  sectionNames: string[];
  layoutBlocks: StorageLayoutBlock[];
  createdAt: string;
};

export type StorageLayoutBlockType = "temporary" | "section" | "support";

export type StorageLayoutBlock = {
  id: string;
  name: string;
  type: StorageLayoutBlockType;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LocationPayload = {
  name: string;
  address: string;
  description: string;
  capacity: number;
  sectionNames: string[];
  layoutBlocks: StorageLayoutBlock[];
};

export const DEFAULT_STORAGE_SECTION = "TEMP";

export function normalizeStorageSection(value?: string | null) {
  const trimmed = (value ?? "").trim().toUpperCase();
  if (!trimmed) {
    return DEFAULT_STORAGE_SECTION;
  }
  return trimmed;
}

export function getLocationSectionOptions(location: Location | undefined) {
  const sectionNames = location?.sectionNames
    ?.map((sectionName) => normalizeStorageSection(sectionName))
    .filter(Boolean) ?? [];

  return Array.from(new Set([DEFAULT_STORAGE_SECTION, ...sectionNames]));
}

export type Customer = {
  id: number;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type CustomerPayload = {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  notes: string;
};

export type SKUMaster = {
  id: number;
  itemNumber: string;
  sku: string;
  name: string;
  category: string;
  description: string;
  unit: string;
  reorderLevel: number;
  defaultUnitsPerPallet: number;
  createdAt: string;
  updatedAt: string;
};

export type SKUMasterPayload = {
  itemNumber: string;
  sku: string;
  name: string;
  category: string;
  description: string;
  unit: string;
  reorderLevel: number;
  defaultUnitsPerPallet: number;
};

export type Item = {
  id: number;
  skuMasterId: number;
  itemNumber: string;
  sku: string;
  name: string;
  category: string;
  description: string;
  unit: string;
  quantity: number;
  availableQty: number;
  allocatedQty: number;
  damagedQty: number;
  holdQty: number;
  reorderLevel: number;
  customerId: number;
  customerName: string;
  locationId: number;
  locationName: string;
  storageSection: string;
  deliveryDate: string | null;
  containerNo: string;
  lastRestockedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InventoryProjectionRef = {
  customerId: number;
  locationId: number;
  storageSection: string;
  containerNo: string;
  skuMasterId: number;
};

export function buildInventoryProjectionKey(input: InventoryProjectionRef) {
  return [
    String(input.customerId),
    String(input.locationId),
    normalizeStorageSection(input.storageSection),
    (input.containerNo ?? "").trim().toUpperCase(),
    String(input.skuMasterId)
  ].join(":");
}

export function toInventoryProjectionRef(
  item: Pick<Item, "customerId" | "locationId" | "storageSection" | "containerNo" | "skuMasterId">
): InventoryProjectionRef {
  return {
    customerId: item.customerId,
    locationId: item.locationId,
    storageSection: normalizeStorageSection(item.storageSection),
    containerNo: (item.containerNo ?? "").trim().toUpperCase(),
    skuMasterId: item.skuMasterId
  };
}

export type Movement = {
  id: number;
  itemId: number;
  inboundDocumentId: number;
  inboundDocumentLineId: number;
  outboundDocumentId: number;
  outboundDocumentLineId: number;
  itemName: string;
  sku: string;
  description: string;
  customerId: number;
  customerName: string;
  locationName: string;
  storageSection: string;
  movementType: "IN" | "OUT" | "ADJUST" | "REVERSAL" | "TRANSFER_IN" | "TRANSFER_OUT" | "COUNT";
  quantityChange: number;
  deliveryDate: string | null;
  containerNo: string;
  packingListNo: string;
  orderRef: string;
  itemNumber: string;
  expectedQty: number;
  receivedQty: number;
  pallets: number;
  palletsDetailCtns: string;
  cartonSizeMm: string;
  cartonCount: number;
  unitLabel: string;
  netWeightKgs: number;
  grossWeightKgs: number;
  heightIn: number;
  outDate: string | null;
  documentNote: string;
  reason: string;
  referenceCode: string;
  createdAt: string;
};

export type PalletContent = {
  id: number;
  palletId: number;
  skuMasterId: number;
  itemNumber: string;
  sku: string;
  description: string;
  quantity: number;
  allocatedQty?: number;
  damagedQty?: number;
  holdQty?: number;
  createdAt: string;
  updatedAt: string;
};

export type PalletTrace = {
  id: number;
  parentPalletId: number;
  palletCode: string;
  containerVisitId: number;
  sourceInboundDocumentId: number;
  sourceInboundLineId: number;
  actualArrivalDate: string | null;
  customerId: number;
  customerName: string;
  skuMasterId: number;
  sku: string;
  description: string;
  currentLocationId: number;
  currentLocationName: string;
  currentStorageSection: string;
  currentContainerNo: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  contents: PalletContent[];
};

export type PalletLocationEvent = {
  id: number;
  palletId: number;
  palletCode: string;
  containerVisitId: number;
  customerId: number;
  customerName: string;
  locationId: number;
  locationName: string;
  storageSection: string;
  containerNo: string;
  eventType: string;
  quantityDelta: number;
  palletDelta: number;
  eventTime: string;
  createdAt: string;
};

export type OutboundDocumentLine = {
  id: number;
  documentId: number;
  skuMasterId: number;
  itemNumber: string;
  locationId: number;
  locationName: string;
  storageSection: string;
  sku: string;
  description: string;
  quantity: number;
  pallets: number;
  palletsDetailCtns: string;
  unitLabel: string;
  cartonSizeMm: string;
  netWeightKgs: number;
  grossWeightKgs: number;
  lineNote: string;
  pickPallets: OutboundLinePalletPick[];
  pickAllocations: OutboundPickAllocation[];
  createdAt: string;
};

export type OutboundLinePalletPick = {
  palletId: number;
  quantity: number;
};

export type OutboundPickAllocation = {
  id: number;
  lineId: number;
  itemNumber: string;
  locationId: number;
  locationName: string;
  storageSection: string;
  containerNo: string;
  allocatedQty: number;
  createdAt: string;
};

export type OutboundDocument = {
  id: number;
  packingListNo: string;
  orderRef: string;
  customerId: number;
  customerName: string;
  expectedShipDate: string | null;
  actualShipDate: string | null;
  shipToName: string;
  shipToAddress: string;
  shipToContact: string;
  carrierName: string;
  documentNote: string;
  status: string;
  trackingStatus: string;
  confirmedAt: string | null;
  cancelNote: string;
  cancelledAt: string | null;
  archivedAt: string | null;
  totalLines: number;
  totalQty: number;
  totalNetWeightKgs: number;
  totalGrossWeightKgs: number;
  storages: string;
  createdAt: string;
  updatedAt: string;
  lines: OutboundDocumentLine[];
};

export type OutboundDocumentLinePayload = {
  customerId: number;
  locationId: number;
  skuMasterId: number;
  quantity: number;
  pallets: number;
  palletsDetailCtns?: string;
  unitLabel?: string;
  cartonSizeMm?: string;
  netWeightKgs?: number;
  grossWeightKgs?: number;
  lineNote?: string;
  pickPallets?: OutboundLinePalletPick[];
};

export type OutboundDocumentPayload = {
  packingListNo?: string;
  orderRef?: string;
  expectedShipDate?: string;
  actualShipDate?: string;
  shipToName?: string;
  shipToAddress?: string;
  shipToContact?: string;
  carrierName?: string;
  status?: string;
  trackingStatus?: string;
  documentNote?: string;
  lines: OutboundDocumentLinePayload[];
};

export type CancelOutboundDocumentPayload = {
  reason?: string;
};

export type InboundDocumentLine = {
  id: number;
  documentId: number;
  sku: string;
  description: string;
  storageSection: string;
  reorderLevel: number;
  expectedQty: number;
  receivedQty: number;
  pallets: number;
  unitsPerPallet: number;
  palletsDetailCtns: string;
  palletBreakdown?: InboundPalletBreakdown[];
  unitLabel: string;
  lineNote: string;
  createdAt: string;
};

export type InboundPalletBreakdown = {
  quantity: number;
};

export type InboundDocument = {
  id: number;
  customerId: number;
  customerName: string;
  locationId: number;
  locationName: string;
  expectedArrivalDate: string | null;
  actualArrivalDate: string | null;
  containerNo: string;
  handlingMode: "PALLETIZED" | "SEALED_TRANSIT";
  storageSection: string;
  unitLabel: string;
  documentNote: string;
  status: string;
  trackingStatus: string;
  confirmedAt: string | null;
  cancelNote: string;
  cancelledAt: string | null;
  archivedAt: string | null;
  totalLines: number;
  totalExpectedQty: number;
  totalReceivedQty: number;
  createdAt: string;
  updatedAt: string;
  lines: InboundDocumentLine[];
};

export type InboundDocumentLinePayload = {
  sku: string;
  description: string;
  reorderLevel: number;
  expectedQty: number;
  receivedQty: number;
  pallets: number;
  unitsPerPallet?: number;
  palletsDetailCtns?: string;
  palletBreakdown?: InboundPalletBreakdown[];
  storageSection?: string;
  lineNote?: string;
};

export type InboundDocumentPayload = {
  customerId: number;
  locationId: number;
  expectedArrivalDate?: string;
  actualArrivalDate?: string;
  containerNo?: string;
  handlingMode?: string;
  storageSection?: string;
  unitLabel?: string;
  status?: string;
  trackingStatus?: string;
  documentNote?: string;
  lines: InboundDocumentLinePayload[];
};

export type DocumentTrackingStatusPayload = {
  trackingStatus: string;
};

export type InboundPackingListImportLine = {
  sequence: number;
  itemNumber: string;
  sku: string;
  description: string;
  quantity: number;
  unitLabel: string;
  cartonSizeMm: string;
  cartonCount: number;
  netWeightKgs: number;
  grossWeightKgs: number;
};

export type InboundPackingListImportPreview = {
  sourceFileName: string;
  title: string;
  containerNo: string;
  referenceCode: string;
  unitLabel: string;
  totalQty: number;
  totalCartons: number;
  totalNetWeightKgs: number;
  totalGrossWeightKgs: number;
  lines: InboundPackingListImportLine[];
};

export type CancelInboundDocumentPayload = {
  reason?: string;
};

export type InventoryAdjustmentLine = {
  id: number;
  adjustmentId: number;
  customerId: number;
  customerName: string;
  locationId: number;
  locationName: string;
  storageSection: string;
  sku: string;
  description: string;
  beforeQty: number;
  adjustQty: number;
  afterQty: number;
  lineNote: string;
  createdAt: string;
};

export type InventoryAdjustment = {
  id: number;
  adjustmentNo: string;
  reasonCode: string;
  actualAdjustedAt: string | null;
  notes: string;
  status: string;
  totalLines: number;
  totalAdjustQty: number;
  createdAt: string;
  updatedAt: string;
  lines: InventoryAdjustmentLine[];
};

export type InventoryAdjustmentLinePayload = {
  customerId: number;
  locationId: number;
  storageSection: string;
  containerNo: string;
  palletId?: number;
  skuMasterId: number;
  adjustQty: number;
  lineNote?: string;
};

export type InventoryAdjustmentPayload = {
  adjustmentNo?: string;
  reasonCode: string;
  actualAdjustedAt?: string;
  notes?: string;
  lines: InventoryAdjustmentLinePayload[];
};

export type InventoryTransferLine = {
  id: number;
  transferId: number;
  customerId: number;
  customerName: string;
  fromLocationId: number;
  fromLocationName: string;
  fromStorageSection: string;
  toLocationId: number;
  toLocationName: string;
  toStorageSection: string;
  sku: string;
  description: string;
  quantity: number;
  lineNote: string;
  createdAt: string;
};

export type InventoryTransfer = {
  id: number;
  transferNo: string;
  actualTransferredAt: string | null;
  notes: string;
  status: string;
  totalLines: number;
  totalQty: number;
  routes: string;
  createdAt: string;
  updatedAt: string;
  lines: InventoryTransferLine[];
};

export type InventoryTransferLinePayload = {
  customerId: number;
  locationId: number;
  storageSection: string;
  containerNo: string;
  palletId?: number;
  skuMasterId: number;
  quantity: number;
  toLocationId: number;
  toStorageSection?: string;
  lineNote?: string;
};

export type InventoryTransferPayload = {
  transferNo?: string;
  actualTransferredAt?: string;
  notes?: string;
  lines: InventoryTransferLinePayload[];
};

export type CycleCountLine = {
  id: number;
  cycleCountId: number;
  customerId: number;
  customerName: string;
  locationId: number;
  locationName: string;
  storageSection: string;
  sku: string;
  description: string;
  systemQty: number;
  countedQty: number;
  varianceQty: number;
  lineNote: string;
  createdAt: string;
};

export type CycleCount = {
  id: number;
  countNo: string;
  notes: string;
  status: string;
  totalLines: number;
  totalVariance: number;
  createdAt: string;
  updatedAt: string;
  lines: CycleCountLine[];
};

export type CycleCountLinePayload = {
  customerId: number;
  locationId: number;
  storageSection: string;
  containerNo: string;
  skuMasterId: number;
  countedQty: number;
  lineNote?: string;
};

export type CycleCountPayload = {
  countNo?: string;
  notes?: string;
  lines: CycleCountLinePayload[];
};
