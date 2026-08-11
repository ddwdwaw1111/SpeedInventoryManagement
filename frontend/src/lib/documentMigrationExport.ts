import { strToU8, zipSync, type Zippable, type ZipOptions } from "fflate";

import { buildExcelWorkbookBytes, downloadBytes, type ExcelExportCell } from "./excelExport";
import { INBOUND_BULK_IMPORT_TEMPLATE_COLUMNS } from "./inboundBulkImportTemplate";
import { OUTBOUND_BULK_IMPORT_TEMPLATE_COLUMNS } from "./outboundBulkImportTemplate";
import type { InboundDocument, OutboundDocument, OutboundDocumentLine, OutboundPickAllocation } from "./types";

const MAX_DOCUMENTS_PER_IMPORT = 500;
const MAX_ROWS_PER_IMPORT = 5000;
const ZIP_MIME_TYPE = "application/zip";

type MigrationDirection = "inbound" | "outbound";
type MigrationSourceState = "confirmed" | "draft";

type DocumentRows<TDocument> = {
  document: TDocument;
  identity: string;
  rows: Array<Record<string, ExcelExportCell>>;
};

type MigrationManifestRow = {
  file: string;
  direction: MigrationDirection;
  customer: string;
  sourceState: MigrationSourceState;
  documentCount: number;
  rowCount: number;
  firstBusinessDate: string;
  lastBusinessDate: string;
};

export type DocumentMigrationPackageSummary = {
  inboundDocuments: number;
  outboundDocuments: number;
  workbookCount: number;
  skippedDocuments: number;
};

export type DocumentMigrationPackage = {
  bytes: Uint8Array;
  fileName: string;
  summary: DocumentMigrationPackageSummary;
};

export function downloadDocumentMigrationPackage(
  inboundDocuments: InboundDocument[],
  outboundDocuments: OutboundDocument[],
  now = new Date()
) {
  const migrationPackage = buildDocumentMigrationPackage(inboundDocuments, outboundDocuments, now);
  downloadBytes(migrationPackage.bytes, migrationPackage.fileName, ZIP_MIME_TYPE);
  return migrationPackage.summary;
}

export function buildDocumentMigrationPackage(
  inboundDocuments: InboundDocument[],
  outboundDocuments: OutboundDocument[],
  now = new Date()
): DocumentMigrationPackage {
  const files: Zippable = {};
  const manifestRows: MigrationManifestRow[] = [];
  const skippedRows: string[][] = [];
  const customerDirectories = buildCustomerDirectories(inboundDocuments, outboundDocuments);

  addInboundWorkbooks(files, manifestRows, skippedRows, inboundDocuments, customerDirectories);
  addOutboundWorkbooks(files, manifestRows, skippedRows, outboundDocuments, customerDirectories);

  const summary: DocumentMigrationPackageSummary = {
    inboundDocuments: manifestRows
      .filter((row) => row.direction === "inbound")
      .reduce((total, row) => total + row.documentCount, 0),
    outboundDocuments: manifestRows
      .filter((row) => row.direction === "outbound")
      .reduce((total, row) => total + row.documentCount, 0),
    workbookCount: manifestRows.length,
    skippedDocuments: skippedRows.length
  };

  files["README.txt"] = textZipEntry(buildReadme(summary));
  files["manifest.csv"] = textZipEntry(`\uFEFF${buildManifestCsv(manifestRows)}`);
  if (skippedRows.length > 0) {
    files["skipped-documents.csv"] = textZipEntry(`\uFEFF${buildCsv([
      ["Direction", "Customer", "Document Reference", "Reason"],
      ...skippedRows
    ])}`);
  }

  const dateToken = formatCompactDate(now);
  return {
    bytes: zipSync(files, { level: 6 }),
    fileName: `document-bulk-reimport-${dateToken}.zip`,
    summary
  };
}

export function buildInboundBulkReimportRows(document: InboundDocument) {
  const actualArrivalDate = inboundBusinessDate(document);
  const handlingMode = document.handlingMode || "PALLETIZED";

  return document.lines.map((line) => ({
    containerNo: document.containerNo,
    warehouse: document.locationName,
    actualArrivalDate,
    containerType: document.containerType || "NORMAL",
    handlingMode,
    sku: line.sku,
    itemNumber: line.itemNumber ?? "",
    description: line.description?.trim() || line.sku,
    expectedQty: line.expectedQty,
    receivedQty: line.receivedQty,
    pallets: handlingMode === "SEALED_TRANSIT" ? 0 : line.pallets,
    inboundCtnsPerPallet: handlingMode === "SEALED_TRANSIT" ? 0 : line.inboundCtnsPerPallet,
    storageSection: line.storageSection || document.storageSection || "TEMP",
    lineNote: line.lineNote
  }));
}

