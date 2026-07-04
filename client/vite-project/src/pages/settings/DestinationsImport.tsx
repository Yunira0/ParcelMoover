import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { CheckCircle2, Download, Upload, XCircle } from 'lucide-react';
import Button from '../../components/Button';
import {
  bulkImportLocations,
  type BulkImportDestinationInput,
  type BulkImportResult,
} from '../../services/locations.service';
import './DestinationsImport.css';

// ── Column definitions ────────────────────────────────────────────────────────

const COLUMNS = [
  'destination_name',
  'destination_code',
  'city',
  'district',
  'area_name',
  'zone',
  'valley',
  'per_destination_rate',
] as const;

const ZONE_VALUES = ['major_cities', 'urban_areas', 'remote_areas'];
const VALLEY_VALUES = ['inside', 'outside'];

const SAMPLE_ROWS = [
  ['Kathmandu', 'KTM', 'Kathmandu', 'Bagmati', 'Thamel', 'major_cities', 'inside', '100'],
  ['Kathmandu', '', '', '', 'Baneshwor', '', '', ''],
  ['Kathmandu', '', '', '', 'New Road', '', '', ''],
  ['Pokhara', 'PKR', 'Pokhara', 'Kaski', 'Lakeside', 'urban_areas', 'outside', '150'],
  ['Pokhara', '', '', '', 'Prithvi Chowk', '', '', ''],
  ['Butwal', 'BTW', 'Butwal', 'Rupandehi', 'Devinagar', 'remote_areas', 'outside', '200'],
];

// ── Template download ─────────────────────────────────────────────────────────

