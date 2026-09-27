import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banknote, Hourglass, Plus, Receipt, Truck } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import StatCard from '../../components/StatCard';
import StatusChip from '../../components/StatusChip';
import Table from '../../components/Table';
import Button from '../../components/Button';
import SegmentedTabs from '../../components/SegmentedTabs';
import { Banner } from '../accounting/ui';
import { money } from '../accounting/format';
import {
  CARRIERS,
  CARRIER_LABEL,
  getCarrierCodSummary,
  getCarrierSettlements,
  type CarrierCode,
  type CarrierCodSummary,
  type CarrierSettlementRow,
} from '../../services/carrierCod.service';
import { settlementStatusLabel, settlementStatusTone } from '../../utils/settlementStatus';
import { toBsDate } from '../../utils/nepaliDate';
import { apiErrorMessage } from '../../utils/serverValidation';
import '../accounting/Accounting.css';

/** COD NCM and Upaya collected for us: what they have paid, kept and still owe. */
const CarrierCodPage: React.FC = () => {
  const navigate = useNavigate();
  const [carrier, setCarrier] = useState<CarrierCode>('ncm');
  const [summary, setSummary] = useState<CarrierCodSummary[]>([]);
  const [statements, setStatements] = useState<CarrierSettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([getCarrierCodSummary(), getCarrierSettlements({ carrier })])
      .then(([s, rows]) => {
        if (!live) return;
        setSummary(s);
        setStatements(rows);
        setError('');
      })
      .catch((err) => live && setError(apiErrorMessage(err, 'Failed to load 3PL COD.')))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [carrier]);

  const current = summary.find((s) => s.carrier === carrier);
  const label = CARRIER_LABEL[carrier];

  return (
    <div className="acc-page">
      <PageHeader
        title="3PL COD"
        actionLabel={`New ${label} statement`}
        actionIcon={<Plus size={16} />}
        onAction={() => navigate(`/finance/carrier-cod/new?carrier=${carrier}`)}
      />

      <SegmentedTabs
        ariaLabel="Carrier"
        fullWidth={false}
        value={carrier}
        onChange={setCarrier}
        options={CARRIERS.map((c) => ({ value: c, label: CARRIER_LABEL[c] }))}
      />

      {error && <Banner tone="danger">{error}</Banner>}

      {current && (
        <div className="acc-cards">
          <StatCard icon={Truck} label="COD collected" value={money(current.collected)} hint={`On orders ${label} delivered`} />
          <StatCard icon={Banknote} label="Received" value={money(current.received)} tone="positive" hint={`Cash ${label} has paid us`} />
          <StatCard icon={Receipt} label={`${label} charges`} value={money(current.charges)} hint="Kept by the carrier, on statements" />
          <StatCard
            icon={Hourglass}
            label="Still to receive"
            value={money(current.outstanding)}
            tone={current.outstanding > 0 ? 'negative' : 'default'}
            hint={current.notOnStatement > 0 ? `${money(current.notOnStatement)} not on a statement yet` : 'Everything delivered is on a statement'}
          />
        </div>
      )}

      <Table
        selectable={false}
        loading={loading}
        loadingMessage="Loading statements…"
        emptyMessage={`No ${label} statements yet.`}
        data={statements}
        columns={[
          {
            header: 'Statement',
            width: '190px',
            accessor: (s: CarrierSettlementRow) => (
              <button type="button" className="acc-link acc-entry-no" onClick={() => navigate(`/finance/carrier-cod/${s.id}`)}>
                {s.statementNo}
              </button>
            ),
          },
          { header: 'Date', width: '110px', accessor: (s: CarrierSettlementRow) => toBsDate(s.settlementDate) || s.settlementDate },
          { header: 'Orders', width: '80px', accessor: (s: CarrierSettlementRow) => s.orders },
          { header: 'COD', width: '120px', className: 'acc-num', accessor: (s: CarrierSettlementRow) => money(s.grossCod) },
          { header: 'Charges', width: '110px', className: 'acc-num', accessor: (s: CarrierSettlementRow) => money(s.carrierCharges) },
          { header: 'Net to receive', width: '130px', className: 'acc-num', accessor: (s: CarrierSettlementRow) => money(s.netReceivable) },
          { header: 'Received / left', width: '170px', accessor: (s: CarrierSettlementRow) => `${money(s.paidAmount)} / ${money(s.remainingAmount)}` },
          {
            header: 'Status',
            width: '130px',
            accessor: (s: CarrierSettlementRow) => (
              <StatusChip variant="solid" tone={settlementStatusTone(s.status)}>{settlementStatusLabel(s.status)}</StatusChip>
            ),
          },
        ]}
        minWidth="1050px"
      />

      {!loading && current && current.notOnStatement > 0 && (
        <Button variant="secondary" onClick={() => navigate(`/finance/carrier-cod/new?carrier=${carrier}`)}>
          Put {money(current.notOnStatement)} of delivered COD on a statement
        </Button>
      )}
    </div>
  );
};

export default CarrierCodPage;
