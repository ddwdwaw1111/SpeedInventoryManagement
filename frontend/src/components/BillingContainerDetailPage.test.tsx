import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test/renderWithProviders";
import {
	createCustomer,
	createInboundDocument,
	createInboundDocumentLine,
	createLocation,
	createOutboundDocument,
	createOutboundDocumentLine,
	createOutboundPickAllocation
} from "../test/fixtures";
import { BillingContainerDetailPage } from "./BillingContainerDetailPage";

describe("BillingContainerDetailPage", () => {
	beforeEach(() => {
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

	it("shows document-derived storage and invoice detail for the selected container", async () => {
		renderPage({
			inboundDocuments: [
				createInboundDocument({
					id: 10,
					status: "CONFIRMED",
					trackingStatus: "RECEIVED",
					actualArrivalDate: "2026-03-01",
					confirmedAt: "2026-03-01T09:00:00Z",
					containerNo: "GCXU5817233",
					lines: [createInboundDocumentLine({ id: 100, documentId: 10, pallets: 2, receivedQty: 20 })]
				})
			],
			outboundDocuments: [
				createOutboundDocument({
					id: 20,
					status: "CONFIRMED",
					trackingStatus: "SHIPPED",
					actualShipDate: "2026-03-10",
					confirmedAt: "2026-03-10T10:00:00Z",
					lines: [
						createOutboundDocumentLine({
							id: 200,
							documentId: 20,
							pallets: 1,
							quantity: 10,
							pickAllocations: [
								createOutboundPickAllocation({
									id: 2000,
									lineId: 200,
									containerNo: "GCXU5817233",
									pallets: 1,
									allocatedQty: 10
								})
							]
						})
					]
				})
			]
		});

		const storageTable = await screen.findByRole("table", { name: "Storage Segment Breakdown" });
		expect(within(storageTable).getAllByText(/Mar/).length).toBeGreaterThan(0);
		expect(screen.getByRole("table", { name: "Invoice Preview" })).toBeInTheDocument();
		expect(screen.queryByRole("table", { name: "Pallet Change Timeline" })).not.toBeInTheDocument();
	});

	it("shows the empty state when no document data matches the container", () => {
		renderPage({ inboundDocuments: [], outboundDocuments: [] });

		expect(screen.getByText("No billing detail found for this container.")).toBeInTheDocument();
	});

	it("ignores stale workspace grace-period settings when the stored context does not match the route", async () => {
		window.sessionStorage.setItem("sim-billing-workspace-context", JSON.stringify({
			startDate: "2026-02-01",
			endDate: "2026-02-28",
			customerId: "all",
			warehouseLocationId: "all",
			containerType: "all",
			normalPalletGracePeriodEnabled: false,
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

		renderPage({
			containerNo: "STALE-GRACE",
			routeKey: "/billing/container/2026-03-01/2026-03-31/all/all/STALE-GRACE",
			inboundDocuments: [
				createInboundDocument({
					status: "CONFIRMED",
					trackingStatus: "RECEIVED",
					actualArrivalDate: "2026-03-01",
					confirmedAt: "2026-03-01T09:00:00Z",
					containerNo: "STALE-GRACE",
					lines: [createInboundDocumentLine({ pallets: 1, receivedQty: 10 })]
				})
			],
			outboundDocuments: []
		});

		expect(await screen.findAllByText("$24.00")).not.toHaveLength(0);
		expect(screen.queryByText("$31.00")).not.toBeInTheDocument();
	});
});

function renderPage(overrides: Partial<Parameters<typeof BillingContainerDetailPage>[0]> = {}) {
	return renderWithProviders(
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
			onBackToBilling={vi.fn()}
			onOpenContainerDetail={vi.fn()}
			{...overrides}
		/>
	);
}
