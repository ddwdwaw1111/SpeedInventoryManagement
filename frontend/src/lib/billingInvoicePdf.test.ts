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

function createInboundInvoiceFixture(): BillingInvoice {
  const base = createInvoiceFixture();
  return {
    ...base,
    invoiceType: "MIXED",
    periodStart: "2026-04-01",
    periodEnd: "2026-04-30",
    subtotal: 670,
    discountTotal: 0,
    grandTotal: 670,
    lineCount: 2,
    lines: [
      {
        ...base.lines[0],
        id: 3001,
        invoiceId: base.id,
        chargeType: "INBOUND",
        description: "22 pallets received",
        reference: "Receipt 157 | REGULAR-001",
        containerNo: "REGULAR-001",
        occurredOn: "2026-04-16",
        quantity: 1,
        unitRate: 450,
        amount: 450,
        notes: "",
        details: null
      },
      {
        ...base.lines[0],
        id: 3002,
        invoiceId: base.id,
        chargeType: "INBOUND",
        description: "22 transfer pallets received",
        reference: "Receipt 158 | EGHU9604405-SHYA127-4410",
        containerNo: "EGHU9604405-SHYA127-4410",
        occurredOn: "2026-04-17",
        quantity: 22,
        unitRate: 10,
        amount: 220,
        notes: "",
        sortOrder: 2,
        details: null
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
    expect(content.slice(0, lineDetailTitleIndex).map((block) => block.text)).toContain("Container Fee Summary");
    expect(content.slice(0, lineDetailTitleIndex).map((block) => block.text)).not.toContain("Charge Summary");
    expect(content.slice(0, lineDetailTitleIndex).map((block) => block.text)).not.toContain("Discount Sources");
    expect(content.map((block) => block.text)).not.toContain("Storage Segment Detail");

    const amountSummaryTable = content[3].table.body;
    expect(amountSummaryTable[0].map((cell: { text: string }) => cell.text)).toEqual([
      "Summary Item",
      "Basis / Source",
      "Gross Charges",
      "Discounts",
      "Net Amount"
    ]);
    expect(JSON.stringify(amountSummaryTable)).toContain("140 pallet-days");
    expect(amountSummaryTable[1][0].text).toBe("Storage Segment Detail");
    expect(amountSummaryTable[1][1].text).toBe("2026-03-01 to 2026-03-14 | 10 pallets | 14 days | 140 pallet-days");
    expect(amountSummaryTable[1][2].text).toBe("$140.00");
    expect(amountSummaryTable[2][0].text).toBe("Storage Segment Detail");
    expect(amountSummaryTable[2][1].text).toBe("2026-03-01 to 2026-03-14 | 7 free pallet-days | Storage grace period");
    expect(amountSummaryTable[2][3].text).toBe("-$7.00");
    expect(amountSummaryTable[5][2].text).toBe("$140.00");
    expect(amountSummaryTable[6][3].text).toBe("-$27.00");
    expect(amountSummaryTable[7][4].text).toBe("$113.00");
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

  it("annotates discount sources and identifies the billed container on every detail row", () => {
    const definition = buildBillingInvoicePdfDefinition({
      invoice: createInvoiceFixture(),
      timeZone: "UTC"
    });

    const content = definition.content as any[];
    const amountSummaryTable = content[3].table.body;
    expect(amountSummaryTable[0].map((cell: { text: string }) => cell.text)).not.toContain("Container");
    expect(amountSummaryTable[1][0].text).toBe("Storage Segment Detail");
    expect(amountSummaryTable[1][1].text).toBe("2026-03-01 to 2026-03-14 | 10 pallets | 14 days | 140 pallet-days");
    expect(amountSummaryTable[2][0].text).toBe("Storage Segment Detail");
    expect(amountSummaryTable[2][1].text).toBe("2026-03-01 to 2026-03-14 | 7 free pallet-days | Storage grace period");
    expect(amountSummaryTable[3][0].text).toBe("Discount source");
    expect(amountSummaryTable[3][1].text).toBe("Storage grace period | Storage | GCXU5817233 | 7 free pallet-days");
    expect(amountSummaryTable[3][3].text).toBe("-$7.00");
    expect(amountSummaryTable[4][0].text).toBe("Discount source");
    expect(amountSummaryTable[4][1].text).toBe("Manual discount line | Line 2 | Courtesy discount");
    expect(amountSummaryTable[4][3].text).toBe("-$20.00");

    const lineDetailTitleIndex = content.findIndex((block) => block.text === "Line Item Detail");
    const lineDetailTable = content[lineDetailTitleIndex + 1].table.body;
    const lineHeaders = lineDetailTable[0].map((cell: { text: string }) => cell.text);
    expect(lineHeaders).toContain("Discount Source");
    expect(lineHeaders).toContain("Container");
    expect(lineHeaders).not.toContain("Warehouse");
    expect(lineDetailTable[1][1].text).toBe("GCXU5817233");
    expect(lineDetailTable[1][6].text).toBe("140 pallet-days");
    expect(lineDetailTable[1][8].text).toBe("$140.00");
    expect(lineDetailTable[2][1].text).toBe("GCXU5817233");
    expect(lineDetailTable[2][2].text).toBe("Discount");
    expect(lineDetailTable[2][6].text).toBe("7 free pallet-days");
    expect(lineDetailTable[2][8].text).toBe("-$7.00");
    expect(lineDetailTable[2][9].text).toBe("Storage grace period");
    expect(lineDetailTable[3][1].text).toBe("Invoice-level");
    expect(lineDetailTable[3][2].text).toBe("Discount");
    expect(lineDetailTable[3][3].text).toBe("Courtesy discount");
    expect(lineDetailTable[3][8].text).toBe("-$20.00");
    expect(lineDetailTable[3][9].text).toBe("Manual discount line");

    const containerSummaryTitleIndex = content.findIndex((block) => block.text === "Container Fee Summary");
    const containerSummaryTable = content[containerSummaryTitleIndex + 1].table.body;
    expect(containerSummaryTable[0][0].text).toBe("Received");
    expect(containerSummaryTable[0][1].text).toBe("Container");
    expect(containerSummaryTable[1][1].text).toBe("GCXU5817233");
    expect(containerSummaryTable[2][1].text).toBe("Invoice-level");
    const storageDetailTitleIndex = content.findIndex((block) => block.text === "Container Storage Detail");
    const storageDetailTable = content[storageDetailTitleIndex + 1].table.body;
    expect(storageDetailTable[0].map((cell: { text: string }) => cell.text)).toContain("Opening");
    expect(storageDetailTable[0].map((cell: { text: string }) => cell.text)).toContain("Released / Date");
    expect(storageDetailTable[1][0].text).toBe("GCXU5817233");
    expect(storageDetailTable[1][5].text).toBe("2026-03-01\nto 2026-03-14");
    expect(content.findIndex((block) => block.text === "Storage Segment Detail")).toBe(-1);
  });

  it("shows gross storage and discount for a fully discounted container", () => {
    const base = createInvoiceFixture();
    const storageLine = base.lines[0];
    const definition = buildBillingInvoicePdfDefinition({
      invoice: {
        ...base,
        subtotal: 0,
        discountTotal: 0,
        grandTotal: 0,
        lineCount: 1,
        lines: [{
          ...storageLine,
          quantity: 0,
          amount: 0,
          details: {
            kind: "STORAGE_CONTAINER_SUMMARY",
            warehousesTouched: ["NJ"],
            palletsTracked: 1,
            palletDays: 7,
            freePalletDays: 7,
            billablePalletDays: 0,
            grossAmount: 7,
            discountAmount: 7,
            segments: [{
              startDate: "2026-03-01",
              endDate: "2026-03-07",
              dayEndPallets: 1,
              billedDays: 7,
              palletDays: 7,
              freePalletDays: 7,
              billablePalletDays: 0,
              grossAmount: 7,
              discountAmount: 7,
              amount: 0
            }]
          }
        }]
      },
      timeZone: "UTC"
    });

    const content = definition.content as any[];
    const containerSummaryTitleIndex = content.findIndex((block) => block.text === "Container Fee Summary");
    const containerSummaryTable = content[containerSummaryTitleIndex + 1].table.body;
    expect(containerSummaryTable[1][5].text).toBe("$0.00\n$7.00 gross; -$7.00 discount");
  });

  it("keeps manual discount references aligned with container-sorted detail rows", () => {
    const base = createInvoiceFixture();
    const definition = buildBillingInvoicePdfDefinition({
      invoice: {
        ...base,
        subtotal: 15,
        discountTotal: -2,
        grandTotal: 13,
        lineCount: 3,
        lines: [
          {
            ...base.lines[0],
            id: 5001,
            sortOrder: 1,
            chargeType: "INBOUND",
            containerNo: "ZZZU9999999",
            description: "Inbound Z",
            reference: "",
            amount: 10,
            details: null
          },
          {
            ...base.lines[1],
            id: 5002,
            sortOrder: 2,
            description: "Order discount",
            reference: "",
            amount: -2
          },
          {
            ...base.lines[0],
            id: 5003,
            sortOrder: 3,
            chargeType: "OUTBOUND",
            containerNo: "AAAU1111111",
            description: "Outbound A",
            reference: "",
            amount: 5,
            details: null
          }
        ]
      },
      timeZone: "UTC"
    });

    const content = definition.content as any[];
    const amountSummaryTable = content[3].table.body;
    const discountSourceRow = amountSummaryTable.find((row: Array<{ text: string }>) =>
      row[0]?.text === "Discount source" && row[1]?.text.includes("Manual discount line")
    );
    expect(discountSourceRow[1].text).toBe("Manual discount line | Line 3 | Order discount");

    const lineDetailTitleIndex = content.findIndex((block) => block.text === "Line Item Detail");
    const lineDetailTable = content[lineDetailTitleIndex + 1].table.body;
    const discountDetailRow = lineDetailTable.find((row: Array<{ text: string }>) => row[2]?.text === "Discount");
    expect(discountDetailRow[0].text).toBe("3");
    expect(discountDetailRow[1].text).toBe("Invoice-level");
  });

  it("aggregates overlapping storage segment dates when container columns are hidden", () => {
    const definition = buildBillingInvoicePdfDefinition({
      invoice: createOverlappingSegmentInvoiceFixture(),
      timeZone: "UTC"
    });

    const content = definition.content as any[];
    const amountSummaryTable = content[3].table.body;
    expect(amountSummaryTable[0].map((cell: { text: string }) => cell.text)).toEqual([
      "Summary Item",
      "Basis / Source",
      "Amount"
    ]);
    expect(content.findIndex((block) => block.text === "Storage Segment Detail")).toBe(-1);

    expect(amountSummaryTable.slice(1, 4).map((row: Array<{ text: string }>) => row.map((cell) => cell.text))).toEqual([
      ["Storage Segment Detail", "2026-04-01 to 2026-04-02 | 10 pallets | 2 days | 20 pallet-days", "$20.00"],
      ["Storage Segment Detail", "2026-04-03 to 2026-04-04 | 15 pallets | 2 days | 30 pallet-days", "$30.00"],
      ["Storage Segment Detail", "2026-04-05 to 2026-04-06 | 5 pallets | 2 days | 10 pallet-days", "$10.00"]
    ]);
  });

  it("includes storage segment details on mixed invoices", () => {
    const base = createInboundInvoiceFixture();
    const definition = buildBillingInvoicePdfDefinition({
      invoice: {
        ...base,
        lines: [
          ...base.lines,
          {
            ...createInvoiceFixture().lines[0],
            id: 3003,
            invoiceId: base.id,
            sortOrder: 3,
            amount: 140,
            quantity: 140,
            details: {
              kind: "STORAGE_CONTAINER_SUMMARY",
              warehousesTouched: ["NJ"],
              palletsTracked: 10,
              palletDays: 140,
              freePalletDays: 0,
              billablePalletDays: 140,
              grossAmount: 140,
              discountAmount: 0,
              segments: [
                {
                  startDate: "2026-04-10",
                  endDate: "2026-04-23",
                  dayEndPallets: 10,
                  billedDays: 14,
                  palletDays: 140,
                  freePalletDays: 0,
                  billablePalletDays: 140,
                  grossAmount: 140,
                  discountAmount: 0,
                  amount: 140
                }
              ]
            }
          }
        ]
      },
      timeZone: "UTC"
    });

    const content = definition.content as any[];
    expect(content.findIndex((block) => block.text === "Storage Segment Detail")).toBe(-1);
    const amountSummaryTable = content[3].table.body;
    expect(JSON.stringify(amountSummaryTable)).toContain("140 pallet-days");
  });

  it("omits zero-amount discount lines from line details", () => {
    const invoice = createOverlappingSegmentInvoiceFixture();
    const definition = buildBillingInvoicePdfDefinition({
      invoice: {
        ...invoice,
        lineCount: invoice.lines.length + 1,
        lines: [
          ...invoice.lines,
          {
            ...createInvoiceFixture().lines[1],
            id: 4001,
            invoiceId: invoice.id,
            description: "Zero discount",
            unitRate: 0,
            amount: 0,
            sortOrder: 3
          }
        ]
      },
      timeZone: "UTC"
    });

    const content = definition.content as any[];
    const lineDetailTitleIndex = content.findIndex((block) => block.text === "Line Item Detail");
    const lineDetailTable = content[lineDetailTitleIndex + 1].table.body;
    const lineHeaders = lineDetailTable[0].map((cell: { text: string }) => cell.text);

    expect(JSON.stringify(lineDetailTable)).not.toContain("Zero discount");
    expect(lineHeaders).not.toContain("Discount Source");
  });

  it("shows transfer inbound quantity as pallets instead of containers", () => {
    const definition = buildBillingInvoicePdfDefinition({
      invoice: createInboundInvoiceFixture(),
      timeZone: "UTC"
    });

    const content = definition.content as any[];
    const lineDetailTitleIndex = content.findIndex((block) => block.text === "Line Item Detail");
    const lineDetailTable = content[lineDetailTitleIndex + 1].table.body;

    expect(lineDetailTable[1][3].text).toBe("22 transfer pallets received");
    expect(lineDetailTable[1][6].text).toBe("22 pallets");
    expect(lineDetailTable[2][3].text).toBe("22 pallets received");
    expect(lineDetailTable[2][6].text).toBe("1 container");
  });
});
