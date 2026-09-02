import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Download, ListChecks } from 'lucide-react';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import Table from '../../components/Table';
import { Banner } from '../accounting/ui';
import { useBranchScope } from '../../context/BranchScopeContext';
import { getOrders, type Order } from '../../services/orders.service';
import { downloadExcel, type CellValue } from '../../utils/excel';
import '../SettlementCreatePage.css';

const SectionHeader: React.FC<{ icon: React.ReactNode; title: string; description: string }> = ({
  icon,
  title,
  description,
}) => (
  <div className="scp-section-header">
    <div className="scp-section-icon">{icon}</div>
    <div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  </div>
);

const hubName = (loc: string) => loc.split(' - ')[0];
const money = (n: number) => `Rs. ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/** The declared COD, as a labelled block — mirrors the rider/vendor form's CodCell. */
const CodCell: React.FC<{ codAmount: number }> = ({ codAmount }) => (
  <div className="scp-cod">
    <span className="scp-cod-label">COD</span>
    <span className="scp-cod-value">{money(codAmount)}</span>
  </div>
);

// Branch settlement form — same shape as the Rider/Vendor settlement form: pick
// the branches, pick the unsettled orders, net payable = COD less a flat
// per-parcel commission. Not wired to a backend yet.
const BranchSettlementCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const { branches } = useBranchScope();

  const [fromBranch, setFromBranch] = useState('');
  const [toBranch, setToBranch] = useState('');
  const [settlementDate, setSettlementDate] = useState(new Date().toISOString().split('T')[0]);
  const [commissionPerParcel, setCommissionPerParcel] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [loadingOrders, setLoadingOrders] = useState(false);

  const branchOptions = branches.map((b) => ({ value: b.id, label: b.name }));
  const nameOf = (id: string) => branches.find((b) => b.id === id)?.name ?? null;
  const fromName = nameOf(fromBranch);
  const toName = nameOf(toBranch);

  // Unsettled orders for the branch pair — `settlement: 'pending'` is the same
  // filter the dashboard's Pending Deposit figure uses (delivered, not yet in a
  // settlement). Hub scoping is client-side, same as Branch Overview.
  const loadOrders = useCallback(
    async (signal: AbortSignal) => {
      if (!fromBranch && !toBranch) {
        setOrders([]);
        return;
      }
      setLoadingOrders(true);
      try {
        const res = await getOrders({ pageSize: 200, settlement: 'pending' }, signal);
        const list = res?.success && Array.isArray(res.data) ? res.data : [];
        const scoped = list.filter(
          (o) =>
            (!fromName || (o.origin && hubName(o.origin) === fromName)) &&
            (!toName || (o.destination && hubName(o.destination) === toName)),
        );
        setOrders(scoped);
        setSelectedIds(new Set(scoped.map((o) => o.id))); // default: settle the whole batch
      } catch {
        setError('Failed to load unsettled orders for this branch pair.');
      } finally {
        setLoadingOrders(false);
      }
    },
    [fromBranch, toBranch, fromName, toName],
  );

  useEffect(() => {
    const c = new AbortController();
    loadOrders(c.signal);
    return () => c.abort();
  }, [loadOrders]);

  const commission = Number(commissionPerParcel || 0);
  const selectedOrders = orders.filter((o) => selectedIds.has(o.id));
  const codTotal = selectedOrders.reduce((sum, o) => sum + (o.codAmount || 0), 0);
  const netPayable = codTotal - commission * selectedOrders.length;

  const rowIds = orders.map((o) => o.id);
  const allSelected = rowIds.length > 0 && rowIds.every((id) => selectedIds.has(id));
  const someSelected = rowIds.some((id) => selectedIds.has(id));
  const toggleRow = (id: string | number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      rowIds.forEach((id) => {
        if (allSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromBranch || !toBranch) {
      setError('Pick both a From and a To branch.');
      return;
    }
    if (fromBranch === toBranch) {
      setError('From and To branch must be different.');
      return;
    }
    if (selectedOrders.length === 0) {
      setError('Select at least one order to settle.');
      return;
    }
    // TODO(backend): POST the branch settlement once the endpoint exists.
    setError('');
    setSaved(true);
  };

  const exportRows = selectedOrders.length > 0 ? selectedOrders : orders;
  const downloadOrdersExcel = () => {
    if (exportRows.length === 0) return;
    const headers = ['SN', 'Order ID', 'Tracking ID', 'Receiver', 'Receiver Phone', 'Destination', 'COD', 'Commission', 'Net Payable'];
    const rows: CellValue[][] = exportRows.map((o, i) => [
      i + 1,
      `#${o.orderNumber}`,
      o.trackingId,
      o.receiverName,
      o.receiverPhone,
      o.destination || '-',
      o.codAmount,
      commission,
      o.codAmount - commission,
    ]);
    rows.push([
      '', '', '', '', '', '',
      exportRows.reduce((s, o) => s + o.codAmount, 0),
      commission * exportRows.length,
      exportRows.reduce((s, o) => s + o.codAmount - commission, 0),
    ]);
    downloadExcel(`branch-settlement-orders-${settlementDate}.xlsx`, 'Unsettled Orders', headers, rows);
  };

  const orderColumns = [
    { header: 'ORDER ID', accessor: (o: Order) => `#${o.orderNumber}`, width: '80px' },
    { header: 'TRACKING ID', accessor: (o: Order) => o.trackingId, width: '150px' },
    {
      header: 'RECEIVER',
      accessor: (o: Order) => (
        <div className="party-cell">
          <span>{o.receiverName}</span>
          <small>{o.receiverAddress || '-'}</small>
        </div>
      ),
      width: '190px',
    },
    { header: 'NUMBER', accessor: (o: Order) => o.receiverPhone, width: '120px' },
    { header: 'DESTINATION', accessor: (o: Order) => o.destination || '-', width: '130px' },
    { header: 'COD', accessor: (o: Order) => <CodCell codAmount={o.codAmount} />, width: '110px' },
    {
      header: 'Commission',
      accessor: () => <span className="scp-num">{money(commission)}</span>,
      width: '110px',
    },
    {
      header: 'Net Payable',
      accessor: (o: Order) => (
        <span className="scp-num scp-num-strong">{money(o.codAmount - commission)}</span>
      ),
      width: '120px',
    },
  ];

  return (
    <div className="scp-page">
      <button type="button" className="scp-back" onClick={() => navigate('/branches/settlement')}>
        <ArrowLeft size={15} />
        Branch Settlement
      </button>

      <div className="scp-header">
        <h1>Add Branch Settlement</h1>
        <p>Settle the COD one branch collected for another, less that branch’s commission.</p>
      </div>

      {saved && (
        <Banner tone="success">
          Settlement captured on screen only — the branch settlement API isn’t wired yet, so
          nothing was saved.
        </Banner>
      )}

      <form className="scp-form" onSubmit={handleSubmit} noValidate>
        <section className="scp-section">
          <SectionHeader
            icon={<Building2 size={18} />}
            title="Branches"
            description="From = the branch paying (it holds the COD). To = the branch being paid."
          />
          <div className="scp-row">
            <div className="scp-field">
              <FormField
                label="From Branch (paying)"
                type="select"
                required
                value={fromBranch}
                onChange={setFromBranch}
                placeholder="Select branch"
                options={branchOptions}
              />
            </div>
            <div className="scp-field">
              <FormField
                label="To Branch (receiving)"
                type="select"
                required
                value={toBranch}
                onChange={setToBranch}
                placeholder="Select branch"
                options={branchOptions}
              />
            </div>
            <div className="scp-field">
              <FormField label="Settlement Date" type="date" value={settlementDate} onChange={setSettlementDate} />
            </div>
          </div>
          <div className="scp-row">
            <div className="scp-field">
              <FormField
                label="Commission per Parcel"
                type="decimal"
                value={commissionPerParcel}
                onChange={setCommissionPerParcel}
                placeholder="e.g. 50"
                hint="Rs. per parcel, deducted from each order's COD."
              />
            </div>
          </div>
        </section>

        {(fromBranch || toBranch) && (
          <section className="scp-section">
            <div className="scp-section-bar">
              <SectionHeader
                icon={<ListChecks size={18} />}
                title={`Unsettled Orders (${orders.length})`}
                description="Select the orders to include in this settlement."
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={downloadOrdersExcel}
                disabled={exportRows.length === 0}
              >
                <Download size={15} />
                {selectedOrders.length > 0 ? `Download Excel (${selectedOrders.length})` : 'Download Excel'}
              </Button>
            </div>
            <Table
              columns={orderColumns}
              data={orders}
              selectedIds={selectedIds}
              onToggleRow={toggleRow}
              allSelected={allSelected}
              someSelected={someSelected}
              onToggleAll={toggleAll}
              loading={loadingOrders}
              loadingMessage="Loading orders…"
              emptyMessage="No unsettled orders for this branch pair."
              minWidth="1100px"
            />
            {selectedOrders.length > 0 && (
              <div className="scp-summary">
                <span>{selectedOrders.length} order{selectedOrders.length > 1 ? 's' : ''} selected</span>
                <span className="scp-summary-total">Net Payable: {money(netPayable)}</span>
              </div>
            )}
          </section>
        )}

        {error && (
          <div className="scp-error" role="alert">
            {error}
          </div>
        )}

        <div className="scp-actions">
          <Button type="button" variant="secondary" onClick={() => navigate('/branches/settlement')}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Add Settlement
          </Button>
        </div>
      </form>
    </div>
  );
};

export default BranchSettlementCreatePage;
