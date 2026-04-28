import { describe, expect, it } from "vitest";

import { DEFAULT_BILLING_RATES, type BillingPreview } from "./billingPreview";
import { buildBillingPreviewPdfDefinition, buildBillingPreviewPdfDocument } from "./billingPreviewPdf";

function createPreviewFixture(): BillingPreview {
  return {
    startDate: "2026-03-01",
    endDate: "2026-03-31",
    customerId: 1,
    customerName: "Imperial Bag & Paper",
    invoiceLines: [
      {
        id: "storage-1-NORMAL-GCXU5817233",
        customerId: 1,
        customerName: "Imperial Bag & Paper",
        chargeType: "STORAGE",
        reference: "Storage | GCXU5817233",
        containerNo: "GCXU5817233",
        warehouseSummary: "NJ",
        occurredOn: "2026-03-31",
        quantity: 133,
        unitRate: 1,
        amount: 133,
        meta: "10 pallets tracked | Normal | 7 free pallet-days | -$7.00"
      }
    ],
    storageRows: [
      {
        customerId: 1,
        customerName: "Imperial Bag & Paper",
        containerNo: "GCXU5817233",
        containerType: "NORMAL",
        locationId: 1,
        locationName: "NJ",
        warehousesTouched: ["NJ"],
        palletsTracked: 10,
        palletDays: 140,
        freePalletDays: 7,
        billablePalletDays: 133,
        averageDailyPallets: 10,
        firstActivityAt: "2026-03-01",
        lastActivityAt: "2026-03-31",
        grossAmount: 140,
        discountAmount: 7,
        amount: 133,
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
    ],
    dailyBalanceRows: [],
    summary: {
      receivedContainers: 0,
      receivedPallets: 0,
      shippedPallets: 0,
      palletDays: 140,
      inboundAmount: 0,
      wrappingAmount: 0,
      storageGrossAmount: 140,
      storageDiscountAmount: 7,
      storageAmount: 133,
      outboundAmount: 0,
      grandTotal: 133
    }
  };
}

function createOverlappingSegmentPreviewFixture(): BillingPreview {
  const base = createPreviewFixture();
  return {
    ...base,
    startDate: "2026-04-01",
    endDate: "2026-04-06",
    invoiceLines: [],
    storageRows: [
      {
        ...base.storageRows[0],
        containerNo: "CONT-A",
        palletsTracked: 10,
        palletDays: 40,
        freePalletDays: 0,
        billablePalletDays: 40,
        grossAmount: 40,
        discountAmount: 0,
        amount: 40,
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
      },
      {
        ...base.storageRows[0],
        containerNo: "CONT-B",
        palletsTracked: 5,
        palletDays: 20,
        freePalletDays: 0,
        billablePalletDays: 20,
        grossAmount: 20,
        discountAmount: 0,
        amount: 20,
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
    ],
    dailyBalanceRows: [],
    summary: {
      ...base.summary,
      palletDays: 60,
      storageGrossAmount: 60,
      storageDiscountAmount: 0,
      storageAmount: 60,
      grandTotal: 60
    }
  };
}

describe("buildBillingPreviewPdfDefinition", () => {
  it("uses the US invoice-style layout and separate discount detail rows", () => {
    const document = buildBillingPreviewPdfDocument({
      preview: createPreviewFixture(),
      rates: DEFAULT_BILLING_RATES,
      timeZone: "UTC",
      workspaceMode: "STORAGE_SETTLEMENT",
      generatedAt: "2026-04-01T12:00:00Z"
    });
    const definition = buildBillingPreviewPdfDefinition(document);

    expect(definition.pageSize).toBe("LETTER");
    expect(definition.pageOrientation).toBe("portrait");

    const content = definition.content as any[];
    expect(JSON.stringify(content)).not.toContain("No billable rows found");
    expect(content[0].columns[0].stack[0].text).toBe("Speed Inventory Management");
    expect(content[0].columns[1].stack[0].text).toBe("STORAGE SETTLEMENT PREVIEW");
    const headerRows = content[0].columns[1].stack[1].table.body;
    expect(headerRows[0][1].text).toBe("Apr 1, 2026, 12:00 PM");
    expect(headerRows[1][1].text).toBe("May 1, 2026");
    expect(headerRows[2][1].text).toBe("Net 30");
    expect(content[1].table.body[0][0].stack[0].text).toBe("Bill To");
    expect(content[1].table.body[0][0].stack[1].text).toBe("Imperial Bag & Paper");

    const amountSummaryTable = content[3].table.body;
    expect(content.map((block) => block.text)).not.toContain("Charge Summary");
    expect(content.map((block) => block.text)).not.toContain("Discount Sources");
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
    expect(amountSummaryTable[1][3].text).toBe("-$7.00");
    expect(amountSummaryTable[1][4].text).toBe("$133.00");
    expect(amountSummaryTable[2][0].text).toBe("Discount source");
    expect(amountSummaryTable[2][1].text).toBe("Storage grace period | Storage | GCXU5817233 | 7 free pallet-days");
    expect(amountSummaryTable[2][3].text).toBe("-$7.00");
    expect(amountSummaryTable[3][2].text).toBe("$140.00");
    expect(amountSummaryTable[4][3].text).toBe("-$7.00");
    expect(amountSummaryTable[5][4].text).toBe("$133.00");

    const lineDetailTitleIndex = content.findIndex((block) => block.text === "Line Item Detail");
    expect(content[lineDetailTitleIndex].pageBreak).toBe("before");
    const lineDetailTable = content[lineDetailTitleIndex + 1].table.body;
    const lineHeaders = lineDetailTable[0].map((cell: { text: string }) => cell.text);
    expect(lineHeaders).not.toContain("Container");
    expect(lineHeaders).not.toContain("Warehouse");
    expect(lineDetailTable[1][5].text).toBe("140 pallet-days");
    expect(lineDetailTable[1][7].text).toBe("$140.00");
    expect(lineDetailTable[2][1].text).toBe("Discount");
    expect(lineDetailTable[2][5].text).toBe("7 free pallet-days");
    expect(lineDetailTable[2][7].text).toBe("-$7.00");
    expect(lineDetailTable[2][8].text).toBe("Storage grace period");

    const segmentTitleIndex = content.findIndex((block) => block.text === "Storage Segment Detail");
    expect(content[segmentTitleIndex].pageBreak).toBe("before");
    const segmentTable = content[segmentTitleIndex + 1].table.body;
    const segmentHeaders = segmentTable[0].map((cell: { text: string }) => cell.text);
    expect(segmentHeaders).not.toContain("Container");
    expect(segmentHeaders).not.toContain("Warehouses");
    expect(segmentTable[1][5].text).toBe("140 pallet-days");
    expect(segmentTable[1][6].text).toBe("$140.00");
    expect(segmentTable[2][5].text).toBe("7 free pallet-days");
    expect(segmentTable[2][6].text).toBe("-$7.00");
  });

  it("aggregates overlapping storage segment dates when container columns are hidden", () => {
    const document = buildBillingPreviewPdfDocument({
      preview: createOverlappingSegmentPreviewFixture(),
      rates: DEFAULT_BILLING_RATES,
      timeZone: "UTC",
      workspaceMode: "STORAGE_SETTLEMENT",
      generatedAt: "2026-04-07T12:00:00Z"
    });
    const definition = buildBillingPreviewPdfDefinition(document);

    const content = definition.content as any[];
    const segmentTitleIndex = content.findIndex((block) => block.text === "Storage Segment Detail");
    const segmentTable = content[segmentTitleIndex + 1].table.body;

    expect(segmentTable.slice(1).map((row: Array<{ text: string }>) => row.slice(1, 7).map((cell) => cell.text))).toEqual([
      ["2026-04-01", "2026-04-02", "10", "2", "20 pallet-days", "$20.00"],
      ["2026-04-03", "2026-04-04", "15", "2", "30 pallet-days", "$30.00"],
      ["2026-04-05", "2026-04-06", "5", "2", "10 pallet-days", "$10.00"]
    ]);
  });

  it("uses configurable preview header defaults and preserves blank fields", () => {
    const document = buildBillingPreviewPdfDocument({
      preview: createPreviewFixture(),
      rates: DEFAULT_BILLING_RATES,
      header: {
        sellerName: "",
        subtitle: "",
        remitTo: "",
        terms: "",
        paymentDueDays: 0,
        paymentInstructions: ""
      },
      timeZone: "UTC",
      workspaceMode: "STORAGE_SETTLEMENT",
      generatedAt: "2026-04-01T12:00:00Z"
    });
    const definition = buildBillingPreviewPdfDefinition(document);

    const content = definition.content as any[];
    expect(content[0].columns[0].stack[0].text).toBe("");
    expect(content[0].columns[0].stack[1].text).toBe("");
    const headerRows = content[0].columns[1].stack[1].table.body;
    expect(headerRows[1][1].text).toBe("Apr 1, 2026");
    expect(headerRows[2][1].text).toBe("");
    expect(content[1].table.body[0][1].stack[1].text).toBe("-");
  });
});
