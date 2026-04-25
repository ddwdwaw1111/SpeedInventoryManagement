export type UserRole = "admin" | "operator" | "viewer";
export type ContainerType = "NORMAL" | "WEST_COAST_TRANSFER";

export type DashboardData = {
  totalItems: number;
  totalUnits: number;
  lowStockItems: number;
  locationsInUse: number;
  recentMovements: Movement[];
};

export type OperationsReportGranularity = "day" | "month" | "year";

export type OperationsReportSummary = {
  onHandUnits: number;
  activeContainers: number;
  palletsIn: number;
  palletsOut: number;
  netPalletFlow: number;
  activeSkuCount: number;
  activeWarehouseCount: number;
  lowStockCount: number;
  endingBalance: number;
  peakBalance: number;
  averageBalance: number;
};

export type OperationsReportLocationRow = {
  label: string;
  value: number;
  skuCount: number;
};

export type OperationsReportSkuRow = {
  label: string;
  value: number;
  description: string;
};

export type OperationsReportLowStockRow = {
  label: string;
  value: number;
  available: number;
  reorder: number;
};

export type OperationsReportPalletFlowRow = {
  dateKey: string;
  inbound: number;
  outbound: number;
  adjustmentDelta: number;
  endOfDay: number;
};

export type OperationsReportMovementTrendRow = {
  key: string;
  inbound: number;
  outbound: number;
};

export type OperationsReport = {
  startDate: string;
  endDate: string;
  granularity: OperationsReportGranularity;
  summary: OperationsReportSummary;
  locationInventoryRows: OperationsReportLocationRow[];
  topSkuRows: OperationsReportSkuRow[];
  lowStockRows: OperationsReportLowStockRow[];
  palletFlowRows: OperationsReportPalletFlowRow[];
  movementTrendRows: OperationsReportMovementTrendRow[];
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
  containerType: ContainerType;
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
  pallets?: number;
  createdAt: string;
};

export type OutboundPickAllocationPayload = {
  itemNumber?: string;
  locationId: number;
  locationName?: string;
  storageSection?: string;
  containerNo?: string;
  allocatedQty: number;
  pallets?: number;
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
  deletedAt: string | null;
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
  pickAllocations?: OutboundPickAllocationPayload[];
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

export type UpdateOutboundDocumentNotePayload = {
  documentNote?: string;
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
  containerType: ContainerType;
  handlingMode: "PALLETIZED" | "SEALED_TRANSIT";
  storageSection: string;
  unitLabel: string;
  documentNote: string;
  status: string;
  trackingStatus: string;
  confirmedAt: string | null;
  deletedAt: string | null;
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
  containerType?: ContainerType;
  handlingMode?: string;
  storageSection?: string;
  unitLabel?: string;
  status?: string;
  trackingStatus?: string;
  documentNote?: string;
  lines: InboundDocumentLinePayload[];
};

export type UpdateInboundDocumentNotePayload = {
  documentNote?: string;
};

export type UpdateInboundDocumentContainerTypePayload = {
  containerType: ContainerType;
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
  palletId?: number;
  createPallet?: boolean;
  skuMasterId: number;
  countedQty: number;
  lineNote?: string;
};

export type CycleCountPayload = {
  countNo?: string;
  notes?: string;
  lines: CycleCountLinePayload[];
};

// --- Billing Invoice Types ---

export type BillingInvoiceStatus = "DRAFT" | "FINALIZED" | "PAID" | "VOID";
export type BillingInvoiceType = "MIXED" | "STORAGE_SETTLEMENT";
export type BillingExportMode = "SUMMARY" | "DETAILED";

export type BillingStorageSegmentDetail = {
  startDate: string;
  endDate: string;
  dayEndPallets: number;
  billedDays: number;
  palletDays: number;
  freePalletDays?: number;
  billablePalletDays?: number;
  grossAmount?: number;
  discountAmount?: number;
  amount: number;
};

export type BillingInvoiceLineDetails = {
  kind: "STORAGE_CONTAINER_SUMMARY";
  warehouseLocationId?: number | null;
  warehouseName?: string;
  warehousesTouched: string[];
  palletsTracked: number;
  palletDays: number;
  freePalletDays?: number;
  billablePalletDays?: number;
  grossAmount?: number;
  discountAmount?: number;
  segments: BillingStorageSegmentDetail[];
};

export type BillingRatesSnapshot = {
  inboundContainerFee: number;
  transferInboundFeePerPallet: number;
  wrappingFeePerPallet: number;
  storageFeePerPalletPerWeek?: number;
  storageFeePerPalletPerWeekNormal: number;
  storageFeePerPalletPerWeekWestCoastTransfer: number;
  outboundFeePerPallet: number;
};

export type BillingInvoiceLineData = {
  id: number;
  invoiceId: number;
  chargeType: string;
  description: string;
  reference: string;
  containerNo: string;
  warehouse: string;
  occurredOn: string;
  quantity: number;
  unitRate: number;
  amount: number;
  notes: string;
  sourceType: "AUTO" | "MANUAL";
  sortOrder: number;
  createdAt: string;
  details?: BillingInvoiceLineDetails | null;
};

export type BillingInvoice = {
  id: number;
  invoiceNo: string;
  invoiceType: BillingInvoiceType;
  customerId: number;
  customerNameSnapshot: string;
  warehouseLocationId: number | null;
  warehouseNameSnapshot: string;
  containerType: ContainerType | "";
  periodStart: string;
  periodEnd: string;
  currencyCode: string;
  rates: BillingRatesSnapshot;
  subtotal: number;
  discountTotal: number;
  grandTotal: number;
  status: BillingInvoiceStatus;
  notes: string;
  finalizedAt: string | null;
  finalizedByUserId: number | null;
  paidAt: string | null;
  voidedAt: string | null;
  createdByUserId: number;
  createdAt: string;
  updatedAt: string;
  lineCount: number;
  lines: BillingInvoiceLineData[];
};

export type CreateBillingInvoiceLinePayload = {
  chargeType: string;
  description: string;
  reference?: string;
  containerNo?: string;
  warehouse?: string;
  occurredOn?: string;
  quantity: number;
  unitRate: number;
  amount: number;
  notes?: string;
  sourceType?: string;
  details?: BillingInvoiceLineDetails;
};

export type CreateBillingInvoicePayload = {
  invoiceType?: BillingInvoiceType;
  customerId: number;
  customerName: string;
  warehouseLocationId?: number | null;
  warehouseName?: string;
  containerType?: ContainerType | null;
  periodStart: string;
  periodEnd: string;
  rates: BillingRatesSnapshot;
  notes?: string;
  lines: CreateBillingInvoiceLinePayload[];
};

export type AddBillingInvoiceLinePayload = {
  chargeType: string;
  description: string;
  reference?: string;
  containerNo?: string;
  warehouse?: string;
  occurredOn?: string;
  quantity: number;
  unitRate: number;
  amount: number;
  notes?: string;
};

export type UpdateBillingInvoiceLinePayload = {
  chargeType: string;
  description: string;
  reference?: string;
  containerNo?: string;
  warehouse?: string;
  occurredOn?: string;
  quantity: number;
  unitRate: number;
  amount: number;
  notes?: string;
};
