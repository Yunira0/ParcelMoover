import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Table from '../../components/Table';
import Pagination from '../../components/Pagination';
import StatusChip from '../../components/StatusChip';
import FormField from '../../components/FormField';
import NepaliDatePicker from '../../components/NepaliDatePicker';
import { Banner } from '../accounting/ui';
import { money } from '../accounting/format';
import {
  CARRIERS,
  CARRIER_LABEL,
  getCarrierSettlements,
  type CarrierCode,
  type CarrierSettlementRow,
  type CarrierSettlementStatus,
} from '../../services/carrierCod.service';
import { settlementStatusLabel, settlementStatusTone } from '../../utils/settlementStatus';
import { toBsDate } from '../../utils/nepaliDate';
import '../accounting/Accounting.css';

const PAGE_SIZE = 20;

/** 3PL COD statements - the same list as Rider COD and Vendor COD, one row per carrier statement. */
const CarrierCodPage: React.FC = () => {
  const navigate = useNavigate();
  const [carrier, setCarrier] = useState<CarrierCode | ''>('');
  const [status, setStatus] = useState<CarrierSettlementStatus | ''>('');
  const [settledFrom, setSettledFrom] = useState('');
  const [settledTo, setSettledTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [items, setItems] = useState<CarrierSettlementRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getCarrierSettlements({
      ...(carrier ? { carrier } : {}),
      ...(status ? { status } : {}),
      ...(settledFrom ? { settledFrom } : {}),
      ...(settledTo ? { settledTo } : {}),
      page,
      pageSize,
    })
      .then((res) => {
        if (!active) return;
        setItems(res.data);
        setTotal(res.meta.total);
        setTotalPages(res.meta.totalPages);
      })
      .catch((err) => active && setError(err?.response?.data?.message || 'Failed to load settlements.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [carrier, status, settledFrom, settledTo, page, pageSize]);

  const rows = useMemo(
    () => items.map((item, index) => ({ ...item, sn: (page - 1) * pageSize + index + 1 })),
    [items, page, pageSize],
  );
  type Row = (typeof rows)[number];

  /** Any filter change puts you back on page 1. */
  const applyFilter = (change: () => void) => {
    change();
    setPage(1);
  };

  return (
    <div className="acc-page">
      <PageHeader
        title="3PL COD"
        actionLabel="Add settlement"
        actionIcon={<Plus size={16} />}
        onAction={() => navigate(`/finance/carrier-cod/new${carrier ? `?carrier=${carrier}` : ''}`)}
      />

      <div className="acc-toolbar">
        <div className="acc-filters">
          <label>
            <span>CARRIER</span>
            <FormField
              label=""
              type="select"
              value={carrier}
              onChange={(value) => applyFilter(() => setCarrier(value as CarrierCode | ''))}
              options={[{ value: '', label: 'All carriers' }, ...CARRIERS.map((c) => ({ value: c, label: CARRIER_LABEL[c] }))]}
            />
          </label>
          <label>
            <span>SETTLED FROM</span>
            <NepaliDatePicker value={settledFrom} onChange={(value) => applyFilter(() => setSettledFrom(value))} placeholder="Start date" />
          </label>
          <label>
            <span>TO</span>
            <NepaliDatePicker value={settledTo} onChange={(value) => applyFilter(() => setSettledTo(value))} placeholder="End date" />
          </label>
        </div>

        <label>
          <span>STATUS</span>
          <FormField
            label=""
            type="select"
            value={status}
            onChange={(value) => applyFilter(() => setStatus(value as CarrierSettlementStatus | ''))}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'settled', label: 'Settled' },
              { value: 'partially_paid', label: 'Partially paid' },
              { value: 'pending', label: 'Pending' },
            ]}
          />
        </label>
      </div>

      {error && <Banner tone="danger">{error}</Banner>}

      <Table
        selectable={false}
        loading={loading}
        loadingMessage="Loading settlements…"
        data={rows}
        columns={[
          { header: 'SN', accessor: 'sn', width: '60px' },
          {
            header: 'Statement ID',
            width: '185px',
            accessor: (item: Row) => (
              <button type="button" className="acc-link acc-entry-no" onClick={() => navigate(`/finance/carrier-cod/${item.id}`)}>
                {item.statementNo}
              </button>
            ),
          },
          { header: 'Carrier', width: '110px', accessor: (item: Row) => CARRIER_LABEL[item.carrier] },
          {
            header: 'Amount',
            width: '130px',
            className: 'acc-num',
            accessor: (item: Row) => <span className="acc-num">{money(item.netReceivable)}</span>,
          },
          { header: 'Settled date', width: '125px', accessor: (item: Row) => (item.settledAt ? toBsDate(item.settledAt) : '—') },
          {
            header: 'Payment',
            width: '185px',
            accessor: (item: Row) =>
              item.paymentBreakdown.length > 0 ? (
                <>
                  {item.paymentBreakdown.map((line) => (
                    <span key={line.method} className="acc-stack">
                      {line.method} - {money(line.amount)}
                    </span>
                  ))}
                </>
              ) : (
                <span className="acc-muted">Not paid</span>
              ),
          },
          {
            header: 'Status',
            width: '120px',
            accessor: (item: Row) => (
              <StatusChip variant="solid" tone={settlementStatusTone(item.status)}>
                {settlementStatusLabel(item.status)}
              </StatusChip>
            ),
          },
          { header: 'Remark', width: '190px', accessor: (item: Row) => item.remark || '—' },
        ]}
        minWidth="1110px"
        emptyMessage="No 3PL settlements recorded yet."
      />

      <Pagination
        ariaLabel="Settlements pagination"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(size) => applyFilter(() => setPageSize(size))}
        summary={`${total} settlement${total === 1 ? '' : 's'}`}
      />
    </div>
  );
};

export default CarrierCodPage;
