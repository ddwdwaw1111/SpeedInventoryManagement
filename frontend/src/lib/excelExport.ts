import { strToU8, zipSync, type Zippable, type ZipOptions } from "fflate";

export type ExcelExportCell = string | number | boolean | Date | null | undefined;

export type ExcelExportColumn = {
  key: string;
  label: string;
  /** Apply a currency or number format to cells in this column */
  numberFormat?: "currency" | "currencyRate" | "number";
};

export type ExcelExportSummaryRow = {
  label: string;
  value: ExcelExportCell;
  numberFormat?: "currency" | "number";
  bold?: boolean;
};

export type ExcelInvoiceHeader = {
  sellerName: string;
  subtitle: string;
  invoiceNo: string;
  billTo: string;
  invoiceDate: string;
  dueDate: string;
  amountDue: number;
  containerNo: string;
  billingPeriod: string;
  receivedOn: string;
};

export type ExcelExportWorksheet = {
  title: string;
  sheetName: string;
  columns: ExcelExportColumn[];
  rows: Array<Record<string, ExcelExportCell>>;
  summaryRows?: ExcelExportSummaryRow[];
  /** Optional invoice-style heading used by individual customer statements. */
  invoiceHeader?: ExcelInvoiceHeader;
};

export type ExcelExportOptions = {
  title: string;
  sheetName: string;
  fileName: string;
  columns: ExcelExportColumn[];
  rows: Array<Record<string, ExcelExportCell>>;
  /** Optional summary/totals rows displayed below the data with a separator */
  summaryRows?: ExcelExportSummaryRow[];
  /** Optional worksheets appended after the primary worksheet. */
  additionalSheets?: ExcelExportWorksheet[];
  /** Optional invoice-style heading used by the primary worksheet. */
  invoiceHeader?: ExcelInvoiceHeader;
};

const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const STYLE_ID = {
  default: 0,
  title: 1,
  meta: 2,
  header: 3,
  data: 4,
  dataAlt: 5,
  dataCurrency: 6,
  dataCurrencyAlt: 7,
  dataNumber: 8,
  dataNumberAlt: 9,
  summaryDivider: 10,
  summaryLabel: 11,
  summaryValue: 12,
  summaryValueCurrency: 13,
  summaryValueNumber: 14,
  invoiceSeller: 15,
  invoiceSubtitle: 16,
  invoiceNumberLabel: 17,
  invoiceNumberValue: 18,
  invoiceMetaLabel: 19,
  invoiceMetaValue: 20,
  invoiceAmountDue: 21,
  invoiceContextLabel: 22,
  invoiceContextValue: 23,
  invoiceTableHeader: 24,
  invoiceTotalLabel: 25,
  invoiceTotalValue: 26,
  invoiceMetaLabelLeft: 27,
  dataCurrencyRate: 28,
  dataCurrencyRateAlt: 29
} as const;

function escapeXml(value: string) {
  return sanitizeXmlText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeXmlText(value: string) {
  return Array.from(value).filter((char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    return codePoint === 0x09
      || codePoint === 0x0A
      || codePoint === 0x0D
      || (codePoint >= 0x20 && codePoint <= 0xD7FF)
      || (codePoint >= 0xE000 && codePoint <= 0xFFFD)
      || (codePoint >= 0x10000 && codePoint <= 0x10FFFF);
  }).join("");
}

function toCellValue(value: ExcelExportCell) {
  if (value === null || value === undefined) {
    return { type: "String", value: "" };
  }

  if (value instanceof Date) {
    return { type: "String", value: value.toISOString() };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return { type: "Number", value: String(value) };
  }

  if (typeof value === "boolean") {
    return { type: "String", value: value ? "Yes" : "No" };
  }

  return { type: "String", value: String(value) };
}

function buildCellXml(value: ExcelExportCell, rowNumber: number, columnNumber: number, styleId?: number) {
  const cell = toCellValue(value);
  const styleAttribute = typeof styleId === "number" ? ` s="${styleId}"` : "";
  const reference = `${columnName(columnNumber)}${rowNumber}`;
  if (cell.type === "Number") {
    return `<c r="${reference}"${styleAttribute}><v>${escapeXml(cell.value)}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"${styleAttribute}>${inlineStringXml(cell.value)}</c>`;
}

/** Derive the correct data-cell style ID based on row position and column number format */
function dataCellStyleId(
  rowIndex: number,
  numberFormat: ExcelExportColumn["numberFormat"] | undefined
): number {
  const alt = rowIndex % 2 === 1;
  if (numberFormat === "currencyRate") return alt ? STYLE_ID.dataCurrencyRateAlt : STYLE_ID.dataCurrencyRate;
  if (numberFormat === "currency") return alt ? STYLE_ID.dataCurrencyAlt : STYLE_ID.dataCurrency;
  if (numberFormat === "number") return alt ? STYLE_ID.dataNumberAlt : STYLE_ID.dataNumber;
  return alt ? STYLE_ID.dataAlt : STYLE_ID.data;
}

function sanitizeSheetName(value: string) {
  return value.replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 31) || "Sheet1";
}

function sanitizeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim() || "export";
}