function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const data = [COLUMNS as unknown as string[], ...SAMPLE_ROWS];
  const ws = XLSX.utils.aoa_to_sheet(data);

  // Set column widths
  ws['!cols'] = [
    { wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 16 },
    { wch: 20 }, { wch: 18 }, { wch: 12 }, { wch: 22 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Destinations');

  // Add a Notes sheet
  const notes = XLSX.utils.aoa_to_sheet([
    ['Column', 'Required', 'Allowed values / Notes'],
    ['destination_name', 'YES', 'Name of the hub/branch. Repeated rows for the same destination add more areas.'],
    ['destination_code', 'no', 'Short code, e.g. KTM. Only needed on the first row for a destination.'],
    ['city', 'no', 'City of the destination.'],
    ['district', 'no', 'District of the destination.'],
    ['area_name', 'no', 'Covered area for this destination. Leave blank to add no area on this row.'],
    ['zone', 'no', `Pricing zone: ${ZONE_VALUES.join(' | ')}. Set on first row of destination.`],
    ['valley', 'no', `Valley side: ${VALLEY_VALUES.join(' | ')}. Set on first row of destination.`],
    ['per_destination_rate', 'no', 'Delivery rate in NPR. Numeric only.'],
  ]);
  notes['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 65 }];
  XLSX.utils.book_append_sheet(wb, notes, 'Notes');

  XLSX.writeFile(wb, 'destinations_template.xlsx');
}

// ── Parser ────────────────────────────────────────────────────────────────────

interface ParsedRow {
  destinationName: string;
  destinationCode: string;
  city: string;
  district: string;
  areaName: string;
  zone: string;
  valley: string;
  perDestinationRate: string;
  _rowIndex: number;
  _error?: string;
}

function parseSheet(raw: string[][]): ParsedRow[] {
  if (raw.length === 0) return [];

  // Detect header row
  const firstRow = raw[0].map((c) => String(c ?? '').toLowerCase().replace(/[\s-]+/g, '_'));
  const isHeader =
    firstRow.includes('destination_name') || firstRow.some((h) => h.includes('destination'));
  const dataRows = isHeader ? raw.slice(1) : raw;

  return dataRows
    .map((cols, i): ParsedRow => {
      const get = (idx: number) => String(cols[idx] ?? '').trim();
      const errors: string[] = [];
      const destName = get(0);
      if (!destName) errors.push('destination_name is required');

      const zone = get(5);
      if (zone && !ZONE_VALUES.includes(zone)) {
        errors.push(`zone must be one of: ${ZONE_VALUES.join(', ')}`);
      }
      const valley = get(6);
      if (valley && !VALLEY_VALUES.includes(valley)) {
        errors.push(`valley must be one of: ${VALLEY_VALUES.join(', ')}`);
      }
      const rateStr = get(7);
      if (rateStr && isNaN(Number(rateStr))) {
        errors.push('per_destination_rate must be a number');
      }

      return {
        destinationName: destName,
        destinationCode: get(1),
        city: get(2),
        district: get(3),
        areaName: get(4),
        zone,
        valley,
        perDestinationRate: rateStr,
        _rowIndex: i + (isHeader ? 2 : 1),
        _error: errors.length ? errors.join('; ') : undefined,
      };
    })
    .filter((r) => r.destinationName || r._error);
}

function groupRows(rows: ParsedRow[]): BulkImportDestinationInput[] {
  const map = new Map<string, BulkImportDestinationInput>();

  for (const row of rows) {
    if (row._error) continue;
    const key = row.destinationName.toLowerCase();

    if (!map.has(key)) {
      map.set(key, {
        name: row.destinationName,
        code: row.destinationCode || undefined,
        city: row.city || undefined,
        district: row.district || undefined,
        zone: row.zone || undefined,
        valley: row.valley || undefined,
        perDestinationRate: row.perDestinationRate ? Number(row.perDestinationRate) : undefined,
        areas: [],
      });
    }

    if (row.areaName) {
      map.get(key)!.areas.push(row.areaName);
    }
  }

  return Array.from(map.values());
}

// ── Component ─────────────────────────────────────────────────────────────────

const DestinationsImport: React.FC = () => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<BulkImportResult[] | null>(null);

  const validRows = parsedRows.filter((r) => !r._error);
  const invalidRows = parsedRows.filter((r) => r._error);
  const grouped = groupRows(validRows);

  const handleFile = (file: File) => {
    setFileName(file.name);
    setError('');
    setResults(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        setParsedRows(parseSheet(raw));
      } catch {
        setError('Could not read file. Make sure it is a valid .xlsx or .csv file.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleSubmit = async () => {
    if (grouped.length === 0) { setError('No valid destinations to import.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const res = await bulkImportLocations(grouped);
      setResults(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Import failed.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Result screen ──────────────────────────────────────────────────────────
  if (results) {
    const created = results.filter((r) => r.action === 'created' && !r.error).length;
    const updated = results.filter((r) => r.action === 'updated' && !r.error).length;
    const errored = results.filter((r) => r.error).length;
    const totalAreasCreated = results.reduce((s, r) => s + r.areasCreated.length, 0);

    return (
      <div className="di-result">
        <div className="di-result-counts">
          <div className="di-stat di-stat--success">
            <CheckCircle2 size={26} />
            <span className="di-stat-num">{created}</span>
            <span className="di-stat-label">Destinations created</span>
          </div>
          <div className="di-stat di-stat--info">
            <CheckCircle2 size={26} />
            <span className="di-stat-num">{updated}</span>
            <span className="di-stat-label">Destinations updated</span>
          </div>
          <div className="di-stat di-stat--success">
            <CheckCircle2 size={26} />
            <span className="di-stat-num">{totalAreasCreated}</span>
            <span className="di-stat-label">Areas added</span>
          </div>
          {errored > 0 && (
            <div className="di-stat di-stat--fail">
              <XCircle size={26} />
              <span className="di-stat-num">{errored}</span>
              <span className="di-stat-label">Errors</span>
            </div>
          )}
        </div>

        <div className="di-result-table-wrap">
          <table className="di-result-table">
            <thead>
              <tr><th>Destination</th><th>Action</th><th>Areas added</th><th>Areas skipped</th><th>Error</th></tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} className={r.error ? 'di-row--error' : ''}>
                  <td>{r.destination}</td>
                  <td>{r.error ? '—' : r.action}</td>
                  <td>{r.areasCreated.join(', ') || '—'}</td>
                  <td className="di-muted">{r.areasSkipped.join(', ') || '—'}</td>
                  <td className="di-error-msg">{r.error || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="di-result-actions">
          <Button variant="secondary" onClick={() => { setResults(null); setParsedRows([]); setFileName(''); }}>
            Import Another File
          </Button>
        </div>
      </div>
    );
  }

  // ── Main screen ────────────────────────────────────────────────────────────
  return (
    <div className="di-container">
      <div className="di-head">
        <div>
          <h2>Import Destinations &amp; Rates</h2>
          <p>Upload an Excel or CSV file to bulk-create destinations, their covered areas, and delivery rates.</p>
        </div>
        <Button variant="outline" onClick={downloadTemplate}>
          <Download size={15} /> Download Template
        </Button>
      </div>

      <div
        className={`di-dropzone${fileName ? ' di-dropzone--loaded' : ''}`}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') fileRef.current?.click(); }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFileInput}
          className="di-file-input"
          aria-hidden="true"
        />
        <Upload size={28} className="di-dropzone-icon" />
        {fileName ? (
          <span className="di-dropzone-filename">{fileName}</span>
        ) : (
          <>
            <span className="di-dropzone-primary">Drop file here or click to browse</span>
            <span className="di-dropzone-hint">Accepts .xlsx, .xls, .csv</span>
          </>
        )}
      </div>

      {parsedRows.length > 0 && (
        <div className="di-preview-section">
          <div className="di-preview-head">
            <div>
              <h3>Preview</h3>
              <p>
                {parsedRows.length} row(s) — {validRows.length} valid, {invalidRows.length} with errors,
                {' '}{grouped.length} unique destination(s)
              </p>
            </div>
            {invalidRows.length > 0 && (
              <span className="di-badge di-badge--warn">{invalidRows.length} row(s) will be skipped</span>
            )}
          </div>

          <div className="di-preview-wrap">
            <table className="di-preview-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Destination</th>
                  <th>Code</th>
                  <th>Area</th>
                  <th>Zone</th>
                  <th>Valley</th>
                  <th>Rate</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.map((row, i) => (
                  <tr key={i} className={row._error ? 'di-row--error' : 'di-row--ok'}>
                    <td className="di-cell-num">{row._rowIndex}</td>
                    <td>{row.destinationName || <span className="di-empty">—</span>}</td>
                    <td>{row.destinationCode || <span className="di-empty">—</span>}</td>
                    <td>{row.areaName || <span className="di-empty">—</span>}</td>
                    <td>{row.zone || <span className="di-empty">—</span>}</td>
                    <td>{row.valley || <span className="di-empty">—</span>}</td>
                    <td>{row.perDestinationRate || <span className="di-empty">—</span>}</td>
                    <td>
                      {row._error ? (
                        <span className="di-status di-status--error" title={row._error}>
                          <XCircle size={13} /> Error
                        </span>
                      ) : (
                        <span className="di-status di-status--ok">
                          <CheckCircle2 size={13} /> Ready
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && <p role="alert" className="di-error">{error}</p>}

      <div className="di-actions">
        <Button
          variant="primary"
          disabled={submitting || grouped.length === 0}
          onClick={handleSubmit}
        >
          {submitting
            ? 'Importing…'
            : `Import ${grouped.length} Destination${grouped.length !== 1 ? 's' : ''}`}
        </Button>
      </div>
    </div>
  );
};

export default DestinationsImport;
