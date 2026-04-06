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

/** Derive the correct data-cell style ID based on row position and column number format */
function dataCellStyleId(
  rowIndex: number,
  numberFormat: ExcelExportColumn["numberFormat"] | undefined
): string {
  const alt = rowIndex % 2 === 1;
  if (numberFormat === "currency") return alt ? "dataCurrencyAlt" : "dataCurrency";
  if (numberFormat === "number")   return alt ? "dataNumberAlt"   : "dataNumber";
  return alt ? "dataAlt" : "data";
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

  const colCount = columns.length;
  const mergeAttr = `ss:MergeAcross="${Math.max(colCount - 1, 0)}"`;

  const headerRow = `<Row>${columns.map((column) => buildCellXml(column.label, "header")).join("")}</Row>`;
  const dataRows = rows
    .map((row, rowIndex) =>
      `<Row>${columns.map((column) =>
        buildCellXml(row[column.key], dataCellStyleId(rowIndex, column.numberFormat))
      ).join("")}</Row>`
    )
    .join("");

  // Build summary/totals section
  let summaryXml = "";
  if (summaryRows && summaryRows.length > 0) {
    // Empty separator row
    summaryXml += `<Row><Cell ${mergeAttr} ss:StyleID="summaryDivider"><Data ss:Type="String"></Data></Cell></Row>`;
    for (const srow of summaryRows) {
      const labelStyle = srow.bold !== false ? "summaryLabel" : "meta";
      const valueStyleMap: Record<string, string> = {
        currency: "summaryValueCurrency",
        number: "summaryValueNumber"
      };
      const valueStyle = srow.numberFormat ? (valueStyleMap[srow.numberFormat] ?? "summaryValue") : "summaryValue";
      const labelCols = colCount - 1;
      const labelMerge = labelCols > 0 ? ` ss:MergeAcross="${labelCols - 1}"` : "";
      summaryXml += `<Row>`;
      summaryXml += `<Cell${labelMerge} ss:StyleID="${labelStyle}"><Data ss:Type="String">${escapeXml(srow.label)}</Data></Cell>`;
      summaryXml += buildCellXml(srow.value, valueStyle);
      summaryXml += `</Row>`;
    }
  }

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
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#94A3B8"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
      </Borders>
    </Style>
    <Style ss:ID="data">
      <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#1f2937"/>
      <Alignment ss:Vertical="Center"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
      </Borders>
    </Style>
    <Style ss:ID="dataAlt">
      <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#1f2937"/>
      <Alignment ss:Vertical="Center"/>
      <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
      </Borders>
    </Style>
    <Style ss:ID="dataCurrency">
      <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#1f2937"/>
      <Alignment ss:Vertical="Center" ss:Horizontal="Right"/>
      <NumberFormat ss:Format="&quot;$&quot;#,##0.00"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
      </Borders>
    </Style>
    <Style ss:ID="dataCurrencyAlt">
      <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#1f2937"/>
      <Alignment ss:Vertical="Center" ss:Horizontal="Right"/>
      <NumberFormat ss:Format="&quot;$&quot;#,##0.00"/>
      <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
      </Borders>
    </Style>
    <Style ss:ID="dataNumber">
      <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#1f2937"/>
      <Alignment ss:Vertical="Center" ss:Horizontal="Right"/>
      <NumberFormat ss:Format="#,##0.##"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
      </Borders>
    </Style>
    <Style ss:ID="dataNumberAlt">
      <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#1f2937"/>
      <Alignment ss:Vertical="Center" ss:Horizontal="Right"/>
      <NumberFormat ss:Format="#,##0.##"/>
      <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
      </Borders>
    </Style>
    <Style ss:ID="summaryDivider">
      <Interior ss:Color="#EEF2F7" ss:Pattern="Solid"/>
      <Borders>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#94A3B8"/>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#94A3B8"/>
      </Borders>
    </Style>
    <Style ss:ID="summaryLabel">
      <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#17324d"/>
      <Alignment ss:Vertical="Center" ss:Horizontal="Right"/>
      <Interior ss:Color="#EEF2F7" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="summaryValue">
      <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#17324d"/>
      <Alignment ss:Vertical="Center" ss:Horizontal="Right"/>
      <Interior ss:Color="#EEF2F7" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="summaryValueCurrency">
      <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#17324d"/>
      <Alignment ss:Vertical="Center" ss:Horizontal="Right"/>
      <NumberFormat ss:Format="&quot;$&quot;#,##0.00"/>
      <Interior ss:Color="#EEF2F7" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="summaryValueNumber">
      <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#17324d"/>
      <Alignment ss:Vertical="Center" ss:Horizontal="Right"/>
      <NumberFormat ss:Format="#,##0.##"/>
      <Interior ss:Color="#EEF2F7" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="${escapeXml(safeSheetName)}">
    <Table>
      <Row>
        <Cell ss:StyleID="title" ${mergeAttr}>
          <Data ss:Type="String">${escapeXml(title)}</Data>
        </Cell>
      </Row>
      <Row>
        <Cell ss:StyleID="meta" ${mergeAttr}>
          <Data ss:Type="String">${escapeXml(`Exported ${exportTimestamp}`)}</Data>
        </Cell>
      </Row>
      ${headerRow}
      ${dataRows}
      ${summaryXml}
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