export function downloadExcelWorkbook({
  title,
  sheetName,
  fileName,
  columns,
  rows,
  summaryRows,
  additionalSheets,
  invoiceHeader
}: ExcelExportOptions) {
  const safeFileName = `${sanitizeFileName(fileName)}.xlsx`;
  const workbookBytes = buildExcelWorkbookBytes({
    title,
    sheetName,
    fileName,
    columns,
    rows,
    summaryRows,
    additionalSheets,
    invoiceHeader
  });
  downloadBytes(workbookBytes, safeFileName, XLSX_MIME_TYPE);
}

export function buildExcelWorkbookBytes({
  title,
  sheetName,
  columns,
  rows,
  summaryRows,
  additionalSheets,
  invoiceHeader
}: ExcelExportOptions) {
  const exportTimestamp = new Date().toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });

  const worksheetInputs: ExcelExportWorksheet[] = [
    { title, sheetName, columns, rows, summaryRows, invoiceHeader },
    ...(additionalSheets ?? [])
  ];
  const worksheets = worksheetInputs.map((worksheet, index) => ({
    sheetName: uniqueSheetName(worksheet.sheetName, index, worksheetInputs),
    worksheetXml: worksheet.invoiceHeader
      ? buildInvoiceWorksheetXml({
        invoiceHeader: worksheet.invoiceHeader,
        columns: worksheet.columns,
        rows: worksheet.rows,
        summaryRows: worksheet.summaryRows ?? []
      })
      : buildWorksheetXml({
        title: worksheet.title,
        exportTimestamp,
        columns: worksheet.columns,
        rows: worksheet.rows,
        summaryRows: worksheet.summaryRows ?? []
      })
  }));
  return buildXlsxArchive({
    title,
    worksheets
  });
}

