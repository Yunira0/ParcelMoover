import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import Table from './Table';
import Pagination from './Pagination';
import Button from './Button';
import StatusChip, { type StatusChipTone } from './StatusChip';
import { toBsDateTime } from '../utils/nepaliDate';
import { commitScannedTerm, handleScannerPaste } from '../utils/scannerInput';
import { apiErrorMessage } from '../utils/serverValidation';
import {
  addParcelsToTransitManifest,
  getTransitManifests,
  receiveTransitManifestParcels,
  TRANSIT_MANIFEST_STATUS_LABELS,
  type TransitManifest as TransitManifestModel,
  type TransitManifestStatus,
  type RejectedTransitParcel,
} from '../services/transitManifests.service';
import CreateTransitManifestModal from './CreateTransitManifestModal';
import '../pages/OOVOperations.css';

const STATUS_TONE: Record<TransitManifestStatus, StatusChipTone> = {
  open: 'warning',
  dispatched: 'info',
  received: 'success',
};

interface TransitManifestPanelProps {
  /** `active` = every manifest not yet received; `received` = the received ones. */
  statusFilter: 'active' | 'received';
}

// The "Open Manifest" / "Received" tabs on the Transit (OOV) page. Scanning a
// parcel onto an OPEN manifest dispatches it (→ dispatched / In Transit);
// scanning a parcel on a DISPATCHED manifest receives it (→ arrived_at_branch).
// The action follows the selected manifest's status — no mode picker.
const TransitManifestPanel: React.FC<TransitManifestPanelProps> = ({ statusFilter }) => {
  const [manifests, setManifests] = useState<TransitManifestModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [buffer, setBuffer] = useState('');
  const [scanned, setScanned] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [rejected, setRejected] = useState<RejectedTransitParcel[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getTransitManifests();
      setManifests(res?.success ? res.data : []);
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load transit manifests.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resetScan = () => {
    setBuffer('');
    setScanned([]);
    setRejected([]);
  };


  const rows = manifests.filter((m) =>
    statusFilter === 'received' ? m.status === 'received' : m.status !== 'received',
  );
  const selected = manifests.find((m) => m.id === selectedId) ?? null;
  const scannedCount = [...scanned, buffer.trim()].filter(Boolean).length;

  // Open manifest → scanning dispatches (parcels go In Transit). Dispatched
  // manifest → scanning receives (parcels go Arrived at Destination).
  const canScan = !!selected && selected.status !== 'received';
  const isReceiving = selected?.status === 'dispatched';
  const scanVerb = isReceiving ? 'Receive' : 'Dispatch';

  const handleScanSubmit = async () => {
    const ids = [...scanned, buffer.trim()].filter(Boolean);
    if (!selectedId || !canScan || ids.length === 0) return;
    setBusy(true);
    setNotice('');
    setRejected([]);
    try {
      const res = isReceiving
        ? await receiveTransitManifestParcels(selectedId, ids)
        : await addParcelsToTransitManifest(selectedId, ids);
      setNotice(res.message || `${res.data.updated} parcel(s) updated.`);
      setRejected(res.data.rejected ?? []);
      resetScan();
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Scan failed.'));
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { header: 'MANIFEST NO', accessor: (m: TransitManifestModel) => m.manifestNo, width: '150px' },
    {
      header: 'STATUS',
      accessor: (m: TransitManifestModel) => (
        <StatusChip tone={STATUS_TONE[m.status]}>{TRANSIT_MANIFEST_STATUS_LABELS[m.status]}</StatusChip>
      ),
      width: '130px',
    },
    { header: 'ROUTE', accessor: (m: TransitManifestModel) => `${m.fromHub || '—'} → ${m.toHub || '—'}`, width: '220px' },
    { header: 'PARCELS', accessor: (m: TransitManifestModel) => m.parcelCount, width: '90px' },
    { header: 'CREATED', accessor: (m: TransitManifestModel) => toBsDateTime(m.createdAt) || '—', width: '150px' },
    { header: 'UPDATED', accessor: (m: TransitManifestModel) => toBsDateTime(m.updatedAt) || '—', width: '150px' },
  ];

  return (
    <>
      {error && <p className="oov-action-error">{error}</p>}

      <div className="oov-toolbar">
        <span className="oov-selected-count">
          {statusFilter === 'active'
            ? selected
              ? `Scanning into ${selected.manifestNo}`
              : 'Select a manifest to scan into'
            : 'Manifests received so far'}
        </span>
        {statusFilter === 'active' && (
          <div className="oov-toolbar-actions">
            <Button variant="secondary" className="oov-outline-btn" onClick={() => setCreateOpen(true)} disabled={busy}>
              <Plus size={14} /> New manifest
            </Button>
          </div>
        )}
      </div>

      {statusFilter === 'active' && (
        <div className="oov-search-wrap">
          <label className="oov-search">
            <Search size={16} />
            <input
              value={buffer}
              onChange={(e) => setBuffer(e.target.value)}
              onKeyDown={(e) => commitScannedTerm(e, setScanned, setBuffer)}
              onPaste={(e) => handleScannerPaste(e, setScanned, setBuffer)}
              placeholder={canScan ? 'Scan tracking id, then Enter' : 'Select a manifest first'}
              disabled={!canScan}
            />
            {(buffer || scanned.length > 0) && (
              <button type="button" onClick={resetScan} aria-label="Clear scans">
                <X size={14} />
              </button>
            )}
          </label>
          <div>
            <Button
              variant="primary"
              onClick={handleScanSubmit}
              disabled={busy || !canScan || scannedCount === 0}
            >
              {scanVerb}{scannedCount > 0 ? ` (${scannedCount})` : ''}
            </Button>
          </div>
          {scanned.length > 0 && (
            <div className="scan-chip-list">
              {scanned.map((id) => (
                <span key={id} className="scan-chip">
                  {id}
                  <button
                    type="button"
                    onClick={() => setScanned((p) => p.filter((x) => x !== id))}
                    aria-label={`Remove ${id}`}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {notice && <p className="oov-action-notice">{notice}</p>}
          {rejected.length > 0 && (
            <ul className="oov-action-error-list">
              {rejected.map((r) => (
                <li key={r.trackingId}>
                  <strong>{r.trackingId}</strong> — {r.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Table
        columns={columns}
        data={rows}
        selectable={false}
        onRowClick={(m) => {
          setSelectedId(m.id);
          resetScan();
        }}
        getRowClassName={(m) => (m.id === selectedId ? 'selected-row' : '')}
        loading={loading}
        loadingMessage="Loading manifests…"
        emptyMessage="No transit manifests."
        minWidth="900px"
        tableClassName="oov-table"
      />

      <Pagination
        ariaLabel="Transit manifest pagination"
        page={page}
        totalPages={1}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={setPageSize}
        summary={`${rows.length} manifest${rows.length === 1 ? '' : 's'}`}
      />

      <CreateTransitManifestModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(m) => {
          setNotice(`Manifest ${m.manifestNo} opened.`);
          setSelectedId(m.id);
          load();
        }}
      />
    </>
  );
};

export default TransitManifestPanel;
