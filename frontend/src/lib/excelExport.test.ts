import { afterEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";

import { downloadExcelWorkbook } from "./excelExport";

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
    const stylesXml = readZipText(workbookFiles, "xl/styles.xml");

    expect(workbookXml).toContain('sheet name="Inventory Receipts"');
    expect(worksheetXml).toContain("Inventory &amp; Receipts");
    expect(worksheetXml).toContain("<t>SKU</t>");
    expect(worksheetXml).toContain("<t>Container &lt;A&gt;</t>");
    expect(worksheetXml).toContain("<t>Yes</t>");
    expect(worksheetXml).toContain("<t>2026-03-30T12:34:00.000Z</t>");
    expect(worksheetXml).toContain("<v>123.45</v>");
    expect(worksheetXml).toContain("<t></t>");
    expect(worksheetXml).toContain("<mergeCells");
    expect(stylesXml).toContain('formatCode="&quot;$&quot;#,##0.00"');
  });
});

function readZipText(files: Record<string, Uint8Array>, path: string) {
  const entry = files[path];
  if (!entry) {
    throw new Error(`Missing zip entry ${path}. Found: ${Object.keys(files).join(", ")}`);
  }
  return strFromU8(entry);
}
