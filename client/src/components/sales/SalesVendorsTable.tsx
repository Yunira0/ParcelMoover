import React, { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import Table from '../Table';
import Pagination from '../Pagination';
import Button from '../Button';
import { getVendors } from '../../services/users.service';
import { salesVendorName, type SalesVendor } from '../../services/salesOverview.service';
import { toBsDate } from '../../utils/nepaliDate';
import './SalesVendorsTable.css';

// Every vendor one sales rep owns, with the same figures Vendor Management
// shows (all-time, not the page's date range).
const PAGE_SIZE = 10;

interface SalesVendorsTableProps {
  salesUserId: string;
  selectedVendor: SalesVendor | null;
  /** Picking the selected vendor again clears the pick. */
  onSelectVendor: (vendor: SalesVendor | null) => void;
}

const SalesVendorsTable: React.FC<SalesVendorsTableProps> = ({ salesUserId, selectedVendor, onSelectVendor }) => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  // One result per request; while the current request has none yet, it is loading.
  const requestKey = `${salesUserId}:${page}:${pageSize}`;
  const [result, setResult] = useState<{
    key: string; vendors: SalesVendor[]; total: number; totalPages: number; error: string;
  } | null>(null);
  const current = result?.key === requestKey ? result : null;
  const loading = current === null;
  const vendors = current?.vendors ?? result?.vendors ?? [];
  const total = current?.total ?? result?.total ?? 0;
  const totalPages = current?.totalPages ?? result?.totalPages ?? 1;
  const error = current?.error ?? '';

  // A different rep starts from their first page.
  const [pageFor, setPageFor] = useState(salesUserId);
  if (pageFor !== salesUserId) {
    setPageFor(salesUserId);
    setPage(1);
  }

  useEffect(() => {
    let active = true;
    getVendors({ salesUserId, page, pageSize })
      .then((res) => {
        if (!active) return;
        setResult({
          key: requestKey,
          vendors: res?.success && Array.isArray(res.data) ? res.data : [],
          total: res?.meta?.total ?? 0,
          totalPages: res?.meta?.totalPages ?? 1,
          error: '',
        });
      })
      .catch(() => {
        if (active) setResult({ key: requestKey, vendors: [], total: 0, totalPages: 1, error: "Failed to load this sales rep's vendors." });
      });
    return () => { active = false; };
  }, [requestKey, salesUserId, page, pageSize]);

  const isSelected = (v: SalesVendor) => v.id === selectedVendor?.id;

  const columns = [
    {
      header: 'VENDOR NAME',
      // A real button so the row can be reached and picked from the keyboard;
      // its click bubbles to the row's own handler, which does the picking.
      accessor: (v: SalesVendor) => (
        <button
          type="button"
          className="sales-vendor-pick"
          aria-pressed={isSelected(v)}
          title={`Show ${salesVendorName(v)}'s orders`}
        >
          {isSelected(v) && <Check size={14} aria-hidden="true" />}
          <span>{salesVendorName(v)}</span>
        </button>
      ),
      width: '220px',
    },
    {
      header: 'EMAIL',
      accessor: (v: SalesVendor) => (
        <span className="sales-vendor-email" title={v.email || undefined}>{v.email || '—'}</span>
      ),
      width: '230px',
    },
    { header: 'PHONE', accessor: (v: SalesVendor) => v.phone || '—', width: '130px', className: 'sales-vendors-figure' },
    {
      header: 'ORDERS',
      accessor: (v: SalesVendor) => (
        <dl className="sales-vendor-orders">
          <dt>Total order</dt>
          <dd>{v.orders.total.toLocaleString()}</dd>
          <dt>Delivered</dt>
          <dd>{v.orders.delivered.toLocaleString()}</dd>
          <dt>Returned</dt>
          <dd>{v.orders.returned.toLocaleString()}</dd>
        </dl>
      ),
      width: '170px',
    },
    {
      header: 'COD DUE',
      accessor: (v: SalesVendor) => (
        <span className={v.codDue > 0 ? undefined : 'sales-vendor-nil'}>
          Rs. {Math.round(v.codDue).toLocaleString()}
        </span>
      ),
      width: '130px',
      className: 'sales-vendors-figure sales-vendors-money',
    },
    // The API sends these as AD "YYYY-MM-DD"; every date shown in this app is BS.
    { header: 'JOINED', accessor: (v: SalesVendor) => toBsDate(v.joined) || '—', width: '120px', className: 'sales-vendors-figure' },
    {
      header: 'LAST ORDER DATE',
      accessor: (v: SalesVendor) =>
        toBsDate(v.lastOrderedDate) || (v.orders.total === 0 ? <span className="sales-vendor-nil">No orders yet</span> : '—'),
      width: '150px',
      className: 'sales-vendors-figure',
    },
  ];

  return (
    <section
      className={`sales-vendors${loading && vendors.length > 0 ? ' is-refreshing' : ''}`}
      aria-labelledby="sales-vendors-title"
      aria-busy={loading}
    >
      <div className="sales-vendors-head">
        <div>
          <h2 id="sales-vendors-title" className="sales-vendors-title">
            Vendors {!loading && <span className="sales-vendors-count">({total})</span>}
          </h2>
          <p className="sales-vendors-hint">
            {selectedVendor
              ? <>Showing <strong>{salesVendorName(selectedVendor)}</strong> only. Click it again or clear to see every vendor.</>
              : 'Click a vendor to see its orders.'}
          </p>
        </div>
        {selectedVendor && (
          <Button variant="outline" size="sm" onClick={() => onSelectVendor(null)}>
            <X size={14} /> Show all vendors
          </Button>
        )}
      </div>

      {error && <p className="order-load-error">{error}</p>}

      <Table
        columns={columns}
        data={vendors}
        selectable={false}
        loading={loading && vendors.length === 0}
        loadingMessage="Loading vendors..."
        emptyMessage="This sales rep has no vendors yet."
        minWidth="1120px"
        tableClassName="sales-vendors-table"
        onRowClick={(v) => onSelectVendor(selectedVendor?.id === v.id ? null : v)}
        getRowClassName={(v) => (isSelected(v) ? 'selected-row' : '')}
      />

      {/* Only when there's more than one page to move through (or the size was changed). */}
      {(totalPages > 1 || pageSize !== PAGE_SIZE) && (
        <Pagination
          ariaLabel="Sales rep vendors pagination"
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          summary={`${total} vendor${total === 1 ? '' : 's'}`}
          pageSize={pageSize}
          pageSizeLabel="vendors"
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}
    </section>
  );
};

export default SalesVendorsTable;
