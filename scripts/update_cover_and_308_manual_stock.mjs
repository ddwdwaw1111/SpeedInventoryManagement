import { readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
import { unzipSync, zipSync, strFromU8, strToU8 } from '../frontend/node_modules/fflate/esm/browser.js';

const paths = {
  coverDownloads: 'C:/Users/zihao/Downloads/99_600_cover_check_accurate_2026-06-02.xlsx',
  coverExports: 'C:/Users/zihao/Desktop/Projects/SpeedInventoryManagement/exports/99_600_cover_check_accurate_2026-06-02.xlsx',
  inventory308: 'C:/Users/zihao/Downloads/308仓_05_29_仓库点货单.xlsx',
};

const manualRows = [
  { item: '51807', sku: '004586', ctnPerPallet: 200, pallets: 10, qty: 2000 },
  { item: '11803', sku: '004593', ctnPerPallet: 162, pallets: 3, qty: 486 },
  { item: '51803', sku: '004555', ctnPerPallet: 200, pallets: 26, qty: 5200 },
  { item: '51808', sku: '004579', ctnPerPallet: 190, pallets: 7, qty: 1330 },
  { item: '12408', sku: '011621', ctnPerPallet: 48, pallets: 2, qty: 96 },
];

const manualByItem = new Map(manualRows.map((row) => [row.item, row]));

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlDecode(value = '') {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#10;/g, '\n')
    .replace(/&#xA;/gi, '\n');
}

function attrs(tag) {
  const out = {};
  for (const m of String(tag).matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) {
    out[m[1]] = xmlDecode(m[2]);
  }
  return out;
}

function columnNumber(col) {
  let value = 0;
  for (const ch of col) value = value * 26 + ch.charCodeAt(0) - 64;
  return value;
}

function columnName(index) {
  let name = '';
  while (index > 0) {
    const mod = (index - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    index = Math.floor((index - mod) / 26);
  }
  return name;
}

function cellInfo(ref) {
  const m = String(ref).match(/^([A-Z]+)(\d+)$/);
  return { col: m[1], colNum: columnNumber(m[1]), row: Number(m[2]) };
}

function parseSharedStrings(xml) {
  const strings = [];
  for (const si of xml.matchAll(/<si[\s\S]*?<\/si>/g)) {
    const text = [...si[0].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((m) => xmlDecode(m[1]))
      .join('');
    strings.push(text);
  }
  return strings;
}

function getText(zip, path) {
  const data = zip[path];
  return data ? strFromU8(data) : '';
}

function putText(zip, path, text) {
  zip[path] = strToU8(text);
}

function getWorkbookInfo(zip) {
  const shared = parseSharedStrings(getText(zip, 'xl/sharedStrings.xml'));
  const workbookXml = getText(zip, 'xl/workbook.xml');
  const relsXml = getText(zip, 'xl/_rels/workbook.xml.rels');
  const relMap = new Map();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const a = attrs(m[0]);
    relMap.set(a.Id, a.Target);
  }
  const sheets = [];
  for (const m of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const a = attrs(m[0]);
    let target = relMap.get(a['r:id']) || '';
    if (target && !target.startsWith('xl/')) target = `xl/${target.replace(/^\//, '')}`;
    sheets.push({ name: a.name, id: a.sheetId, path: target });
  }
  return { shared, sheets };
}

function parseSheetRows(sheetXml, shared) {
  const rows = [];
  for (const rm of sheetXml.matchAll(/<row\b[^>]*(?:\/>|>[\s\S]*?<\/row>)/g)) {
    const rowXml = rm[0];
    const rowTag = rowXml.match(/^<row\b[^>]*>/)?.[0] || rowXml.match(/^<row\b[^>]*\/>/)?.[0] || '';
    const rowNumber = Number(attrs(rowTag).r || rows.length + 1);
    const cells = [];
    for (const cm of rowXml.matchAll(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g)) {
      const cellXml = cm[0];
      const tag = cellXml.match(/^<c\b[^>]*>/)?.[0] || cellXml.match(/^<c\b[^>]*\/>/)?.[0] || '';
      const a = attrs(tag);
      const ref = a.r;
      const type = a.t;
      const valueRaw = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(valueRaw)] ?? '';
      else if (type === 'inlineStr') {
        value = [...cellXml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
          .map((m) => xmlDecode(m[1]))
          .join('');
      } else if (valueRaw !== undefined) {
        value = xmlDecode(valueRaw);
      }
      const info = cellInfo(ref);
      cells.push({ ref, ...info, value });
    }
    rows.push({ row: rowNumber, cells });
  }
  return rows;
}

function rowObjects(sheetXml, shared) {
  return parseSheetRows(sheetXml, shared).map((row) => {
    const out = { row: row.row };
    for (const cell of row.cells) out[cell.col] = cell.value;
    return out;
  });
}

function cellXml(ref, value, options = {}) {
  if (options.formula) {
    const cached = value === undefined || value === null ? '' : `<v>${xmlEscape(value)}</v>`;
    return `<c r="${ref}"><f>${xmlEscape(options.formula)}</f>${cached}</c>`;
  }
  if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
  if (value === null || value === undefined || value === '') return `<c r="${ref}"/>`;
  return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
}

function rowXml(rowNumber, cells) {
  const body = cells.map((cell) => cellXml(cell.ref, cell.value, cell)).join('');
  return `<row r="${rowNumber}">${body}</row>`;
}

function updateDimension(sheetXml, ref) {
  if (/<dimension\b[^>]*\/>/.test(sheetXml)) {
    return sheetXml.replace(/<dimension\b[^>]*\/>/, `<dimension ref="${ref}"/>`);
  }
  return sheetXml.replace(/<worksheet\b[^>]*>/, (m) => `${m}<dimension ref="${ref}"/>`);
}

function setCell(sheetXml, ref, value, options = {}) {
  const info = cellInfo(ref);
  const replacement = cellXml(ref, value, options);
  const cellRe = new RegExp(`<c\\b(?=[^>]*\\br="${ref}")[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`);
  if (cellRe.test(sheetXml)) return sheetXml.replace(cellRe, replacement);

  const rowRe = new RegExp(`<row\\b(?=[^>]*\\br="${info.row}")[^>]*(?:\\/>|>[\\s\\S]*?<\\/row>)`);
  const rowMatch = sheetXml.match(rowRe);
  if (rowMatch) {
    const existing = rowMatch[0];
    const updated = existing.endsWith('/>')
      ? `<row r="${info.row}">${replacement}</row>`
      : existing.replace('</row>', `${replacement}</row>`);
    return sheetXml.replace(rowRe, updated);
  }

  const newRow = `<row r="${info.row}">${replacement}</row>`;
  const sheetDataClose = sheetXml.indexOf('</sheetData>');
  return `${sheetXml.slice(0, sheetDataClose)}${newRow}${sheetXml.slice(sheetDataClose)}`;
}

function number(value) {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function backup(path) {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  await copyFile(path, `${path}.bak_${stamp}`);
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function findSheet(info, name) {
  const sheet = info.sheets.find((s) => s.name === name);
  if (!sheet) throw new Error(`Missing sheet: ${name}`);
  return sheet;
}

async function updateCover(path) {
  if (!(await exists(path))) return null;
  await backup(path);
  const zip = unzipSync(new Uint8Array(await readFile(path)));
  const info = getWorkbookInfo(zip);
  const coverSheet = findSheet(info, 'cover检查');
  let xml = getText(zip, coverSheet.path);
  const rows = rowObjects(xml, info.shared);

  xml = setCell(xml, 'H1', '99+600+新增可用Qty');
  xml = setCell(xml, 'N1', '新增确认Qty');
  xml = setCell(xml, 'O1', '新增确认托数');
  xml = setCell(xml, 'P1', '每板ctn');
  xml = setCell(xml, 'Q1', '建议新增拿Qty');
  xml = setCell(xml, 'R1', '加新增后说明');

  for (const row of rows.slice(1)) {
    const item = String(row.A || '');
    const manual = manualByItem.get(item);
    if (!manual) continue;
    const need = number(row.C);
    const qty99 = number(row.D);
    const qty600 = number(row.F);
    const oldAvailable = qty99 + qty600;
    const updatedAvailable = oldAvailable + manual.qty;
    const shortAfter = Math.max(need - updatedAvailable, 0);
    const manualPick = Math.min(manual.qty, Math.max(need - oldAvailable, 0));
    const note = row.M ? `${row.M}; 已加入新增手工确认库存` : '已加入新增手工确认库存';
    const desc = `新增手工确认：${manual.pallets}板 x ${manual.ctnPerPallet}ctn = ${manual.qty}ctn`;

    xml = setCell(xml, `H${row.row}`, updatedAvailable);
    xml = setCell(xml, `I${row.row}`, shortAfter <= 0 ? '能cover' : '不能cover');
    xml = setCell(xml, `J${row.row}`, shortAfter);
    xml = setCell(xml, `M${row.row}`, note);
    xml = setCell(xml, `N${row.row}`, manual.qty);
    xml = setCell(xml, `O${row.row}`, manual.pallets);
    xml = setCell(xml, `P${row.row}`, manual.ctnPerPallet);
    xml = setCell(xml, `Q${row.row}`, manualPick);
    xml = setCell(xml, `R${row.row}`, desc);
  }

  xml = updateDimension(xml, 'A1:R40');
  putText(zip, coverSheet.path, xml);

  const updatedRows = rowObjects(xml, info.shared).slice(1).filter((row) => row.A);
  const stats = {
    needTotal: 0,
    coverRows: 0,
    notCoverRows: 0,
    shortTotal: 0,
    pick99Total: 0,
    pick600Total: 0,
    manualQtyTotal: 0,
    manualPickTotal: 0,
  };
  for (const row of updatedRows) {
    stats.needTotal += number(row.C);
    stats.shortTotal += number(row.J);
    stats.pick99Total += number(row.K);
    stats.pick600Total += number(row.L);
    stats.manualQtyTotal += number(row.N);
    stats.manualPickTotal += number(row.Q);
    if (row.I === '能cover') stats.coverRows++;
    else stats.notCoverRows++;
  }

  const summarySheet = info.sheets.find((s) => s.name === '汇总说明');
  if (summarySheet) {
    let sx = getText(zip, summarySheet.path);
    const summaryRows = rowObjects(sx, info.shared);
    const labelMap = new Map(summaryRows.map((row) => [row.A, row.row]));
    const updates = [
      ['能完全cover行数', stats.coverRows],
      ['不能完全cover行数', stats.notCoverRows],
      ['总需补Qty', stats.needTotal],
      ['建议99拿Qty合计', stats.pick99Total],
      ['建议600拿Qty合计', stats.pick600Total],
      ['补完仍缺Qty合计', stats.shortTotal],
    ];
    for (const [label, value] of updates) {
      const rowNum = labelMap.get(label);
      if (rowNum) sx = setCell(sx, `B${rowNum}`, value);
    }
    sx = setCell(sx, 'A11', '新增确认Qty合计');
    sx = setCell(sx, 'B11', stats.manualQtyTotal);
    sx = setCell(sx, 'A12', '建议新增拿Qty合计');
    sx = setCell(sx, 'B12', stats.manualPickTotal);
    sx = setCell(sx, 'A13', '更新说明');
    sx = setCell(sx, 'B13', 'H/I/J已按99+600原有库存加本次手工确认库存重算；N:R保留新增库存明细。');
    sx = updateDimension(sx, 'A1:B13');
    putText(zip, summarySheet.path, sx);
  }

  await writeFile(path, Buffer.from(zipSync(zip)));
  return stats;
}

function buildNormalizedSheet(items) {
  const rows = [];
  rows.push(rowXml(1, [
    { ref: 'A1', value: 'Item Code' },
    { ref: 'B1', value: 'Barcode' },
    { ref: 'C1', value: 'Boxes Per Pallet' },
    { ref: 'D1', value: 'Total Quantity' },
    { ref: 'E1', value: 'Total Pallets' },
  ]));
  items.forEach((item, index) => {
    const row = index + 2;
    rows.push(rowXml(row, [
      { ref: `A${row}`, value: item.item },
      { ref: `B${row}`, value: item.barcode },
      { ref: `C${row}`, value: item.ctnPerPallet },
      { ref: `D${row}`, value: item.qty },
      { ref: `E${row}`, value: item.pallets },
    ]));
  });
  return `<sheetData>${rows.join('')}</sheetData>`;
}

function buildDetailsSheet(items) {
  const leftCount = Math.ceil(items.length / 2);
  const left = items.slice(0, leftCount);
  const right = items.slice(leftCount);
  const dataRows = Math.max(left.length, right.length);
  const rows = [];
  rows.push(rowXml(1, [{ ref: 'A1', value: 'Inventory Details' }]));
  rows.push(rowXml(2, [
    { ref: 'A2', value: 'Item' },
    { ref: 'B2', value: 'BAR CODE' },
    { ref: 'C2', value: 'Boxes / Per Pallet' },
    { ref: 'D2', value: 'Total' },
    { ref: 'E2', value: 'Total Pallets' },
    { ref: 'F2', value: 'Item' },
    { ref: 'G2', value: 'BAR CODE' },
    { ref: 'H2', value: 'Boxes / Per Pallet' },
    { ref: 'I2', value: 'Total' },
    { ref: 'J2', value: 'Total Pallets' },
  ]));
  for (let i = 0; i < dataRows; i++) {
    const row = i + 3;
    const cells = [];
    if (left[i]) {
      cells.push(
        { ref: `A${row}`, value: left[i].item },
        { ref: `B${row}`, value: left[i].barcode },
        { ref: `C${row}`, value: left[i].ctnPerPallet },
        { ref: `D${row}`, value: left[i].qty },
        { ref: `E${row}`, value: left[i].pallets },
      );
    }
    if (right[i]) {
      cells.push(
        { ref: `F${row}`, value: right[i].item },
        { ref: `G${row}`, value: right[i].barcode },
        { ref: `H${row}`, value: right[i].ctnPerPallet },
        { ref: `I${row}`, value: right[i].qty },
        { ref: `J${row}`, value: right[i].pallets },
      );
    }
    rows.push(rowXml(row, cells));
  }
  const totalRow = dataRows + 4;
  const lastDataRow = dataRows + 2;
  const leftQty = left.reduce((sum, item) => sum + item.qty, 0);
  const leftPallets = left.reduce((sum, item) => sum + item.pallets, 0);
  const rightQty = right.reduce((sum, item) => sum + item.qty, 0);
  const rightPallets = right.reduce((sum, item) => sum + item.pallets, 0);
  rows.push(rowXml(totalRow, [
    { ref: `C${totalRow}`, value: 'Left Total:' },
    { ref: `D${totalRow}`, value: leftQty, formula: `SUM(D3:D${lastDataRow})` },
    { ref: `E${totalRow}`, value: leftPallets, formula: `SUM(E3:E${lastDataRow})` },
    { ref: `H${totalRow}`, value: 'Right Total:' },
    { ref: `I${totalRow}`, value: rightQty, formula: `SUM(I3:I${lastDataRow})` },
    { ref: `J${totalRow}`, value: rightPallets, formula: `SUM(J3:J${lastDataRow})` },
  ]));
  return {
    sheetData: `<sheetData>${rows.join('')}</sheetData>`,
    dimension: `A1:J${totalRow}`,
  };
}

function replaceSheetData(sheetXml, sheetData, dimension) {
  let out = sheetXml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, sheetData);
  out = updateDimension(out, dimension);
  return out;
}

async function updateInventory308(path) {
  await backup(path);
  const zip = unzipSync(new Uint8Array(await readFile(path)));
  const info = getWorkbookInfo(zip);
  const normSheet = findSheet(info, 'Normalized Data List');
  const detailsSheet = findSheet(info, 'Inventory Details');
  const normXml = getText(zip, normSheet.path);
  const existing = rowObjects(normXml, info.shared)
    .slice(1)
    .filter((row) => row.A)
    .map((row) => ({
      item: String(row.A),
      barcode: String(row.B || ''),
      ctnPerPallet: number(row.C),
      qty: number(row.D),
      pallets: number(row.E),
    }));

  const itemMap = new Map(existing.map((row) => [row.item, row]));
  for (const manual of manualRows) {
    itemMap.set(manual.item, {
      item: manual.item,
      barcode: manual.sku,
      ctnPerPallet: manual.ctnPerPallet,
      qty: manual.qty,
      pallets: manual.pallets,
    });
  }
  const finalItems = [...existing.filter((row) => !manualByItem.has(row.item)), ...manualRows.map((row) => ({
    item: row.item,
    barcode: row.sku,
    ctnPerPallet: row.ctnPerPallet,
    qty: row.qty,
    pallets: row.pallets,
  }))];

  const normalizedData = buildNormalizedSheet(finalItems);
  const newNormXml = replaceSheetData(normXml, normalizedData, `A1:E${finalItems.length + 1}`);
  putText(zip, normSheet.path, newNormXml);

  const detailsXml = getText(zip, detailsSheet.path);
  const detailsData = buildDetailsSheet(finalItems);
  const newDetailsXml = replaceSheetData(detailsXml, detailsData.sheetData, detailsData.dimension);
  putText(zip, detailsSheet.path, newDetailsXml);

  await writeFile(path, Buffer.from(zipSync(zip)));
}

await updateCover(paths.coverDownloads);
await updateCover(paths.coverExports);
await updateInventory308(paths.inventory308);

console.log('Updated cover workbooks and 308 inventory workbook.');
