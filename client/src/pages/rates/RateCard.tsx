import React, { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import Pagination from '../../components/Pagination';
import SearchField from '../../components/SearchField';
import StatusChip from '../../components/StatusChip';
import Table from '../../components/Table';
import { apiErrorMessage } from '../../utils/serverValidation';
import { updateLocation, type Destination } from '../../services/locations.service';
import {
  deleteDeliveryRate,
  upsertDeliveryRate,
  type DeliveryRate,
} from '../../services/deliveryRates.service';
import './RateCard.css';

type RowEdit = { rate: string; branchRate: string };

interface Row {
  id: string;
  name: string;
  code: string | null;
  /** Set for a covered area that has a route rate of its own. */
  parentName: string | null;
  perDestinationRate: number | null;
  branchPerDestinationRate: number | null;
  /** Branch views only: the route rate behind this row, if one exists. */
  route: DeliveryRate | null;
}

interface Props {
  destinations: Destination[];
  /** True for head office, whose rates live on the destinations themselves. */
  isHeadOffice: boolean;
  originLocationId: string;
  originName: string;
  /** Branch views only - every route rate out of this origin. */
  rates: DeliveryRate[];
  loading: boolean;
  canEditRates: boolean;
  /** Refetch destinations and rates after a write. */
  onChanged: () => Promise<void> | void;
  /** Origin picker and import toggle, shown in the panel header. */
  controls: React.ReactNode;
  /** When set, replaces the table (an open import). */
  importPanel?: React.ReactNode;
}

const str = (value: number | null | undefined) => (value == null ? '' : String(value));

const PAGE_SIZE = 10;

// One panel for every origin. Head office reads and writes each destination's
// own rate; any other origin reads and writes its delivery_rates route to that
// destination. Zone and valley belong to the destination, so they're edited on
// Destinations & Areas rather than here.
const RateCard: React.FC<Props> = ({
  destinations,
  isHeadOffice,
  originLocationId,
  originName,
  rates,
  loading,
  canEditRates,
  onChanged,
  controls,
  importPanel,
}) => {
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [savingRow, setSavingRow] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSizeChoice, setPageSizeChoice] = useState(PAGE_SIZE);
  const [searchQuery, setSearchQuery] = useState('');

  // Keyed by location id, never by name - two locations can share a display
  // name, and matching by name would price one as the other.
  const routeByDestinationId = useMemo(
    () => new Map(rates.map((rate) => [rate.destinationLocationId, rate])),
    [rates],
  );

  const rows = useMemo<Row[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    const matches = (d: Destination) =>
      !q ||
      d.name.toLowerCase().includes(q) ||
      (d.code || '').toLowerCase().includes(q) ||
      d.areas.some((a) => a.name.toLowerCase().includes(q));

    const built: Row[] = [];
    const seen = new Set<string>();
    for (const d of destinations) {
      if (d.parentId || !d.isActive || !matches(d)) continue;
      built.push({
        id: d.id,
        name: d.name,
        code: d.code,
        parentName: null,
        perDestinationRate: d.perDestinationRate,
        branchPerDestinationRate: d.branchPerDestinationRate,
        route: routeByDestinationId.get(d.id) ?? null,
      });
      seen.add(d.id);
      if (isHeadOffice) continue;
      // A covered area only gets a row of its own once it has its own route
      // rate - otherwise its destination's row prices it. Keeps legacy
      // area-level routes reachable without inviting new ones.
      for (const area of d.areas) {
        const route = routeByDestinationId.get(area.id);
        if (!route) continue;
        built.push({
          id: area.id,
          name: area.name,
          code: area.code,
          parentName: d.name,
          perDestinationRate: null,
          branchPerDestinationRate: null,
          route,
        });
        seen.add(area.id);
      }
    }
    // A route to a location the destinations list no longer carries would
    // otherwise vanish from the page while still pricing orders.
    if (!isHeadOffice && !q) {
      for (const route of rates) {
        if (seen.has(route.destinationLocationId)) continue;
        built.push({
          id: route.destinationLocationId,
          name: route.destinationLocationName,
          code: null,
          parentName: null,
          perDestinationRate: null,
          branchPerDestinationRate: null,
          route,
        });
      }
    }
    return built;
  }, [destinations, rates, routeByDestinationId, isHeadOffice, searchQuery]);

  const savedRow = (row: Row): RowEdit => ({
    rate: isHeadOffice ? str(row.perDestinationRate) : str(row.route?.baseCharge),
    branchRate: isHeadOffice ? str(row.branchPerDestinationRate) : str(row.route?.branchBaseCharge),
  });
  // Derived on read, not copied into state by an effect, so a refetch after
  // one row's save can't wipe a different row that is mid-edit.
  const rowFor = (row: Row) => edits[row.id] ?? savedRow(row);
  const setRow = (row: Row, patch: Partial<RowEdit>) =>
    setEdits((prev) => ({ ...prev, [row.id]: { ...(prev[row.id] ?? savedRow(row)), ...patch } }));
  const dropEdit = (id: string) =>
    setEdits((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const isDirty = (row: Row) => {
    const edit = edits[row.id];
    if (!edit) return false;
    const saved = savedRow(row);
    return edit.rate.trim() !== saved.rate || edit.branchRate.trim() !== saved.branchRate;
  };

  const flash = (text: string) => {
    setStatus(text);
    setTimeout(() => setStatus(''), 2000);
  };

  const saveRow = async (row: Row) => {
    const edit = rowFor(row);
    const rate = edit.rate.trim();
    const branchRate = edit.branchRate.trim();
    if (!isHeadOffice && rate === '' && branchRate !== '') {
      setError(`Enter a rate for ${row.name} before its branch rate.`);
      return;
    }
    setSavingRow(row.id);
    setError('');
    try {
      if (isHeadOffice) {
        await updateLocation(row.id, {
          perDestinationRate: rate === '' ? null : Number(rate),
          branchPerDestinationRate: branchRate === '' ? null : Number(branchRate),
        });
      } else if (rate === '') {
        // Blanking a route's rate removes the route, the way head office's
        // blank rate means "no per-destination rate".
        if (row.route) await deleteDeliveryRate(row.route.id);
      } else {
        await upsertDeliveryRate({
          originLocationId,
          destinationLocationId: row.id,
          baseCharge: Number(rate),
          branchBaseCharge: branchRate === '' ? null : Number(branchRate),
          // This panel has no columns for these, so an existing route keeps
          // what it had - the upsert would otherwise reset them to 0 / 2kg
          // and silently reprice returns and heavy parcels.
          ...(row.route
            ? {
                returnPercent: row.route.returnPercent,
                branchReturnPercent: row.route.branchReturnPercent,
                extraWeightPercent: row.route.extraWeightPercent,
                freeWeightKg: row.route.freeWeightKg,
              }
            : {}),
        });
      }
      dropEdit(row.id);
      await onChanged();
      flash(`Saved ${row.name}.`);
    } catch (err) {
      setError(apiErrorMessage(err, `Failed to save ${row.name}.`));
    } finally {
      setSavingRow(null);
    }
  };

  // Sends the clear directly rather than through local row state, so it can't
  // race a pending edit on the same row.
  const clearRow = async (row: Row) => {
    setSavingRow(row.id);
    setError('');
    try {
      if (isHeadOffice) {
        await updateLocation(row.id, { perDestinationRate: null, branchPerDestinationRate: null });
      } else if (row.route) {
        await deleteDeliveryRate(row.route.id);
      }
      dropEdit(row.id);
      await onChanged();
      flash(`Cleared ${row.name}.`);
    } catch (err) {
      setError(apiErrorMessage(err, `Failed to clear ${row.name}.`));
    } finally {
      setSavingRow(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSizeChoice));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = rows.slice((currentPage - 1) * pageSizeChoice, currentPage * pageSizeChoice);

  const rateInput = (row: Row, key: keyof RowEdit, label: string, placeholder: string) => (
    <FormField
      // The column header names the field visually; this label is for screen
      // readers, which otherwise hear a bare, unlabelled input per row.
      label={`${label} for ${row.name}`}
      className="rates-panel-input"
      type="decimal"
      value={rowFor(row)[key]}
      onChange={(value) => setRow(row, { [key]: value })}
      placeholder={placeholder}
      disabled={!canEditRates || savingRow === row.id}
    />
  );

  const columns = [
    {
      header: 'Destination',
      accessor: (row: Row) => (
        <div className="rates-panel-destination">
          <span className="rates-panel-destination-name">{row.name}</span>
          {(row.parentName || row.code) && (
            <span className="rates-panel-destination-meta">
              {row.parentName ? `Covered area of ${row.parentName}` : row.code}
            </span>
          )}
          {row.route && !row.route.isActive && <StatusChip tone="neutral">Inactive</StatusChip>}
        </div>
      ),
    },
    {
      header: isHeadOffice ? 'Per-destination rate (Rs.)' : 'Rate (Rs.)',
      accessor: (row: Row) => rateInput(row, 'rate', 'Rate', 'e.g. 155'),
      width: '180px',
    },
    {
      header: 'Branch rate (Rs.)',
      accessor: (row: Row) => rateInput(row, 'branchRate', 'Branch rate', 'e.g. 100'),
      width: '180px',
    },
    ...(canEditRates
      ? [{
          header: '',
          accessor: (row: Row) => {
            const saved = savedRow(row);
            const hasRate = isHeadOffice ? Boolean(saved.rate || saved.branchRate) : Boolean(row.route);
            const dirty = isDirty(row);
            // Saving an inactive route re-activates it, so it stays actionable
            // even with its numbers unchanged.
            const reactivate = Boolean(row.route && !row.route.isActive && !dirty);
            return (
              <div className="rates-panel-actions">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={savingRow === row.id || (!dirty && !reactivate)}
                  onClick={() => saveRow(row)}
                >
                  {savingRow === row.id ? 'Saving…' : reactivate ? 'Activate' : 'Save'}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={savingRow === row.id || !hasRate}
                  onClick={() => clearRow(row)}
                  aria-label={`Clear rates for ${row.name}`}
                  title="Clear rates"
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            );
          },
          width: '120px',
        }]
      : []),
  ];

  return (
    <section className="rates-panel">
      <header className="rates-panel-head">
        <div className="rates-panel-title">
          <h2>{isHeadOffice ? 'Per-destination rates' : `Rates from ${originName || 'this branch'}`}</h2>
          <p>
            {isHeadOffice
              ? 'Each destination’s own rate for head-office orders. A vendor’s rate card can override it; return, extra-weight and free-weight charges come from Global Pricing.'
              : 'The rate from this branch to each destination. A destination left blank can’t be ordered from this branch.'}
          </p>
        </div>
        <div className="rates-panel-controls">{controls}</div>
      </header>

      {importPanel ? (
        <div className="rates-panel-body">{importPanel}</div>
      ) : (
        <>
          <div className="rates-panel-toolbar">
            <SearchField
              value={searchQuery}
              onChange={(value) => { setSearchQuery(value); setPage(1); }}
              placeholder="Search destinations, codes or covered areas"
              width="100%"
            />
            {status && <span className="rates-panel-status" role="status">{status}</span>}
          </div>

          {error && (
            <div className="rates-panel-banner">
              <Banner tone="danger">{error}</Banner>
            </div>
          )}

          <Table
            columns={columns}
            data={pagedRows}
            selectable={false}
            loading={loading}
            loadingMessage="Loading rates…"
            emptyMessage={
              searchQuery
                ? `No destinations match “${searchQuery}”.`
                : 'No destinations yet. Add them on the Destinations & Areas tab.'
            }
            getRowClassName={(row) => (row.parentName ? 'rates-panel-row--area' : '')}
          />

          {!loading && rows.length > 0 && (
            <div className="rates-panel-footer">
              <Pagination
                page={currentPage}
                totalPages={totalPages}
                onPageChange={setPage}
                ariaLabel="Rate pages"
                pageSize={pageSizeChoice}
                pageSizeLabel="destinations"
                onPageSizeChange={(size) => { setPageSizeChoice(size); setPage(1); }}
                summary={`Showing ${(currentPage - 1) * pageSizeChoice + 1}–${Math.min(currentPage * pageSizeChoice, rows.length)} of ${rows.length} destinations`}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default RateCard;
