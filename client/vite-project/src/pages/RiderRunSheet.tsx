import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Banknote,
  Bike,
  Eye,
  EyeOff,
  MapPin,
  Package,
  PackageCheck,
  Phone,
  Printer,
  Truck,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import Table from '../components/Table';
import Button from '../components/Button';
import SearchableSelect from '../components/SearchableSelect';
import StatusChip, { type StatusChipTone } from '../components/StatusChip';
import {
  getRiderRunSheet,
  subscribeToOrderStatusChanged,
  type ParcelStatus,
  type RunSheet,
  type RunSheetParcel,
} from '../services/orders.service';
import { getRiders } from '../services/users.service';
import { formatCurrency } from '../utils/format';
import { toBsDate, toNptTime } from '../utils/nepaliDate';
import './RiderRunSheet.css';

const ALL_RIDERS = '';

const STATUS_LABELS: Record<ParcelStatus, string> = {
  pickup_ordered: 'Pickup Ordered',
  rider_assigned: 'Rider Assigned',
  picked_up: 'Pickup Completed',
  arrived: 'Arrived at Origin',
  ready_to_deliver: 'Ready to Deliver',
  sent_for_delivery: 'Sent for Delivery',
  oov: 'Transit',
  dispatched: 'Dispatched',
  arrived_at_branch: 'Arrived at Destination',
  hold: 'Hold',
  loss_and_damage: 'Loss and Damage',
  delivered: 'Delivered',
  partially_delivered: 'Partially Delivered',
  failed_pickup: 'Failed Pickup',
  failed_delivery: 'Failed Delivery',
  cancelled: 'Cancelled',
  follow_up: 'Follow Up',
  ready_to_return: 'Ready to Return',
  sent_to_vendor: 'Sent to Vendor',
  returned_to_vendor: 'Returned to Vendor',
};

const getStatusTone = (status: ParcelStatus): StatusChipTone => {
  if (status === 'delivered') return 'success';
  if (status === 'partially_delivered') return 'warning';
  if (['failed_delivery', 'failed_pickup', 'loss_and_damage'].includes(status)) return 'danger';
  if (status === 'cancelled') return 'neutral';
  if (['sent_for_delivery', 'ready_to_deliver'].includes(status)) return 'info';
  return 'warning';
};

// Today's date in Nepal local time (UTC+5:45) - matches the server's day bucketing.
const nepalToday = () =>
  new Date(Date.now() + (5 * 60 + 45) * 60 * 1000).toISOString().slice(0, 10);

// One row per persisted run sheet - Table needs an `id` on every row.
type RunSheetRow = RunSheet & { sn: number };

const DateTimeCell: React.FC<{ iso: string | null }> = ({ iso }) => {
  if (!iso) return <>-</>;
  return (
    <div className="runsheet-datetime">
      <span>{toBsDate(iso)}</span>
      <small>{toNptTime(iso, true)}</small>
    </div>
  );
};

const parcelColumns = [
  {
    header: '#',
    accessor: (parcel: RunSheetParcel) => `#${parcel.orderNumber}`,
    width: '70px',
  },
  {
    header: 'TRACKING ID',
    accessor: (parcel: RunSheetParcel) => (
      <Link to={`/orders/track/${parcel.trackingId}`} className="tracking-id-link">
        {parcel.trackingId}
      </Link>
    ),
    width: '160px',
    className: 'runsheet-tracking-cell',
  },
  {
    header: 'RECEIVER',
    accessor: (parcel: RunSheetParcel) => (
      <div className="runsheet-party-cell">
        <span>{parcel.receiverName}</span>
        <small>{parcel.receiverPhone}</small>
      </div>
    ),
    width: '200px',
  },
  {
    header: 'DELIVERY ADDRESS',
    accessor: (parcel: RunSheetParcel) => parcel.address || parcel.destination || '-',
  },
  {
    header: 'PIECES',
    accessor: (parcel: RunSheetParcel) => parcel.pieces,
    width: '80px',
  },
  {
    header: 'COD',
    accessor: (parcel: RunSheetParcel) =>
      parcel.codAmount > 0 ? formatCurrency(parcel.codAmount, 0) : '-',
    width: '110px',
  },
  {
    header: 'VENDOR',
    accessor: (parcel: RunSheetParcel) => parcel.vendorName || '-',
    width: '160px',
  },
  {
    header: 'STATUS',
    accessor: (parcel: RunSheetParcel) => (
      <StatusChip tone={getStatusTone(parcel.status)}>
        {STATUS_LABELS[parcel.status] ?? parcel.status}
      </StatusChip>
    ),
    width: '160px',
  },
];

