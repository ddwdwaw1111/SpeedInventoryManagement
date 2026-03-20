export type DashboardData = {
  totalItems: number;
  totalUnits: number;
  lowStockItems: number;
  locationsInUse: number;
  recentMovements: Movement[];
};

export type User = {
  id: number;
  email: string;
  fullName: string;
  createdAt: string;
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
  sku: string;
  name: string;
  category: string;
  description: string;
  unit: string;
  reorderLevel: number;
  createdAt: string;
  updatedAt: string;
};

export type SKUMasterPayload = {
  sku: string;
  name: string;
  category: string;
  description: string;
  unit: string;
  reorderLevel: number;
};

export type Item = {
  id: number;
  sku: string;
  name: string;
  category: string;
  description: string;
  unit: string;
  quantity: number;
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
  pallets: number;
  palletsDetailCtns: string;
  heightIn: number;
  outDate: string | null;
  lastRestockedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Movement = {
  id: number;
  itemId: number;
  itemName: string;
  sku: string;
  description: string;
  customerId: number;
  customerName: string;
  locationName: string;
  storageSection: string;
  movementType: "IN" | "OUT" | "ADJUST";
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
  reason: string;
  referenceCode: string;
  createdAt: string;
};

export type ItemPayload = {
  sku: string;
  name: string;
  category: string;
  description: string;
  unit: string;
  quantity: number;
  reorderLevel: number;
  customerId: number;
  locationId: number;
  storageSection?: string;
  deliveryDate?: string;
  containerNo?: string;
  expectedQty: number;
  receivedQty: number;
  pallets: number;
  palletsDetailCtns?: string;
  heightIn: number;
  outDate?: string;
};

export type MovementPayload = {
  itemId: number;
  movementType: "IN" | "OUT" | "ADJUST";
  quantity: number;
  storageSection?: string;
  deliveryDate?: string;
  containerNo?: string;
  packingListNo?: string;
  orderRef?: string;
  itemNumber?: string;
  expectedQty: number;
  receivedQty: number;
  pallets: number;
  palletsDetailCtns?: string;
  cartonSizeMm?: string;
  cartonCount?: number;
  unitLabel?: string;
  netWeightKgs?: number;
  grossWeightKgs?: number;
  heightIn: number;
  outDate?: string;
  reason?: string;
  referenceCode?: string;
};
