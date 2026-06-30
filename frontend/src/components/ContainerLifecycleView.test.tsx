import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CustomerPortalContainerLifecycle } from "../lib/types";
import { renderWithProviders } from "../test/renderWithProviders";
import {
  buildLifecycleFlow,
  ContainerLifecycleView,
  getInboundDiscrepancyKind,
  getInboundDiscrepancyReasons,
  getInboundExpectedQty,
  getInboundPalletCount,
  getInboundSkuCount
} from "./ContainerLifecycleView";

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
    expect(screen.queryByText("RW-91")).not.toBeInTheDocument();
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

  it("keeps every packing list visible after node subtitles are hidden", () => {
    renderWithProviders(
      <ContainerLifecycleView
        containerNo="CNT-MULTI-PL"
        visibilityMode="admin"
        lifecycle={{
          summary: {
            containerNo: "CNT-MULTI-PL",
            customerId: 1,
            customerName: "Acme Warehouse",
            warehouses: [],
            packingListCount: 2,
            firstPackingListId: 10,
            totalExpectedQty: 30,
            totalReceivedQty: 30,
            currentQty: 30,
            availableQty: 30,
            shippedQty: 0,
            outboundOrderCount: 0,
            pickingOrderRefs: [],
            transferCount: 0,
            palletCount: 0,
            status: "IN_STOCK",
            firstReceivedAt: "2026-06-01T12:00:00Z",
            lastActivityAt: "2026-06-01T12:00:00Z"
          },
          packingLists: [
            {
              id: 10,
              containerNo: "PL-A",
              totalExpectedQty: 10,
              totalReceivedQty: 10,
              expectedArrivalDate: null,
              status: "CONFIRMED",
              attachments: [{ id: 1 }]
            },
            {
              id: 11,
              containerNo: "PL-B",
              totalExpectedQty: 20,
              totalReceivedQty: 20,
              expectedArrivalDate: null,
              status: "CONFIRMED",
              attachments: [{ id: 2 }, { id: 3 }]
            }
          ],
          pickingOrders: [],
          movements: [],
          lifecycleEvents: [],
          pallets: [],
          palletEvents: []
        } as unknown as CustomerPortalContainerLifecycle}
      />
    );

    expect(screen.getByText("PL-A")).toBeInTheDocument();
    expect(screen.getByText("PL-B")).toBeInTheDocument();
  });

  it("shows received metrics, inbound time, and discrepancy status on the receiving node", () => {
    const lifecycle = {
      summary: {
        containerNo: "CNT-RECEIVED-METRICS",
        customerId: 1,
        customerName: "Acme Warehouse",
        warehouses: [],
        packingListCount: 1,
        firstPackingListId: 10,
        totalExpectedQty: 50,
        totalReceivedQty: 44,
        currentQty: 44,
        availableQty: 44,
        shippedQty: 0,
        outboundOrderCount: 0,
        pickingOrderRefs: [],
        transferCount: 0,
        palletCount: 1,
        status: "IN_STOCK",
        firstReceivedAt: "2026-06-07T15:30:00Z",
        lastActivityAt: "2026-06-07T15:30:00Z"
      },
      packingLists: [
        {
          id: 10,
          containerNo: "CNT-RECEIVED-METRICS",
          totalExpectedQty: 50,
          totalReceivedQty: 44,
          expectedArrivalDate: null,
          status: "CONFIRMED",
          lines: [
            { sku: "SKU-A", expectedQty: 24, receivedQty: 24, pallets: 3 },
            { sku: "SKU-B", expectedQty: 26, receivedQty: 20, pallets: 4, lineNote: "Damaged cartons on arrival" }
          ]
        }
      ],
      pickingOrders: [],
      movements: [],
      lifecycleEvents: [],
      pallets: [],
      palletEvents: []
    } as unknown as CustomerPortalContainerLifecycle;

    renderWithProviders(
      <ContainerLifecycleView
        containerNo="CNT-RECEIVED-METRICS"
        visibilityMode="admin"
        lifecycle={lifecycle}
      />
    );

    expect(getInboundPalletCount(lifecycle)).toBe(7);
    expect(getInboundSkuCount(lifecycle)).toBe(2);
    expect(getInboundExpectedQty(lifecycle)).toBe(50);
    expect(getInboundDiscrepancyKind(lifecycle)).toBe("shortage");
    expect(getInboundDiscrepancyReasons(lifecycle, (key) => ({
      inboundDiscrepancyShortage: "Shortage",
      inboundDiscrepancyDamaged: "Damaged",
      inboundDiscrepancyOverage: "Overage"
    })[key] ?? key)).toBe("Shortage / Damaged");
    expect(screen.getByText("SKU Count")).toBeInTheDocument();
    expect(screen.getAllByText("Received").length).toBeGreaterThan(0);
    expect(screen.getAllByText("7").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    expect(screen.getAllByText("44").length).toBeGreaterThan(0);
    expect(screen.getByText("Received At: 2026-06-07")).toBeInTheDocument();
    expect(screen.getByText("Has discrepancy")).toBeInTheDocument();
    expect(screen.queryByText("Discrepancy: Shortage / Damaged")).not.toBeInTheDocument();
  });

  it("colors inbound node red for shortage and yellow for overage", () => {
    const baseLifecycle = {
      summary: {
        containerNo: "CNT-INBOUND-COLOR",
        customerId: 1,
        customerName: "Acme Warehouse",
        warehouses: [],
        packingListCount: 1,
        firstPackingListId: 10,
        totalExpectedQty: 50,
        totalReceivedQty: 44,
        currentQty: 44,
        availableQty: 44,
        shippedQty: 0,
        outboundOrderCount: 0,
        pickingOrderRefs: [],
        transferCount: 0,
        palletCount: 1,
        status: "IN_STOCK",
        firstReceivedAt: "2026-06-07T15:30:00Z",
        lastActivityAt: "2026-06-07T15:30:00Z"
      },
      packingLists: [
        {
          id: 10,
          containerNo: "CNT-INBOUND-COLOR",
          totalExpectedQty: 50,
          totalReceivedQty: 44,
          expectedArrivalDate: null,
          status: "CONFIRMED",
          lines: [
            { sku: "SKU-A", expectedQty: 50, receivedQty: 44, pallets: 3 }
          ]
        }
      ],
      pickingOrders: [],
      movements: [],
      lifecycleEvents: [],
      pallets: [],
      palletEvents: []
    } as unknown as CustomerPortalContainerLifecycle;
    const overageLifecycle = {
      ...baseLifecycle,
      summary: {
        ...baseLifecycle.summary,
        totalReceivedQty: 56,
        currentQty: 56,
        availableQty: 56
      },
      packingLists: [
        {
          ...baseLifecycle.packingLists[0],
          totalReceivedQty: 56,
          lines: [
            { sku: "SKU-A", expectedQty: 50, receivedQty: 56, pallets: 3 }
          ]
        }
      ]
    } as unknown as CustomerPortalContainerLifecycle;

    const shortageFlow = buildLifecycleFlow(baseLifecycle, (key) => key, true, null, "admin");
    const overageFlow = buildLifecycleFlow(overageLifecycle, (key) => key, true, null, "admin");

    expect(shortageFlow.nodes.find((node) => node.id === "received")?.style).toMatchObject({ background: "#fef2f2" });
    expect(overageFlow.nodes.find((node) => node.id === "received")?.style).toMatchObject({ background: "#fffbeb" });
  });

  it("shows pallet rework as a source-to-target pallet count only", () => {
    renderWithProviders(
      <ContainerLifecycleView
        containerNo="CNT-REWORK"
        visibilityMode="admin"
        lifecycle={{
          summary: {
            containerNo: "CNT-REWORK",
            customerId: 1,
            customerName: "Acme Warehouse",
            warehouses: [],
            packingListCount: 0,
            firstPackingListId: 0,
            totalExpectedQty: 30,
            totalReceivedQty: 30,
            currentQty: 30,
            availableQty: 30,
            shippedQty: 0,
            outboundOrderCount: 0,
            pickingOrderRefs: [],
            transferCount: 0,
            palletCount: 1,
            status: "IN_STOCK",
            firstReceivedAt: "2026-06-01T12:00:00Z",
            lastActivityAt: "2026-06-02T12:00:00Z"
          },
          packingLists: [],
          pickingOrders: [],
          movements: [],
          lifecycleEvents: [],
          pallets: [],
          palletEvents: [],
          reworkEvents: [
            {
              id: 200,
              referenceNo: "RW-200",
              customerId: 1,
              customerName: "Acme Warehouse",
              containerNo: "CNT-REWORK",
              eventType: "REPACK",
              eventTime: "2026-06-02T12:00:00Z",
              notes: "",
              pallets: [
                { id: 1, reworkEventId: 200, palletId: 10, palletCode: "P-10", role: "SOURCE", quantityDelta: 0, createdAt: "2026-06-02T12:00:00Z" },
                { id: 2, reworkEventId: 200, palletId: 11, palletCode: "P-11", role: "SOURCE", quantityDelta: 0, createdAt: "2026-06-02T12:00:00Z" },
                { id: 3, reworkEventId: 200, palletId: 12, palletCode: "P-12", role: "TARGET", quantityDelta: 0, createdAt: "2026-06-02T12:00:00Z" }
              ],
              createdAt: "2026-06-02T12:00:00Z"
            }
          ]
        } as unknown as CustomerPortalContainerLifecycle}
      />
    );

    expect(screen.getByText("2 pallets -> 1 pallet")).toBeInTheDocument();
    expect(screen.queryByText("RW-200")).not.toBeInTheDocument();
    expect(screen.queryByText("REPACK")).not.toBeInTheDocument();
  });

  it("shows an attached document node for a selected secondary picking order", () => {
    renderWithProviders(
      <ContainerLifecycleView
        containerNo="CNT-MULTI-PO"
        visibilityMode="admin"
        selectedNodeId="picking-1"
        onNodeSelect={() => undefined}
        lifecycle={{
          summary: {
            containerNo: "CNT-MULTI-PO",
            customerId: 1,
            customerName: "Acme Warehouse",
            warehouses: [],
            packingListCount: 0,
            firstPackingListId: 0,
            totalExpectedQty: 30,
            totalReceivedQty: 30,
            currentQty: 10,
            availableQty: 10,
            shippedQty: 20,
            outboundOrderCount: 2,
            pickingOrderRefs: ["PO-1", "PO-2"],
            transferCount: 0,
            palletCount: 0,
            status: "PARTIAL",
            firstReceivedAt: "2026-06-01T12:00:00Z",
            lastActivityAt: "2026-06-02T12:00:00Z"
          },
          packingLists: [],
          pickingOrders: [
            {
              id: 20,
              packingListNo: "PO-1",
              orderRef: "",
              expectedShipDate: null,
              status: "CONFIRMED",
              lines: [],
              attachments: []
            },
            {
              id: 21,
              packingListNo: "PO-2",
              orderRef: "",
              expectedShipDate: null,
              status: "CONFIRMED",
              lines: [],
              attachments: [{ id: 4 }, { id: 5 }]
            }
          ],
          movements: [],
          lifecycleEvents: [],
          pallets: [],
          palletEvents: []
        } as unknown as CustomerPortalContainerLifecycle}
      />
    );

    expect(screen.getAllByText("PO-2").length).toBeGreaterThan(1);
  });

  it("labels outbound nodes with the packing order and this container's fulfilled SKUs", () => {
    renderWithProviders(
      <ContainerLifecycleView
        containerNo="CNT-PO"
        visibilityMode="admin"
        lifecycle={{
          summary: {
            containerNo: "CNT-PO",
            customerId: 1,
            customerName: "Acme Warehouse",
            warehouses: [],
            packingListCount: 0,
            firstPackingListId: 0,
            totalExpectedQty: 30,
            totalReceivedQty: 30,
            currentQty: 10,
            availableQty: 10,
            shippedQty: 20,
            outboundOrderCount: 1,
            pickingOrderRefs: ["PO-88"],
            transferCount: 0,
            palletCount: 0,
            status: "PARTIAL",
            firstReceivedAt: "2026-06-01T12:00:00Z",
            lastActivityAt: "2026-06-02T12:00:00Z"
          },
          packingLists: [],
          pickingOrders: [
            {
              id: 20,
              packingListNo: "PO-88",
              orderRef: "",
              expectedShipDate: null,
              status: "CONFIRMED",
              lines: [
                {
                  sku: "SKU-A",
                  quantity: 20,
                  pickAllocations: [
                    { containerNo: "CNT-PO", allocatedQty: 12 },
                    { containerNo: "OTHER-CNT", allocatedQty: 8 }
                  ]
                },
                {
                  sku: "SKU-B",
                  quantity: 3,
                  pickAllocations: [
                    { containerNo: "CNT-PO", allocatedQty: 3 }
                  ]
                }
              ],
              attachments: []
            }
          ],
          deliveryEvents: [
            {
              id: 300,
              outboundDocumentId: 20,
              bolNumber: "BOL-88",
              eventType: "BOL_RECEIVED",
              bolReceivedAt: "2026-06-03T12:00:00Z",
              eventTime: "2026-06-03T12:00:00Z"
            }
          ],
          movements: [],
          lifecycleEvents: [],
          pallets: [],
          palletEvents: []
        } as unknown as CustomerPortalContainerLifecycle}
      />
    );

    expect(screen.getByText("PO-88: SKU-A 12, SKU-B 3")).toBeInTheDocument();
    expect(screen.queryByText("BOL No. BOL-88: SKU-A 12, SKU-B 3")).not.toBeInTheDocument();
    expect(screen.queryByText("OTHER-CNT")).not.toBeInTheDocument();
  });

  it("shows the current warehouse on the inventory node", () => {
    renderWithProviders(
      <ContainerLifecycleView
        containerNo="CNT-WAREHOUSE"
        visibilityMode="admin"
        lifecycle={{
          summary: {
            containerNo: "CNT-WAREHOUSE",
            customerId: 1,
            customerName: "Acme Warehouse",
            warehouses: [],
            packingListCount: 0,
            firstPackingListId: 0,
            totalExpectedQty: 20,
            totalReceivedQty: 20,
            currentQty: 15,
            availableQty: 15,
            shippedQty: 5,
            outboundOrderCount: 0,
            pickingOrderRefs: [],
            transferCount: 0,
            palletCount: 1,
            status: "PARTIAL",
            firstReceivedAt: "2026-06-01T12:00:00Z",
            lastActivityAt: "2026-06-02T12:00:00Z"
          },
          packingLists: [],
          pickingOrders: [],
          movements: [],
          lifecycleEvents: [],
          pallets: [
            {
              id: 1,
              currentLocationName: "308 Herrod Blvd",
              currentStorageSection: "A1"
            }
          ],
          palletEvents: []
        } as unknown as CustomerPortalContainerLifecycle}
      />
    );

    expect(screen.getByText("15 / 20")).toBeInTheDocument();
    expect(screen.getByText("Warehouse: 308 Herrod Blvd")).toBeInTheDocument();
  });

  it("does not show stale warehouse names when the current inventory is empty", () => {
    renderWithProviders(
      <ContainerLifecycleView
        containerNo="CNT-SHIPPED"
        visibilityMode="admin"
        lifecycle={{
          container: {
            id: 1,
            containerNo: "CNT-SHIPPED",
            locationName: "2801 Route"
          },
          summary: {
            containerNo: "CNT-SHIPPED",
            customerId: 1,
            customerName: "Acme Warehouse",
            warehouses: ["308 Herrod Blvd"],
            packingListCount: 0,
            firstPackingListId: 0,
            totalExpectedQty: 20,
            totalReceivedQty: 20,
            currentQty: 0,
            availableQty: 0,
            shippedQty: 20,
            outboundOrderCount: 0,
            pickingOrderRefs: [],
            transferCount: 0,
            palletCount: 1,
            status: "SHIPPED",
            firstReceivedAt: "2026-06-01T12:00:00Z",
            lastActivityAt: "2026-06-02T12:00:00Z"
          },
          packingLists: [],
          pickingOrders: [],
          movements: [],
          lifecycleEvents: [],
          pallets: [
            {
              id: 1,
              currentLocationName: "308 Herrod Blvd",
              currentStorageSection: "A1"
            }
          ],
          palletEvents: []
        } as unknown as CustomerPortalContainerLifecycle}
      />
    );

    expect(screen.getByText("0 / 20")).toBeInTheDocument();
    expect(screen.getByText("Warehouse: -")).toBeInTheDocument();
    expect(screen.queryByText("Warehouse: 308 Herrod Blvd")).not.toBeInTheDocument();
    expect(screen.queryByText("Warehouse: 2801 Route")).not.toBeInTheDocument();
  });

  it("adds a transfer node from transfer movements when the summary count is missing", () => {
    const flow = buildLifecycleFlow(
      {
        summary: {
          containerNo: "CNT-TRANSFER",
          customerId: 1,
          customerName: "Acme Warehouse",
          warehouses: ["308 Herrod Blvd"],
          packingListCount: 0,
          firstPackingListId: 0,
          totalExpectedQty: 20,
          totalReceivedQty: 20,
          currentQty: 20,
          availableQty: 20,
          shippedQty: 0,
          outboundOrderCount: 0,
          pickingOrderRefs: [],
          transferCount: 0,
          palletCount: 1,
          status: "IN_STOCK",
          firstReceivedAt: "2026-06-01T12:00:00Z",
          lastActivityAt: "2026-06-02T12:00:00Z"
        },
        packingLists: [],
        pickingOrders: [],
        movements: [
          {
            id: 1,
            sourceDocumentType: "TRANSFER",
            sourceDocumentId: 77,
            movementType: "TRANSFER_OUT",
            locationName: "308 Herrod Blvd",
            storageSection: "A1"
          },
          {
            id: 2,
            sourceDocumentType: "TRANSFER",
            sourceDocumentId: 77,
            movementType: "TRANSFER_IN",
            locationName: "2801 Route",
            storageSection: "B2"
          }
        ],
        lifecycleEvents: [],
        pallets: [],
        palletEvents: []
      } as unknown as CustomerPortalContainerLifecycle,
      (key) => key,
      true,
      null,
      "admin"
    );

    const transferNode = flow.nodes.find((node) => node.id === "transfer");
    const transferEdge = flow.edges.find((edge) => edge.source === "inventory" && edge.target === "transfer");

    expect(transferNode?.data.action.kind).toBe("transfer");
    expect(transferEdge).toMatchObject({
      sourceHandle: "bottom-source",
      targetHandle: "top-target"
    });
  });

  it("routes picking order edges through the admin transfer node when transfer exists", () => {
    const flow = buildLifecycleFlow(
      {
        summary: {
          containerNo: "CNT-OUTBOUND-EDGES",
          customerId: 1,
          customerName: "Acme Warehouse",
          warehouses: [],
          packingListCount: 0,
          firstPackingListId: 0,
          totalExpectedQty: 30,
          totalReceivedQty: 30,
          currentQty: 10,
          availableQty: 10,
          shippedQty: 20,
          outboundOrderCount: 2,
          pickingOrderRefs: ["PO-1", "PO-2"],
          transferCount: 1,
          palletCount: 1,
          status: "PARTIAL",
          firstReceivedAt: "2026-06-01T12:00:00Z",
          lastActivityAt: "2026-06-02T12:00:00Z"
        },
        packingLists: [],
        pickingOrders: [
          {
            id: 20,
            packingListNo: "PO-1",
            orderRef: "",
            expectedShipDate: null,
            status: "CONFIRMED",
            lines: [],
            attachments: []
          },
          {
            id: 21,
            packingListNo: "PO-2",
            orderRef: "",
            expectedShipDate: null,
            status: "CONFIRMED",
            lines: [],
            attachments: []
          }
        ],
        movements: [],
        lifecycleEvents: [],
        deliveryEvents: [
          {
            id: 300,
            outboundDocumentId: 21,
            bolNumber: "BOL-21",
            eventType: "BOL_RECEIVED",
            bolReceivedAt: "2026-06-04T12:00:00Z",
            eventTime: "2026-06-04T12:00:00Z"
          },
          {
            id: 301,
            outboundDocumentId: 20,
            bolNumber: "BOL-20",
            eventType: "DISPATCHED",
            bolReceivedAt: null,
            eventTime: "2026-06-03T12:00:00Z"
          }
        ],
        pallets: [{ id: 1 }],
        palletEvents: []
      } as unknown as CustomerPortalContainerLifecycle,
      (key) => key,
      true,
      null,
      "admin"
    );

    const inventoryToTransferEdge = flow.edges.find((edge) => edge.source === "inventory" && edge.target === "transfer");
    const pickingInboundEdges = flow.edges.filter((edge) => edge.target.startsWith("picking-"));

    expect(flow.nodes.some((node) => node.id === "transfer")).toBe(true);
    expect(inventoryToTransferEdge).toMatchObject({ sourceHandle: "right-source", targetHandle: "left-target" });
    expect(pickingInboundEdges).toHaveLength(2);
    expect(pickingInboundEdges.map((edge) => edge.source)).toEqual(["transfer", "transfer"]);
    expect(pickingInboundEdges.map((edge) => edge.sourceHandle)).toEqual(["right-source", "right-source"]);
    expect(pickingInboundEdges.map((edge) => edge.targetHandle)).toEqual(["left-target", "left-target"]);

    const deliveryNodes = flow.nodes.filter((node) => node.id.startsWith("delivery-"));
    const deliveryInboundEdges = flow.edges.filter((edge) => edge.target.startsWith("delivery-"));
    const containerNode = flow.nodes.find((node) => node.id === "container");

    expect(deliveryNodes).toHaveLength(2);
    expect(deliveryNodes.map((node) => node.data.action.outboundDocumentId)).toEqual([20, 21]);
    expect(deliveryNodes.map((node) => node.data.action.deliveryEventId)).toEqual([301, 300]);
    expect(deliveryInboundEdges.map((edge) => edge.source)).toEqual(["picking-0", "picking-1"]);
    expect(flow.nodes.some((node) => node.id === "complete")).toBe(false);
    expect(containerNode?.style).toMatchObject({ background: "#fffbeb" });
  });

  it("hides transfer nodes from customer lifecycle flow", () => {
    const flow = buildLifecycleFlow(
      {
        summary: {
          containerNo: "CNT-CUSTOMER-TRANSFER-HIDDEN",
          customerId: 1,
          customerName: "Acme Warehouse",
          warehouses: ["308 Herrod Blvd"],
          packingListCount: 0,
          firstPackingListId: 0,
          totalExpectedQty: 30,
          totalReceivedQty: 30,
          currentQty: 10,
          availableQty: 10,
          shippedQty: 20,
          outboundOrderCount: 1,
          pickingOrderRefs: ["PO-1"],
          transferCount: 1,
          palletCount: 1,
          status: "PARTIAL",
          firstReceivedAt: "2026-06-01T12:00:00Z",
          lastActivityAt: "2026-06-02T12:00:00Z"
        },
        packingLists: [],
        pickingOrders: [
          {
            id: 20,
            packingListNo: "PO-1",
            orderRef: "",
            expectedShipDate: null,
            status: "CONFIRMED",
            lines: [],
            attachments: []
          }
        ],
        movements: [
          {
            id: 1,
            sourceDocumentType: "TRANSFER",
            sourceDocumentId: 77,
            movementType: "TRANSFER_IN",
            locationName: "308 Herrod Blvd",
            storageSection: "A1"
          }
        ],
        lifecycleEvents: [],
        deliveryEvents: [],
        pallets: [],
        palletEvents: []
      } as unknown as CustomerPortalContainerLifecycle,
      (key) => key,
      true,
      null,
      "customer"
    );

    const pickingInboundEdge = flow.edges.find((edge) => edge.target === "picking-0");

    expect(flow.nodes.some((node) => node.id === "transfer")).toBe(false);
    expect(pickingInboundEdge).toMatchObject({ source: "inventory", sourceHandle: "right-source", targetHandle: "left-target" });
  });

  it("routes pallet rework from current inventory into the first outbound order", () => {
    const flow = buildLifecycleFlow(
      {
        summary: {
          containerNo: "CNT-REWORK-OUTBOUND",
          customerId: 1,
          customerName: "Acme Warehouse",
          warehouses: [],
          packingListCount: 0,
          firstPackingListId: 0,
          totalExpectedQty: 30,
          totalReceivedQty: 30,
          currentQty: 10,
          availableQty: 10,
          shippedQty: 20,
          outboundOrderCount: 2,
          pickingOrderRefs: ["PO-1", "PO-2"],
          transferCount: 0,
          palletCount: 3,
          status: "PARTIAL",
          firstReceivedAt: "2026-06-01T12:00:00Z",
          lastActivityAt: "2026-06-03T12:00:00Z"
        },
        packingLists: [],
        pickingOrders: [
          {
            id: 20,
            packingListNo: "PO-1",
            orderRef: "",
            expectedShipDate: null,
            status: "CONFIRMED",
            lines: [
              {
                sku: "SKU-A",
                quantity: 10,
                pickAllocations: []
              }
            ],
            attachments: []
          },
          {
            id: 21,
            packingListNo: "PO-2",
            orderRef: "",
            expectedShipDate: null,
            status: "CONFIRMED",
            lines: [
              {
                sku: "SKU-B",
                quantity: 10,
                pickAllocations: []
              }
            ],
            attachments: []
          }
        ],
        movements: [],
        lifecycleEvents: [],
        deliveryEvents: [],
        pallets: [{ id: 100 }, { id: 501 }, { id: 502 }],
        palletEvents: [],
        reworkEvents: [
          {
            id: 200,
            referenceNo: "RW-200",
            customerId: 1,
            customerName: "Acme Warehouse",
            containerNo: "CNT-REWORK-OUTBOUND",
            eventType: "REPACK",
            eventTime: "2026-06-03T12:00:00Z",
            notes: "",
            pallets: [
              { id: 1, reworkEventId: 200, palletId: 501, palletCode: "P-501", role: "SOURCE", quantityDelta: 0, createdAt: "2026-06-03T12:00:00Z" },
              { id: 2, reworkEventId: 200, palletId: 502, palletCode: "P-502", role: "TARGET", quantityDelta: 0, createdAt: "2026-06-03T12:00:00Z" }
            ],
            createdAt: "2026-06-03T12:00:00Z"
          }
        ]
      } as unknown as CustomerPortalContainerLifecycle,
      (key) => key,
      true,
      null,
      "admin"
    );

    const inventoryNode = flow.nodes.find((node) => node.id === "inventory");
    const reworkNode = flow.nodes.find((node) => node.id === "rework-0");
    const targetPickingNode = flow.nodes.find((node) => node.id === "picking-0");
    const inventoryToRework = flow.edges.find((edge) => edge.source === "inventory" && edge.target === "rework-0");
    const reworkToPicking = flow.edges.find((edge) => edge.source === "rework-0" && edge.target === "picking-0");

    expect(reworkNode).toBeTruthy();
    expect(reworkNode?.position.y).toBe(targetPickingNode?.position.y);
    expect(reworkNode?.position.x).toBeGreaterThan(inventoryNode?.position.x ?? 0);
    expect(reworkNode?.position.x).toBeLessThan(targetPickingNode?.position.x ?? 0);
    expect(inventoryToRework).toMatchObject({ sourceHandle: "right-source", targetHandle: "left-target" });
    expect(reworkToPicking).toMatchObject({ sourceHandle: "right-source", targetHandle: "left-target" });
    expect(flow.edges.some((edge) => edge.source === "inventory" && edge.target === "picking-0")).toBe(false);
  });

  it("centers stacked outbound orders around the inventory row", () => {
    const pickingOrders = Array.from({ length: 5 }, (_, index) => ({
      id: 30 + index,
      packingListNo: `PO-${index + 1}`,
      orderRef: "",
      expectedShipDate: null,
      status: "CONFIRMED",
      lines: [],
      attachments: []
    }));
    const flow = buildLifecycleFlow(
      {
        summary: {
          containerNo: "CNT-STACKED-PO",
          customerId: 1,
          customerName: "Acme Warehouse",
          warehouses: [],
          packingListCount: 0,
          firstPackingListId: 0,
          totalExpectedQty: 50,
          totalReceivedQty: 50,
          currentQty: 0,
          availableQty: 0,
          shippedQty: 50,
          outboundOrderCount: 5,
          pickingOrderRefs: pickingOrders.map((document) => document.packingListNo),
          transferCount: 0,
          palletCount: 0,
          status: "SHIPPED",
          firstReceivedAt: "2026-06-01T12:00:00Z",
          lastActivityAt: "2026-06-05T12:00:00Z"
        },
        packingLists: [],
        pickingOrders,
        movements: [],
        lifecycleEvents: [],
        deliveryEvents: pickingOrders.map((document) => ({
          id: document.id + 100,
          outboundDocumentId: document.id,
          bolNumber: `BOL-${document.id}`,
          eventType: "DISPATCHED",
          bolReceivedAt: null,
          eventTime: "2026-06-05T12:00:00Z"
        })),
        pallets: [],
        palletEvents: []
      } as unknown as CustomerPortalContainerLifecycle,
      (key) => key,
      true,
      null,
      "admin"
    );

    const inventoryY = flow.nodes.find((node) => node.id === "inventory")?.position.y;
    const pickingNodes = flow.nodes.filter((node) => node.id.startsWith("picking-"));
    const deliveryNodes = flow.nodes.filter((node) => node.id.startsWith("delivery-"));
    const pickingYValues = pickingNodes.map((node) => node.position.y);

    expect(pickingNodes).toHaveLength(5);
    expect(deliveryNodes).toHaveLength(5);
    expect(pickingYValues[2]).toBe(inventoryY);
    expect(pickingYValues[0] + pickingYValues[4]).toBe((inventoryY ?? 0) * 2);
    expect(pickingYValues[1] + pickingYValues[3]).toBe((inventoryY ?? 0) * 2);
    expect(deliveryNodes.map((node) => node.position.y)).toEqual(pickingYValues);
  });
});
