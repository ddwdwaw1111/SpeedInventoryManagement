import { afterEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";

import { buildExcelWorkbookBytes, downloadExcelWorkbook } from "./excelExport";

describe("downloadExcelWorkbook", () => {
  const OriginalBlob = globalThis.Blob;
  const originalCreateObjectURL = window.URL.createObjectURL;
  const originalRevokeObjectURL = window.URL.revokeObjectURL;

  afterEach(() => {
    globalThis.Blob = OriginalBlob;
    window.URL.createObjectURL = originalCreateObjectURL;
    window.URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it("builds an excel xml workbook with sanitized names and serialized values", async () => {
    class BlobMock {
      parts: unknown[];
      type: string;

      constructor(parts: unknown[], options?: { type?: string }) {
        this.parts = parts;
        this.type = options?.type ?? "";
      }
    }

    const createObjectURL = vi.fn((_: unknown) => "blob:export");
    const revokeObjectURL = vi.fn();
    let createdAnchor: HTMLAnchorElement | null = null;
    let exportedBlob: BlobMock | null = null;

    globalThis.Blob = BlobMock as unknown as typeof Blob;

    window.URL.createObjectURL = (((blob: Blob | MediaSource) => {
      exportedBlob = blob as unknown as BlobMock;
      return createObjectURL(blob);
    }) as unknown) as typeof window.URL.createObjectURL;
    window.URL.revokeObjectURL = revokeObjectURL;

    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      const element = document.createElementNS("http://www.w3.org/1999/xhtml", tagName);
      if (tagName.toLowerCase() === "a") {
        Object.defineProperty(element, "click", {
          configurable: true,
          value: vi.fn()
        });
        createdAnchor = element as HTMLAnchorElement;
      }
      return element;
    }) as typeof document.createElement);

    downloadExcelWorkbook({
      title: "Inventory & Receipts",
      sheetName: "Inventory/Receipts:*?",
      fileName: 'Inventory:"March"/2026',
      columns: [
        { key: "sku", label: "SKU" },
        { key: "active", label: "Active" },
        { key: "receivedAt", label: "Received At" },
        { key: "amount", label: "Amount", numberFormat: "currency" },
        { key: "notes", label: "Notes" }
      ],
      rows: [
        {
          sku: "Container <A>",
          active: true,
          receivedAt: new Date("2026-03-30T12:34:00Z"),
          amount: 123.45,
          notes: null
        }
      ],
      summaryRows: [
        { label: "Total", value: 123.45, numberFormat: "currency", bold: true }
      ],
      additionalSheets: [
        {
          title: "Storage Billing Period: 2026-03-01 to 2026-03-31",
          sheetName: "Storage Fee",
          columns: [{ key: "containerNo", label: "Container No." }],
          rows: [{ containerNo: "CONT-001" }]
        }
      ]
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
    expect(createdAnchor).not.toBeNull();
    if (!createdAnchor) {
      throw new Error("Expected download anchor to be created");
    }
    const anchor = createdAnchor as unknown as { download: string };
    expect(anchor.download).toBe("Inventory March 2026.xlsx");
    expect(exportedBlob).not.toBeNull();
    expect(exportedBlob!.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    const workbookBytes = new Uint8Array(exportedBlob!.parts[0] as ArrayBuffer);
    expect(strFromU8(workbookBytes.slice(0, 2))).toBe("PK");
    const workbookFiles = unzipSync(workbookBytes);
    const workbookXml = readZipText(workbookFiles, "xl/workbook.xml");
    const worksheetXml = readZipText(workbookFiles, "xl/worksheets/sheet1.xml");
    const storageWorksheetXml = readZipText(workbookFiles, "xl/worksheets/sheet2.xml");
    const stylesXml = readZipText(workbookFiles, "xl/styles.xml");

    expect(workbookXml).toContain('sheet name="Inventory Receipts"');
    expect(workbookXml).toContain('sheet name="Storage Fee"');
    expect(worksheetXml).toContain("Inventory &amp; Receipts");
    expect(worksheetXml).toContain("<t>SKU</t>");
    expect(worksheetXml).toContain("<t>Container &lt;A&gt;</t>");
    expect(worksheetXml).toContain("<t>Yes</t>");
    expect(worksheetXml).toContain("<t>2026-03-30T12:34:00.000Z</t>");
    expect(worksheetXml).toContain("<v>123.45</v>");
    expect(worksheetXml).toContain("<t></t>");
    expect(worksheetXml).toContain("<mergeCells");
    expect(storageWorksheetXml).toContain("Storage Billing Period: 2026-03-01 to 2026-03-31");
    expect(storageWorksheetXml).toContain("CONT-001");
    expect(stylesXml).toContain('formatCode="&quot;$&quot;#,##0.00"');
  });

  it("builds a print-ready invoice worksheet without an export footer or logo", () => {
    const workbookBytes = buildExcelWorkbookBytes({
      title: "Container Invoice",
      sheetName: "Container Invoice",
      fileName: "INV-001-CONT-A",
      columns: [
        { key: "item", label: "ITEM" },
        { key: "description", label: "DESCRIPTION" },
        { key: "quantity", label: "QTY", numberFormat: "number" },
        { key: "rate", label: "RATE", numberFormat: "currencyRate" },
        { key: "amount", label: "AMOUNT", numberFormat: "currency" }
      ],
      rows: [{ item: "STORAGE", description: "July storage", quantity: 10, rate: 2.5, amount: 25 }],
      summaryRows: [
        { label: "SUBTOTAL", value: 25, numberFormat: "currency", bold: false },
        { label: "TOTAL", value: 25, numberFormat: "currency", bold: true }
      ],
      invoiceHeader: {
        sellerName: "Speed Inventory Management",
        subtitle: "Business services invoice",
        invoiceNo: "INV-001",
        billTo: "Customer A",
        invoiceDate: "Jul 30, 2026",
        dueDate: "Aug 29, 2026",
        amountDue: 25,
        containerNo: "CONT-A",
        billingPeriod: "2026-07-01 to 2026-07-30",
        receivedOn: "2026-06-15"
      }
    });

    const workbookFiles = unzipSync(workbookBytes);
    const worksheetXml = readZipText(workbookFiles, "xl/worksheets/sheet1.xml");
    expect(worksheetXml).toContain("Speed Inventory Management");
    expect(worksheetXml).toContain("Invoice#");
    expect(worksheetXml).toContain("BILL TO");
    expect(worksheetXml).toContain("AMOUNT DUE");
    expect(worksheetXml).toContain("CONT-A");
    expect(worksheetXml).toContain("RECEIVED");
    expect(worksheetXml).not.toContain("WAREHOUSE");
    expect(worksheetXml).toContain("STORAGE");
    expect(worksheetXml).toContain('orientation="portrait"');
    expect(worksheetXml).toContain('showGridLines="0"');
    expect(worksheetXml).not.toContain("Exported ");
    expect(worksheetXml).not.toContain("picture");
    expect(worksheetXml).not.toContain("oddFooter");
    expect(readZipText(workbookFiles, "xl/styles.xml")).toContain('formatCode="&quot;$&quot;#,##0.00######"');
  });
});

function readZipText(files: Record<string, Uint8Array>, path: string) {
  const entry = files[path];
  if (!entry) {
    throw new Error(`Missing zip entry ${path}. Found: ${Object.keys(files).join(", ")}`);
  }
  return strFromU8(entry);
}