const RunSheetDetailCard: React.FC<{ sheet: RunSheet }> = ({ sheet }) => {
  const cardRef = React.useRef<HTMLElement>(null);

  // The card renders below the overview table, off-screen when there are many
  // sheets - bring it into view so "View" visibly does something.
  useEffect(() => {
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [sheet.id]);

  return (
  <section ref={cardRef} className="runsheet-rider-card">
    <header className="runsheet-rider-header">
      <div className="runsheet-rider-identity">
        <div className="runsheet-rider-avatar">
          <Bike size={20} />
        </div>
        <div className="runsheet-rider-info">
          <h2>{sheet.sheetNo}</h2>
          <div className="runsheet-rider-meta">
            <span><Bike size={13} /> {sheet.rider.name}</span>
            {sheet.rider.phone && (
              <span><Phone size={13} /> {sheet.rider.phone}</span>
            )}
            {sheet.rider.vehicleNo && (
              <span><Truck size={13} /> {sheet.rider.vehicleNo}</span>
            )}
            {sheet.rider.hub && (
              <span><MapPin size={13} /> {sheet.rider.hub}</span>
            )}
          </div>
        </div>
      </div>
      <div className="runsheet-rider-totals">
        <StatusChip tone="info" variant="solid">
          {sheet.outItems} out
        </StatusChip>
        <StatusChip tone="success" variant="solid">
          {sheet.deliveredItems} delivered
        </StatusChip>
        {sheet.failedItems > 0 && (
          <StatusChip tone="danger" variant="solid">
            {sheet.failedItems} failed
          </StatusChip>
        )}
        <StatusChip tone="warning" variant="solid">
          COD {formatCurrency(sheet.totalCod, 0)}
        </StatusChip>
      </div>
    </header>

    <Table
      columns={parcelColumns}
      data={sheet.parcels}
      selectable={false}
      minWidth="1010px"
      tableClassName="runsheet-table"
      emptyMessage="This run sheet has no parcels."
    />
  </section>
  );
};

const RiderRunSheet: React.FC = () => {
  const [sheets, setSheets] = useState<RunSheet[]>([]);
  const [summary, setSummary] = useState({
    totalSheets: 0,
    totalItems: 0,
    deliveredItems: 0,
    outItems: 0,
    totalCod: 0,
  });
  const [riders, setRiders] = useState<{ id: string; name: string }[]>([]);
  const [riderId, setRiderId] = useState(ALL_RIDERS);
  const [date, setDate] = useState(nepalToday);
  const [expandedSheetId, setExpandedSheetId] = useState('');
  const [selectedSheetIds, setSelectedSheetIds] = useState<Set<string | number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await getRiders();
        if (res?.success && Array.isArray(res.data)) {
          setRiders(res.data.filter((r: { status: string }) => r.status === 'active'));
        }
      } catch {
        // filter dropdown will just be empty; the sheet list itself still loads
      }
    })();
  }, []);

  const loadRunSheets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getRiderRunSheet({
        riderId: riderId || undefined,
        date: date || undefined,
      });
      if (res?.success && res.data) {
        setSheets(res.data.sheets);
        setSummary(res.data.summary);
        setLoadError('');
      }
    } catch {
      setLoadError('Failed to load run sheets. Showing the last loaded data, if any.');
    } finally {
      setLoading(false);
    }
  }, [riderId, date]);

  useEffect(() => { loadRunSheets(); }, [loadRunSheets]);
  useEffect(() => subscribeToOrderStatusChanged(loadRunSheets), [loadRunSheets]);

  const rows = useMemo<RunSheetRow[]>(
    () => sheets.map((sheet, index) => ({ ...sheet, sn: index + 1 })),
    [sheets],
  );
  const expandedSheet = sheets.find(sheet => sheet.id === expandedSheetId);

  const overviewColumns = [
    {
      header: 'S.N.',
      accessor: (row: RunSheetRow) => row.sn,
      width: '60px',
    },
    {
      header: 'RUNSHEET ID',
      accessor: (row: RunSheetRow) => row.sheetNo,
      width: '210px',
      className: 'runsheet-tracking-cell',
    },
    {
      header: 'CREATED',
      accessor: (row: RunSheetRow) => <DateTimeCell iso={row.createdAt} />,
      width: '120px',
    },
    {
      header: 'UPDATED',
      accessor: (row: RunSheetRow) => <DateTimeCell iso={row.updatedAt} />,
      width: '120px',
    },
    {
      header: 'VEHICLE',
      accessor: (row: RunSheetRow) => row.rider.vehicleNo || 'N/A',
      width: '110px',
    },
    {
      header: 'DRIVER',
      accessor: (row: RunSheetRow) => (
        <div className="runsheet-party-cell">
          <span>{row.rider.name}</span>
          <small>{row.rider.phone}</small>
        </div>
      ),
      width: '180px',
    },
    {
      header: 'HUB',
      accessor: (row: RunSheetRow) => row.rider.hub || '-',
      width: '130px',
    },
    {
      header: 'TOTAL ITEMS',
      accessor: (row: RunSheetRow) => <strong>{row.totalItems}</strong>,
      width: '100px',
    },
    {
      header: 'DELIVERED ITEMS',
      accessor: (row: RunSheetRow) =>
        row.totalItems > 0 && row.deliveredItems === row.totalItems ? (
          <StatusChip tone="success">{row.deliveredItems}</StatusChip>
        ) : (
          <strong>{row.deliveredItems}</strong>
        ),
      width: '130px',
    },
    {
      header: 'COD',
      accessor: (row: RunSheetRow) =>
        row.totalCod > 0 ? formatCurrency(row.totalCod, 0) : '-',
      width: '110px',
    },
    {
      header: 'PARCELS',
      accessor: (row: RunSheetRow) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setExpandedSheetId(current => (current === row.id ? '' : row.id))
          }
        >
          {expandedSheetId === row.id ? (
            <><EyeOff size={14} /> Hide</>
          ) : (
            <><Eye size={14} /> View</>
          )}
        </Button>
      ),
      width: '110px',
    },
  ];

  return (
    <div className="runsheet-container">
      <PageHeader
        title="Rider Run Sheet"
        subtitle="Every hand-off batch sent out for delivery - one numbered sheet per rider trip."
      />

      <div className="runsheet-stats">
        <StatCard icon={Package} label="Total Items" value={summary.totalItems} />
        <StatCard icon={Truck} label="Out for Delivery" value={summary.outItems} />
        <StatCard icon={PackageCheck} label="Delivered" value={summary.deliveredItems} />
        <StatCard icon={Banknote} label="COD on Sheets" value={formatCurrency(summary.totalCod, 0)} />
      </div>

      <div className="runsheet-toolbar">
        <div className="runsheet-filters">
          <div className="runsheet-filter-group">
            <label className="runsheet-filter-label">Rider</label>
            <SearchableSelect
              options={[
                { id: ALL_RIDERS, label: 'All Riders' },
                ...riders.map(r => ({ id: r.id, label: r.name })),
              ]}
              value={riderId}
              onChange={setRiderId}
              placeholder="All Riders"
              searchPlaceholder="Search rider by name..."
              emptyMessage="No active riders found."
            />
          </div>
          <div className="runsheet-filter-group">
            <label className="runsheet-filter-label">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="runsheet-date-input"
            />
          </div>
        </div>
        <div className="runsheet-toolbar-right">
          {selectedSheetIds.size > 0 && (
            <span className="runsheet-selected-count">
              {selectedSheetIds.size} sheet{selectedSheetIds.size === 1 ? '' : 's'} selected
            </span>
          )}
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer size={14} /> Print
          </Button>
        </div>
      </div>

      {loadError && <p className="runsheet-error">{loadError}</p>}

      <Table
        columns={overviewColumns}
        data={rows}
        onSelectionChange={setSelectedSheetIds}
        getRowClassName={row => (row.id === expandedSheetId ? 'runsheet-row-active' : '')}
        loading={loading && rows.length === 0}
        loadingMessage="Loading run sheets..."
        emptyMessage={`No run sheets on ${date}.`}
        minWidth="1420px"
        tableClassName="runsheet-table"
      />

      {expandedSheet && <RunSheetDetailCard sheet={expandedSheet} />}
    </div>
  );
};

export default RiderRunSheet;
