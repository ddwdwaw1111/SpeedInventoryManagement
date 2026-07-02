export type UserRole = "admin" | "operator" | "viewer" | "customer";
export type ContainerType = "NORMAL" | "WEST_COAST_TRANSFER";

export type DashboardData = {
  totalItems: number;
  totalUnits: number;
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
  palletFlowRows: OperationsReportPalletFlowRow[];
  movementTrendRows: OperationsReportMovementTrendRow[];
};

export type SKUFlowReportSummary = {
  inboundQty: number;
  inboundPallets: number;
  outboundQty: number;
  outboundPallets: number;
  netQty: number;
  currentQty: number;
  currentPallets: number;
  lastOutboundDate: string;
};

export type SKUFlowReportRow = {
  direction: "INBOUND" | "OUTBOUND";
  eventType: string;
  date: string;
  quantity: number;
  pallets: number;
  customerName: string;
  locationName: string;
  storageSection: string;
  containerNo: string;
  packingListNo: string;
  orderRef: string;
  sourceDocumentType: string;
  sourceDocumentId: number;
  sourceLineId: number;
};

export type SKUFlowReport = {
  startDate: string;
  endDate: string;
  skuMasterId: number;
  sku: string;
  itemNumber: string;
  description: string;
  summary: SKUFlowReportSummary;
  rows: SKUFlowReportRow[];
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
  customerId: number;
  customerName: string;
  createdAt: string;
};

export type CreateUserPayload = {
  email: string;
  fullName: string;
  password: string;
  role: UserRole;
  isActive: boolean;
  customerId?: number;
};

