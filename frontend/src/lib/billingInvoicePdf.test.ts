import { describe, expect, it } from "vitest";

import { buildBillingInvoicePdfDefinition } from "./billingInvoicePdf";
import type { BillingInvoice } from "./types";

function createInvoiceFixture(): BillingInvoice {
  return {
    id: 42,
    invoiceNo: "INV-2026-0001",
    invoiceType: "STORAGE_SETTLEMENT",
    customerId: 1,
    customerNameSnapshot: "Imperial Bag & Paper",
    warehouseLocationId: 1,
    warehouseNameSnapshot: "NJ",
    containerType: "NORMAL",
    periodStart: "2026-03-01",
    periodEnd: "2026-03-31",
    currencyCode: "USD",
    rates: {
      inboundContainerFee: 450,
      transferInboundFeePerPallet: 10,
      wrappingFeePerPallet: 15,
      storageFeePerPalletPerWeek: 7,
      storageFeePerPalletPerWeekNormal: 7,
      storageFeePerPalletPerWeekWestCoastTransfer: 7,
      outboundFeePerPallet: 0
    },
    header: {
      sellerName: "Speed Inventory Management",
      subtitle: "Business services invoice",
      remitTo: "Speed Inventory Management",
      terms: "Net 30",
      paymentDueDays: 30,
      paymentInstructions: "Payment due within 30 days of invoice date. Please reference the invoice number with payment. Amounts are in USD."
    },
    subtotal: 133,
    discountTotal: -20,
    grandTotal: 113,
    status: "DRAFT",
    notes: "March billing",
    finalizedAt: null,
    finalizedByUserId: null,
    paidAt: null,
    voidedAt: null,
    createdByUserId: 1,
    createdAt: "2026-04-01T12:00:00Z",
    updatedAt: "2026-04-01T12:00:00Z",
    lineCount: 2,
    lines: [
      {
        id: 1001,
        invoiceId: 42,
        chargeType: "STORAGE",
        description: "Storage settlement for GCXU5817233",
        reference: "Storage | GCXU5817233",
        containerNo: "GCXU5817233",
        warehouse: "NJ",
        occurredOn: "2026-03-31",
        quantity: 133,
        unitRate: 1,
        amount: 133,
        notes: "Storage settlement",
        sourceType: "AUTO",
        sortOrder: 1,
        createdAt: "2026-04-01T12:00:00Z",
        details: {
          kind: "STORAGE_CONTAINER_SUMMARY",
          warehousesTouched: ["NJ"],
          palletsTracked: 10,
          palletDays: 140,
          freePalletDays: 7,
          billablePalletDays: 133,
          grossAmount: 140,
          discountAmount: 7,
          segments: [
            {
              startDate: "2026-03-01",
              endDate: "2026-03-14",
              dayEndPallets: 10,
              billedDays: 14,
              palletDays: 140,
              freePalletDays: 7,
              billablePalletDays: 133,
              grossAmount: 140,
              discountAmount: 7,
              amount: 133
            }
          ]
        }
      },
      {
        id: 1002,
        invoiceId: 42,
        chargeType: "DISCOUNT",
        description: "Courtesy discount",
        reference: "",
        containerNo: "",
        warehouse: "",
        occurredOn: "",
        quantity: 1,
        unitRate: -20,
        amount: -20,
        notes: "",
        sourceType: "MANUAL",
        sortOrder: 2,
        createdAt: "2026-04-01T12:00:00Z",
        details: null
      }
    ]
  };
}

