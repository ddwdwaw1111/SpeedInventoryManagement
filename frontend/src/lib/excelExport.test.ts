import { afterEach, describe, expect, it, vi } from "vitest";

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
      parts: string[];
      type: string;

      constructor(parts: unknown[], options?: { type?: string }) {
        this.parts = parts.map((part) => String(part));
        this.type = options?.type ?? "";
      }

      text() {
        return Promise.resolve(this.parts.join(""));
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
        { key: "notes", label: "Notes" }
      ],
      rows: [
        {
          sku: "Container <A>",
          active: true,
          receivedAt: new Date("2026-03-30T12:34:00Z"),
          notes: null
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
    expect(anchor.download).toBe("Inventory March 2026.xls");
    expect(exportedBlob).not.toBeNull();

    const workbookXml = await exportedBlob!.text();

    expect(workbookXml).toContain('Worksheet ss:Name="Inventory Receipts"');
    expect(workbookXml).toContain("Inventory &amp; Receipts");
    expect(workbookXml).toContain("<Data ss:Type=\"String\">SKU</Data>");
    expect(workbookXml).toContain("<Data ss:Type=\"String\">Container &lt;A&gt;</Data>");
    expect(workbookXml).toContain("<Data ss:Type=\"String\">Yes</Data>");
    expect(workbookXml).toContain("<Data ss:Type=\"String\">2026-03-30T12:34:00.000Z</Data>");
    expect(workbookXml).toContain("<Data ss:Type=\"String\"></Data>");
  });
});
