import { strToU8, zipSync, type Zippable, type ZipOptions } from "fflate";

export type ExcelExportCell = string | number | boolean | Date | null | undefined;

export type ExcelExportColumn = {
  key: string;
  label: string;
  /** Apply a currency or number format to cells in this column */
  numberFormat?: "currency" | "number";
};

export type ExcelExportSummaryRow = {
  label: string;
  value: ExcelExportCell;
  numberFormat?: "currency" | "number";
  bold?: boolean;
};

type ExcelExportOptions = {
  title: string;
  sheetName: string;
  fileName: string;
  columns: ExcelExportColumn[];
  rows: Array<Record<string, ExcelExportCell>>;
  /** Optional summary/totals rows displayed below the data with a separator */
  summaryRows?: ExcelExportSummaryRow[];
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
  summaryValueNumber: 14
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
  summaryRows
}: ExcelExportOptions) {
  const safeSheetName = sanitizeSheetName(sheetName);
  const safeFileName = `${sanitizeFileName(fileName)}.xlsx`;
  const exportTimestamp = new Date().toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });

  const worksheetXml = buildWorksheetXml({
    title,
    exportTimestamp,
    columns,
    rows,
    summaryRows: summaryRows ?? []
  });
  const workbookBytes = buildXlsxArchive({
    title,
    sheetName: safeSheetName,
    worksheetXml
  });
  const workbookBuffer = new ArrayBuffer(workbookBytes.byteLength);
  new Uint8Array(workbookBuffer).set(workbookBytes);

  const blob = new Blob([workbookBuffer], {
    type: XLSX_MIME_TYPE
  });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeFileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
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
  sheetName,
  worksheetXml
}: {
  title: string;
  sheetName: string;
  worksheetXml: string;
}) {
  const timestamp = new Date().toISOString();
  const files: Zippable = {
    "[Content_Types].xml": zipEntry(buildContentTypesXml()),
    "_rels/.rels": zipEntry(buildRootRelationshipsXml()),
    "docProps/app.xml": zipEntry(buildAppPropertiesXml()),
    "docProps/core.xml": zipEntry(buildCorePropertiesXml(title, timestamp)),
    "xl/workbook.xml": zipEntry(buildWorkbookXml(sheetName)),
    "xl/_rels/workbook.xml.rels": zipEntry(buildWorkbookRelationshipsXml()),
    "xl/styles.xml": zipEntry(buildStylesXml()),
    "xl/worksheets/sheet1.xml": zipEntry(worksheetXml)
  };
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

function buildContentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
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

function buildWorkbookXml(sheetName: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
}

function buildWorkbookRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
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
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/>
    <numFmt numFmtId="165" formatCode="#,##0.##"/>
  </numFmts>
  <fonts count="4">
    <font><sz val="11"/><color rgb="FF1F2937"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><color rgb="FF17324D"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF64748B"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF17324D"/><name val="Calibri"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDCEBFA"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right style="thin"><color rgb="FFE2E8F0"/></right><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>
    <border><left/><right style="thin"><color rgb="FFCBD5E1"/></right><top/><bottom style="medium"><color rgb="FF94A3B8"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="15">
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
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}