function createOverlappingSegmentInvoiceFixture(): BillingInvoice {
  const base = createInvoiceFixture();
  return {
    ...base,
    periodStart: "2026-04-01",
    periodEnd: "2026-04-06",
    subtotal: 60,
    discountTotal: 0,
    grandTotal: 60,
    lines: [
      {
        ...base.lines[0],
        id: 2001,
        invoiceId: base.id,
        reference: "Storage | CONT-A",
        containerNo: "CONT-A",
        quantity: 40,
        amount: 40,
        details: {
          kind: "STORAGE_CONTAINER_SUMMARY",
          warehousesTouched: ["NJ"],
          palletsTracked: 10,
          palletDays: 40,
          freePalletDays: 0,
          billablePalletDays: 40,
          grossAmount: 40,
          discountAmount: 0,
          segments: [
            {
              startDate: "2026-04-01",
              endDate: "2026-04-04",
              dayEndPallets: 10,
              billedDays: 4,
              palletDays: 40,
              freePalletDays: 0,
              billablePalletDays: 40,
              grossAmount: 40,
              discountAmount: 0,
              amount: 40
            }
          ]
        }
      },
      {
        ...base.lines[0],
        id: 2002,
        invoiceId: base.id,
        reference: "Storage | CONT-B",
        containerNo: "CONT-B",
        quantity: 20,
        amount: 20,
        sortOrder: 2,
        details: {
          kind: "STORAGE_CONTAINER_SUMMARY",
          warehousesTouched: ["NJ"],
          palletsTracked: 5,
          palletDays: 20,
          freePalletDays: 0,
          billablePalletDays: 20,
          grossAmount: 20,
          discountAmount: 0,
          segments: [
            {
              startDate: "2026-04-03",
              endDate: "2026-04-06",
              dayEndPallets: 5,
              billedDays: 4,
              palletDays: 20,
              freePalletDays: 0,
              billablePalletDays: 20,
              grossAmount: 20,
              discountAmount: 0,
              amount: 20
            }
          ]
        }
      }
    ]
  };
}

