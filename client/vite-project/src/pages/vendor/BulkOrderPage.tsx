import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Download, Upload, XCircle } from 'lucide-react';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import {
  bulkCreateOrders,
  type BulkCreateOrderRow,
  type BulkCreateResult,
} from '../../services/orders.service';
import './BulkOrderPage.css';

// ── CSV helpers ───────────────────────────────────────────────────────────────

const TEMPLATE_HEADERS = [
  'receiver_name',
  'receiver_phone',
  'receiver_alternate_phone',
  'receiver_address',
  'cod_amount',
  'weight_kg',
  'order_type',
  'delivery_instruction',
];

const SAMPLE_ROW = [
  'John Doe', '9801234567', '', 'Lalitpur', '0', '1', 'delivery', '',
];

function downloadTemplate() {
  const csv = [TEMPLATE_HEADERS, SAMPLE_ROW]
    .map(row => row.map(v => `"${v}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bulk_order_template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Single-pass parse (not line-split first) so a quoted field containing a
// literal newline doesn't get torn into two rows.
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"' && normalized[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cell += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }

  return rows.filter(r => !(r.length === 1 && r[0] === ''));
}

interface ParsedRow extends BulkCreateOrderRow {
  _raw: string[];
  _error?: string;
}

const MAX_ROWS_PER_IMPORT = 100;

function csvToRows(text: string): ParsedRow[] {
  const allRows = parseCSV(text);
  if (allRows.length === 0) return [];

  // Detect if first row is the header and skip it.
  const firstRow = allRows[0].map(c => c.toLowerCase().replace(/\s+/g, '_'));
  const isHeader = firstRow.includes('receiver_name') || firstRow.includes('receiver_phone');
  const dataRows = isHeader ? allRows.slice(1) : allRows;

  return dataRows.map((cols, index): ParsedRow => {
    const [
      receiverName = '',
      receiverPhone = '',
      receiverAltPhone = '',
      receiverAddress = '',
      codAmountStr = '',
      weightStr = '',
      orderTypeStr = '',
      deliveryInstruction = '',
    ] = cols;

    const errors: string[] = [];
    if (!receiverName.trim()) errors.push('receiver_name is required');
    if (!receiverPhone.trim()) errors.push('receiver_phone is required');
    if (index >= MAX_ROWS_PER_IMPORT) errors.push(`exceeds ${MAX_ROWS_PER_IMPORT} order limit per import`);

    let codAmount = 0;
    const codAmountRaw = codAmountStr.trim();
    if (codAmountRaw !== '') {
      const parsed = Number(codAmountRaw);
      if (!Number.isFinite(parsed) || parsed < 0) errors.push('cod_amount must be a non-negative number');
      else codAmount = parsed;
    }

    let weightKg = 1;
    const weightRaw = weightStr.trim();
    if (weightRaw !== '') {
      const parsed = Number(weightRaw);
      if (!Number.isFinite(parsed) || parsed <= 0) errors.push('weight_kg must be a positive number');
      else weightKg = parsed;
    }

    const validOrderTypes = ['delivery', 'exchange', 'return'] as const;
    const orderType = validOrderTypes.includes(orderTypeStr.trim() as any)
      ? (orderTypeStr.trim() as 'delivery' | 'exchange' | 'return')
      : 'delivery';

    return {
      _raw: cols,
      _error: errors.length ? errors.join('; ') : undefined,
      receiver: {
        name: receiverName.trim(),
        phone: receiverPhone.trim(),
        alternatePhone: receiverAltPhone.trim() || undefined,
        address: receiverAddress.trim() || undefined,
      },
      codAmount,
      weightKg,
      orderType,
      deliveryInstruction: deliveryInstruction.trim() || undefined,
    };
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

const BulkOrderPage: React.FC = () => {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [senderName, setSenderName] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<BulkCreateResult | null>(null);

  const validRows = rows.filter(r => !r._error);
  const invalidRows = rows.filter(r => r._error);

  const handleFile = (file: File) => {
    setFileName(file.name);
    setResult(null);
    setError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setRows(csvToRows(text));
    };
    reader.readAsText(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && (file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv'))) handleFile(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!senderName.trim() || !senderPhone.trim()) {
      setError('Sender name and phone are required.');
      return;
    }
    if (validRows.length === 0) {
      setError('No valid orders to submit. Fix errors in the preview below.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const res = await bulkCreateOrders({
        defaultSender: { name: senderName.trim(), phone: senderPhone.trim() },
        orders: validRows.map(({ _raw: _r, _error: _e, ...row }) => row),
      });
      setResult(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Bulk submission failed.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Result screen ────────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="bop-page">
        <div className="bop-result-card">
          <div className="bop-result-counts">
            <div className="bop-result-stat bop-result-stat--success">
              <CheckCircle2 size={28} />
              <span className="bop-result-num">{result.created}</span>
              <span className="bop-result-label">Created</span>
            </div>
            <div className="bop-result-stat bop-result-stat--fail">
              <XCircle size={28} />
              <span className="bop-result-num">{result.failed}</span>
              <span className="bop-result-label">Failed</span>
            </div>
          </div>

          {result.failed > 0 && (
            <div className="bop-result-errors">
              <h3>Failed Orders</h3>
              <table className="bop-result-table">
                <thead>
                  <tr><th>#</th><th>Row</th><th>Reason</th></tr>
                </thead>
                <tbody>
                  {result.results
                    .filter((r): r is Extract<typeof r, { success: false }> => !r.success)
                    .map(r => (
                      <tr key={r.index}>
                        <td>{r.index + 1}</td>
                        <td>{rows[r.index]?.receiver.name ?? '—'}</td>
                        <td className="bop-result-error-msg">{r.error}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="bop-result-actions">
            <Button variant="secondary" onClick={() => { setResult(null); setRows([]); setFileName(''); }}>
              Import More Orders
            </Button>
            <Button variant="primary" onClick={() => navigate('/orders')}>
              View Orders
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main form ────────────────────────────────────────────────────────────────
  return (
    <div className="bop-page">
      <button type="button" className="bop-back" onClick={() => navigate('/orders')}>
        <ArrowLeft size={15} /> Orders
      </button>

      <div className="bop-header">
        <h1>Bulk Order Import</h1>
        <p>Upload a CSV file to create multiple orders in a single request.</p>
      </div>

      <form className="bop-form" onSubmit={handleSubmit} noValidate>
        {/* ── Sender ── */}
        <section className="bop-section">
          <div className="bop-section-heading">
            <h2>Default Sender</h2>
            <p>Applied to all orders in this batch. Can be overridden per row in the CSV.</p>
          </div>
          <div className="bop-sender-fields">
            <FormField
              label="Sender Name"
              required
              value={senderName}
              onChange={setSenderName}
              placeholder="Your business name"
              autoComplete="organization"
            />
            <FormField
              label="Sender Phone"
              required
              value={senderPhone}
              onChange={setSenderPhone}
              placeholder="98XXXXXXXX"
              autoComplete="tel"
            />
          </div>
        </section>

        {/* ── Upload ── */}
        <section className="bop-section">
          <div className="bop-section-heading-row">
            <div>
              <h2>Upload CSV</h2>
              <p>One row per order. Max 100 orders per import.</p>
            </div>
            <Button type="button" variant="outline" onClick={downloadTemplate}>
              <Download size={15} /> Download Template
            </Button>
          </div>

          <div
            className={`bop-dropzone${fileName ? ' bop-dropzone--loaded' : ''}`}
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && fileRef.current?.click()}
            aria-label="Upload CSV file"
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileInput}
              className="bop-file-input"
              aria-hidden="true"
            />
            <Upload size={28} className="bop-dropzone-icon" />
            {fileName ? (
              <span className="bop-dropzone-filename">{fileName}</span>
            ) : (
              <>
                <span className="bop-dropzone-primary">Drop CSV here or click to browse</span>
                <span className="bop-dropzone-hint">Accepts .csv files</span>
              </>
            )}
          </div>
        </section>

        {/* ── Preview ── */}
        {rows.length > 0 && (
          <section className="bop-section">
            <div className="bop-section-heading-row">
              <div>
                <h2>Preview</h2>
                <p>{rows.length} row(s) — {validRows.length} valid, {invalidRows.length} with errors</p>
              </div>
              {invalidRows.length > 0 && (
                <span className="bop-preview-badge bop-preview-badge--warn">
                  {invalidRows.length} row(s) will be skipped
                </span>
              )}
            </div>

            <div className="bop-preview-wrap">
              <table className="bop-preview-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Receiver</th>
                    <th>Phone</th>
                    <th>Address</th>
                    <th>COD</th>
                    <th>Weight (kg)</th>
                    <th>Type</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className={row._error ? 'bop-row--error' : 'bop-row--ok'}>
                      <td className="bop-cell-num">{i + 1}</td>
                      <td>{row.receiver.name || <span className="bop-empty">—</span>}</td>
                      <td>{row.receiver.phone || <span className="bop-empty">—</span>}</td>
                      <td>{row.receiver.address || <span className="bop-empty">—</span>}</td>
                      <td>{row.codAmount ?? 0}</td>
                      <td>{row.weightKg ?? 1}</td>
                      <td>{row.orderType ?? 'delivery'}</td>
                      <td>
                        {row._error ? (
                          <span className="bop-status bop-status--error" title={row._error}>
                            <XCircle size={14} /> Error
                          </span>
                        ) : (
                          <span className="bop-status bop-status--ok">
                            <CheckCircle2 size={14} /> Ready
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {error && <p role="alert" className="bop-error">{error}</p>}

        <div className="bop-actions">
          <Button type="button" variant="secondary" onClick={() => navigate('/orders')} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={submitting || validRows.length === 0}
          >
            {submitting
              ? 'Submitting…'
              : `Submit ${validRows.length} Order${validRows.length !== 1 ? 's' : ''} (1 request)`}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default BulkOrderPage;