function buildInvoiceWorksheetXml({
  invoiceHeader,
  columns,
  rows,
  summaryRows
}: {
  invoiceHeader: ExcelInvoiceHeader;
  columns: ExcelExportColumn[];
  rows: Array<Record<string, ExcelExportCell>>;
  summaryRows: ExcelExportSummaryRow[];
}) {
  const columnCount = Math.max(columns.length, 5);
  const lastColumnName = columnName(columnCount);
  const worksheetRows: string[] = [];
  const mergeRefs: string[] = [];
  let rowNumber = 1;

  function addRow(cells: string[], height?: number) {
    const heightAttributes = height ? ` ht="${height}" customHeight="1"` : "";
    worksheetRows.push(`<row r="${rowNumber}"${heightAttributes}>${cells.join("")}</row>`);
    rowNumber += 1;
  }

  function merge(range: string) {
    mergeRefs.push(range);
  }

  addRow([
    buildCellXml(invoiceHeader.sellerName, rowNumber, 1, STYLE_ID.invoiceSeller),
    buildCellXml("Invoice#", rowNumber, 4, STYLE_ID.invoiceNumberLabel)
  ], 24);
  merge("A1:C1");
  merge("D1:E1");

  addRow([
    buildCellXml(invoiceHeader.subtitle, rowNumber, 1, STYLE_ID.invoiceSubtitle),
    buildCellXml(invoiceHeader.invoiceNo, rowNumber, 4, STYLE_ID.invoiceNumberValue)
  ], 22);
  merge("A2:C2");
  merge("D2:E2");

  addRow([], 10);
  addRow([
    buildCellXml("BILL TO", rowNumber, 1, STYLE_ID.invoiceMetaLabelLeft),
    buildCellXml("DATE", rowNumber, 3, STYLE_ID.invoiceMetaLabel),
    buildCellXml("AMOUNT DUE", rowNumber, 4, STYLE_ID.invoiceMetaLabel),
    buildCellXml("DUE DATE", rowNumber, 5, STYLE_ID.invoiceMetaLabel)
  ], 20);
  merge("A4:B4");
  addRow([
    buildCellXml(invoiceHeader.billTo, rowNumber, 1, STYLE_ID.invoiceMetaValue),
    buildCellXml(invoiceHeader.invoiceDate, rowNumber, 3, STYLE_ID.invoiceMetaValue),
    buildCellXml(invoiceHeader.amountDue, rowNumber, 4, STYLE_ID.invoiceAmountDue),
    buildCellXml(invoiceHeader.dueDate, rowNumber, 5, STYLE_ID.invoiceMetaValue)
  ], 22);
  merge("A5:B5");

  addRow([], 8);
  addRow([
    buildCellXml("CONTAINER", rowNumber, 1, STYLE_ID.invoiceContextLabel),
    buildCellXml(invoiceHeader.containerNo, rowNumber, 2, STYLE_ID.invoiceContextValue),
    buildCellXml("BILLING PERIOD", rowNumber, 4, STYLE_ID.invoiceContextLabel),
    buildCellXml(invoiceHeader.billingPeriod, rowNumber, 5, STYLE_ID.invoiceContextValue)
  ], 30);
  merge("B7:C7");
  addRow([
    buildCellXml("RECEIVED", rowNumber, 1, STYLE_ID.invoiceContextLabel),
    buildCellXml(invoiceHeader.receivedOn, rowNumber, 2, STYLE_ID.invoiceContextValue)
  ], 20);
  merge("B8:E8");

  addRow([], 8);
  const headerRowNumber = rowNumber;
  addRow(columns.map((column, index) =>
    buildCellXml(column.label, headerRowNumber, index + 1, STYLE_ID.invoiceTableHeader)
  ), 21);

  rows.forEach((row, rowIndex) => {
    const currentRow = rowNumber;
    addRow(columns.map((column, index) =>
      buildCellXml(row[column.key], currentRow, index + 1, dataCellStyleId(rowIndex, column.numberFormat))
    ), 20);
  });

  if (summaryRows.length > 0) {
    addRow([], 8);
    for (const [summaryIndex, summaryRow] of summaryRows.entries()) {
      const currentRow = rowNumber;
      const isTotal = summaryIndex === summaryRows.length - 1 || summaryRow.bold === true;
      const labelStyleId = isTotal ? STYLE_ID.invoiceTotalLabel : STYLE_ID.summaryLabel;
      const valueStyleId = isTotal
        ? STYLE_ID.invoiceTotalValue
        : summaryRow.numberFormat === "currency"
          ? STYLE_ID.summaryValueCurrency
          : summaryRow.numberFormat === "number"
            ? STYLE_ID.summaryValueNumber
            : STYLE_ID.summaryValue;
      addRow([
        buildCellXml(summaryRow.label, currentRow, 1, labelStyleId),
        buildCellXml(summaryRow.value, currentRow, 5, valueStyleId)
      ], isTotal ? 22 : 20);
      merge(`A${currentRow}:D${currentRow}`);
    }
  }

  const mergeXml = mergeRefs.length > 0
    ? `<mergeCells count="${mergeRefs.length}">${mergeRefs.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>`
    : "";
  const lastRowNumber = Math.max(rowNumber - 1, 1);
  const columnXml = `<cols>
    <col min="1" max="1" width="16" customWidth="1"/>
    <col min="2" max="2" width="44" customWidth="1"/>
    <col min="3" max="3" width="14" customWidth="1"/>
    <col min="4" max="4" width="15" customWidth="1"/>
    <col min="5" max="5" width="16" customWidth="1"/>
  </cols>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:${lastColumnName}${lastRowNumber}"/>
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  ${columnXml}
  <sheetData>
    ${worksheetRows.join("\n    ")}
  </sheetData>
  ${mergeXml}
  <pageMargins left="0.45" right="0.45" top="0.5" bottom="0.5" header="0" footer="0"/>
  <pageSetup paperSize="1" orientation="portrait" fitToWidth="1" fitToHeight="1"/>
</worksheet>`;
}

export function downloadBytes(bytes: Uint8Array, fileName: string, contentType = "application/octet-stream") {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);

  downloadByteParts([new Uint8Array(buffer)], fileName, contentType);
}

export function downloadByteParts(parts: readonly Uint8Array[], fileName: string, contentType = "application/octet-stream") {
  const blob = new Blob(parts as unknown as BlobPart[], {
    type: contentType
  });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = sanitizeFileName(fileName);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}

