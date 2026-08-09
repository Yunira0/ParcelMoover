import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import Button from '../components/Button';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import Table from '../components/Table';
import {
  COD_DETAIL_BUCKETS,
  getCodSettlementDetail,
  type CodDetailBucket,
  type CodDetailRow,
} from '../services/orders.service';
import { COD_BUCKET_META } from '../utils/codBuckets';
import { downloadExcel } from '../utils/excel';
import { formatCurrency, formatDate } from '../utils/format';
import './CodSettlementDetailPage.css';

const PAGE_SIZE = 10;

const isCodBucket = (value: string | undefined): value is CodDetailBucket =>
  !!value && (COD_DETAIL_BUCKETS as readonly string[]).includes(value);

const CodSettlementDetailPage: React.FC = () => {
  const { bucket } = useParams<{ bucket: string }>();
  const navigate = useNavigate();
  const [rows, setRows] = useState<CodDetailRow[]>([]);
  const [capped, setCapped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const validBucket = isCodBucket(bucket) ? bucket : null;
  const meta = validBucket ? COD_BUCKET_META[validBucket] : null;

  useEffect(() => {
    if (!validBucket) {
      // Unknown bucket in the URL - bounce back to the dashboard.
      navigate('/dashboard', { replace: true });
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setPage(1);
    getCodSettlementDetail(validBucket, controller.signal)
      .then((res) => {
        setRows(res.rows);
        setCapped(res.capped);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError('Failed to load COD settlement detail.');
        console.error(err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [validBucket, navigate]);

  // Deliberately summed over every row, not the visible page: this is the
  // figure the dashboard card showed, and seeing it reconcile is the reason
  // anyone opens this page.
  const bucketTotal = useMemo(() => rows.reduce((sum, r) => sum + r.bucketAmount, 0), [rows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const columns = useMemo(() => {
    // The bucket's own figure sits ahead of the context columns: on a laptop
    // the table is wider than the page, and the column the reader opened this
    // page for must not be the one that scrolls off.
    const bucketColumn = {
      header: meta?.amountHeader ?? 'AMOUNT',
      accessor: (r: CodDetailRow) => (
        <span className="cod-detail-bucket-amount">{formatCurrency(r.bucketAmount)}</span>
      ),
      width: '130px',
      className: 'cod-detail-num',
    };


    // For 'total' the bucket figure IS the collected amount, so a COLLECTED
    // column would print the same number twice.
    const context = [
      ...(validBucket === 'total'
        ? []
        : [
            {
              header: 'COLLECTED',
              accessor: (r: CodDetailRow) => formatCurrency(r.collectedAmount),
              width: '120px',
              className: 'cod-detail-num',
            },
          ]),
      {
        header: validBucket === 'pm-rider' ? 'REMITTED TO OFFICE' : 'REMITTED',
        accessor: (r: CodDetailRow) =>
          formatCurrency(validBucket === 'pm-rider' ? r.riderRemittedAmount : r.remittedAmount),
        width: '150px',
        className: 'cod-detail-num',
      },
    ];

    return [
      {
        header: 'SN',
        accessor: (r: CodDetailRow) => (currentPage - 1) * pageSize + pagedRows.indexOf(r) + 1,
        width: '50px',
      },
      {
        header: 'TRACKING ID',
        accessor: (r: CodDetailRow) => (
          <Link to={`/orders/track/${r.trackingId}`} className="tracking-id-link">
            {r.trackingId}
          </Link>
        ),
        // Matches VendorMetricDetail's tracking column. A full id wraps to two
        // lines here exactly as it does on the other order tables, and still
        // fits inside the table's standard row height.
        width: '190px',
      },
      { header: 'VENDOR', accessor: (r: CodDetailRow) => r.vendorName, width: '165px' },
      { header: 'RECEIVER', accessor: (r: CodDetailRow) => r.receiverName, width: '130px' },
      { header: 'RIDER', accessor: (r: CodDetailRow) => r.riderName ?? '-', width: '100px' },
      { header: 'DELIVERED', accessor: (r: CodDetailRow) => formatDate(r.deliveredAt), width: '105px' },
      bucketColumn,
      ...context,
    ];
  }, [meta?.amountHeader, validBucket, currentPage, pageSize, pagedRows]);

  const handleExport = () => {
    if (!validBucket || !meta) return;
    const headers = [
      '#',
      'Tracking ID',
      'Vendor',
      'Receiver',
      'Rider',
      'Delivered',
      'Collected',
      'Remitted to Vendor',
      'Remitted by Rider',
      'Delivery Charge',
      meta.amountHeader.charAt(0) + meta.amountHeader.slice(1).toLowerCase(),
    ];
    // Exports the whole bucket, not just the visible page - the spreadsheet is
    // for reconciling the full figure.
    const exportRows = rows.map((r) => [
      `#${r.orderNumber}`,
      r.trackingId,
      r.vendorName,
      r.receiverName,
      r.riderName ?? '',
      formatDate(r.deliveredAt),
      r.collectedAmount,
      r.remittedAmount,
      r.riderRemittedAmount,
      r.deliveryCharge,
      r.bucketAmount,
    ]);
    downloadExcel(`cod-${validBucket}.xlsx`, meta.title.slice(0, 31), headers, exportRows);
  };

  if (!meta) return null;

  return (
    <div className="cod-detail-page">
      <PageHeader title={meta.title} subtitle={meta.description} onBack={() => navigate('/dashboard')}>
        <Button variant="secondary" onClick={handleExport} disabled={loading || rows.length === 0}>
          <Download size={14} /> Download
        </Button>
      </PageHeader>

      <div className="cod-detail-stats">
        <div className="cod-detail-stat">
          <span className="cod-detail-stat-value">{loading ? '-' : formatCurrency(bucketTotal)}</span>
          <span className="cod-detail-stat-label">{meta.amountHeader}</span>
        </div>
        <div className="cod-detail-stat">
          <span className="cod-detail-stat-value">
            {loading ? '-' : `${rows.length.toLocaleString()}${capped ? '+' : ''}`}
          </span>
          <span className="cod-detail-stat-label">Orders</span>
        </div>
      </div>

      {capped && (
        <p className="cod-detail-notice">
          Showing the 1,000 most recently delivered orders — the total above covers only those rows,
          not the full bucket.
        </p>
      )}

      {error && <p className="cod-detail-error">{error}</p>}

      <Table
        columns={columns}
        data={pagedRows}
        selectable={false}
        loading={loading}
        loadingMessage="Loading COD detail..."
        emptyMessage="No orders in this bucket."
        minWidth="1140px"
      />

      {/* Rendered unconditionally, like every other operations table in the
          app. Hiding it under a row-count threshold means a bucket that
          happens to be short shows no pager and no rows-per-page control at
          all, which reads as "this page forgot pagination". */}
      <Pagination
        ariaLabel={`${meta.title} pages`}
        page={currentPage}
        totalPages={totalPages}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSizeLabel="orders"
        summary={
          loading
            ? 'Loading…'
            : rows.length === 0
              ? 'No orders'
              : `Showing ${(currentPage - 1) * pageSize + 1}–${Math.min(
                  currentPage * pageSize,
                  rows.length,
                )} of ${rows.length.toLocaleString()}${capped ? '+' : ''} orders`
        }
      />
    </div>
  );
};

export default CodSettlementDetailPage;
