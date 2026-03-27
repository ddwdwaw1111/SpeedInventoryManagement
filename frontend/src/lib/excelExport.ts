export type ExcelExportCell = string | number | boolean | Date | null | undefined;

export type ExcelExportColumn = {
  key: string;
  label: string;
};

type ExcelExportOptions = {
  title: string;
  sheetName: string;
  fileName: string;
  columns: ExcelExportColumn[];
  rows: Array<Record<string, ExcelExportCell>>;
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
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

function buildCellXml(value: ExcelExportCell, styleId?: string) {
  const cell = toCellValue(value);
  const styleAttribute = styleId ? ` ss:StyleID="${styleId}"` : "";
  return `<Cell${styleAttribute}><Data ss:Type="${cell.type}">${escapeXml(cell.value)}</Data></Cell>`;
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
  rows
}: ExcelExportOptions) {
  const safeSheetName = sanitizeSheetName(sheetName);
  const safeFileName = `${sanitizeFileName(fileName)}.xls`;
  const exportTimestamp = new Date().toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });

  const headerRow = `<Row>${columns.map((column) => buildCellXml(column.label, "header")).join("")}</Row>`;
  const dataRows = rows
    .map((row) => `<Row>${columns.map((column) => buildCellXml(row[column.key])).join("")}</Row>`)
    .join("");

  const workbookXml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook
  xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:html="http://www.w3.org/TR/REC-html40">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Alignment ss:Vertical="Center"/>
      <Borders/>
      <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#1f2937"/>
      <Interior/>
      <NumberFormat/>
      <Protection/>
    </Style>
    <Style ss:ID="title">
      <Font ss:FontName="Calibri" ss:Size="14" ss:Bold="1" ss:Color="#17324d"/>
    </Style>
    <Style ss:ID="meta">
      <Font ss:FontName="Calibri" ss:Size="10" ss:Color="#64748b"/>
    </Style>
    <Style ss:ID="header">
      <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#17324d"/>
      <Interior ss:Color="#EEF2F7" ss:Pattern="Solid"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
      </Borders>
    </Style>
  </Styles>
  <Worksheet ss:Name="${escapeXml(safeSheetName)}">
    <Table>
      <Row>
        <Cell ss:StyleID="title" ss:MergeAcross="${Math.max(columns.length - 1, 0)}">
          <Data ss:Type="String">${escapeXml(title)}</Data>
        </Cell>
      </Row>
      <Row>
        <Cell ss:StyleID="meta" ss:MergeAcross="${Math.max(columns.length - 1, 0)}">
          <Data ss:Type="String">${escapeXml(`Exported ${exportTimestamp}`)}</Data>
        </Cell>
      </Row>
      ${headerRow}
      ${dataRows}
    </Table>
  </Worksheet>
</Workbook>`;

  const blob = new Blob([workbookXml], {
    type: "application/vnd.ms-excel;charset=utf-8;"
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