describe("buildBillingInvoicePdfDefinition", () => {
  it("places amount summary first and moves line details onto later pages", () => {
    const definition = buildBillingInvoicePdfDefinition({
      invoice: createInvoiceFixture(),
      timeZone: "UTC"
    });

    expect(definition.pageSize).toBe("LETTER");
    expect(definition.pageOrientation).toBe("portrait");

    const content = definition.content as any[];
    expect(content[0].columns[0].stack[0].text).toBe("Speed Inventory Management");
    expect(content[0].columns[1].stack[0].text).toBe("INVOICE");
    const invoiceHeaderRows = content[0].columns[1].stack[1].table.body;
    expect(invoiceHeaderRows[0][1].text).toBe("INV-2026-0001");
    expect(invoiceHeaderRows[1][1].text).toBe("Apr 1, 2026");
    expect(invoiceHeaderRows[2][1].text).toBe("May 1, 2026");
    expect(invoiceHeaderRows[3][1].text).toBe("Net 30");
    expect(content[1].table.body[0][0].stack[0].text).toBe("Bill To");
    expect(content[1].table.body[0][0].stack[1].text).toBe("Imperial Bag & Paper");
    expect(content[1].table.body[0][1].stack[0].text).toBe("Remit To");

    const lineDetailTitleIndex = content.findIndex((block) => block.text === "Line Item Detail");
    expect(lineDetailTitleIndex).toBeGreaterThan(0);
    expect(content[lineDetailTitleIndex].pageBreak).toBe("before");
    expect(content.slice(0, lineDetailTitleIndex).map((block) => block.text)).toContain("Amount Summary");
    expect(content.slice(0, lineDetailTitleIndex).map((block) => block.text)).not.toContain("Charge Summary");
    expect(content.slice(0, lineDetailTitleIndex).map((block) => block.text)).not.toContain("Discount Sources");

    const amountSummaryTable = content[3].table.body;
    expect(amountSummaryTable[0].map((cell: { text: string }) => cell.text)).toEqual([
      "Summary Item",
      "Basis / Source",
      "Gross Charges",
      "Discounts",
      "Net Amount"
    ]);
    expect(JSON.stringify(amountSummaryTable)).not.toContain("Storage pallet-days");
    expect(amountSummaryTable[1][0].text).toBe("Storage Charges");
    expect(amountSummaryTable[1][2].text).toBe("$140.00");
    expect(amountSummaryTable[4][2].text).toBe("$140.00");
    expect(amountSummaryTable[5][3].text).toBe("-$27.00");
    expect(amountSummaryTable[6][4].text).toBe("$113.00");
    expect(JSON.stringify(content)).not.toContain("Invoice Notes");
    expect(JSON.stringify(content)).not.toContain("March billing");
  });

  it("uses the persisted editable invoice header", () => {
    const definition = buildBillingInvoicePdfDefinition({
      invoice: {
        ...createInvoiceFixture(),
        header: {
          sellerName: "SIM Logistics LLC",
          subtitle: "Warehouse services invoice",
          remitTo: "SIM Logistics LLC - ACH 1234",
          terms: "Net 15",
          paymentDueDays: 15,
          paymentInstructions: "Send ACH payment and reference the invoice number."
        }
      },
      timeZone: "UTC"
    });

    const content = definition.content as any[];
    expect(content[0].columns[0].stack[0].text).toBe("SIM Logistics LLC");
    expect(content[0].columns[0].stack[1].text).toBe("Warehouse services invoice");
    expect(definition.info?.author).toBe("SIM Logistics LLC");

    const invoiceHeaderRows = content[0].columns[1].stack[1].table.body;
    expect(invoiceHeaderRows[2][1].text).toBe("Apr 16, 2026");
    expect(invoiceHeaderRows[3][1].text).toBe("Net 15");
    expect(content[1].table.body[0][1].stack[1].text).toBe("SIM Logistics LLC - ACH 1234");
    expect(JSON.stringify(content)).toContain("Send ACH payment and reference the invoice number.");
  });

  it("annotates discount sources on separate detail rows without container or warehouse columns", () => {
    const definition = buildBillingInvoicePdfDefinition({
      invoice: createInvoiceFixture(),
      timeZone: "UTC"
    });

    const content = definition.content as any[];
    const amountSummaryTable = content[3].table.body;
    expect(amountSummaryTable[0].map((cell: { text: string }) => cell.text)).not.toContain("Container");
    expect(amountSummaryTable[2][0].text).toBe("Discount source");
    expect(amountSummaryTable[2][1].text).toBe("Storage grace period | Storage | GCXU5817233 | 7 free pallet-days");
    expect(amountSummaryTable[2][3].text).toBe("-$7.00");
    expect(amountSummaryTable[3][0].text).toBe("Discount source");
    expect(amountSummaryTable[3][1].text).toBe("Manual discount line | Line 2 | Courtesy discount");
    expect(amountSummaryTable[3][3].text).toBe("-$20.00");

    const lineDetailTitleIndex = content.findIndex((block) => block.text === "Line Item Detail");
    const lineDetailTable = content[lineDetailTitleIndex + 1].table.body;
    const lineHeaders = lineDetailTable[0].map((cell: { text: string }) => cell.text);
    expect(lineHeaders).toContain("Discount Source");
    expect(lineHeaders).not.toContain("Container");
    expect(lineHeaders).not.toContain("Warehouse");
    expect(lineDetailTable[1][5].text).toBe("140 pallet-days");
    expect(lineDetailTable[1][7].text).toBe("$140.00");
    expect(lineDetailTable[2][1].text).toBe("Discount");
    expect(lineDetailTable[2][5].text).toBe("7 free pallet-days");
    expect(lineDetailTable[2][7].text).toBe("-$7.00");
    expect(lineDetailTable[2][8].text).toBe("Storage grace period");
    expect(lineDetailTable[3][1].text).toBe("Discount");
    expect(lineDetailTable[3][2].text).toBe("Courtesy discount");
    expect(lineDetailTable[3][7].text).toBe("-$20.00");
    expect(lineDetailTable[3][8].text).toBe("Manual discount line");

    const segmentTitleIndex = content.findIndex((block) => block.text === "Storage Segment Detail");
    expect(content[segmentTitleIndex].pageBreak).toBe("before");
    const segmentTable = content[segmentTitleIndex + 1].table.body;
    const segmentHeaders = segmentTable[0].map((cell: { text: string }) => cell.text);
    expect(segmentHeaders).toContain("Discount Source");
    expect(segmentHeaders).not.toContain("Container");
    expect(segmentHeaders).not.toContain("Warehouses");
    expect(segmentTable[1][5].text).toBe("140 pallet-days");
    expect(segmentTable[1][6].text).toBe("$140.00");
    expect(segmentTable[2][5].text).toBe("7 free pallet-days");
    expect(segmentTable[2][6].text).toBe("-$7.00");
    expect(segmentTable[2][7].text).toBe("Storage grace period");
  });

  it("aggregates overlapping storage segment dates when container columns are hidden", () => {
    const definition = buildBillingInvoicePdfDefinition({
      invoice: createOverlappingSegmentInvoiceFixture(),
      timeZone: "UTC"
    });

    const content = definition.content as any[];
    const segmentTitleIndex = content.findIndex((block) => block.text === "Storage Segment Detail");
    const segmentTable = content[segmentTitleIndex + 1].table.body;

    expect(segmentTable.slice(1).map((row: Array<{ text: string }>) => row.slice(1, 7).map((cell) => cell.text))).toEqual([
      ["2026-04-01", "2026-04-02", "10", "2", "20 pallet-days", "$20.00"],
      ["2026-04-03", "2026-04-04", "15", "2", "30 pallet-days", "$30.00"],
      ["2026-04-05", "2026-04-06", "5", "2", "10 pallet-days", "$10.00"]
    ]);
  });
});
