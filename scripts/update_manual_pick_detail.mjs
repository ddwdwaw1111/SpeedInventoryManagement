import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { unzipSync, zipSync, strFromU8, strToU8 } from '../frontend/node_modules/fflate/esm/browser.js';

const path = 'C:/Users/zihao/Desktop/Projects/SpeedInventoryManagement/exports/99_600_cover_check_accurate_2026-06-02.xlsx';

const manualRows = [
  { item: '11803', sku: '004593', gap: 486, qty: 486, totalQty: 486, pallets: 3, detail: '3*162', note: '新增手工确认库存' },
  { item: '12408', sku: '011621', gap: 192, qty: 96, totalQty: 96, pallets: 2, detail: '2*48', note: '新增手工确认库存；另有600 Ridge 96ctn' },
  { item: '51803', sku: '004555', gap: 5400, qty: 5200, totalQty: 5200, pallets: 26, detail: '26*200', note: '新增手工确认库存；另有99 Caven 200ctn' },
  { item: '51807', sku: '004586', gap: 2200, qty: 2000, totalQty: 2000, pallets: 10, detail: '10*200', note: '新增后仍缺200ctn' },
  { item: '51808', sku: '004579', gap: 1330, qty: 1330, totalQty: 1330, pallets: 7, detail: '7*190', note: '新增手工确认库存' },
];

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
  for (const m of String(tag).matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) out[m[1]] = xmlDecode(m[2]);
  return out;
}

function parseSharedStrings(xml) {
  const strings = [];
  for (const si of xml.matchAll(/<si[\s\S]*?<\/si>/g)) {
    strings.push([...si[0].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => xmlDecode(m[1])).join(''));
  }
  return strings;
}

function getText(zip, name) {
  const data = zip[name];
  return data ? strFromU8(data) : '';
}

function putText(zip, name, text) {
  zip[name] = strToU8(text);
}

function workbookInfo(zip) {
  const shared = parseSharedStrings(getText(zip, 'xl/sharedStrings.xml'));
  const wb = getText(zip, 'xl/workbook.xml');
  const rels = getText(zip, 'xl/_rels/workbook.xml.rels');
  const relMap = new Map();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const a = attrs(m[0]);
    relMap.set(a.Id, a.Target);
  }
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const a = attrs(m[0]);
    let target = relMap.get(a['r:id']) || '';
    if (target && !target.startsWith('xl/')) target = `xl/${target.replace(/^\//, '')}`;
    sheets.push({ name: a.name, path: target });
  }
  return { shared, sheets };
}

function cellXml(ref, value) {
  if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
}

function rowXml(r, values) {
  const cols = 'ABCDEFGHIJKL'.split('');
  const cells = values.map((value, i) => cellXml(`${cols[i]}${r}`, value)).join('');
  return `<row r="${r}">${cells}</row>`;
}

function updateDimension(xml, ref) {
  if (/<dimension\b[^>]*\/>/.test(xml)) return xml.replace(/<dimension\b[^>]*\/>/, `<dimension ref="${ref}"/>`);
  return xml.replace(/<worksheet\b[^>]*>/, (m) => `${m}<dimension ref="${ref}"/>`);
}

await copyFile(path, `${path}.bak_pick_${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}`);
const zip = unzipSync(new Uint8Array(await readFile(path)));
const info = workbookInfo(zip);
const sheet = info.sheets.find((s) => s.name === '建议拿货明细');
if (!sheet) throw new Error('Missing 建议拿货明细 sheet');

let xml = getText(zip, sheet.path);
const existingRowNumbers = [...xml.matchAll(/<row\b[^>]*\br="(\d+)"/g)].map((m) => Number(m[1]));
let nextRow = Math.max(...existingRowNumbers) + 1;

const rowsToAppend = manualRows.map((row) => rowXml(nextRow++, [
  '新增手工确认',
  row.item,
  row.sku,
  row.gap,
  '手工确认',
  '',
  row.qty,
  row.totalQty,
  row.pallets,
  row.detail,
  '',
  row.note,
])).join('');

xml = xml.replace('</sheetData>', `${rowsToAppend}</sheetData>`);
xml = updateDimension(xml, `A1:L${nextRow - 1}`);
putText(zip, sheet.path, xml);

await writeFile(path, Buffer.from(zipSync(zip)));
console.log('Updated manual pick detail rows.');
