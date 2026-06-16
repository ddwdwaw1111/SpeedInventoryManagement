import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CustomerPortalContainerLifecycle } from "../lib/types";
import { renderWithProviders } from "../test/renderWithProviders";
import { ContainerLifecycleView } from "./ContainerLifecycleView";

describe("ContainerLifecycleView", () => {
  it("renders lifecycle details when optional array fields are omitted", () => {
    renderWithProviders(
      <ContainerLifecycleView
        containerNo="CNT-EMPTY-ARRAYS"
        visibilityMode="admin"
        lifecycle={{
          summary: {
            containerNo: "CNT-EMPTY-ARRAYS",
            customerId: 1,
            customerName: "Acme Warehouse",
            warehouses: undefined,
            packingListCount: 0,
            firstPackingListId: 0,
            totalExpectedQty: 0,
            totalReceivedQty: 0,
            currentQty: 0,
            availableQty: 0,
            shippedQty: 0,
            outboundOrderCount: 0,
            pickingOrderRefs: undefined,
            transferCount: 0,
            palletCount: 0,
            status: "PENDING",
            firstReceivedAt: null,
            lastActivityAt: null
          },
          packingLists: undefined,
          pickingOrders: undefined,
          movements: undefined,
          lifecycleEvents: undefined,
          pallets: undefined,
          palletEvents: undefined,
          reworkEvents: [
            {
              id: 91,
              referenceNo: "RW-91",
              customerId: 1,
              customerName: "Acme Warehouse",
              containerNo: "CNT-EMPTY-ARRAYS",
              eventType: "REWORK",
              eventTime: "2026-05-01T12:00:00Z",
              notes: "",
              pallets: undefined,
              createdAt: "2026-05-01T12:00:00Z"
            }
          ]
        } as unknown as CustomerPortalContainerLifecycle}
      />
    );

    expect(screen.getByText("Container Lifecycle CNT-EMPTY-ARRAYS")).toBeInTheDocument();
    expect(screen.getAllByText("RW-91").length).toBeGreaterThan(0);
  });

  it("hides internal-only lifecycle events and staff pickup details in customer mode", () => {
    renderWithProviders(
      <ContainerLifecycleView
        containerNo="CNT-CUSTOMER-VIEW"
        visibilityMode="customer"
        lifecycle={{
          summary: {
            containerNo: "CNT-CUSTOMER-VIEW",
            customerId: 1,
            customerName: "Acme Warehouse",
            warehouses: [],
            packingListCount: 0,
            firstPackingListId: 0,
            totalExpectedQty: 0,
            totalReceivedQty: 0,
            currentQty: 0,
            availableQty: 0,
            shippedQty: 0,
            outboundOrderCount: 0,
            pickingOrderRefs: [],
            transferCount: 0,
            palletCount: 0,
            status: "PENDING",
            firstReceivedAt: null,
            lastActivityAt: "2026-05-01T12:00:00Z"
          },
          packingLists: [],
          pickingOrders: [],
          movements: [],
          lifecycleEvents: [],
          pallets: [],
          palletEvents: [],
          pickupAssignments: [
            {
              id: 100,
              containerId: 1,
              customerId: 1,
              customerName: "Acme Warehouse",
              containerNo: "CNT-CUSTOMER-VIEW",
              assignmentType: "THIRD_PARTY_PICKUP",
              driverName: "Secret Driver",
              vendorName: "Hidden Vendor",
              phone: "555-0000",
              scheduledPickupAt: "2026-05-01T12:00:00Z",
              actualPickupAt: null,
              cost: 200,
              status: "SCHEDULED",
              notes: "Internal pickup cost note",
              visibility: "INTERNAL",
              publicStatus: "",
              publicLabel: "",
              internalStatus: "PICKUP_ASSIGNED",
              internalLabel: "Third-party pickup",
              createdByUserId: 7,
              createdAt: "2026-05-01T12:00:00Z",
              updatedAt: "2026-05-01T12:00:00Z"
            },
            {
              id: 101,
              containerId: 1,
              customerId: 1,
              customerName: "Acme Warehouse",
              containerNo: "CNT-CUSTOMER-VIEW",
              assignmentType: "OWN_DRIVER",
              driverName: "John Staff Driver",
              vendorName: "",
              phone: "555-1111",
              scheduledPickupAt: "2026-05-02T12:00:00Z",
              actualPickupAt: "2026-05-02T14:00:00Z",
              cost: 0,
              status: "PICKED_UP",
              notes: "Internal driver note",
              visibility: "BOTH",
              publicStatus: "PICKED_UP",
              publicLabel: "Container picked up",
              internalStatus: "OWN_DRIVER_PICKED_UP",
              internalLabel: "Own driver pickup",
              createdByUserId: 7,
              createdAt: "2026-05-02T12:00:00Z",
              updatedAt: "2026-05-02T14:00:00Z"
            }
          ]
        } as unknown as CustomerPortalContainerLifecycle}
      />
    );

    expect(screen.getAllByText("Container picked up").length).toBeGreaterThan(0);
    expect(screen.queryByText("Secret Driver")).not.toBeInTheDocument();
    expect(screen.queryByText("Hidden Vendor")).not.toBeInTheDocument();
    expect(screen.queryByText("John Staff Driver")).not.toBeInTheDocument();
    expect(screen.queryByText("Internal pickup cost note")).not.toBeInTheDocument();
  });
});
