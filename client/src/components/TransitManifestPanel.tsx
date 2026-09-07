import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, Plus, Search, Trash2, Truck, X } from 'lucide-react';
import Table from './Table';
import Pagination from './Pagination';
import Button from './Button';
import StatusChip, { type StatusChipTone } from './StatusChip';
import { toBsDateTime } from '../utils/nepaliDate';
import { apiErrorMessage } from '../utils/serverValidation';
import {
  addParcelsToTransitManifest,
  deleteTransitManifest,
  dispatchTransitManifest,
  getTransitManifest,
  getTransitManifests,
  receiveTransitManifestParcels,
  removeParcelFromTransitManifest,
  TRANSIT_MANIFEST_STATUS_LABELS,
  type TransitManifest as TransitManifestModel,
  type TransitManifestDetail,
  type TransitManifestParcel,
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

const formatMoney = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });

const parcelColumns = (parcels: TransitManifestParcel[]) => [
  { header: 'S.N', accessor: (p: TransitManifestParcel) => parcels.indexOf(p) + 1, width: '55px' },
  { header: 'ORDER ID', accessor: (p: TransitManifestParcel) => `#${p.orderNumber}`, width: '80px' },
  {
    header: 'TRACKING ID',
    accessor: (p: TransitManifestParcel) => (
      <Link to={`/orders/track/${p.trackingId}`} className="tracking-id-link">{p.trackingId}</Link>
    ),
    width: '150px',
  },
  { header: 'RECEIVER', accessor: (p: TransitManifestParcel) => p.receiverName || '-', width: '160px' },
  { header: 'DESTINATION', accessor: (p: TransitManifestParcel) => p.destination || '-', width: '180px' },
  { header: 'COD', accessor: (p: TransitManifestParcel) => formatMoney(p.codAmount), width: '100px' },
  {
    header: 'STATUS',
    accessor: (p: TransitManifestParcel) => <StatusChip tone="neutral">{p.status.replace(/_/g, ' ')}</StatusChip>,
    width: '140px',
  },
];

interface TransitManifestPanelProps {
  /** `active` = manifests still being loaded (`open`); `received` = manifests
   *  on the road or already in (`dispatched` + `received`). */
  statusFilter: 'active' | 'received';
}