export type UpdateUserAccessPayload = {
  role: UserRole;
  isActive: boolean;
  customerId?: number;
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
  pallets: number;
  availableQty: number;
  allocatedQty: number;
  damagedQty: number;
  holdQty: number;
  customerId: number;
  customerName: string;
  locationId: number;
  locationName: string;
  storageSection: string;
  deliveryDate: string | null;
  containerId?: number;
  containerNo: string;
  lastRestockedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InventoryProjectionRef = {
  customerId: number;
  locationId: number;
  storageSection: string;
  containerId?: number;
  containerNo: string;
  skuMasterId: number;
};

export function buildInventoryProjectionKey(input: InventoryProjectionRef) {
  const containerKey = input.containerId && input.containerId > 0
    ? `id:${input.containerId}`
    : `no:${(input.containerNo ?? "").trim().toUpperCase()}`;
  return [
    String(input.customerId),
    String(input.locationId),
    normalizeStorageSection(input.storageSection),
    containerKey,
    String(input.skuMasterId)
  ].join(":");
}

export function toInventoryProjectionRef(
  item: Pick<Item, "customerId" | "locationId" | "storageSection" | "containerId" | "containerNo" | "skuMasterId">
): InventoryProjectionRef {
  return {
    customerId: item.customerId,
    locationId: item.locationId,
    storageSection: normalizeStorageSection(item.storageSection),
    containerId: item.containerId,
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
  sourceDocumentType: string;
  sourceDocumentId: number;
  sourceLineId: number;
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
  containerId?: number;
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

export type ContainerRecord = {
  id: number;
  customerId: number;
  customerName: string;
  inboundDocumentId: number;
  locationId: number;
  locationName: string;
  packingListNo: string;
  containerNo: string;
  containerType: ContainerType | string;
  handlingMode: string;
  status: string;
  trackingStatus: string;
  lastEventAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContainerLifecycleEventVisibility = "PUBLIC" | "CUSTOMER" | "INTERNAL" | "BOTH" | string;

export type LifecycleDisplayFields = {
  visibility?: ContainerLifecycleEventVisibility;
  displayLabel?: string;
  publicStatus?: string;
  publicLabel?: string;
  internalStatus?: string;
  internalLabel?: string;
};

export type ContainerPayload = {
  customerId: number;
  inboundDocumentId?: number;
  locationId?: number;
  packingListNo?: string;
  containerNo: string;
  containerType?: ContainerType | string;
  handlingMode?: string;
  status?: string;
  trackingStatus?: string;
  lastEventAt?: string;
};

export type ContainerTrackingEvent = {
  id: number;
  containerId?: number;
  customerId: number;
  customerName: string;
  containerNo: string;
  eventType: string;
  eventTime: string;
  location: string;
  notes: string;
  visibility?: ContainerLifecycleEventVisibility;
  displayLabel?: string;
  publicStatus?: string;
  publicLabel?: string;
  internalStatus?: string;
  internalLabel?: string;
  createdByUserId: number;
  createdAt: string;
};

export type ContainerTrackingEventPayload = LifecycleDisplayFields & {
  customerId: number;
  containerId?: number;
  eventType?: string;
  eventTime?: string;
  location?: string;
  notes?: string;
};

export type ContainerPickupAssignment = {
  id: number;
  containerId?: number;
  customerId: number;
  customerName: string;
  containerNo: string;
  assignmentType: string;
  driverName: string;
  vendorName: string;
  phone: string;
  scheduledPickupAt: string | null;
  actualPickupAt: string | null;
  cost: number;
  status: string;
  notes: string;
  visibility?: ContainerLifecycleEventVisibility;
  displayLabel?: string;
  publicStatus?: string;
  publicLabel?: string;
  internalStatus?: string;
  internalLabel?: string;
  createdByUserId: number;
  createdAt: string;
  updatedAt: string;
};

export type ContainerPickupAssignmentPayload = LifecycleDisplayFields & {
  customerId: number;
  containerId?: number;
  assignmentType?: string;
  driverName?: string;
  vendorName?: string;
  phone?: string;
  scheduledPickupAt?: string;
  actualPickupAt?: string;
  cost?: number;
  status?: string;
  notes?: string;
};

export type DeliveryEvent = {
  id: number;
  outboundDocumentId: number;
  customerId: number;
  customerName: string;
  containerId: number;
  containerNo: string;
  eventType: string;
  eventTime: string;
  driverName: string;
  vendorName: string;
  vehicleNo: string;
  bolNumber: string;
  bolReceivedAt: string | null;
  notes: string;
  visibility?: ContainerLifecycleEventVisibility;
  displayLabel?: string;
  publicStatus?: string;
  publicLabel?: string;
  internalStatus?: string;
  internalLabel?: string;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryEventPayload = LifecycleDisplayFields & {
  outboundDocumentId?: number;
  customerId?: number;
  containerId?: number;
  containerNo?: string;
  eventType?: string;
  eventTime?: string;
  driverName?: string;
  vendorName?: string;
  vehicleNo?: string;
  bolNumber?: string;
  notes?: string;
};

export type CustomerPortalContainerSummary = {
  containerId?: number;
  containerNo: string;
  packingListNo?: string;
  customerId: number;
  customerName: string;
  warehouses: string[];
  packingListCount: number;
  firstPackingListId: number;
  totalExpectedQty: number;
  totalReceivedQty: number;
  currentQty: number;
  availableQty: number;
  shippedQty: number;
  outboundOrderCount: number;
  pickingOrderRefs: string[];
  transferCount: number;
  palletCount: number;
  status: "PENDING" | "IN_STOCK" | "PARTIAL" | "SHIPPED" | "DEPLETED" | string;
  firstReceivedAt: string | null;
  lastActivityAt: string | null;
};

export type ContainerLifecycleEvent = {
  id: number;
  stockLedgerId: number;
  customerId: number;
  customerName: string;
  locationId: number;
  locationName: string;
  storageSection: string;
  containerId?: number;
  containerNo: string;
  eventType: string;
  eventTime: string;
  quantityDelta: number;
  skuMasterId: number;
  sourceDocumentType: string;
  sourceDocumentId: number;
  sourceLineId: number;
  packingListNo: string;
  orderRef: string;
  itemNumber: string;
  description: string;
  expectedQty: number;
  receivedQty: number;
  pallets: number;
  documentNote: string;
  reason: string;
  referenceCode: string;
  createdAt: string;
};

export type ContainerLifecycleNode = {
  id: number;
  containerId: number;
  parentNodeId: number;
  nodeKey: string;
  nodeKind: string;
  title: string;
  sourceType: string;
  sourceId: number;
  visibility: ContainerLifecycleEventVisibility;
  sortOrder: number;
  positionX: number | null;
  positionY: number | null;
  metadataJson: string;
  createdAt: string;
  updatedAt: string;
};

export type ContainerLifecycleNodePayload = {
  parentNodeId?: number;
  nodeKey?: string;
  nodeKind?: string;
  title?: string;
  sourceType?: string;
  sourceId?: number;
  visibility?: ContainerLifecycleEventVisibility;
  sortOrder?: number;
  positionX?: number;
  positionY?: number;
  metadataJson?: string;
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
  pickAllocations: OutboundPickAllocation[];
  createdAt: string;
};

export type OutboundPickAllocation = {
  id: number;
  lineId: number;
  itemNumber: string;
  locationId: number;
  locationName: string;
  storageSection: string;
  containerId?: number;
  containerNo: string;
  allocatedQty: number;
  pallets?: number;
  createdAt: string;
};

export type DocumentAttachment = {
  id: number;
  documentType: "INBOUND" | "OUTBOUND";
  documentId: number;
  displayName: string;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedByUserId: number;
  createdAt: string;
};

export type OutboundPickAllocationPayload = {
  itemNumber?: string;
  locationId: number;
  locationName?: string;
  storageSection?: string;
  containerId?: number;
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
  attachments?: DocumentAttachment[];
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
  containerId?: number;
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
  attachments?: DocumentAttachment[];
};

export type InboundDocumentLinePayload = {
  sku: string;
  description: string;
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
  containerId?: number;
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

export type CustomerPortalContainerLifecycle = {
  container?: ContainerRecord | null;
  summary: CustomerPortalContainerSummary;
  packingLists: InboundDocument[];
  pickingOrders: OutboundDocument[];
  movements?: Movement[];
  lifecycleEvents: ContainerLifecycleEvent[];
  trackingEvents?: ContainerTrackingEvent[];
  pickupAssignments?: ContainerPickupAssignment[];
  deliveryEvents?: DeliveryEvent[];
  nodes?: ContainerLifecycleNode[];
};

export type ContainerLifecycle = CustomerPortalContainerLifecycle & {
  container?: ContainerRecord | null;
  trackingEvents: ContainerTrackingEvent[];
  pickupAssignments: ContainerPickupAssignment[];
  deliveryEvents: DeliveryEvent[];
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
  containerId?: number;
  containerNo: string;
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
  pallets: number;
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
  containerId?: number;
  containerNo: string;
  skuMasterId: number;
  quantity: number;
  pallets: number;
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

// --- Billing Invoice Types ---

export type BillingInvoiceStatus = "DRAFT" | "FINALIZED" | "PAID" | "VOID";
export type BillingInvoiceType = "MIXED" | "STORAGE_SETTLEMENT";

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
  normalPalletGracePeriodEnabled?: boolean;
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

export type BillingInvoiceHeader = {
  sellerName: string;
  subtitle: string;
  remitTo: string;
  terms: string;
  paymentDueDays: number;
  paymentInstructions: string;
};

export type BillingInvoiceSettings = {
  id: number;
  header: BillingInvoiceHeader;
  updatedByUserId: number;
  createdAt: string;
  updatedAt: string;
};

export type UpdateBillingInvoiceSettingsPayload = {
  header: BillingInvoiceHeader;
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
  header: BillingInvoiceHeader;
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
  header?: BillingInvoiceHeader;
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
