import type {
  AuthResponse,
  DashboardData,
  Item,
  ItemPayload,
  LoginPayload,
  Location,
  LocationPayload,
  Movement,
  MovementPayload,
  SKUMaster,
  SKUMasterPayload,
  SignUpPayload
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

type ItemQuery = {
  search?: string;
  locationId?: number;
  lowStock?: boolean;
};

type SKUMasterQuery = {
  search?: string;
};

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;

    try {
      const errorPayload = (await response.json()) as { error?: string };
      if (errorPayload.error) {
        message = errorPayload.error;
      }
    } catch {
      // Ignore JSON parse errors for non-JSON failure responses.
    }

    throw new ApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
  getCurrentSession() {
    return request<AuthResponse>("/api/auth/me");
  },

  login(payload: LoginPayload) {
    return request<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  signUp(payload: SignUpPayload) {
    return request<AuthResponse>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  logout() {
    return request<void>("/api/auth/logout", {
      method: "POST"
    });
  },

  getDashboard() {
    return request<DashboardData>("/api/dashboard");
  },

  getLocations() {
    return request<Location[]>("/api/locations");
  },

  createLocation(payload: LocationPayload) {
    return request<Location>("/api/locations", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  updateLocation(locationId: number, payload: LocationPayload) {
    return request<Location>(`/api/locations/${locationId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },

  deleteLocation(locationId: number) {
    return request<void>(`/api/locations/${locationId}`, {
      method: "DELETE"
    });
  },

  getSKUMasters(query?: SKUMasterQuery) {
    const params = new URLSearchParams();

    if (query?.search) {
      params.set("search", query.search);
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<SKUMaster[]>(`/api/sku-master${suffix}`);
  },

  createSKUMaster(payload: SKUMasterPayload) {
    return request<SKUMaster>("/api/sku-master", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  updateSKUMaster(skuMasterId: number, payload: SKUMasterPayload) {
    return request<SKUMaster>(`/api/sku-master/${skuMasterId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },

  deleteSKUMaster(skuMasterId: number) {
    return request<void>(`/api/sku-master/${skuMasterId}`, {
      method: "DELETE"
    });
  },

  getItems(query?: ItemQuery) {
    const params = new URLSearchParams();

    if (query?.search) {
      params.set("search", query.search);
    }
    if (query?.locationId) {
      params.set("locationId", String(query.locationId));
    }
    if (query?.lowStock) {
      params.set("lowStock", "true");
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<Item[]>(`/api/items${suffix}`);
  },

  createItem(payload: ItemPayload) {
    return request<Item>("/api/items", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  updateItem(itemId: number, payload: ItemPayload) {
    return request<Item>(`/api/items/${itemId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },

  deleteItem(itemId: number) {
    return request<void>(`/api/items/${itemId}`, {
      method: "DELETE"
    });
  },

  getMovements(limit = 12) {
    return request<Movement[]>(`/api/movements?limit=${limit}`);
  },

  createMovement(payload: MovementPayload) {
    return request<Movement>("/api/movements", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  updateMovement(movementId: number, payload: MovementPayload) {
    return request<Movement>(`/api/movements/${movementId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },

  deleteMovement(movementId: number) {
    return request<void>(`/api/movements/${movementId}`, {
      method: "DELETE"
    });
  }
};
