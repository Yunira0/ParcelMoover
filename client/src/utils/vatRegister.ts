import type { RegisterAmounts, RegisterKind, RegisterRow, VatRegister } from '../services/vatRegister.service';
import { BS_MONTHS } from './nepaliDate';
import { downloadExcel } from './excel';

// The four IRD VAT registers (Rule 23(1)(h)), in English. One layout drives both
// the screen table and the Excel file, so the two always carry the same columns.

export interface RegisterColumn {
  /** Second header row (the column's own label). */
  label: string;
  /** First header row, shared by neighbouring columns. Omitted = spans both rows. */
  group?: string;
  /** Shorter label for the screen table. */
  screenLabel?: string;
  /** Excel column width, in characters. */
  width: number;
  value: (row: RegisterRow) => string | number | null;
  money?: boolean;
  /** Always blank for this business (exports, quantities), so left off the screen. */
  excelOnly?: boolean;
}

export interface RegisterLayout {
  title: string;
  /** Excel header row heights: [group row, label row]. */
  headerHeights: [number, number];
  columns: RegisterColumn[];
}

const blank = () => null;
const money = (label: string, value: RegisterColumn['value'], group?: string, screenLabel?: string): RegisterColumn => ({
  label, group, screenLabel, value, width: 14, money: true,
});

const date: RegisterColumn = { label: 'Date', width: 10.33, value: (r) => r.date };
const invoiceNo: RegisterColumn = { label: 'Invoice No.', width: 18, value: (r) => r.invoiceNo };
const customsNo: RegisterColumn = { label: 'Customs Declaration No.', screenLabel: 'Customs Decl. No.', width: 12, value: (r) => r.customsNo };
const buyer: RegisterColumn = { label: "Buyer's Name", width: 36, value: (r) => r.partyName };
const buyerPan: RegisterColumn = { label: "Buyer's PAN", width: 11.89, value: (r) => r.partyPan };
const supplier: RegisterColumn = { label: "Supplier's Name", width: 30, value: (r) => r.partyName };
const supplierPan: RegisterColumn = { label: "Supplier's PAN", width: 11.89, value: (r) => r.partyPan };
const withGroup = (group: string, cols: RegisterColumn[]) => cols.map((c) => ({ ...c, group }));

