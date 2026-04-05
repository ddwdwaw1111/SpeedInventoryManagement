import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BillingPage } from "./BillingPage";
import { renderWithProviders } from "../test/renderWithProviders";
import { createCustomer, createInboundDocument, createInboundDocumentLine } from "../test/fixtures";

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

vi.mock("@mui/x-charts", () => ({
	BarChart: () => <div data-testid="billing-balance-chart" />
}));

describe("BillingPage", () => {
	beforeEach(() => {
		getPallets.mockReset();
		getPalletLocationEvents.mockReset();
		window.localStorage.clear();
		window.sessionStorage.clear();
		window.localStorage.setItem("sim-timezone", "UTC");
		getPallets.mockResolvedValue([]);
		getPalletLocationEvents.mockResolvedValue([]);
	});

	it("opens the billing container detail route with the selected date range and customer scope", async () => {
		const onOpenBillingContainerDetail = vi.fn();

		renderWithProviders(
			<BillingPage
				customers={[createCustomer()]}
				inboundDocuments={[
					createInboundDocument({
						id: 12,
						status: "CONFIRMED",
						confirmedAt: "2026-03-05T12:00:00Z",
						expectedArrivalDate: "2026-03-05",
						containerNo: "GCXU5817233",
						lines: [createInboundDocumentLine({ id: 71, pallets: 2, receivedQty: 20, expectedQty: 20 })]
					})
				]}
				outboundDocuments={[]}
				onOpenBillingContainerDetail={onOpenBillingContainerDetail}
			/>
		);

		fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-03-01" } });
		fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-03-31" } });

		const openButton = await screen.findByRole("button", { name: "Billing Detail" });
		expect(screen.getByRole("table", { name: "Container Billing Trace" })).toBeInTheDocument();

		fireEvent.click(openButton);

		expect(onOpenBillingContainerDetail).toHaveBeenCalledWith("2026-03-01", "2026-03-31", "all", "GCXU5817233");
		await waitFor(() => {
			expect(window.sessionStorage.getItem("sim-billing-workspace-context")).toContain('"startDate":"2026-03-01"');
			expect(window.sessionStorage.getItem("sim-billing-workspace-context")).toContain('"endDate":"2026-03-31"');
		});
	});
});
