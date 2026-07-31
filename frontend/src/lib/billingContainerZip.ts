import { strToU8, Zip, ZipPassThrough } from "fflate";

import { buildBillingContainerStatements } from "./billingContainerStatement";
import { buildBillingContainerExcelWorkbookBytes } from "./billingContainerInvoice";
import {
  buildBillingContainerReconciliationPdfDefinition,
  buildBillingInvoicePdfDefinition,
  renderBillingPdfDefinitionBuffer
} from "./billingInvoicePdf";
import { downloadByteParts } from "./excelExport";
import type { BillingInvoice, BillingInvoiceLineData } from "./types";

export type BillingContainerZipInput = {
  invoice: BillingInvoice;
  timeZone: string;
};

export type BillingContainerZipBuildResult = {
  bytes: Uint8Array;
  fileName: string;
  containerFileCount: number;
};

type BillingContainerZipPartsResult = Omit<BillingContainerZipBuildResult, "bytes"> & {
  parts: Uint8Array[];
};

export async function downloadBillingContainerZip(input: BillingContainerZipInput) {
  const result = await buildBillingContainerZipParts(input);
  downloadByteParts(result.parts, result.fileName, "application/zip");
  return {
    fileName: result.fileName,
    containerFileCount: result.containerFileCount
  };
}

export async function buildBillingContainerZip(input: BillingContainerZipInput): Promise<BillingContainerZipBuildResult> {
  const result = await buildBillingContainerZipParts(input);
  return {
    bytes: concatenateBytes(result.parts),
    fileName: result.fileName,
    containerFileCount: result.containerFileCount
  };
}

async function buildBillingContainerZipParts({ invoice, timeZone }: BillingContainerZipInput): Promise<BillingContainerZipPartsResult> {
  const statements = buildBillingContainerStatements(invoice);
  if (statements.length === 0) {
    throw new Error("This invoice has no container reconciliation detail to export.");
  }

  const invoiceToken = safeFileSegment(invoice.invoiceNo) || "invoice";
  const sourceLinesByContainer = indexSourceLinesByContainer(invoice.lines);
  const archive = createStreamingZipArchive();

  try {
    archive.addFile(
      `00-Full-Invoice-${invoiceToken}.pdf`,
      await renderBillingPdfDefinitionBuffer(buildBillingInvoicePdfDefinition({ invoice, timeZone }))
    );

    const manifestRows: string[][] = [[
      "PDF File",
      "Excel File",
      "Container",
      "Warehouse",
      "Received On",
      "Opening Pallets",
      "Received Pallets During Period",
      "Released Pallets",
      "Closing Pallets",
      "Billable Pallet-Days",
      "Inbound Fee",
      "Wrapping Fee",
      "Outbound Fee",
      "Storage Gross",
      "Storage Discount",
      "Storage Net",
      "Adjustments",
      "Container Total"
    ]];

    for (const [index, statement] of statements.entries()) {
      const label = statement.containerNo || "INVOICE-LEVEL-ADJUSTMENTS";
      const statementToken = safeFileSegment(label) || `statement-${index + 1}`;
      const fileName = `${String(index + 1).padStart(3, "0")}-${statementToken}.pdf`;
      const pdfArchivePath = `Containers/${fileName}`;
      const excelArchivePath = `Containers/${String(index + 1).padStart(3, "0")}-${statementToken}.xlsx`;
      archive.addFile(
        pdfArchivePath,
        await renderBillingPdfDefinitionBuffer(
          buildBillingContainerReconciliationPdfDefinition({
            invoice,
            containerNo: statement.containerNo,
            statement,
            sourceLines: sourceLinesByContainer.get(normalizeContainerNo(statement.containerNo)) ?? [],
            timeZone
          })
        )
      );
      archive.addFile(
        excelArchivePath,
        buildBillingContainerExcelWorkbookBytes({ invoice, statement, timeZone })
      );
      manifestRows.push([
        pdfArchivePath,
        excelArchivePath,
        statement.containerNo || "Invoice-level Adjustments",
        statement.warehouses.join(", ") || "-",
        statement.receivedOn || "-",
        statement.palletMovementAvailable ? String(statement.openingPallets) : "-",
        statement.palletMovementAvailable ? String(statement.receivedPallets) : "-",
        statement.palletMovementAvailable ? String(statement.releasedPallets) : "-",
        statement.palletMovementAvailable ? String(statement.closingPallets) : "-",
        String(statement.billablePalletDays),
        formatCsvAmount(statement.inboundAmount),
        formatCsvAmount(statement.wrappingAmount),
        formatCsvAmount(statement.outboundAmount),
        formatCsvAmount(statement.storageGrossAmount),
        formatCsvAmount(-Math.abs(statement.storageDiscountAmount)),
        formatCsvAmount(statement.storageAmount),
        formatCsvAmount(statement.adjustmentAmount),
        formatCsvAmount(statement.totalAmount)
      ]);
    }

    archive.addFile(
      "01-Container-Reconciliation-Index.csv",
      strToU8(`\uFEFF${manifestRows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n")}`)
    );

    return {
      parts: await archive.finish(),
      fileName: `${invoiceToken}-Container-Reconciliation.zip`,
      containerFileCount: statements.filter((statement) => statement.containerNo !== "").length
    };
  } catch (error) {
    archive.terminate();
    throw error;
  }
}

function createStreamingZipArchive() {
  const parts: Uint8Array[] = [];
  let ended = false;
  let settled = false;
  let resolveCompletion: (parts: Uint8Array[]) => void = () => undefined;
  let rejectCompletion: (error: Error) => void = () => undefined;
  const completion = new Promise<Uint8Array[]>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  void completion.catch(() => undefined);
  const archive = new Zip((error, data, final) => {
    if (settled) return;
    if (error) {
      settled = true;
      rejectCompletion(error);
      return;
    }
    parts.push(data);
    if (final) {
      settled = true;
      resolveCompletion(parts);
    }
  });

  return {
    addFile(fileName: string, data: Uint8Array) {
      if (ended) {
        throw new Error("Cannot add a file after the ZIP archive has ended.");
      }
      const entry = new ZipPassThrough(fileName);
      archive.add(entry);
      entry.push(data, true);
    },
    finish() {
      if (!ended) {
        ended = true;
        archive.end();
      }
      return completion;
    },
    terminate() {
      if (ended) return;
      ended = true;
      archive.terminate();
      if (!settled) {
        settled = true;
        rejectCompletion(new Error("ZIP creation was terminated."));
      }
    }
  };
}

function indexSourceLinesByContainer(lines: BillingInvoiceLineData[]) {
  const indexed = new Map<string, BillingInvoiceLineData[]>();
  for (const line of lines) {
    const key = normalizeContainerNo(line.containerNo);
    const grouped = indexed.get(key) ?? [];
    grouped.push(line);
    indexed.set(key, grouped);
  }
  return indexed;
}

function normalizeContainerNo(value: string) {
  return value.trim().toUpperCase();
}

function concatenateBytes(parts: readonly Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function safeFileSegment(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
}

function escapeCsvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function formatCsvAmount(value: number) {
  return (Math.round(value * 100) / 100).toFixed(2);
}
