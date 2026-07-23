import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { ArrowLeft, CheckCircle2, Download, Trash2, Upload, XCircle } from 'lucide-react';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import {
  bulkCreateOrders,
  getSenderProfile,
  type BulkCreateOrderRow,
  type BulkCreateResult,
  type OrderType,
  type SenderProfile,
  type ServiceType,
} from '../../services/orders.service';
import { getLocations, getVendors } from '../../services/users.service';
import { isVendorSide } from '../../utils/auth';
import './BulkOrderPage.css';

interface VendorOption {
  id: string;
  client: string;
  company: string;
  phone: string;
  address: string;
  locationId: string | null;
}

interface LocationOption {
  id: string;
  name: string;
  parentId?: string | null;
}

// ── Row model ─────────────────────────────────────────────────────────────────
// One editable draft per file row, mirroring every field on the Create Order
// page (receiver, destination, service/order/package type, weight, COD,
// instruction). Kept as strings so cells can be edited freely; validation and
// the submit payload derive from them.

interface DraftRow {
  receiverName: string;
  receiverPhone: string;
  receiverAltPhone: string;
  receiverAddress: string;
  destination: string;
  serviceType: string;
  orderType: string;
  packageType: string;
  weightKg: string;
  codAmount: string;
  deliveryInstruction: string;
}

type DraftField = keyof DraftRow;
type RowErrors = Partial<Record<DraftField | '_row', string>>;

const SERVICE_TYPES: ServiceType[] = ['home_delivery', 'branch_delivery'];
const ORDER_TYPES: OrderType[] = ['delivery', 'exchange', 'return'];
const PACKAGE_TYPE_PRESETS = ['Parcel', 'Document', 'Fragile'];
const DELIVERY_INSTRUCTION_PRESETS = [
  'Cannot open the parcel',
  'Can open the parcel',
  'Call before delivery',
  'Handle with care',
];

// ── CSV helpers ───────────────────────────────────────────────────────────────

const TEMPLATE_HEADERS = [
  'receiver_name',
  'receiver_phone',
  'receiver_alternate_phone',
  'receiver_address',
  'destination',
  'service_type',
  'order_type',
  'package_type',
  'weight_kg',
  'cod_amount',
  'delivery_instruction',
] as const;

type TemplateColumn = (typeof TEMPLATE_HEADERS)[number];

const SAMPLE_ROW = [
  'John Doe', '9801234567', '', 'Gwarko, Lalitpur', 'Imadol', 'home_delivery',
  'delivery', 'Parcel', '1', '0', 'Call before delivery',
];

