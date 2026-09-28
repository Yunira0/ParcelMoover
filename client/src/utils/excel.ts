import * as XLSX from 'xlsx';
import type { DataValidation } from 'exceljs';

export type CellValue = string | number | null | undefined;

// Downloads an .xlsx workbook with a single sheet built from a header row plus
// data rows (array-of-arrays). Numbers are kept as numeric cells so Excel can
// sum/sort them; null/undefined become blank. Column widths auto-fit content.
// Matches the SheetJS pattern already used for the import templates.
export function downloadExcel(
  filename: string,
  sheetName: string,
  headers: string[],
  rows: CellValue[][],
): void {
  const aoa: CellValue[][] = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  ws['!cols'] = headers.map((header, col) => {
    const bodyMax = rows.reduce((max, row) => Math.max(max, String(row[col] ?? '').length), 0);
    return { wch: Math.min(Math.max(header.length, bodyMax) + 2, 40) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31)); // Excel caps sheet names at 31 chars
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

const TEMPLATE_DROPDOWN_ROWS = 1000;

// exceljs supports range-level validations but leaves them out of its typings.
interface RangeValidations {
  dataValidations: { add(range: string, validation: DataValidation): void };
}

// Like downloadExcel, but each `dropdowns` entry (keyed by header) becomes an
// in-cell dropdown for that column. Uses exceljs, loaded on demand, because
// SheetJS community can't write data validation. Options live on a hidden
// sheet since inline list validations cap at 255 chars.
export async function downloadExcelTemplate(
  filename: string,
  sheetName: string,
  headers: string[],
  rows: CellValue[][],
  dropdowns: Record<string, string[]>,
): Promise<void> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  ws.addRow(headers);
  rows.forEach(row => ws.addRow(row.map(v => v ?? null)));
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((column, col) => {
    const bodyMax = rows.reduce((max, row) => Math.max(max, String(row[col] ?? '').length), 0);
    column.width = Math.min(Math.max(headers[col].length, bodyMax) + 2, 40);
  });

  const lists = wb.addWorksheet('Lists', { state: 'veryHidden' });
  let listCol = 0;
  for (const [header, options] of Object.entries(dropdowns)) {
    const col = headers.indexOf(header);
    if (col < 0 || options.length === 0) continue;
    listCol += 1;
    options.forEach((option, i) => { lists.getCell(i + 1, listCol).value = option; });
    const letter = lists.getColumn(listCol).letter;
    const target = ws.getColumn(col + 1).letter;
    // Range-level add: per-cell assignment makes exceljs emit overlapping
    // ranges, which Excel flags as needing repair.
    (ws as unknown as RangeValidations).dataValidations.add(`${target}2:${target}${TEMPLATE_DROPDOWN_ROWS + 1}`, {
      type: 'list',
      allowBlank: true,
      formulae: [`Lists!$${letter}$1:$${letter}$${options.length}`],
      showErrorMessage: true,
      errorTitle: 'Invalid value',
      error: `Pick a ${header} from the dropdown.`,
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