export function buildOutboundBulkReimportRows(document: OutboundDocument) {
  return document.lines.flatMap((line) => buildOutboundLineRows(document, line));
}

function addInboundWorkbooks(
  files: Zippable,
  manifestRows: MigrationManifestRow[],
  skippedRows: string[][],
  documents: InboundDocument[],
  customerDirectories: Map<string, string>
) {
  const eligible = documents
    .filter((document) => !isDeleted(document.status, document.deletedAt))
    .sort(compareInboundDocumentsOldestFirst);
  const groups = groupDocuments(eligible);

  for (const group of groups) {
    const entries: Array<DocumentRows<InboundDocument>> = [];
    for (const document of group.documents) {
      const compatibilityIssue = inboundBulkReimportIssue(document);
      const rows = buildInboundBulkReimportRows(document);
      if (compatibilityIssue) {
        skippedRows.push(["Inbound", document.customerName, document.containerNo || `Inbound #${document.id}`, compatibilityIssue]);
      } else if (rows.length === 0) {
        skippedRows.push(["Inbound", document.customerName, document.containerNo, "Receipt has no lines."]);
      } else if (rows.length > MAX_ROWS_PER_IMPORT) {
        skippedRows.push(["Inbound", document.customerName, document.containerNo, `Receipt exceeds ${MAX_ROWS_PER_IMPORT} rows.`]);
      } else {
        entries.push({
          document,
          identity: inboundReceiptIdentity(document),
          rows
        });
      }
    }

    const chunks = chunkDocumentRows(entries);
    chunks.forEach((chunk, index) => {
      const directory = customerDirectories.get(customerKey(group.customerId, group.customerName)) ?? "customer";
      const fileName = `${String(index + 1).padStart(3, "0")}-${group.sourceState}.xlsx`;
      const filePath = `inbound/${directory}/${fileName}`;
      const rows = chunk.flatMap((entry) => entry.rows);
      files[filePath] = buildExcelWorkbookBytes({
        title: `Inbound Bulk Import - ${group.customerName}`,
        sheetName: "Inbound Receipts",
        fileName,
        columns: INBOUND_BULK_IMPORT_TEMPLATE_COLUMNS,
        rows
      });
      manifestRows.push(buildManifestRow(filePath, "inbound", group, chunk, rows.length, inboundBusinessDate));
    });
  }
}

function addOutboundWorkbooks(
  files: Zippable,
  manifestRows: MigrationManifestRow[],
  skippedRows: string[][],
  documents: OutboundDocument[],
  customerDirectories: Map<string, string>
) {
  const eligible = documents
    .filter((document) => !isDeleted(document.status, document.deletedAt))
    .sort(compareOutboundDocumentsOldestFirst);
  const groups = groupDocuments(eligible);

  for (const group of groups) {
    const entries: Array<DocumentRows<OutboundDocument>> = [];
    for (const document of group.documents) {
      const compatibilityIssue = outboundBulkReimportIssue(document);
      const rows = buildOutboundBulkReimportRows(document);
      if (compatibilityIssue) {
        skippedRows.push(["Outbound", document.customerName, document.pickingOrderNo || `Outbound #${document.id}`, compatibilityIssue]);
      } else if (rows.length === 0) {
        skippedRows.push(["Outbound", document.customerName, document.pickingOrderNo, "Shipment has no lines."]);
      } else if (rows.length > MAX_ROWS_PER_IMPORT) {
        skippedRows.push(["Outbound", document.customerName, document.pickingOrderNo, `Shipment exceeds ${MAX_ROWS_PER_IMPORT} rows.`]);
      } else {
        entries.push({
          document,
          identity: document.pickingOrderNo.trim().toUpperCase(),
          rows
        });
      }
    }

    const chunks = chunkDocumentRows(entries);
    chunks.forEach((chunk, index) => {
      const directory = customerDirectories.get(customerKey(group.customerId, group.customerName)) ?? "customer";
      const fileName = `${String(index + 1).padStart(3, "0")}-${group.sourceState}.xlsx`;
      const filePath = `outbound/${directory}/${fileName}`;
      const rows = chunk.flatMap((entry) => entry.rows);
      files[filePath] = buildExcelWorkbookBytes({
        title: `Outbound Bulk Import - ${group.customerName}`,
        sheetName: "Outbound Shipments",
        fileName,
        columns: OUTBOUND_BULK_IMPORT_TEMPLATE_COLUMNS,
        rows
      });
      manifestRows.push(buildManifestRow(filePath, "outbound", group, chunk, rows.length, outboundBusinessDate));
    });
  }
}

