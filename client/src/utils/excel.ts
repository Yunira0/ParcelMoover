export type CellValue = string | number | null | undefined;

// Downloads an .xlsx workbook with a single sheet built from a header row plus
// data rows (array-of-arrays). Numbers are kept as numeric cells so Excel can
// sum/sort them; null/undefined become blank. Column widths auto-fit content.
// Matches the SheetJS pattern already used for the import templates.
export async function downloadExcel(
  filename: string,
  sheetName: string,
  headers: string[],
  rows: CellValue[][],
): Promise<void> {
  try {
    // The workbook engine is large and is only needed after an export click.
    // Keep it out of the route's initial download, including the Orders page.
    const XLSX = await import('xlsx');
    writeWorkbook(XLSX, filename, sheetName, headers, rows);
  } catch (error) {
    console.error('Spreadsheet download failed:', error);
    window.alert('Could not download the spreadsheet. Check your connection and try again.');
  }
}

function writeWorkbook(
  XLSX: typeof import('xlsx'),
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