function downloadTemplate() {
  const csv = [TEMPLATE_HEADERS as unknown as string[], SAMPLE_ROW]
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

const MAX_ROWS_PER_IMPORT = 100;

// "Home Delivery" / "HOME_DELIVERY" → home_delivery; unrecognized text is kept
// as-is so validation flags it and the cell can be fixed inline.
function normalizeChoice(value: string, allowed: string[]): string {
  const v = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return allowed.includes(v) ? v : value.trim();
}

function matrixToRows(allRows: string[][]): DraftRow[] {
  if (allRows.length === 0) return [];

  // Detect if the first row is a header. Columns are then mapped by name, so
  // files made from the older 8-column template still import; headerless
  // files fall back to the current template order.
  const firstRow = allRows[0].map(c => c.toLowerCase().replace(/\s+/g, '_'));
  const isHeader = firstRow.includes('receiver_name') || firstRow.includes('receiver_phone');
  const dataRows = isHeader ? allRows.slice(1) : allRows;

  const colIndex = new Map<TemplateColumn, number>();
  TEMPLATE_HEADERS.forEach((col, i) => colIndex.set(col, isHeader ? firstRow.indexOf(col) : i));

  return dataRows.map((cols): DraftRow => {
    const get = (col: TemplateColumn) => {
      const idx = colIndex.get(col) ?? -1;
      return idx < 0 ? '' : (cols[idx] ?? '').trim();
    };
    return {
      receiverName: get('receiver_name'),
      receiverPhone: get('receiver_phone'),
      receiverAltPhone: get('receiver_alternate_phone'),
      receiverAddress: get('receiver_address'),
      destination: get('destination'),
      serviceType: normalizeChoice(get('service_type'), SERVICE_TYPES),
      orderType: normalizeChoice(get('order_type'), ORDER_TYPES),
      packageType: get('package_type'),
      weightKg: get('weight_kg'),
      codAmount: get('cod_amount'),
      deliveryInstruction: get('delivery_instruction'),
    };
  });
}

// "Imadol" in a CSV should still find the "Imadol - Lalitpur" branch: an exact
// (case-insensitive) name match wins, otherwise a unique prefix match does.
function resolveDestination(
  value: string,
  options: LocationOption[],
): { match?: LocationOption; error?: string } {
  const v = value.trim().toLowerCase();
  if (!v) return {};
  const exact = options.find(o => o.name.toLowerCase() === v);
  if (exact) return { match: exact };
  const prefixed = options.filter(o => o.name.toLowerCase().startsWith(v));
  if (prefixed.length === 1) return { match: prefixed[0] };
  if (prefixed.length > 1) return { error: `"${value.trim()}" matches multiple destinations — pick one from the list` };
  return { error: `"${value.trim()}" is not a known destination` };
}

// Recomputed on every render/edit, so fixing a cell clears its error live.
function validateRow(row: DraftRow, index: number, destinations: LocationOption[]): RowErrors {
  const errors: RowErrors = {};
  if (!row.receiverName.trim()) errors.receiverName = 'receiver name is required';
  if (!row.receiverPhone.trim()) errors.receiverPhone = 'receiver phone is required';

  const destination = resolveDestination(row.destination, destinations);
  if (destination.error) errors.destination = destination.error;
  if (row.serviceType.trim() && !SERVICE_TYPES.includes(row.serviceType.trim() as ServiceType)) {
    errors.serviceType = `service type must be one of: ${SERVICE_TYPES.join(', ')}`;
  }
  if (row.orderType.trim() && !ORDER_TYPES.includes(row.orderType.trim() as OrderType)) {
    errors.orderType = `order type must be one of: ${ORDER_TYPES.join(', ')}`;
  }

  if (row.codAmount.trim() !== '') {
    const parsed = Number(row.codAmount);
    if (!Number.isFinite(parsed) || parsed < 0) errors.codAmount = 'COD must be a non-negative number';
  }
  if (row.weightKg.trim() !== '') {
    const parsed = Number(row.weightKg);
    if (!Number.isFinite(parsed) || parsed <= 0) errors.weightKg = 'weight must be a positive number';
  }
  if (index >= MAX_ROWS_PER_IMPORT) {
    errors._row = `exceeds ${MAX_ROWS_PER_IMPORT} order limit per import — remove extra rows`;
  }
  return errors;
}

// ── Component ─────────────────────────────────────────────────────────────────

const BulkOrderPage: React.FC = () => {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  // Vendor/vendor_staff have exactly one possible sender (themselves), fetched
  // automatically below. Admin/super_admin/sales act on behalf of one of many
  // vendors, so they pick which one via the dropdown instead.
  const actingForVendor = !isVendorSide();

  // The vendor IS the default sender - no reason to ask them to type in their
  // own business name/phone. Fetched once and applied to every row in the batch.
  const [senderProfile, setSenderProfile] = useState<SenderProfile | null>(null);
  const [senderLoading, setSenderLoading] = useState(true);
  const [senderError, setSenderError] = useState('');
  const [vendorOptions, setVendorOptions] = useState<VendorOption[]>([]);
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<BulkCreateResult | null>(null);
  // Snapshot of the drafts that were submitted, so the result screen can name
  // failed rows even after `rows` changes.
  const submittedRowsRef = useRef<DraftRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (actingForVendor) {
          const res = await getVendors();
          if (!cancelled && res?.success && Array.isArray(res.data)) {
            setVendorOptions(res.data.map((v: any) => ({
              id: v.id,
              client: v.client,
              company: v.company,
              phone: v.phone,
              address: v.address || '',
              locationId: v.locationId ?? null,
            })));
          }
        } else {
          const res = await getSenderProfile();
          if (!cancelled && res?.success) setSenderProfile(res.data);
        }
      } catch (err: any) {
        if (!cancelled) {
          setSenderError(err?.response?.data?.message || 'Failed to load sender details.');
        }
      } finally {
        if (!cancelled) setSenderLoading(false);
      }
    })();
    (async () => {
      try {
        const res = await getLocations();
        if (!cancelled && res?.success && Array.isArray(res.data)) {
          setLocations(res.data.map((l: any) => ({ id: l.id, name: l.name, parentId: l.parent_id })));
        }
      } catch (err) {
        console.error('Failed to load destinations:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [actingForVendor]);

  // When acting on behalf of a vendor, the picked vendor's own details stand
  // in for the auto-fetched sender profile used by the vendor-side flow.
  useEffect(() => {
    if (!actingForVendor) return;
    const vendor = vendorOptions.find(v => v.id === selectedVendorId);
    setSenderProfile(vendor ? {
      id: vendor.id,
      name: vendor.company || vendor.client,
      phone: vendor.phone,
      address: vendor.address,
      locationId: vendor.locationId,
    } : null);
  }, [actingForVendor, selectedVendorId, vendorOptions]);

  // Same rule as the Create Order page: destinations are top-level locations;
  // covered areas (children with a parentId) are zones within them.
  const destinationOptions = useMemo(
    () => locations.filter(l => !l.parentId),
    [locations],
  );

  const rowErrors = useMemo(
    () => rows.map((row, i) => validateRow(row, i, destinationOptions)),
    [rows, destinationOptions],
  );
  const errorCount = rowErrors.filter(e => Object.keys(e).length > 0).length;
  const validCount = rows.length - errorCount;

  const updateCell = (index: number, field: DraftField, value: string) => {
    setRows(prev => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const removeRow = (index: number) => {
    setRows(prev => prev.filter((_, i) => i !== index));
  };

  const handleFile = (file: File) => {
    setFileName(file.name);
    setResult(null);
    setError('');
    const isExcel = /\.xlsx?$/.test(file.name.toLowerCase());
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        if (isExcel) {
          const wb = XLSX.read(e.target?.result as ArrayBuffer, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          // raw:false keeps phone numbers as their displayed text instead of
          // Excel's numeric cell value (which drops leading zeros / reformats).
          const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }) as unknown[][];
          setRows(matrixToRows(matrix.map(r => r.map(c => String(c ?? '').trim()))));
        } else {
          setRows(matrixToRows(parseCSV(e.target?.result as string)));
        }
      } catch {
        setError('Could not read file. Make sure it is a valid .csv, .xlsx, or .xls file.');
        setRows([]);
      }
    };
    if (isExcel) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && /\.(csv|xlsx|xls)$/.test(file.name.toLowerCase())) handleFile(file);
  };

  const toOrderRow = (row: DraftRow): BulkCreateOrderRow => {
    const destinationLocationId = resolveDestination(row.destination, destinationOptions).match?.id;
    return {
      receiver: {
        name: row.receiverName.trim(),
        phone: row.receiverPhone.trim(),
        alternatePhone: row.receiverAltPhone.trim() || undefined,
        address: row.receiverAddress.trim() || undefined,
        locationId: destinationLocationId,
      },
      destinationLocationId,
      serviceType: SERVICE_TYPES.includes(row.serviceType.trim() as ServiceType)
        ? (row.serviceType.trim() as ServiceType)
        : 'home_delivery',
      orderType: ORDER_TYPES.includes(row.orderType.trim() as OrderType)
        ? (row.orderType.trim() as OrderType)
        : 'delivery',
      packageType: row.packageType.trim() || undefined,
      weightKg: row.weightKg.trim() !== '' ? Number(row.weightKg) : 1,
      codAmount: row.codAmount.trim() !== '' ? Number(row.codAmount) : 0,
      deliveryInstruction: row.deliveryInstruction.trim() || undefined,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (actingForVendor && !selectedVendorId) {
      setError('Pick which vendor this import is for.');
      return;
    }
    if (!senderProfile) {
      setError('Sender details could not be loaded. Please refresh and try again.');
      return;
    }
    const validRows = rows.filter((_, i) => Object.keys(rowErrors[i]).length === 0);
    if (validRows.length === 0) {
      setError('No valid orders to submit. Fix errors in the preview below.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      submittedRowsRef.current = validRows;
      const res = await bulkCreateOrders({
        defaultSender: {
          name: senderProfile.name,
          phone: senderProfile.phone,
          address: senderProfile.address || undefined,
        },
        orders: validRows.map(row => (
          actingForVendor ? { ...toOrderRow(row), vendorId: selectedVendorId } : toOrderRow(row)
        )),
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
                  <tr><th>ID</th><th>Row</th><th>Reason</th></tr>
                </thead>
                <tbody>
                  {result.results
                    .filter((r): r is Extract<typeof r, { success: false }> => !r.success)
                    .map(r => (
                      <tr key={r.index}>
                        <td>{r.index + 1}</td>
                        <td>{submittedRowsRef.current[r.index]?.receiverName ?? '—'}</td>
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

  // A cell input plus its error binding, so every field reads the same way.
  const cell = (
    index: number,
    field: DraftField,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => {
    const fieldError = rowErrors[index][field];
    return (
      <input
        className={`bop-cell-input${fieldError ? ' bop-cell-input--invalid' : ''}${props.type === 'number' ? ' bop-cell-input--num' : ''}`}
        value={rows[index][field]}
        onChange={e => updateCell(index, field, e.target.value)}
        title={fieldError}
        aria-invalid={Boolean(fieldError)}
        {...props}
      />
    );
  };

  const choiceCell = (index: number, field: DraftField, options: string[], labels?: Record<string, string>) => {
    const value = rows[index][field];
    const fieldError = rowErrors[index][field];
    const unknownValue = value.trim() !== '' && !options.includes(value.trim());
    return (
      <select
        className={`bop-cell-input${fieldError ? ' bop-cell-input--invalid' : ''}`}
        value={value}
        onChange={e => updateCell(index, field, e.target.value)}
        title={fieldError}
        aria-invalid={Boolean(fieldError)}
      >
        {/* Keeps an unrecognized value from the file visible until it's fixed. */}
        {unknownValue && <option value={value}>{value}</option>}
        {options.map(o => <option key={o} value={o}>{labels?.[o] ?? o}</option>)}
      </select>
    );
  };

  // ── Main form ────────────────────────────────────────────────────────────────
  return (
    <div className="bop-page">
      <button type="button" className="bop-back" onClick={() => navigate('/orders')}>
        <ArrowLeft size={15} /> Orders
      </button>

      <div className="bop-header">
        <h1>Bulk Order Import</h1>
        <p>Upload a CSV or Excel file to create multiple orders in a single request.</p>
      </div>

      <form className="bop-form" onSubmit={handleSubmit} noValidate>
        {/* ── Sender ── */}
        <section className="bop-section">
          <div className="bop-section-heading">
            <h2>Sender</h2>
            <p>Applied to every order in this batch.</p>
          </div>
          {senderLoading ? (
            <p className="bop-empty">Loading sender details…</p>
          ) : senderError ? (
            <p role="alert" className="bop-error">{senderError}</p>
          ) : actingForVendor ? (
            <div className="bop-sender-fields">
              <FormField
                label="Vendor"
                type="searchable-select"
                required
                value={selectedVendorId}
                onChange={setSelectedVendorId}
                searchableOptions={vendorOptions.map(v => ({ id: v.id, label: v.company || v.client, description: v.phone }))}
                placeholder="Select which vendor this import is for"
                searchPlaceholder="Search vendors..."
                emptyMessage="No vendors available."
                gridColumn="1 / -1"
              />
              {senderProfile && (
                <>
                  <FormField label="Sender Name" value={senderProfile.name} onChange={() => {}} disabled />
                  <FormField label="Sender Phone" value={senderProfile.phone} onChange={() => {}} disabled />
                </>
              )}
            </div>
          ) : senderProfile ? (
            <div className="bop-sender-fields">
              <FormField label="Sender Name" value={senderProfile.name} onChange={() => {}} disabled />
              <FormField label="Sender Phone" value={senderProfile.phone} onChange={() => {}} disabled />
            </div>
          ) : null}
        </section>

        {/* ── Upload ── */}
        <section className="bop-section">
          <div className="bop-section-heading-row">
            <div>
              <h2>Upload File</h2>
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
            aria-label="Upload CSV or Excel file"
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={handleFileInput}
              className="bop-file-input"
              aria-hidden="true"
            />
            <Upload size={28} className="bop-dropzone-icon" />
            {fileName ? (
              <span className="bop-dropzone-filename">{fileName}</span>
            ) : (
              <>
                <span className="bop-dropzone-primary">Drop CSV or Excel here or click to browse</span>
                <span className="bop-dropzone-hint">Accepts .csv, .xlsx, and .xls files</span>
              </>
            )}
          </div>
        </section>

        {/* ── Preview ── */}
        {rows.length > 0 && (
          <section className="bop-section bop-section--preview">
            <div className="bop-section-heading-row">
              <div>
                <h2>Preview</h2>
                <p>
                  {rows.length} row(s) — {validCount} valid, {errorCount} with errors.
                  Every cell is editable; hover a red cell for the reason.
                </p>
              </div>
              {errorCount > 0 && (
                <span className="bop-preview-badge bop-preview-badge--warn">
                  {errorCount} row(s) need fixing or will be skipped
                </span>
              )}
            </div>

            <div className="bop-preview-wrap">
              <table className="bop-preview-table bop-preview-table--edit">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Receiver</th>
                    <th>Phone</th>
                    <th>Alt Phone</th>
                    <th>Address</th>
                    <th>Destination</th>
                    <th>Service</th>
                    <th>Type</th>
                    <th>Package</th>
                    <th>Weight (kg)</th>
                    <th>COD</th>
                    <th>Instruction</th>
                    <th>Status</th>
                    <th aria-label="Remove" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const errors = rowErrors[i];
                    const errorMessage = Object.values(errors).join('; ');
                    return (
                      <tr key={i} className={errorMessage ? 'bop-row--error' : 'bop-row--ok'}>
                        <td className="bop-cell-num">{i + 1}</td>
                        <td>{cell(i, 'receiverName', { placeholder: 'Receiver name' })}</td>
                        <td>{cell(i, 'receiverPhone', { placeholder: 'Phone' })}</td>
                        <td>{cell(i, 'receiverAltPhone', { placeholder: '—' })}</td>
                        <td>{cell(i, 'receiverAddress', { placeholder: 'Address' })}</td>
                        <td>
                          <input
                            className={`bop-cell-input${errors.destination ? ' bop-cell-input--invalid' : ''}`}
                            value={row.destination}
                            onChange={e => updateCell(i, 'destination', e.target.value)}
                            list="bop-destination-options"
                            placeholder="Branch"
                            title={errors.destination}
                            aria-invalid={Boolean(errors.destination)}
                          />
                        </td>
                        <td>{choiceCell(i, 'serviceType', SERVICE_TYPES, { home_delivery: 'Home Delivery', branch_delivery: 'Branch Delivery' })}</td>
                        <td>{choiceCell(i, 'orderType', ORDER_TYPES, { delivery: 'Delivery', exchange: 'Exchange', return: 'Return' })}</td>
                        <td>
                          <input
                            className="bop-cell-input"
                            value={row.packageType}
                            onChange={e => updateCell(i, 'packageType', e.target.value)}
                            list="bop-package-options"
                            placeholder="Parcel"
                          />
                        </td>
                        <td>{cell(i, 'weightKg', { type: 'number', min: 0, step: '0.1', placeholder: '1' })}</td>
                        <td>{cell(i, 'codAmount', { type: 'number', min: 0, step: '1', placeholder: '0' })}</td>
                        <td>
                          <input
                            className="bop-cell-input bop-cell-input--wide"
                            value={row.deliveryInstruction}
                            onChange={e => updateCell(i, 'deliveryInstruction', e.target.value)}
                            list="bop-instruction-options"
                            placeholder="—"
                          />
                        </td>
                        <td>
                          {errorMessage ? (
                            <span className="bop-status bop-status--error" title={errorMessage}>
                              <XCircle size={14} /> Error
                            </span>
                          ) : (
                            <span className="bop-status bop-status--ok">
                              <CheckCircle2 size={14} /> Ready
                            </span>
                          )}
                        </td>
                        <td className="bop-cell-remove">
                          <button
                            type="button"
                            className="bop-remove"
                            onClick={() => removeRow(i)}
                            aria-label={`Remove row ${i + 1}`}
                            title="Remove row"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <datalist id="bop-destination-options">
              {destinationOptions.map(d => <option key={d.id} value={d.name} />)}
            </datalist>
            <datalist id="bop-package-options">
              {PACKAGE_TYPE_PRESETS.map(p => <option key={p} value={p} />)}
            </datalist>
            <datalist id="bop-instruction-options">
              {DELIVERY_INSTRUCTION_PRESETS.map(p => <option key={p} value={p} />)}
            </datalist>
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
            disabled={submitting || validCount === 0 || !senderProfile}
          >
            {submitting
              ? 'Submitting…'
              : `Submit ${validCount} Order${validCount !== 1 ? 's' : ''} (1 request)`}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default BulkOrderPage;