function buildOutboundLineRows(document: OutboundDocument, line: OutboundDocumentLine) {
  const actualQuantity = Math.max(0, line.actualQuantity ?? line.quantity);
  const plannedQuantity = Math.max(0, line.plannedQuantity ?? actualQuantity);
  const allocations = (line.pickAllocations ?? []).filter((allocation) => allocation.allocatedQty > 0);
  const sourceRows = allocations.length > 0
    ? allocations
    : [fallbackOutboundAllocation(line, actualQuantity)];
  const weights = sourceRows.map((allocation) => Math.max(0, allocation.allocatedQty));
  const actualShares = allocateIntegerTotal(actualQuantity, weights);
  const plannedShares = allocateIntegerTotal(plannedQuantity, weights);
  const outboundPalletShares = actualQuantity > 0
    ? allocateIntegerTotal(Math.max(0, line.pallets), weights)
    : sourceRows.map(() => 0);

  return sourceRows.map((allocation, index) => ({
    pickingOrderNo: document.pickingOrderNo,
    expectedShipDate: firstDate(document.expectedShipDate),
    actualShipDate: outboundActualShipDate(document),
    shipToName: document.shipToName,
    shipToAddress: document.shipToAddress,
    shipToContact: document.shipToContact,
    warehouse: allocation.sourceLocationName || allocation.locationName || line.locationName,
    sourceContainer: allocation.containerNo,
    storageSection: allocation.sourceStorageSection || allocation.storageSection || line.storageSection,
    sku: line.sku,
    itemNumber: line.itemNumber,
    plannedQuantity: plannedShares[index] ?? 0,
    quantity: actualShares[index] ?? 0,
    inventoryPallets: actualQuantity === 0 ? 0 : Math.max(0, allocation.inventoryPalletsUsed ?? allocation.pallets ?? 0),
    outboundPallets: outboundPalletShares[index] ?? 0,
    lineNote: line.lineNote
  }));
}

function fallbackOutboundAllocation(line: OutboundDocumentLine, quantity: number): OutboundPickAllocation {
  return {
    id: 0,
    lineId: line.id,
    itemNumber: line.itemNumber,
    locationId: line.locationId,
    locationName: line.locationName,
    storageSection: line.storageSection,
    containerNo: "",
    allocatedQty: quantity,
    pallets: 0,
    createdAt: line.createdAt
  };
}

function inboundBulkReimportIssue(document: InboundDocument) {
  if (!document.containerNo.trim()) return "Container No is empty.";
  if (!document.locationName.trim()) return "Warehouse is empty.";
  if (!inboundBusinessDate(document)) return "Actual Arrival Date cannot be derived.";
  for (const line of document.lines) {
    if (!line.sku.trim()) return `Inbound line ${line.id} has no UPC.`;
    if (line.expectedQty < 0 || line.receivedQty < 0 || line.pallets < 0 || line.inboundCtnsPerPallet < 0) {
      return `Inbound line ${line.id} contains a negative quantity or pallet value.`;
    }
    if (line.expectedQty === 0 && line.receivedQty === 0) {
      return `Inbound line ${line.id} has neither Expected Qty nor Received Qty.`;
    }
  }
  return "";
}

function outboundBulkReimportIssue(document: OutboundDocument) {
  if (!document.pickingOrderNo.trim()) return "Picking Order No is empty.";
  for (const line of document.lines) {
    const actualQuantity = Math.max(0, line.actualQuantity ?? line.quantity);
    const plannedQuantity = Math.max(0, line.plannedQuantity ?? actualQuantity);
    if (!line.sku.trim()) return `Outbound line ${line.id} has no UPC.`;
    if (actualQuantity === 0 && plannedQuantity === 0) {
      return `Outbound line ${line.id} has neither Planned Qty nor Actual Qty.`;
    }
    if (line.pallets < 0) return `Outbound line ${line.id} has a negative outbound pallet count.`;
    if (!isConfirmed(document.status) || actualQuantity === 0) continue;
    if (!line.hasStoredPickAllocations) {
      return `Outbound line ${line.id} is a legacy record without a current source-allocation snapshot.`;
    }
    const allocations = (line.pickAllocations ?? []).filter((allocation) => allocation.allocatedQty > 0);
    if (allocations.length === 0) {
      return `Outbound line ${line.id} has no source-container allocation.`;
    }
    if (allocations.reduce((total, allocation) => total + allocation.allocatedQty, 0) !== actualQuantity) {
      return `Outbound line ${line.id} source allocations do not equal Actual Qty.`;
    }
    if (allocations.some((allocation) => !allocation.containerNo.trim() || !(allocation.locationName || line.locationName).trim())) {
      return `Outbound line ${line.id} has an incomplete source container or warehouse.`;
    }
  }
  return "";
}

