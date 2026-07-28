import { describe, expect, it } from "vitest";

import {
  buildBillingInvoiceContainerDetails,
  resolveBillingInvoiceContainerDetails,
  sumBillingContainerDetailTotals
} from "./billingContainerLedger";
import type { BillingInvoice, BillingInvoiceLineData } from "./types";

function line(overrides: Partial<BillingInvoiceLineData>): BillingInvoiceLineData {
  return {
    id: 1,
    invoiceId: 10,
    chargeType: "INBOUND",
    description: "",
    reference: "",
    containerNo: "CONT-A",
    warehouse: "308",
    occurredOn: "2026-07-01",
    quantity: 1,
    unitRate: 0,
    amount: 0,
    notes: "",
    sourceType: "AUTO",
    sortOrder: 1,
    createdAt: "2026-07-01T00:00:00Z",
    details: null,
    ...overrides
  };
}

describe("billing container ledger", () => {
  it("groups every charge by container and keeps invoice-level adjustments", () => {
    const details = buildBillingInvoiceContainerDetails([
      line({ id: 1, chargeType: "INBOUND", reference: "Receipt 1", amount: 450 }),
      line({ id: 2, chargeType: "WRAPPING", reference: "Receipt 1", quantity: 4, amount: 60 }),
      line({
        id: 3,
        chargeType: "STORAGE",
        reference: "Storage | CONT-A",
        quantity: 35,
        amount: 35,
        details: {
          kind: "STORAGE_CONTAINER_SUMMARY",
          warehousesTouched: ["308"],
          palletsTracked: 4,
          palletDays: 40,
          freePalletDays: 5,
          billablePalletDays: 35,
          grossAmount: 40,
          discountAmount: 5,
          segments: []
        }
      }),
      line({ id: 4, chargeType: "OUTBOUND", reference: "Picking order PO-1", quantity: 2, amount: 20 }),
      line({ id: 5, chargeType: "DISCOUNT", containerNo: "", warehouse: "", amount: -10 })
    ]);

    expect(details).toHaveLength(2);
    expect(details[0]).toMatchObject({
      containerNo: "CONT-A",
      references: ["Picking order PO-1", "Receipt 1", "Storage | CONT-A"],
      inboundUnits: 1,
      wrappingPallets: 4,
      palletsTracked: 4,
      palletDays: 40,
      freePalletDays: 5,
      billablePalletDays: 35,
      outboundPallets: 2,
      inboundAmount: 450,
      wrappingAmount: 60,
      storageGrossAmount: 40,
      storageDiscountAmount: 5,
      storageAmount: 35,
      outboundAmount: 20,
      totalAmount: 565,
      lineCount: 4
    });
    expect(details[1]).toMatchObject({
      containerNo: "",
      adjustmentAmount: -10,
      totalAmount: -10,
      lineCount: 1
    });
    expect(sumBillingContainerDetailTotals(details)).toBe(555);
  });

  it("prefers the server-generated container ledger snapshot", () => {
    const serverDetail = {
      ...buildBillingInvoiceContainerDetails([line({ amount: 450 })])[0],
      totalAmount: 999
    };
    const invoice = {
      containerDetails: [serverDetail],
      lines: [line({ amount: 450 })]
    } as BillingInvoice;

    expect(resolveBillingInvoiceContainerDetails(invoice)[0].totalAmount).toBe(999);
  });
});
