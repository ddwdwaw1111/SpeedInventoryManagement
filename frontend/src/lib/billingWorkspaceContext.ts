import type { BillingRates } from "./billingPreview";

export type BillingWorkspaceContext = {
	startDate: string;
	endDate: string;
	customerId: number | "all";
	warehouseLocationId: number | "all";
	containerType: "all" | "NORMAL" | "WEST_COAST_TRANSFER";
	rates: BillingRates;
};

const STORAGE_KEY = "sim-billing-workspace-context";

export function readBillingWorkspaceContext(): BillingWorkspaceContext | null {
	const raw = window.sessionStorage.getItem(STORAGE_KEY);
	if (!raw) {
		return null;
	}

	try {
		const parsed = JSON.parse(raw) as Partial<BillingWorkspaceContext>;
		if (!parsed || typeof parsed !== "object") {
			return null;
		}

		if (typeof parsed.startDate !== "string" || !parsed.startDate.trim()) {
			return null;
		}
		if (typeof parsed.endDate !== "string" || !parsed.endDate.trim()) {
			return null;
		}
		if (parsed.customerId !== "all" && typeof parsed.customerId !== "number") {
			return null;
		}
		if (parsed.warehouseLocationId !== "all" && typeof parsed.warehouseLocationId !== "number") {
			return null;
		}
		if (
			parsed.containerType !== "all"
			&& parsed.containerType !== "NORMAL"
			&& parsed.containerType !== "WEST_COAST_TRANSFER"
		) {
			return null;
		}
		if (!parsed.rates || typeof parsed.rates !== "object") {
			return null;
		}

		return {
			startDate: parsed.startDate,
			endDate: parsed.endDate,
			customerId: parsed.customerId,
			warehouseLocationId: parsed.warehouseLocationId ?? "all",
			containerType: parsed.containerType ?? "all",
			rates: {
				inboundContainerFee: normalizeRate(parsed.rates.inboundContainerFee),
				transferInboundFeePerPallet: normalizeRate(parsed.rates.transferInboundFeePerPallet ?? 10),
				wrappingFeePerPallet: normalizeRate(parsed.rates.wrappingFeePerPallet),
				storageFeePerPalletPerWeek: normalizeRate(parsed.rates.storageFeePerPalletPerWeek),
				storageFeePerPalletPerWeekNormal: normalizeRate(parsed.rates.storageFeePerPalletPerWeekNormal ?? parsed.rates.storageFeePerPalletPerWeek),
				storageFeePerPalletPerWeekWestCoastTransfer: normalizeRate(parsed.rates.storageFeePerPalletPerWeekWestCoastTransfer ?? parsed.rates.storageFeePerPalletPerWeek),
				outboundFeePerPallet: normalizeRate(parsed.rates.outboundFeePerPallet)
			}
		};
	} catch {
		return null;
	}
}

export function setBillingWorkspaceContext(context: BillingWorkspaceContext) {
	window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(context));
}

function normalizeRate(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
