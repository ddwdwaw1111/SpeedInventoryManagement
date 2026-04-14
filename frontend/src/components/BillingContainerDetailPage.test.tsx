import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Movement, PalletTrace } from "../lib/types";
import { renderWithProviders } from "../test/renderWithProviders";
import { createCustomer, createLocation } from "../test/fixtures";
import { BillingContainerDetailPage } from "./BillingContainerDetailPage";

const { getPallets, getPalletLocationEvents } = vi.hoisted(() => ({
	getPallets: vi.fn(),
	getPalletLocationEvents: vi.fn()
}));

vi.mock("../lib/api", () => ({
	ApiError: class ApiError extends Error {},
	api: {
		getPallets,
		getPalletLocationEvents
	}
}));

describe("BillingContainerDetailPage", () => {
	beforeEach(() => {
		getPallets.mockReset();
		getPalletLocationEvents.mockReset();
		window.localStorage.clear();
		window.sessionStorage.clear();
		window.localStorage.setItem("sim-timezone", "UTC");
		window.sessionStorage.setItem("sim-billing-workspace-context", JSON.stringify({
			startDate: "2026-03-01",
			endDate: "2026-03-31",
			customerId: "all",
			warehouseLocationId: "all",
			containerType: "all",
			rates: {
				inboundContainerFee: 450,
				transferInboundFeePerPallet: 10,
				wrappingFeePerPallet: 15,
				storageFeePerPalletPerWeek: 7,
				storageFeePerPalletPerWeekNormal: 7,
				storageFeePerPalletPerWeekWestCoastTransfer: 7,
				outboundFeePerPallet: 0
			}
		}));
	});

	it("shows only the selected date-range timeline rows for the selected container and keeps cumulative deltas", async () => {
		getPallets.mockResolvedValue([
			createPalletTrace({
				id: 11,
				palletCode: "PLT-001",
				currentContainerNo: "GCXU5817233",
				createdAt: "2026-03-02T09:00:00Z",
				updatedAt: "2026-03-20T10:00:00Z"
			})
		]);
		getPalletLocationEvents.mockResolvedValue([
			{
				id: 101,
				palletId: 11,
				palletCode: "PLT-001",
				containerVisitId: 1,
				customerId: 1,
				customerName: "Imperial Bag & Paper",
				locationId: 1,
				locationName: "NJ",
				storageSection: "TEMP",
				containerNo: "GCXU5817233",
				eventType: "RECEIVED",
				quantityDelta: 10,
				palletDelta: 1,
				eventTime: "2026-03-02T10:00:00Z",
				createdAt: "2026-03-02T10:00:00Z"
			},
			{
				id: 102,
				palletId: 11,
				palletCode: "PLT-001",
				containerVisitId: 1,
				customerId: 1,
				customerName: "Imperial Bag & Paper",
				locationId: 1,
				locationName: "NJ",
				storageSection: "A",
				containerNo: "GCXU5817233",
				eventType: "TRANSFER",
				quantityDelta: 0,
				palletDelta: 0,
				eventTime: "2026-03-12T12:00:00Z",
				createdAt: "2026-03-12T12:00:00Z"
			},
			{
				id: 103,
				palletId: 11,
				palletCode: "PLT-001",
				containerVisitId: 1,
				customerId: 1,
				customerName: "Imperial Bag & Paper",
				locationId: 1,
				locationName: "NJ",
				storageSection: "A",
				containerNo: "GCXU5817233",
				eventType: "SHIPPED",
				quantityDelta: -4,
				palletDelta: -1,
				eventTime: "2026-03-20T10:00:00Z",
				createdAt: "2026-03-20T10:00:00Z"
			},
			{
				id: 104,
				palletId: 12,
				palletCode: "PLT-APR",
				containerVisitId: 1,
				customerId: 1,
				customerName: "Imperial Bag & Paper",
				locationId: 1,
				locationName: "NJ",
				storageSection: "TEMP",
				containerNo: "GCXU5817233",
				eventType: "RECEIVED",
				quantityDelta: 99,
				palletDelta: 1,
				eventTime: "2026-04-01T08:00:00Z",
				createdAt: "2026-04-01T08:00:00Z"
			},
			{
				id: 105,
				palletId: 13,
				palletCode: "PLT-OTHER",
				containerVisitId: 2,
				customerId: 1,
				customerName: "Imperial Bag & Paper",
				locationId: 1,
				locationName: "NJ",
				storageSection: "TEMP",
				containerNo: "MSCU0000001",
				eventType: "RECEIVED",
				quantityDelta: 5,
				palletDelta: 1,
				eventTime: "2026-03-06T08:00:00Z",
				createdAt: "2026-03-06T08:00:00Z"
			}
		]);

		renderWithProviders(
			<BillingContainerDetailPage
				routeKey="/billing/container/2026-03-01/2026-03-31/all/all/GCXU5817233"
				startDate="2026-03-01"
				endDate="2026-03-31"
				customerId="all"
				warehouseLocationId="all"
				containerNo="GCXU5817233"
				customers={[createCustomer()]}
				locations={[createLocation()]}
				inboundDocuments={[]}
				outboundDocuments={[]}
				movements={[]}
				onBackToBilling={vi.fn()}
				onOpenContainerDetail={vi.fn()}
			/>
		);

		const timelineTable = await screen.findByRole("table", { name: "Pallet Change Timeline" });
		expect(getPalletLocationEvents).toHaveBeenCalledWith(50000, "GCXU5817233");
		expect(within(timelineTable).getAllByText("PLT-001")).toHaveLength(3);
		expect(within(timelineTable).queryByText("PLT-APR")).not.toBeInTheDocument();
		expect(within(timelineTable).queryByText("PLT-OTHER")).not.toBeInTheDocument();
		expect(within(timelineTable).getAllByText("+10").length).toBeGreaterThan(0);
		expect(within(timelineTable).getAllByText("+6").length).toBeGreaterThan(0);
		expect(within(timelineTable).getByText("-1")).toBeInTheDocument();
	});

	it("falls back to outbound movements when pallet timeline has no outbound event", async () => {
		getPallets.mockResolvedValue([createPalletTrace({
			id: 21,
			palletCode: "PLT-021",
			currentContainerNo: "MSCU1234567"
		})]);
		getPalletLocationEvents.mockResolvedValue([
			{
				id: 201,
				palletId: 21,
				palletCode: "PLT-021",
				containerVisitId: 1,
				customerId: 1,
				customerName: "Imperial Bag & Paper",
				locationId: 1,
				locationName: "NJ",
				storageSection: "TEMP",
				containerNo: "MSCU1234567",
				eventType: "RECEIVED",
				quantityDelta: 12,
				palletDelta: 1,
				eventTime: "2026-03-05T08:00:00Z",
				createdAt: "2026-03-05T08:00:00Z"
			}
		]);
		const fallbackMovements: Movement[] = [
			{
				id: 301,
				itemId: 0,
				inboundDocumentId: 0,
				inboundDocumentLineId: 0,
				outboundDocumentId: 88,
				outboundDocumentLineId: 99,
				itemName: "608333",
				sku: "608333",
				description: "VB22GC",
				customerId: 1,
				customerName: "Imperial Bag & Paper",
				locationName: "NJ",
				storageSection: "A",
				movementType: "OUT",
				quantityChange: -12,
				deliveryDate: null,
				containerNo: "MSCU1234567",
				packingListNo: "PK-001",
				orderRef: "SO-001",
				itemNumber: "608333",
				expectedQty: 0,
				receivedQty: 0,
				pallets: 1,
				palletsDetailCtns: "12",
				cartonSizeMm: "",
				cartonCount: 0,
				unitLabel: "CTN",
				netWeightKgs: 0,
				grossWeightKgs: 0,
				heightIn: 0,
				outDate: "2026-03-18T11:00:00Z",
				documentNote: "",
				reason: "",
				referenceCode: "OUT-88",
				createdAt: "2026-03-18T11:00:00Z"
			}
		];

		renderWithProviders(
			<BillingContainerDetailPage
				routeKey="/billing/container/2026-03-01/2026-03-31/all/all/MSCU1234567"
				startDate="2026-03-01"
				endDate="2026-03-31"
				customerId="all"
				warehouseLocationId="all"
				containerNo="MSCU1234567"
				customers={[createCustomer()]}
				locations={[createLocation()]}
				inboundDocuments={[]}
				outboundDocuments={[]}
				movements={fallbackMovements}
				onBackToBilling={vi.fn()}
				onOpenContainerDetail={vi.fn()}
			/>
		);

		const timelineTable = await screen.findByRole("table", { name: "Pallet Change Timeline" });
		expect(within(timelineTable).getByText("OUTBOUND")).toBeInTheDocument();
		expect(within(timelineTable).getByText("OUT-88")).toBeInTheDocument();
		expect(within(timelineTable).getByText("-12")).toBeInTheDocument();
	});
});

function createPalletTrace(overrides: Partial<PalletTrace> = {}): PalletTrace {
	return {
		id: 1,
		parentPalletId: 0,
		palletCode: "PLT-001",
		containerVisitId: 1,
		sourceInboundDocumentId: 1,
		sourceInboundLineId: 1,
		actualArrivalDate: "2026-03-02",
		customerId: 1,
		customerName: "Imperial Bag & Paper",
		skuMasterId: 1,
		sku: "608333",
		description: "VB22GC",
		currentLocationId: 1,
		currentLocationName: "NJ",
		currentStorageSection: "TEMP",
		currentContainerNo: "GCXU5817233",
		containerType: "NORMAL",
		status: "OPEN",
		createdAt: "2026-03-02T09:00:00Z",
		updatedAt: "2026-03-20T10:00:00Z",
		contents: [],
		...overrides
	};
}
