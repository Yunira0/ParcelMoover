import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { CheckCircle2, Download, Upload, XCircle } from 'lucide-react';
import Button from '../components/Button';
import {
  bulkImportDeliveryRates,
  type BulkImportRateResult,
  type BulkImportRateRow,
} from '../services/deliveryRates.service';
import './settings/DestinationsImport.css';

// ── Column definitions ────────────────────────────────────────────────────────

const COLUMNS = [
  'origin',
  'destination',
  'base_charge',
  'extra_weight_percent',
  'free_weight_kg',
] as const;

const SAMPLE_ROWS = [
  ['Kathmandu', 'Pokhara', '150', '10', '2'],
  ['Kathmandu', 'Butwal', '200', '10', '2'],
  ['Pokhara', 'Kathmandu', '150', '', ''],
  ['Butwal', 'Kathmandu', '200', '15', '3'],
];

// ── Template download ─────────────────────────────────────────────────────────

function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const data = [COLUMNS as unknown as string[], ...SAMPLE_ROWS];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 22 }, { wch: 22 }, { wch: 14 }, { wch: 20 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Delivery Rates');

  const notes = XLSX.utils.aoa_to_sheet([
    ['Column', 'Required', 'Allowed values / Notes'],
    ['origin', 'YES', 'Destination name (or code) exactly as it appears in Settings > Destinations.'],
    ['destination', 'YES', 'Destination name (or code). Must differ from origin.'],
    ['base_charge', 'YES', 'Delivery charge in NPR for the route. Numeric, covers the free weight.'],
    ['extra_weight_percent', 'no', 'Surcharge per extra kg as % of base charge (0-100). Defaults to 0.'],
    ['free_weight_kg', 'no', 'Weight included in the base charge. Defaults to 2.'],
  ]);
  notes['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, notes, 'Notes');

  XLSX.writeFile(wb, 'delivery_rates_template.xlsx');
}

// ── Parser ────────────────────────────────────────────────────────────────────

interface ParsedRow {
  origin: string;
  destination: string;
  baseCharge: string;
  extraWeightPercent: string;
  freeWeightKg: string;
  _rowIndex: number;
  _error?: string;
}

function parseSheet(raw: string[][]): ParsedRow[] {
  if (raw.length === 0) return [];

  const firstRow = raw[0].map((c) => String(c ?? '').toLowerCase().replace(/[\s-]+/g, '_'));
  const isHeader = firstRow.includes('origin') || firstRow.includes('base_charge');
  const dataRows = isHeader ? raw.slice(1) : raw;

  return dataRows
    .map((cols, i): ParsedRow => {
      const get = (idx: number) => String(cols[idx] ?? '').trim();
      const errors: string[] = [];

      const origin = get(0);
      const destination = get(1);
      if (!origin) errors.push('origin is required');
      if (!destination) errors.push('destination is required');
      if (origin && destination && origin.toLowerCase() === destination.toLowerCase()) {
        errors.push('origin and destination must be different');
      }

      const baseCharge = get(2);
      if (!baseCharge) errors.push('base_charge is required');
      else if (isNaN(Number(baseCharge)) || Number(baseCharge) < 0) {
        errors.push('base_charge must be a non-negative number');
      }

      const extraPercent = get(3);
      if (extraPercent && (isNaN(Number(extraPercent)) || Number(extraPercent) < 0 || Number(extraPercent) > 100)) {
        errors.push('extra_weight_percent must be a number between 0 and 100');
      }
      const freeWeight = get(4);
      if (freeWeight && (isNaN(Number(freeWeight)) || Number(freeWeight) < 0)) {
        errors.push('free_weight_kg must be a non-negative number');
      }

      return {
        origin,
        destination,
        baseCharge,
        extraWeightPercent: extraPercent,
        freeWeightKg: freeWeight,
        _rowIndex: i + (isHeader ? 2 : 1),
        _error: errors.length ? errors.join('; ') : undefined,
      };
    })
    .filter((r) => r.origin || r.destination || r._error);
}

function toApiRows(rows: ParsedRow[]): BulkImportRateRow[] {
  return rows
    .filter((r) => !r._error)
    .map((r) => ({
      origin: r.origin,
      destination: r.destination,
      baseCharge: Number(r.baseCharge),
      ...(r.extraWeightPercent ? { extraWeightPercent: Number(r.extraWeightPercent) } : {}),
      ...(r.freeWeightKg ? { freeWeightKg: Number(r.freeWeightKg) } : {}),
    }));
}

// ── Component ─────────────────────────────────────────────────────────────────

const DeliveryRatesImport: React.FC<{ onImported?: () => void }> = ({ onImported }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<BulkImportRateResult[] | null>(null);

  const validRows = parsedRows.filter((r) => !r._error);
  const invalidRows = parsedRows.filter((r) => r._error);

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
    const rows = toApiRows(validRows);
    if (rows.length === 0) { setError('No valid rates to import.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const res = await bulkImportDeliveryRates(rows);
      setResults(res.data);
      onImported?.();
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

    return (
      <div className="di-result">
        <div className="di-result-counts">
          <div className="di-stat di-stat--success">
            <CheckCircle2 size={26} />
            <span className="di-stat-num">{created}</span>
            <span className="di-stat-label">Rates created</span>
          </div>
          <div className="di-stat di-stat--info">
            <CheckCircle2 size={26} />
            <span className="di-stat-num">{updated}</span>
            <span className="di-stat-label">Rates updated</span>
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
              <tr><th>Origin</th><th>Destination</th><th>Action</th><th>Error</th></tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} className={r.error ? 'di-row--error' : ''}>
                  <td>{r.origin}</td>
                  <td>{r.destination}</td>
                  <td>{r.error ? '—' : r.action}</td>
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
          <h2>Import Delivery Rates</h2>
          <p>Upload an Excel or CSV file to bulk-create or update route rates. Rows reference destinations by name.</p>
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

      {parsedRows.length === 0 && (
        <div className="di-preview-section">
          <div className="di-preview-head">
            <div>
              <h3>Sample file format</h3>
              <p>First row is the header. The template comes pre-filled with these example rows.</p>
            </div>
          </div>
          <div className="di-preview-wrap">
            <table className="di-preview-table">
              <thead>
                <tr>{COLUMNS.map((c) => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {SAMPLE_ROWS.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{cell || <span className="di-empty">—</span>}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {parsedRows.length > 0 && (
        <div className="di-preview-section">
          <div className="di-preview-head">
            <div>
              <h3>Preview</h3>
              <p>
                {parsedRows.length} row(s) — {validRows.length} valid, {invalidRows.length} with errors
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
                  <th>ID</th>
                  <th>Origin</th>
                  <th>Destination</th>
                  <th>Base Charge</th>
                  <th>Extra %</th>
                  <th>Free kg</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.map((row, i) => (
                  <tr key={i} className={row._error ? 'di-row--error' : 'di-row--ok'}>
                    <td className="di-cell-num">{row._rowIndex}</td>
                    <td>{row.origin || <span className="di-empty">—</span>}</td>
                    <td>{row.destination || <span className="di-empty">—</span>}</td>
                    <td>{row.baseCharge || <span className="di-empty">—</span>}</td>
                    <td>{row.extraWeightPercent || <span className="di-empty">—</span>}</td>
                    <td>{row.freeWeightKg || <span className="di-empty">—</span>}</td>
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
          disabled={submitting || validRows.length === 0}
          onClick={handleSubmit}
        >
          {submitting
            ? 'Importing…'
            : `Import ${validRows.length} Rate${validRows.length !== 1 ? 's' : ''}`}
        </Button>
      </div>
    </div>
  );
};

export default DeliveryRatesImport;