export const REGISTER_LAYOUTS: Record<RegisterKind, RegisterLayout> = {
  sales: {
    title: 'Sales Register',
    headerHeights: [15.75, 42],
    columns: [
      ...withGroup('Invoice', [date, invoiceNo, buyer, buyerPan]),
      money('Total Sales / Export (Rs.)', (r) => r.total, undefined, 'Total sales'),
      money('Tax-exempt Sales Value (Rs.)', (r) => r.exempt, undefined, 'Tax-exempt'),
      money('Value (Rs.)', (r) => r.taxable, 'Taxable Sales', 'Taxable value'),
      money('Tax (Rs.)', (r) => r.vat, 'Taxable Sales', 'VAT 13%'),
      { label: 'Value of Goods or Services Exported (Rs.)', group: 'Export', width: 12, value: blank, money: true, excelOnly: true },
      { label: 'Export Country', group: 'Export', width: 9, value: blank, excelOnly: true },
      { label: 'Export Declaration No.', group: 'Export', width: 10, value: blank, excelOnly: true },
      { label: 'Export Declaration Date', group: 'Export', width: 10, value: blank, excelOnly: true },
    ],
  },
  'sales-return': {
    title: 'Sales Return Register',
    headerHeights: [14.4, 32.4],
    columns: [
      ...withGroup('Invoice', [
        date,
        invoiceNo,
        buyer,
        buyerPan,
        { label: 'Name of Goods or Services', screenLabel: 'Goods / service', width: 18, value: (r) => r.description },
        { label: 'Quantity of Goods or Services', width: 9, value: blank, excelOnly: true },
        { label: 'Unit of Goods or Services', width: 9, value: blank, excelOnly: true },
      ]),
      money('Total Return (Rs.)', (r) => r.total, undefined, 'Total return'),
      money('Tax-exempt Return Value (Rs.)', (r) => r.exempt, undefined, 'Tax-exempt'),
      money('Value (Rs.)', (r) => r.taxable, 'Taxable Return', 'Taxable value'),
      money('Tax (Rs.)', (r) => r.vat, 'Taxable Return', 'VAT 13%'),
    ],
  },
  purchase: {
    title: 'Purchase Register',
    headerHeights: [35.25, 37.5],
    columns: [
      ...withGroup('Invoice / Customs Declaration No.', [date, invoiceNo, customsNo, supplier, supplierPan]),
      money('Total Purchase Value (Rs.)', (r) => r.total, undefined, 'Total purchase'),
      money('Purchase / Import Value of Tax-exempt Goods or Services (Rs.)', (r) => r.exempt, undefined, 'Tax-exempt'),
      money('Value (Rs.)', (r) => r.taxable, 'Taxable Purchase (excl. Capital)', 'Taxable value'),
      money('Tax (Rs.)', (r) => r.vat, 'Taxable Purchase (excl. Capital)', 'VAT 13%'),
      money('Value (Rs.)', (r) => r.importTaxable, 'Taxable Import (excl. Capital)', 'Import value'),
      money('Tax (Rs.)', (r) => r.importVat, 'Taxable Import (excl. Capital)', 'Import VAT'),
      money('Value (Rs.)', (r) => r.capitalTaxable, 'Capital Taxable Purchase / Import', 'Capital value'),
      money('Tax (Rs.)', (r) => r.capitalVat, 'Capital Taxable Purchase / Import', 'Capital VAT'),
    ],
  },
  'purchase-return': {
    title: 'Purchase Return Register',
    headerHeights: [38.05, 42.9],
    columns: [
      ...withGroup('Invoice / Customs Declaration No.', [
        date,
        invoiceNo,
        customsNo,
        supplier,
        supplierPan,
        { label: 'Description of Goods or Services Returned', screenLabel: 'Description', width: 18, value: (r) => r.description },
        { label: 'Quantity of Goods or Services Returned', width: 9, value: blank, excelOnly: true },
        { label: 'Unit of Goods or Services', width: 9, value: blank, excelOnly: true },
      ]),
      money('Total Return Value (Rs.)', (r) => r.total, undefined, 'Total return'),
      money('Return Value of Tax-exempt Goods or Services (Rs.)', (r) => r.exempt, undefined, 'Tax-exempt'),
      money('Value (Rs.)', (r) => r.taxable, 'Taxable Return (excl. Capital)', 'Taxable value'),
      money('Tax (Rs.)', (r) => r.vat, 'Taxable Return (excl. Capital)', 'VAT 13%'),
      money('Value (Rs.)', (r) => r.importTaxable, 'Taxable Import Return (excl. Capital)', 'Import value'),
      money('Tax (Rs.)', (r) => r.importVat, 'Taxable Import Return (excl. Capital)', 'Import VAT'),
      money('Value (Rs.)', (r) => r.capitalTaxable, 'Capital Taxable Purchase / Import Return', 'Capital value'),
      money('Tax (Rs.)', (r) => r.capitalVat, 'Capital Taxable Purchase / Import Return', 'Capital VAT'),
    ],
  },
};

const ACCOUNTING_FORMAT = '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)';
const THIN = { style: 'thin' as const, color: { argb: 'FF000000' } };
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };

/** Builds the register as the IRD sheet: title, rule, taxpayer line, two header rows, then entries. */
export async function buildVatRegisterWorkbook(register: VatRegister) {
  const { default: ExcelJS } = await import('exceljs');
  const layout = REGISTER_LAYOUTS[register.kind];
  const cols = layout.columns;
  const last = cols.length;
  const { year, month } = register.period;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(layout.title, {
    pageSetup: { paperSize: 9, orientation: 'landscape', scale: 90 },
  });
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  const fullRow = (rowNo: number, text: string, font: object, height?: number) => {
    ws.mergeCells(rowNo, 1, rowNo, last);
    const cell = ws.getCell(rowNo, 1);
    cell.value = text;
    cell.font = { name: 'Calibri', ...font };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    for (let c = 1; c <= last; c++) ws.getCell(rowNo, c).border = BOX;
    if (height) ws.getRow(rowNo).height = height;
  };

  fullRow(1, layout.title, { bold: true, size: 20 }, 25.8);
  fullRow(2, '(Related to Rule 23, Sub-rule (1), Clause (h))', { size: 11 });
  fullRow(3, '', { size: 11 });
  fullRow(
    4,
    `Taxpayer PAN: ${register.taxpayer.pan || '..................'}        Taxpayer Name: ${register.taxpayer.name || '..................'}         Year: ${year}      Tax Period: ${String(month).padStart(2, '0')}`,
    { bold: true, size: 11 },
    15.75,
  );

  // Header rows 5-6: a group label spans its columns on row 5; a column with no
  // group spans both rows.
  const headerCell = (row: number, col: number, text: string, groupStyle: boolean) => {
    const cell = ws.getCell(row, col);
    cell.value = text;
    cell.font = { name: 'Calibri', size: groupStyle ? 10 : 8, bold: groupStyle };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  };
  for (let i = 0; i < cols.length; ) {
    const group = cols[i].group;
    if (!group) {
      ws.mergeCells(5, i + 1, 6, i + 1);
      headerCell(5, i + 1, cols[i].label, false);
      i++;
      continue;
    }
    let end = i;
    while (end + 1 < cols.length && cols[end + 1].group === group) end++;
    if (end > i) ws.mergeCells(5, i + 1, 5, end + 1);
    headerCell(5, i + 1, group, true);
    for (let c = i; c <= end; c++) headerCell(6, c + 1, cols[c].label, false);
    i = end + 1;
  }
  for (let c = 1; c <= last; c++) {
    ws.getCell(5, c).border = BOX;
    ws.getCell(6, c).border = BOX;
  }
  ws.getRow(5).height = layout.headerHeights[0];
  ws.getRow(6).height = layout.headerHeights[1];

  for (const entry of register.rows) {
    const row = ws.addRow(cols.map((c) => c.value(entry)));
    cols.forEach((c, i) => {
      if (c.money) {
        const cell = row.getCell(i + 1);
        cell.numFmt = ACCOUNTING_FORMAT;
        cell.font = { name: 'Calibri', size: 11 };
      }
    });
  }

  return wb;
}

/** `forName` (a vendor) is added to the file name when the register is filtered to one. */
export async function downloadVatRegister(register: VatRegister, forName?: string): Promise<void> {
  const layout = REGISTER_LAYOUTS[register.kind];
  const { year, month } = register.period;
  const buffer = await (await buildVatRegisterWorkbook(register)).xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${layout.title}${forName ? ` - ${forName}` : ''} - ${BS_MONTHS[month - 1]} ${year}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Per-vendor views of the sales registers, worked out from the month's rows.

const AMOUNT_KEYS: (keyof RegisterAmounts)[] = [
  'total', 'exempt', 'taxable', 'vat', 'importTaxable', 'importVat', 'capitalTaxable', 'capitalVat',
];
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Totals of a set of rows, e.g. one vendor's statements. */
export function registerTotals(rows: RegisterRow[]): RegisterAmounts {
  return Object.fromEntries(
    AMOUNT_KEYS.map((key) => [key, round2(rows.reduce((sum, row) => sum + row[key], 0))]),
  ) as unknown as RegisterAmounts;
}

export interface VendorSummaryRow {
  id: string;
  name: string;
  pan: string | null;
  statements: number;
  total: number;
  taxable: number;
  vat: number;
}

/** One line per vendor: how many statements they had in the period and their totals. */
export function vendorSummary(rows: RegisterRow[]): VendorSummaryRow[] {
  const byVendor = new Map<string, VendorSummaryRow>();
  for (const row of rows) {
    const id = row.partyId ?? row.partyName;
    const line = byVendor.get(id) ?? { id, name: row.partyName, pan: row.partyPan, statements: 0, total: 0, taxable: 0, vat: 0 };
    line.statements += 1;
    line.total = round2(line.total + row.total);
    line.taxable = round2(line.taxable + row.taxable);
    line.vat = round2(line.vat + row.vat);
    byVendor.set(id, line);
  }
  return [...byVendor.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function downloadVendorSummary(register: VatRegister, summary: VendorSummaryRow[]): Promise<void> {
  const { title } = REGISTER_LAYOUTS[register.kind];
  const { year, month } = register.period;
  const { total, taxable, vat } = register.totals;
  const statements = summary.reduce((sum, line) => sum + line.statements, 0);
  return downloadExcel(
    `${title} by vendor - ${BS_MONTHS[month - 1]} ${year}.xlsx`,
    'By vendor',
    ['Vendor', 'PAN', 'Statements', 'Total (Rs.)', 'Taxable value (Rs.)', 'VAT (Rs.)'],
    [
      ...summary.map((line) => [line.name, line.pan ?? '', line.statements, line.total, line.taxable, line.vat]),
      ['Total', '', statements, total, taxable, vat],
    ],
  );
}
