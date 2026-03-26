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
  zone: string;
  description: string;
  capacity: number;
  sectionNames: string[];
  createdAt: string;
};

export type LocationPayload = {
  name: string;
  address: string;
  zone: string;
  description: string;
  capacity: number;
  sectionNames: string[];
};

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
  expectedQty: number;
  receivedQty: number;
  heightIn: number;
  outDate: string | null;
  lastRestockedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

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

export type OutboundDocumentLine = {
  id: number;
  documentId: number;
  movementId: number;
  itemId: number;
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
  movementId: number;
  itemId: number;
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
  outDate: string | null;
  shipToName: string;
  shipToAddress: string;
  shipToContact: string;
  carrierName: string;
  documentNote: string;
  status: string;
  confirmedAt: string | null;
  cancelNote: string;
  cancelledAt: string | null;
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
  itemId: number;
  quantity: number;
  pallets: number;
  palletsDetailCtns?: string;
  unitLabel?: string;
  cartonSizeMm?: string;
  netWeightKgs?: number;
  grossWeightKgs?: number;
  lineNote?: string;
  pickAllocations?: OutboundDocumentLineAllocationPayload[];
};

export type OutboundDocumentLineAllocationPayload = {
  storageSection: string;
  containerNo: string;
  allocatedQty: number;
};

export type OutboundDocumentPayload = {
  packingListNo?: string;
  orderRef?: string;
  outDate?: string;
  shipToName?: string;
  shipToAddress?: string;
  shipToContact?: string;
  carrierName?: string;
  status?: string;
  documentNote?: string;
  lines: OutboundDocumentLinePayload[];
};

export type CancelOutboundDocumentPayload = {
  reason?: string;
};

export type InboundDocumentLine = {
  id: number;
  documentId: number;
  movementId: number;
  itemId: number;
  sku: string;
  description: string;
  storageSection: string;
  reorderLevel: number;
  expectedQty: number;
  receivedQty: number;
  pallets: number;
  palletsDetailCtns: string;
  unitLabel: string;
  lineNote: string;
  createdAt: string;
};

export type InboundDocument = {
  id: number;
  customerId: number;
  customerName: string;
  locationId: number;
  locationName: string;
  deliveryDate: string | null;
  containerNo: string;
  storageSection: string;
  unitLabel: string;
  documentNote: string;
  status: string;
  confirmedAt: string | null;
  cancelNote: string;
  cancelledAt: string | null;
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
  palletsDetailCtns?: string;
  storageSection?: string;
  lineNote?: string;
};

export type InboundDocumentPayload = {
  customerId: number;
  locationId: number;
  deliveryDate?: string;
  containerNo?: string;
  storageSection?: string;
  unitLabel?: string;
  status?: string;
  documentNote?: string;
  lines: InboundDocumentLinePayload[];
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
  movementId: number;
  itemId: number;
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
  notes: string;
  status: string;
  totalLines: number;
  totalAdjustQty: number;
  createdAt: string;
  updatedAt: string;
  lines: InventoryAdjustmentLine[];
};

export type InventoryAdjustmentLinePayload = {
  itemId: number;
  adjustQty: number;
  lineNote?: string;
};

export type InventoryAdjustmentPayload = {
  adjustmentNo?: string;
  reasonCode: string;
  notes?: string;
  lines: InventoryAdjustmentLinePayload[];
};

export type InventoryTransferLine = {
  id: number;
  transferId: number;
  transferOutMovementId: number;
  transferInMovementId: number;
  sourceItemId: number;
  destinationItemId: number;
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
  sourceItemId: number;
  quantity: number;
  toLocationId: number;
  toStorageSection?: string;
  lineNote?: string;
};

export type InventoryTransferPayload = {
  transferNo?: string;
  notes?: string;
  lines: InventoryTransferLinePayload[];
};

export type CycleCountLine = {
  id: number;
  cycleCountId: number;
  movementId: number;
  itemId: number;
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
  itemId: number;
  countedQty: number;
  lineNote?: string;
};

export type CycleCountPayload = {
  countNo?: string;
  notes?: string;
  lines: CycleCountLinePayload[];
};

export type ItemPayload = {
  itemNumber: string;
  sku: string;
  name: string;
  category: string;
  description: string;
  unit: string;
  quantity: number;
  allocatedQty: number;
  damagedQty: number;
  holdQty: number;
  reorderLevel: number;
  customerId: number;
  locationId: number;
  storageSection?: string;
  deliveryDate?: string;
  containerNo?: string;
  expectedQty: number;
  receivedQty: number;
  heightIn: number;
  outDate?: string;
};
