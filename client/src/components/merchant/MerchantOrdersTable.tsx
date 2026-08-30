import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import Table from '../Table';
import Pagination from '../Pagination';
import StatusChip from '../StatusChip';
import SearchField from '../SearchField';
import Button from '../Button';
import { ORDER_STATUS_LABELS, getOrderStatusTone } from '../../utils/orderStatus';
import { toBsDateTime } from '../../utils/nepaliDate';
import { formatMoney } from '../../utils/format';
import type { Order } from '../../services/orders.service';
import './MerchantOrdersTable.css';

interface MerchantOrdersTableProps {
  orders: Order[];
  loading?: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  page: number;
  pageSize: number;
  totalRows: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onDownload: () => void;
  downloading?: boolean;
}

/** The waybill list beneath the roll-up: same columns as the screenshot, paged on the client. */
const MerchantOrdersTable: React.FC<MerchantOrdersTableProps> = ({
  orders,
  loading = false,
  search,
  onSearchChange,
  page,
  pageSize,
  totalRows,
  onPageChange,
  onPageSizeChange,
  onDownload,
  downloading = false,
}) => {
  const columns = useMemo(
    () => [
      {
        header: 'WAYBILL',
        accessor: (o: Order) => (
          <div className="merchant-orders-waybill">
            <Link
              to={`/orders/track/${encodeURIComponent(o.trackingId)}`}
              className="merchant-orders-link"
            >
              #{o.orderNumber} · {o.trackingId}
            </Link>
            <span className="merchant-orders-subtext">{toBsDateTime(o.createdAt) || '—'}</span>
            <span className="merchant-orders-subtext">{o.serviceType?.toUpperCase()}</span>
          </div>
        ),
      },
      { header: 'REF. NO.', accessor: () => <span className="merchant-orders-subtext">N/A</span> },
      { header: 'ORIGIN', accessor: (o: Order) => o.origin || '—' },
      {
        header: 'SENDER',
        accessor: (o: Order) => (
          <div>
            <div>{o.senderName}</div>
            <span className="merchant-orders-subtext">{o.senderPhone}</span>
          </div>
        ),
      },
      {
        header: 'RECEIVER',
        accessor: (o: Order) => (
          <div>
            <div>{o.receiverName}</div>
            <span className="merchant-orders-subtext">{o.receiverPhone}</span>
            {o.receiverAddress && (
              <span className="merchant-orders-subtext">{o.receiverAddress}</span>
            )}
          </div>
        ),
      },
      { header: 'DESTINATION', accessor: (o: Order) => o.destination || '—' },
      {
        header: 'FINANCE',
        accessor: (o: Order) => (
          <div className="merchant-orders-finance">
            <span>COD: {formatMoney(o.codAmount)}</span>
            <span>Collected: {formatMoney(o.collectedAmount)}</span>
            <span>D. Charge: {formatMoney(o.deliveryCharge)}</span>
          </div>
        ),
      },
      { header: 'WEIGHT', accessor: (o: Order) => `${o.weightKg ?? 0} Kg` },
      { header: 'PIECES', accessor: (o: Order) => `${o.pieces} pieces` },
      {
        header: 'REMARKS',
        accessor: (o: Order) =>
          o.remarks ? o.remarks : <span className="merchant-orders-subtext">0 Remarks</span>,
      },
      {
        header: 'STATUS',
        accessor: (o: Order) => (
          <StatusChip tone={getOrderStatusTone(o.status)}>{ORDER_STATUS_LABELS[o.status]}</StatusChip>
        ),
      },
    ],
    [],
  );

  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

  return (
    <div className="merchant-orders">
      <div className="merchant-orders-toolbar">
        <SearchField
          value={search}
          onChange={onSearchChange}
          placeholder="Search"
          ariaLabel="Search orders"
          width="260px"
        />
        <Button
          variant="secondary"
          onClick={onDownload}
          disabled={downloading || loading || totalRows === 0}
        >
          <Download size={16} /> {downloading ? 'Preparing…' : 'Download'}
        </Button>
      </div>

      <Table
        columns={columns}
        data={orders}
        selectable={false}
        loading={loading}
        loadingMessage="Loading orders…"
        emptyMessage="No orders found for this merchant and range."
      />

      <Pagination
        ariaLabel="Merchant orders pagination"
        page={page}
        totalPages={totalPages}
        onPageChange={onPageChange}
        pageSize={pageSize}
        pageSizeLabel="orders"
        onPageSizeChange={onPageSizeChange}
        summary={`${totalRows.toLocaleString()} order${totalRows === 1 ? '' : 's'}`}
      />
    </div>
  );
};

export default MerchantOrdersTable;