// The "Open Manifest" / "Receive Manifest" tabs on the Transit page. Each tab
// does exactly one thing: Open Manifest only ever lists `open` manifests and
// only ever stages parcels onto them (they stay `oov`) - there is nothing to
// receive there, because a manifest that has been dispatched has left this
// branch. Receive Manifest lists `dispatched` manifests (ready to scan in) and
// `received` ones (history), and only ever receives (→ arrived_at_branch).
// Dispatching - the deliberate act that sends every staged parcel to
// `dispatched` in one go - is a button on the Open Manifest row, not a scan.
const TransitManifestPanel: React.FC<TransitManifestPanelProps> = ({ statusFilter }) => {
  const [manifests, setManifests] = useState<TransitManifestModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [buffer, setBuffer] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [rejected, setRejected] = useState<RejectedTransitParcel[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [createOpen, setCreateOpen] = useState(false);

  // Details (with member parcels) fetched on demand and kept, like Return
  // Operations - the list endpoint only carries member ids.
  const [details, setDetails] = useState<Record<string, TransitManifestDetail>>({});
  const [detailLoadingId, setDetailLoadingId] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [selectedParcelIds, setSelectedParcelIds] = useState<Set<string | number>>(new Set());

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
    setRejected([]);
  };

  // Open Manifest only ever holds manifests still being loaded - a dispatched
  // one has already left and has nothing to add to. Receive Manifest holds
  // the other side: manifests on the road waiting to be scanned in, plus the
  // ones already received, as history.
  const rows = manifests.filter((m) =>
    statusFilter === 'received' ? m.status !== 'open' : m.status === 'open',
  );
  // From rows, not the full list - the same panel instance keeps selectedId
  // across an Open Manifest ↔ Receive Manifest tab switch (OOVOperations only
  // changes the statusFilter prop, it doesn't remount), and a manifest from
  // the other tab must not read as selected here.
  const selected = rows.find((m) => m.id === selectedId) ?? null;

  // Scanning always matches the tab it's in: Open Manifest only stages
  // (parcels stay in Transit), Receive Manifest only receives (parcels go
  // Arrived at Destination) - never the other way around, regardless of
  // which manifest happens to be selected.
  const isReceiving = statusFilter === 'received';
  const canScan = !!selected && (isReceiving ? selected.status === 'dispatched' : selected.status === 'open');
  const scanVerb = isReceiving ? 'Receive' : 'Add';

  const loadDetail = useCallback(async (manifestId: string) => {
    if (details[manifestId]) return details[manifestId];
    setDetailLoadingId(manifestId);
    try {
      const res = await getTransitManifest(manifestId);
      if (res?.success) {
        setDetails((prev) => ({ ...prev, [manifestId]: res.data }));
        return res.data;
      }
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load the parcels on this manifest.'));
    } finally {
      setDetailLoadingId('');
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details]);

  const toggleExpanded = (manifestId: string) => {
    const opening = expandedId !== manifestId;
    setExpandedId(opening ? manifestId : '');
    setSelectedParcelIds(new Set());
    if (opening) void loadDetail(manifestId);
  };

  const toggleParcelSelection = (parcelId: string | number) => {
    setSelectedParcelIds((prev) => {
      const next = new Set(prev);
      if (next.has(parcelId)) next.delete(parcelId);
      else next.add(parcelId);
      return next;
    });
  };

  const toggleAllParcels = (parcels: TransitManifestParcel[]) => {
    setSelectedParcelIds((prev) => {
      const allSelected = parcels.length > 0 && parcels.every((p) => prev.has(p.id));
      return allSelected ? new Set() : new Set(parcels.map((p) => p.id));
    });
  };

  // Submits as soon as a tracking id is scanned - no confirm button. A
  // handheld scanner fires Enter after every code, so gating that behind a
  // separate click just adds a step an operator has to remember.
  const submitIds = async (ids: string[]) => {
    if (!selectedId || !canScan || ids.length === 0) return;
    setBusy(true);
    setNotice('');
    setRejected([]);
    try {
      const res = isReceiving
        ? await receiveTransitManifestParcels(selectedId, { trackingIds: ids })
        : await addParcelsToTransitManifest(selectedId, { trackingIds: ids });
      setNotice(res.message);
      setRejected(res.data.rejected ?? []);
      setDetails((prev) => { const next = { ...prev }; delete next[selectedId]; return next; });
      if (expandedId === selectedId) void loadDetail(selectedId);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Scan failed.'));
    } finally {
      setBusy(false);
    }
  };

  const handleScanKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const value = e.currentTarget.value.trim();
    if (!value) return;
    setBuffer('');
    void submitIds([value]);
  };

  // A copied spreadsheet column/row pastes as several tracking ids at once -
  // submit them together in one call rather than one Enter at a time.
  const handleScanPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const tokens = e.clipboardData.getData('text').split(/[\n\r\t,]+/).map((t) => t.trim()).filter(Boolean);
    if (tokens.length <= 1) return;
    e.preventDefault();
    setBuffer('');
    void submitIds(tokens);
  };

  // Takes selected parcels back off an open manifest. They stay `oov`, so they
  // drop straight back into the Transit tab ready to join another hand-over -
  // this only unpicks the grouping, it never touches a parcel's status.
  const removeSelectedParcels = async (manifest: TransitManifestModel) => {
    const detail = details[manifest.id];
    const targets = detail?.parcels.filter((p) => selectedParcelIds.has(p.id)) ?? [];
    if (targets.length === 0) return;

    setBusy(true);
    setNotice('');
    const removed: string[] = [];
    let failure = '';
    let latest: TransitManifestDetail | null = null;

    for (const parcel of targets) {
      try {
        const res = await removeParcelFromTransitManifest(manifest.id, parcel.id);
        removed.push(parcel.trackingId);
        latest = res.data;
      } catch (err) {
        failure = `${parcel.trackingId}: ${apiErrorMessage(err, 'could not be removed')}`;
        break;
      }
    }

    if (latest) setDetails((prev) => ({ ...prev, [manifest.id]: latest! }));
    setSelectedParcelIds(new Set());
    setNotice(
      [removed.length ? `Removed from ${manifest.manifestNo}: ${removed.join(', ')}.` : '', failure]
        .filter(Boolean)
        .join(' '),
    );
    await load();
    setBusy(false);
  };

  // Only ever offered for an empty open manifest (see the ACTION column) - one
  // that ever held parcels or ever left is a record of real work, not a
  // mistake to clean up.
  const handleDelete = async (manifest: TransitManifestModel) => {
    if (!window.confirm(`Delete empty manifest ${manifest.manifestNo}?`)) return;
    setBusy(true);
    setNotice('');
    setError('');
    try {
      const res = await deleteTransitManifest(manifest.id);
      setNotice(res.message);
      if (selectedId === manifest.id) setSelectedId('');
      if (expandedId === manifest.id) setExpandedId('');
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to delete the manifest.'));
    } finally {
      setBusy(false);
    }
  };

  const handleDispatch = async (manifest: TransitManifestModel) => {
    setBusy(true);
    setNotice('');
    setError('');
    try {
      const res = await dispatchTransitManifest(manifest.id);
      setNotice(res.message);
      setDetails((prev) => { const next = { ...prev }; delete next[manifest.id]; return next; });
      if (expandedId === manifest.id) void loadDetail(manifest.id);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to dispatch the manifest.'));
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
    {
      header: 'ACTION',
      accessor: (m: TransitManifestModel) => (
        <div className="oov-manifest-row-actions">
          {m.status === 'open' && (
            <Button
              variant="primary"
              disabled={busy || m.parcelCount === 0}
              onClick={(e) => { e.stopPropagation(); void handleDispatch(m); }}
            >
              <Truck size={14} /> Dispatch
            </Button>
          )}
          <Button variant="secondary" onClick={(e) => { e.stopPropagation(); toggleExpanded(m.id); }}>
            {expandedId === m.id ? <><ChevronUp size={14} /> Details</> : <><ChevronDown size={14} /> Details</>}
          </Button>
          {m.status === 'open' && m.parcelCount === 0 && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={(e) => { e.stopPropagation(); void handleDelete(m); }}
              aria-label={`Delete ${m.manifestNo}`}
            >
              <Trash2 size={14} />
            </Button>
          )}
        </div>
      ),
      width: '260px',
    },
  ];

  const renderParcels = (manifest: TransitManifestModel) => {
    const detail = details[manifest.id];

    if (!detail) {
      return (
        <p className="oov-status-empty">
          {detailLoadingId === manifest.id ? 'Loading parcels…' : 'Could not load the parcels on this manifest.'}
        </p>
      );
    }
    if (detail.parcels.length === 0) {
      return <p className="oov-status-empty">No parcels on this manifest yet.</p>;
    }

    const allSelected = detail.parcels.every((p) => selectedParcelIds.has(p.id));
    const someSelected = detail.parcels.some((p) => selectedParcelIds.has(p.id));

    return (
      <div className="oov-manifest-panel">
        {/* Parcels can only leave a manifest while it is still open - once
            dispatched its contents are a record of what went out. */}
        {manifest.status === 'open' && (
          <div className="oov-manifest-panel-bar">
            <span className="oov-muted">
              {someSelected
                ? `${detail.parcels.filter((p) => selectedParcelIds.has(p.id)).length} selected`
                : 'Tick parcels to take them off this manifest.'}
            </span>
            <Button variant="secondary" disabled={busy || !someSelected} onClick={() => removeSelectedParcels(manifest)}>
              <X size={14} /> Remove from manifest
            </Button>
          </div>
        )}

        <Table
          columns={parcelColumns(detail.parcels)}
          data={detail.parcels}
          selectable={manifest.status === 'open'}
          selectedIds={selectedParcelIds}
          onToggleRow={toggleParcelSelection}
          allSelected={allSelected}
          someSelected={someSelected}
          onToggleAll={() => toggleAllParcels(detail.parcels)}
          minWidth="1000px"
          tableClassName="oov-table"
          emptyMessage="No parcels on this manifest."
        />
      </div>
    );
  };

  return (
    <>
      {error && <p className="oov-action-error">{error}</p>}

      <div className="oov-toolbar">
        <span className="oov-selected-count">
          {selected
            ? `${isReceiving ? 'Receiving' : 'Scanning'} into ${selected.manifestNo}`
            : `Select a manifest to ${isReceiving ? 'receive' : 'scan into'}`}
        </span>
        {statusFilter === 'active' && (
          <div className="oov-toolbar-actions">
            <Button variant="secondary" className="oov-outline-btn" onClick={() => setCreateOpen(true)} disabled={busy}>
              <Plus size={14} /> New manifest
            </Button>
          </div>
        )}
      </div>

      <div className="oov-search-wrap">
        <label className="oov-search">
          <Search size={16} />
          <input
            value={buffer}
            onChange={(e) => setBuffer(e.target.value)}
            onKeyDown={handleScanKeyDown}
            onPaste={handleScanPaste}
            placeholder={canScan ? `Scan tracking id to ${scanVerb.toLowerCase()}` : 'Select a manifest first'}
            disabled={!canScan || busy}
          />
          {buffer && (
            <button type="button" onClick={resetScan} aria-label="Clear">
              <X size={14} />
            </button>
          )}
        </label>
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
        minWidth="1080px"
        tableClassName="oov-table"
        expandedRowId={expandedId}
        renderExpandedRow={renderParcels}
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