function allocateIntegerTotal(total: number, weights: number[]) {
  const shares = weights.map(() => 0);
  if (total <= 0 || weights.length === 0) return shares;

  const safeWeights = weights.map((weight) => Math.max(0, weight));
  const totalWeight = safeWeights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight === 0) {
    shares[0] = total;
    return shares;
  }

  const remainders: Array<{ index: number; remainder: number }> = [];
  let assigned = 0;
  safeWeights.forEach((weight, index) => {
    const numerator = total * weight;
    shares[index] = Math.floor(numerator / totalWeight);
    assigned += shares[index];
    remainders.push({ index, remainder: numerator % totalWeight });
  });
  remainders.sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (let index = 0; assigned < total; index++, assigned++) {
    shares[remainders[index % remainders.length].index] += 1;
  }
  return shares;
}

function chunkDocumentRows<TDocument>(entries: Array<DocumentRows<TDocument>>) {
  const chunks: Array<Array<DocumentRows<TDocument>>> = [];
  let current: Array<DocumentRows<TDocument>> = [];
  let currentRows = 0;
  let currentIdentities = new Set<string>();

  for (const entry of entries) {
    const requiresNewChunk = current.length > 0 && (
      current.length >= MAX_DOCUMENTS_PER_IMPORT
      || currentRows + entry.rows.length > MAX_ROWS_PER_IMPORT
      || currentIdentities.has(entry.identity)
    );
    if (requiresNewChunk) {
      chunks.push(current);
      current = [];
      currentRows = 0;
      currentIdentities = new Set<string>();
    }
    current.push(entry);
    currentRows += entry.rows.length;
    currentIdentities.add(entry.identity);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function groupDocuments<TDocument extends {
  customerId: number;
  customerName: string;
  status: string;
}>(documents: TDocument[]) {
  const groups = new Map<string, {
    customerId: number;
    customerName: string;
    sourceState: MigrationSourceState;
    documents: TDocument[];
  }>();
  for (const document of documents) {
    const sourceState: MigrationSourceState = isConfirmed(document.status) ? "confirmed" : "draft";
    const key = `${customerKey(document.customerId, document.customerName)}|${sourceState}`;
    const group = groups.get(key) ?? {
      customerId: document.customerId,
      customerName: document.customerName || "Unnamed Customer",
      sourceState,
      documents: []
    };
    group.documents.push(document);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => {
    const customerComparison = left.customerName.localeCompare(right.customerName);
    if (customerComparison !== 0) return customerComparison;
    return left.sourceState === right.sourceState ? 0 : left.sourceState === "confirmed" ? -1 : 1;
  });
}

function buildCustomerDirectories(
  inboundDocuments: InboundDocument[],
  outboundDocuments: OutboundDocument[]
) {
  const customers = new Map<string, { id: number; name: string }>();
  for (const document of [...inboundDocuments, ...outboundDocuments]) {
    customers.set(customerKey(document.customerId, document.customerName), {
      id: document.customerId,
      name: document.customerName || "Unnamed Customer"
    });
  }
  const directories = new Map<string, string>();
  const used = new Map<string, number>();
  [...customers.entries()]
    .sort((left, right) => left[1].name.localeCompare(right[1].name) || left[1].id - right[1].id)
    .forEach(([key, customer]) => {
      const base = slugify(customer.name) || "customer";
      const occurrence = (used.get(base) ?? 0) + 1;
      used.set(base, occurrence);
      directories.set(key, occurrence === 1 ? base : `${base}-${occurrence}`);
    });
  return directories;
}

function buildManifestRow<TDocument>(
  file: string,
  direction: MigrationDirection,
  group: { customerName: string; sourceState: MigrationSourceState },
  chunk: Array<DocumentRows<TDocument>>,
  rowCount: number,
  businessDate: (document: TDocument) => string
): MigrationManifestRow {
  const dates = chunk.map((entry) => businessDate(entry.document)).filter(Boolean).sort();
  return {
    file,
    direction,
    customer: group.customerName,
    sourceState: group.sourceState,
    documentCount: chunk.length,
    rowCount,
    firstBusinessDate: dates[0] ?? "",
    lastBusinessDate: dates[dates.length - 1] ?? ""
  };
}

function buildManifestCsv(rows: MigrationManifestRow[]) {
  return buildCsv([
    ["File", "Direction", "Customer", "Source Status", "Documents", "Rows", "First Business Date", "Last Business Date"],
    ...rows.map((row) => [
      row.file,
      row.direction,
      row.customer,
      row.sourceState,
      String(row.documentCount),
      String(row.rowCount),
      row.firstBusinessDate,
      row.lastBusinessDate
    ])
  ]);
}

function buildReadme(summary: DocumentMigrationPackageSummary) {
  return [
    "Speed WMS Bulk Import re-import package",
    "",
    `Included: ${summary.inboundDocuments} inbound receipt(s), ${summary.outboundDocuments} outbound shipment(s), ${summary.workbookCount} workbook(s).`,
    `Skipped: ${summary.skippedDocuments} document(s). See skipped-documents.csv when present.`,
    "",
    "Import order",
    "1. Configure matching customers, warehouses, storage sections, and UPC master data in the destination environment.",
    "2. Import every workbook under inbound/ first. In Bulk Import, select the customer named in manifest.csv.",
    "3. Workbooks marked confirmed create drafts; review and batch-confirm each workbook before moving to the next one. Leave workbooks marked draft unconfirmed.",
    "4. After all confirmed inbound receipts are posted, import outbound/ workbooks in file/date order and confirm those marked confirmed before continuing.",
    "",
    "Notes",
    "- Excel files use the current Bulk Import columns and contain no database IDs.",
    "- Attachments, tracking history, document notes, audit logs, and database IDs are not migrated.",
    "- Confirmed documents without an actual date use their original confirmation/effective date. Draft inbound receipts fall back to Expected Arrival Date or source creation date so the workbook remains importable.",
    "- Legacy outbound records without a current source-allocation snapshot are skipped and listed in skipped-documents.csv.",
    "- Duplicate Container No/date or Picking Order No documents are placed in separate workbooks so Bulk Import does not merge them.",
    "- Each workbook stays within the current 500-document and 5,000-row import limits."
  ].join("\r\n");
}

function buildCsv(rows: string[][]) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function textZipEntry(value: string): [Uint8Array, ZipOptions] {
  const source = strToU8(value);
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  return [bytes, { level: 6 }];
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function inboundBusinessDate(document: InboundDocument) {
  if (isConfirmed(document.status)) {
    return firstDate(document.actualArrivalDate, document.confirmedAt, document.createdAt, document.expectedArrivalDate);
  }
  return firstDate(document.actualArrivalDate, document.expectedArrivalDate, document.createdAt);
}

function outboundBusinessDate(document: OutboundDocument) {
  if (isConfirmed(document.status)) {
    return firstDate(document.actualShipDate, document.confirmedAt, document.createdAt, document.expectedShipDate);
  }
  return firstDate(document.actualShipDate, document.expectedShipDate, document.createdAt);
}

function outboundActualShipDate(document: OutboundDocument) {
  if (!isConfirmed(document.status)) {
    return firstDate(document.actualShipDate);
  }
  return outboundBusinessDate(document);
}

function inboundReceiptIdentity(document: InboundDocument) {
  const businessDate = inboundBusinessDate(document);
  return `${document.containerNo.trim().toUpperCase()}|${businessDate}`;
}

function compareInboundDocumentsOldestFirst(left: InboundDocument, right: InboundDocument) {
  return inboundBusinessDate(left).localeCompare(inboundBusinessDate(right)) || left.id - right.id;
}

function compareOutboundDocumentsOldestFirst(left: OutboundDocument, right: OutboundDocument) {
  return outboundBusinessDate(left).localeCompare(outboundBusinessDate(right)) || left.id - right.id;
}

function firstDate(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = normalizeDate(value);
    if (normalized) return normalized;
  }
  return "";
}

function normalizeDate(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  const isoDate = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) return isoDate[1];
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function isDeleted(status: string, deletedAt: string | null) {
  const normalizedStatus = status.trim().toUpperCase();
  return Boolean(deletedAt) || normalizedStatus === "DELETED" || normalizedStatus === "CANCELLED";
}

function isConfirmed(status: string) {
  const normalizedStatus = status.trim().toUpperCase();
  return normalizedStatus === "CONFIRMED" || normalizedStatus === "POSTED";
}

function customerKey(customerId: number, customerName: string) {
  return `${customerId}|${customerName.trim().toUpperCase()}`;
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
}

function formatCompactDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}`;
}
