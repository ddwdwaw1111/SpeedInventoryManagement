import * as pdfMake from "pdfmake/build/pdfmake";
const PICK_SHEET_LAYOUT_NAME = "pickSheetTable";
const CJK_FONT_NAME = "NotoSansCJKSC";
const CJK_FONT_URL_BASE = "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese";
const PDF_FONTS = {
    [CJK_FONT_NAME]: {
        normal: `${CJK_FONT_URL_BASE}/NotoSansCJKsc-Regular.otf`,
        bold: `${CJK_FONT_URL_BASE}/NotoSansCJKsc-Bold.otf`,
        italics: `${CJK_FONT_URL_BASE}/NotoSansCJKsc-Regular.otf`,
        bolditalics: `${CJK_FONT_URL_BASE}/NotoSansCJKsc-Bold.otf`
    }
};
const PICK_SHEET_TABLE_LAYOUT = {
    hLineColor: (rowIndex, node) => (rowIndex === 0 || rowIndex === node.table.body.length ? "#cbd5e1" : "#e2e8f0"),
    vLineColor: () => "#e2e8f0",
    hLineWidth: (rowIndex, node) => (rowIndex === 0 || rowIndex === 1 || rowIndex === node.table.body.length ? 0.8 : 0.4),
    vLineWidth: () => 0.4,
    paddingLeft: (columnIndex) => (columnIndex === 0 ? 4 : 5),
    paddingRight: (columnIndex, node) => (columnIndex === node.table.widths.length - 1 ? 4 : 5),
    paddingTop: () => 4,
    paddingBottom: () => 4
};
const styles = {
    pageTitle: {
        fontSize: 14,
        bold: true,
        color: "#0f172a"
    },
    metaLabel: {
        fontSize: 7,
        bold: true,
        color: "#64748b"
    },
    metaValue: {
        fontSize: 8,
        color: "#0f172a"
    },
    tableHeader: {
        fontSize: 7,
        bold: true,
        color: "#ffffff",
        fillColor: "#1e3a5f",
        alignment: "center"
    },
    tableCell: {
        fontSize: 7,
        color: "#0f172a"
    },
    tableCellCenter: {
        fontSize: 7,
        color: "#0f172a",
        alignment: "center"
    },
    tableCellRight: {
        fontSize: 7,
        color: "#0f172a",
        alignment: "right"
    },
    totalsLabel: {
        fontSize: 8,
        bold: true,
        color: "#0f172a",
        alignment: "right"
    },
    totalsValue: {
        fontSize: 8,
        bold: true,
        color: "#0f172a",
        alignment: "right"
    },
    footer: {
        fontSize: 6,
        color: "#64748b"
    }
};
const LABELS = {
    title: "Warehouse Pick Sheet",
    printedAt: "Printed At",
    packingListNo: "Packing List No.",
    orderRef: "Order No.",
    customer: "Customer",
    shipDate: "Ship Date",
    warehouse: "Warehouse",
    remarks: "Remarks",
    sequence: "SN",
    itemNumber: "Item #",
    sku: "SKU",
    description: "Item Description",
    section: "Section",
    containerNo: "Container No.",
    qty: "Pick Qty",
    pallets: "Pallets",
    palletsDetail: "Pallet Detail",
    unit: "UOM",
    internalNotes: "Internal Notes",
    total: "TOTAL",
    generatedBySystem: "System generated document",
    empty: "--",
    subject: "Warehouse Pick Sheet"
};
export function downloadOutboundPickSheetPdfFromDocument(document) {
    const pickSheetDocument = buildPickSheetDocument(document);
    const documentDefinition = buildPickSheetDefinition(pickSheetDocument);
    const tableLayouts = { [PICK_SHEET_LAYOUT_NAME]: PICK_SHEET_TABLE_LAYOUT };
    void pdfMake.createPdf(documentDefinition, tableLayouts, PDF_FONTS).download(pickSheetDocument.fileName);
}
export function buildPickSheetDocument(document) {
    const rows = document.lines.flatMap((line) => {
        if (line.pickAllocations.length === 0) {
            return [{
                    id: `${line.id}-fallback`,
                    itemNumber: line.itemNumber || "",
                    sku: line.sku,
                    description: line.description,
                    warehouse: line.locationName,
                    section: line.storageSection || "A",
                    containerNo: "",
                    quantity: line.quantity,
                    pallets: line.pallets || 0,
                    palletsDetailCtns: line.palletsDetailCtns || "",
                    unitLabel: line.unitLabel || "PCS",
                    lineNote: line.lineNote || ""
                }];
        }
        return line.pickAllocations.map((allocation) => ({
            id: `${line.id}-${allocation.id}`,
            itemNumber: allocation.itemNumber || line.itemNumber || "",
            sku: line.sku,
            description: line.description,
            warehouse: allocation.locationName,
            section: allocation.storageSection || "A",
            containerNo: allocation.containerNo || "",
            quantity: allocation.allocatedQty,
            pallets: line.pallets || 0,
            palletsDetailCtns: line.palletsDetailCtns || "",
            unitLabel: line.unitLabel || "PCS",
            lineNote: line.lineNote || ""
        }));
    });
    return {
        fileName: `warehouse-pick-sheet-${sanitizeFileName(document.packingListNo || `outbound-${document.id}`)}.pdf`,
        rows,
        packingListNo: document.packingListNo || `OUT-${document.id}`,
        orderRef: safeValue(document.orderRef),
        customerSummary: safeValue(document.customerName),
        shipDate: safeValue(document.outDate),
        warehouseSummary: joinUniqueValues(rows.map((row) => row.warehouse)),
        remarks: safeValue(document.documentNote),
        totalQty: rows.reduce((sum, row) => sum + row.quantity, 0)
    };
}
export function buildPickSheetDefinition(document) {
    const printedAt = formatTimestamp(new Date().toISOString(), true);
    const tableBody = [
        [
            headerCell(LABELS.sequence),
            headerCell(LABELS.itemNumber),
            headerCell(LABELS.sku),
            headerCell(LABELS.description),
            headerCell(LABELS.warehouse),
            headerCell(LABELS.section),
            headerCell(LABELS.containerNo),
            headerCell(LABELS.qty),
            headerCell(LABELS.pallets),
            headerCell(LABELS.palletsDetail),
            headerCell(LABELS.unit),
            headerCell(LABELS.internalNotes)
        ],
        ...document.rows.map((row, index) => ([
            bodyCell(String(index + 1), "tableCellCenter"),
            bodyCell(row.itemNumber || LABELS.empty, "tableCellCenter"),
            bodyCell(row.sku, "tableCellCenter"),
            bodyCell(row.description || LABELS.empty, "tableCell"),
            bodyCell(row.warehouse || LABELS.empty, "tableCell"),
            bodyCell(row.section || LABELS.empty, "tableCellCenter"),
            bodyCell(row.containerNo || LABELS.empty, "tableCellCenter"),
            bodyCell(formatInteger(row.quantity), "tableCellRight"),
            bodyCell(formatInteger(row.pallets), "tableCellRight"),
            bodyCell(row.palletsDetailCtns || LABELS.empty, "tableCell"),
            bodyCell(row.unitLabel || "PCS", "tableCellCenter"),
            bodyCell(row.lineNote || LABELS.empty, "tableCell")
        ]))
    ];
    const content = [
        {
            text: LABELS.title,
            style: "pageTitle",
            margin: [0, 0, 0, -1]
        },
        {
            margin: [0, 4, 0, 0],
            table: {
                widths: ["*", "*", "*", "*"],
                body: [
                    [
                        metaBlock(LABELS.packingListNo, document.packingListNo),
                        metaBlock(LABELS.orderRef, document.orderRef || LABELS.empty),
                        metaBlock(LABELS.customer, document.customerSummary || LABELS.empty),
                        metaBlock(LABELS.shipDate, formatDateLabel(document.shipDate))
                    ],
                    [
                        metaSpanBlock(LABELS.warehouse, document.warehouseSummary || LABELS.empty, 2),
                        {},
                        metaSpanBlock(LABELS.remarks, document.remarks || LABELS.empty, 2),
                        {}
                    ]
                ]
            },
            layout: "noBorders"
        },
        {
            margin: [0, 4, 0, 0],
            table: {
                headerRows: 1,
                dontBreakRows: true,
                widths: [20, 54, 52, "*", 84, 38, 74, 44, 44, 86, 38, 90],
                body: tableBody
            },
            layout: PICK_SHEET_LAYOUT_NAME
        },
        {
            margin: [0, 8, 0, 0],
            alignment: "right",
            table: {
                widths: [88, 56],
                body: [[
                        { text: LABELS.total, style: "totalsLabel", border: [false, false, false, false] },
                        { text: formatInteger(document.totalQty), style: "totalsValue", border: [false, false, false, false] }
                    ]]
            },
            layout: "noBorders"
        }
    ];
    return {
        pageSize: "A4",
        pageOrientation: "landscape",
        pageMargins: [16, 12, 16, 12],
        info: {
            title: `${LABELS.title} ${document.packingListNo}`,
            subject: LABELS.subject,
            author: "Speed Inventory Management"
        },
        defaultStyle: {
            font: CJK_FONT_NAME,
            fontSize: 8,
            color: "#0f172a"
        },
        styles,
        footer: (currentPage, pageCount) => ({
            margin: [20, 0, 20, 4],
            columns: [
                { text: LABELS.generatedBySystem, style: "footer" },
                { text: `${LABELS.printedAt}: ${printedAt}`, alignment: "center", style: "footer" },
                { text: `Page ${currentPage} / ${pageCount}`, alignment: "right", style: "footer" }
            ]
        }),
        content
    };
}
function headerCell(text) {
    return { text, style: "tableHeader", margin: [0, 1, 0, 1], noWrap: true };
}
function bodyCell(text, styleName) {
    return { text, style: styleName, margin: [0, 0, 0, 0] };
}
function metaBlock(label, value) {
    return {
        stack: [
            { text: label, style: "metaLabel" },
            { text: value, style: "metaValue", margin: [0, 1, 0, 0] }
        ],
        margin: [0, 0, 8, 2]
    };
}
function metaSpanBlock(label, value, colSpan) {
    return {
        colSpan,
        stack: [
            { text: label, style: "metaLabel" },
            { text: value, style: "metaValue", margin: [0, 1, 0, 0] }
        ],
        margin: [0, 0, 8, 2]
    };
}
function formatDateLabel(value) {
    return value ? formatTimestamp(value, false) : LABELS.empty;
}
function formatTimestamp(value, includeTime) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value || LABELS.empty;
    }
    return new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {})
    }).format(parsed);
}
function formatInteger(value) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}
function joinUniqueValues(values) {
    return Array.from(new Set(values.map((value) => safeValue(value)).filter(Boolean))).join(", ");
}
function safeValue(value) {
    return value?.trim() ?? "";
}
function sanitizeFileName(value) {
    return value.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "warehouse-pick-sheet";
}
