import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Download, ListChecks } from 'lucide-react';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import Table from '../../components/Table';
import { Banner } from '../accounting/ui';
import { useBranchScope } from '../../context/BranchScopeContext';
import type { Order } from '../../services/orders.service';
import { createBranchSettlement, getBranchOrders } from '../../services/branchTracking.service';
import { apiErrorMessage } from '../../utils/serverValidation';
import { downloadExcel, type CellValue } from '../../utils/excel';
import { getCurrentUserLocationId } from '../../utils/auth';
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

const money = (n: number) => `Rs. ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/** Cash collected, as a labelled block — mirrors the rider/vendor form's CodCell. */
const CodCell: React.FC<{ codAmount: number }> = ({ codAmount }) => (
  <div className="scp-cod">
    <span className="scp-cod-label">COLLECTED</span>
    <span className="scp-cod-value">{money(codAmount)}</span>
  </div>
);

const BranchSettlementCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const { branches } = useBranchScope();

  const [fromBranch, setFromBranch] = useState('');
  const [toBranch, setToBranch] = useState('');
  const [settlementDate, setSettlementDate] = useState(new Date().toISOString().split('T')[0]);
  const [commissionPerParcel, setCommissionPerParcel] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Default the paying branch to the admin's own hub - they're almost always
  // settling out of wherever they work. Only while the field is still blank,
  // so it never overwrites a manual pick, and it also seeds that branch's own
  // commission default the same way picking it by hand would.
  useEffect(() => {
    if (fromBranch || branches.length === 0) return;
    const own = branches.find((b) => b.id === getCurrentUserLocationId());
    if (own) {
      setFromBranch(own.id);
      setCommissionPerParcel(String(own.commissionPerParcel));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branches]);

  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [loadingOrders, setLoadingOrders] = useState(false);

  const branchOptions = branches.map((b) => ({ value: b.id, label: b.name }));
  const loadOrders = useCallback(
    async (signal: AbortSignal) => {
      if (!fromBranch && !toBranch) {
        setOrders([]);
        return;
      }
      setLoadingOrders(true);
      try {
        const res = await getBranchOrders({
          ...(fromBranch ? { fromBranchId: fromBranch } : {}),
          ...(toBranch ? { toBranchId: toBranch } : {}),
          metric: 'pendingDeposit',
          pageSize: 100,
        }, signal);
        const list = Array.isArray(res.data) ? res.data : [];
        setOrders(list);
        setSelectedIds(new Set(list.map((o) => o.id)));
      } catch {
        setError('Failed to load unsettled orders for this branch pair.');
      } finally {
        setLoadingOrders(false);
      }
    },
    [fromBranch, toBranch],
  );

  useEffect(() => {
    const c = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- request lifecycle owns loading
    loadOrders(c.signal);
    return () => c.abort();
  }, [loadOrders]);

  const commission = Number(commissionPerParcel || 0);
  const selectedOrders = orders.filter((o) => selectedIds.has(o.id));
  const codTotal = selectedOrders.reduce((sum, o) => sum + (o.collectedAmount || 0), 0);
  const commissionTotal = selectedOrders.reduce((sum, o) => sum + Math.min(commission, o.collectedAmount), 0);
  const netPayable = codTotal - commissionTotal;

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

  const handleSubmit = async (e: React.FormEvent) => {
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
    setSaving(true);
    setError('');
    try {
      await createBranchSettlement({
        fromBranchId: fromBranch,
        toBranchId: toBranch,
        settlementDate,
        orderIds: selectedOrders.map((order) => String(order.id)),
        commissionPerParcel: commission,
      });
      setSaved(true);
      setOrders([]);
      setSelectedIds(new Set());
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to create branch settlement'));
    } finally {
      setSaving(false);
    }
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
      o.collectedAmount,
      commission,
      Math.max(0, o.collectedAmount - commission),
    ]);
    rows.push([
      '', '', '', '', '', '',
      exportRows.reduce((s, o) => s + o.collectedAmount, 0),
      exportRows.reduce((s, o) => s + Math.min(commission, o.collectedAmount), 0),
      exportRows.reduce((s, o) => s + Math.max(0, o.collectedAmount - commission), 0),
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
    { header: 'COLLECTED', accessor: (o: Order) => <CodCell codAmount={o.collectedAmount} />, width: '110px' },
    {
      header: 'Commission',
      accessor: () => <span className="scp-num">{money(commission)}</span>,
      width: '110px',
    },
    {
      header: 'Net Payable',
      accessor: (o: Order) => (
        <span className="scp-num scp-num-strong">{money(Math.max(0, o.collectedAmount - commission))}</span>
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
          Settlement saved successfully. It now appears in Branch Settlement and Deposited totals.
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
                onChange={(id) => {
                  setFromBranch(id);
                  setSaved(false);
                  const branch = branches.find((item) => item.id === id);
                  setCommissionPerParcel(branch ? String(branch.commissionPerParcel) : '');
                }}
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
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Add Settlement'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default BranchSettlementCreatePage;