function uniqueSheetName(value: string, index: number, worksheets: ExcelExportWorksheet[]) {
  const safeName = sanitizeSheetName(value);
  const duplicateIndex = worksheets.slice(0, index)
    .filter((worksheet) => sanitizeSheetName(worksheet.sheetName) === safeName)
    .length;
  if (duplicateIndex === 0) {
    return safeName;
  }
  const suffix = ` ${duplicateIndex + 1}`;
  return `${safeName.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
}

function buildWorksheetXml({
  title,
  exportTimestamp,
  columns,
  rows,
  summaryRows
}: {
  title: string;
  exportTimestamp: string;
  columns: ExcelExportColumn[];
  rows: Array<Record<string, ExcelExportCell>>;
  summaryRows: ExcelExportSummaryRow[];
}) {
  const columnCount = Math.max(columns.length, 1);
  const lastColumnName = columnName(columnCount);
  const worksheetRows: string[] = [];
  const mergeRefs: string[] = [];
  let rowNumber = 1;

  function addMergedRow(value: ExcelExportCell, styleId: number) {
    const currentRow = rowNumber;
    worksheetRows.push(`<row r="${currentRow}">${buildCellXml(value, currentRow, 1, styleId)}</row>`);
    if (columnCount > 1) {
      mergeRefs.push(`A${currentRow}:${lastColumnName}${currentRow}`);
    }
    rowNumber += 1;
  }

  addMergedRow(title, STYLE_ID.title);
  addMergedRow(`Exported ${exportTimestamp}`, STYLE_ID.meta);

  const headerRowNumber = rowNumber;
  worksheetRows.push(`<row r="${headerRowNumber}">${columns.map((column, index) =>
    buildCellXml(column.label, headerRowNumber, index + 1, STYLE_ID.header)
  ).join("")}</row>`);
  rowNumber += 1;

  rows.forEach((row, rowIndex) => {
    const currentRow = rowNumber;
    worksheetRows.push(`<row r="${currentRow}">${columns.map((column, index) =>
      buildCellXml(row[column.key], currentRow, index + 1, dataCellStyleId(rowIndex, column.numberFormat))
    ).join("")}</row>`);
    rowNumber += 1;
  });

  if (summaryRows.length > 0) {
    const dividerRow = rowNumber;
    worksheetRows.push(`<row r="${dividerRow}">${buildCellXml("", dividerRow, 1, STYLE_ID.summaryDivider)}</row>`);
    if (columnCount > 1) {
      mergeRefs.push(`A${dividerRow}:${lastColumnName}${dividerRow}`);
    }
    rowNumber += 1;

    for (const summaryRow of summaryRows) {
      const currentRow = rowNumber;
      const labelStyleId = summaryRow.bold !== false ? STYLE_ID.summaryLabel : STYLE_ID.meta;
      const valueStyleId = summaryRow.numberFormat === "currency"
        ? STYLE_ID.summaryValueCurrency
        : summaryRow.numberFormat === "number"
          ? STYLE_ID.summaryValueNumber
          : STYLE_ID.summaryValue;
      const cells = [buildCellXml(summaryRow.label, currentRow, 1, labelStyleId)];
      if (columnCount > 1) {
        if (columnCount > 2) {
          mergeRefs.push(`A${currentRow}:${columnName(columnCount - 1)}${currentRow}`);
        }
        cells.push(buildCellXml(summaryRow.value, currentRow, columnCount, valueStyleId));
      }
      worksheetRows.push(`<row r="${currentRow}">${cells.join("")}</row>`);
      rowNumber += 1;
    }
  }

  const columnXml = buildColumnWidthXml(columns, rows);
  const mergeXml = mergeRefs.length > 0
    ? `<mergeCells count="${mergeRefs.length}">${mergeRefs.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>`
    : "";
  const lastRowNumber = Math.max(rowNumber - 1, 1);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:${lastColumnName}${lastRowNumber}"/>
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  ${columnXml}
  <sheetData>
    ${worksheetRows.join("\n    ")}
  </sheetData>
  ${mergeXml}
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}

function buildXlsxArchive({
  title,
  worksheets
}: {
  title: string;
  worksheets: Array<{ sheetName: string; worksheetXml: string }>;
}) {
  const timestamp = new Date().toISOString();
  const files: Zippable = {
    "[Content_Types].xml": zipEntry(buildContentTypesXml(worksheets.length)),
    "_rels/.rels": zipEntry(buildRootRelationshipsXml()),
    "docProps/app.xml": zipEntry(buildAppPropertiesXml()),
    "docProps/core.xml": zipEntry(buildCorePropertiesXml(title, timestamp)),
    "xl/workbook.xml": zipEntry(buildWorkbookXml(worksheets.map((worksheet) => worksheet.sheetName))),
    "xl/_rels/workbook.xml.rels": zipEntry(buildWorkbookRelationshipsXml(worksheets.length)),
    "xl/styles.xml": zipEntry(buildStylesXml())
  };
  worksheets.forEach((worksheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = zipEntry(worksheet.worksheetXml);
  });
  return zipSync(files);
}

function zipEntry(xml: string): [Uint8Array, ZipOptions] {
  const sourceBytes = strToU8(xml);
  const buffer = new ArrayBuffer(sourceBytes.byteLength);
  const bytes = new Uint8Array(buffer);
  bytes.set(sourceBytes);
  return [bytes, { level: 6 }];
}

function buildColumnWidthXml(columns: ExcelExportColumn[], rows: Array<Record<string, ExcelExportCell>>) {
  if (columns.length === 0) {
    return "";
  }

  const cols = columns.map((column, index) => {
    const sampleValues = rows.slice(0, 200).map((row) => cellDisplayLength(row[column.key]));
    const maxContentWidth = Math.max(column.label.length, ...sampleValues);
    const width = Math.min(Math.max(maxContentWidth + 2, column.numberFormat ? 12 : 10), 36);
    const columnNumber = index + 1;
    return `<col min="${columnNumber}" max="${columnNumber}" width="${width}" customWidth="1"/>`;
  }).join("");

  return `<cols>${cols}</cols>`;
}

function cellDisplayLength(value: ExcelExportCell) {
  const cell = toCellValue(value);
  return cell.value.length;
}

function inlineStringXml(value: string) {
  const preserveSpace = value !== value.trim() ? ' xml:space="preserve"' : "";
  return `<is><t${preserveSpace}>${escapeXml(value)}</t></is>`;
}

function columnName(columnNumber: number) {
  let value = Math.max(1, Math.floor(columnNumber));
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function buildContentTypesXml(worksheetCount: number) {
  const worksheetOverrides = Array.from({ length: Math.max(worksheetCount, 1) }, (_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${worksheetOverrides}
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
}

function buildRootRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function buildWorkbookXml(sheetNames: string[]) {
  const sheets = sheetNames.map((sheetName, index) =>
    `<sheet name="${escapeXml(sheetName)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  ).join("\n    ");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheets}
  </sheets>
</workbook>`;
}

function buildWorkbookRelationshipsXml(worksheetCount: number) {
  const worksheetRelationships = Array.from({ length: Math.max(worksheetCount, 1) }, (_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  ).join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${worksheetRelationships}
  <Relationship Id="rId${Math.max(worksheetCount, 1) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function buildAppPropertiesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Speed Inventory Management</Application>
</Properties>`;
}

function buildCorePropertiesXml(title: string, timestamp: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(title)}</dc:title>
  <dc:creator>Speed Inventory Management</dc:creator>
  <cp:lastModifiedBy>Speed Inventory Management</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified>
</cp:coreProperties>`;
}

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="3">
    <numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/>
    <numFmt numFmtId="165" formatCode="#,##0.##"/>
    <numFmt numFmtId="166" formatCode="&quot;$&quot;#,##0.00######"/>
  </numFmts>
  <fonts count="8">
    <font><sz val="11"/><color rgb="FF1F2937"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><color rgb="FF17324D"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF64748B"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF17324D"/><name val="Calibri"/></font>
    <font><b/><sz val="18"/><color rgb="FF111827"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF374151"/><name val="Calibri"/></font>
    <font><sz val="16"/><color rgb="FF111827"/><name val="Calibri"/></font>
    <font><b/><sz val="12"/><color rgb="FF111827"/><name val="Calibri"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDCEBFA"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFBFD5F3"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right style="thin"><color rgb="FFE2E8F0"/></right><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>
    <border><left/><right style="thin"><color rgb="FFCBD5E1"/></right><top/><bottom style="medium"><color rgb="FF94A3B8"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="30">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment vertical="center" horizontal="right"/></xf>
    <xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"><alignment vertical="center" horizontal="right"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment vertical="center" horizontal="right"/></xf>
    <xf numFmtId="165" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"><alignment vertical="center" horizontal="right"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="2" xfId="0" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center" horizontal="right"/></xf>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center" horizontal="right"/></xf>
    <xf numFmtId="164" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"><alignment vertical="center" horizontal="right"/></xf>
    <xf numFmtId="165" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"><alignment vertical="center" horizontal="right"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment vertical="center" horizontal="right"/></xf>
    <xf numFmtId="0" fontId="7" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment vertical="center" horizontal="right"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="center" horizontal="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="center" horizontal="left" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="7" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyBorder="1"><alignment vertical="center" horizontal="right"/></xf>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="center" horizontal="left" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="5" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" horizontal="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center" horizontal="right"/></xf>
    <xf numFmtId="164" fontId="7" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"><alignment vertical="center" horizontal="right"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="center" horizontal="left"/></xf>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment vertical="center" horizontal="right"/></xf>
    <xf numFmtId="166" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"><alignment vertical="center" horizontal="right"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}
