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
  createdAt: string;
};

export type LocationPayload = {
  name: string;
  address: string;
  zone: string;
  description: string;
  capacity: number;
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
