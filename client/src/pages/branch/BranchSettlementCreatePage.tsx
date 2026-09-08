import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Download, ListChecks } from 'lucide-react';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import Table from '../../components/Table';
import { useBranchScope } from '../../context/BranchScopeContext';
import type { Order } from '../../services/orders.service';
import { createBranchSettlement, getBranchOrders } from '../../services/branchTracking.service';
import { apiErrorMessage } from '../../utils/serverValidation';
import { downloadExcel, type CellValue } from '../../utils/excel';
import { getCurrentUserLocationId, isBranchWorkspaceUser } from '../../utils/auth';
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
  const isBranchWorkspace = isBranchWorkspaceUser();
  const ownLocationId = getCurrentUserLocationId();
  const masterBranch = branches.find((branch) => branch.code?.trim().toUpperCase() === 'IMADOL');
  const masterBranchId = masterBranch?.id ?? '';

  // A branch workspace only ever settles its own COD, at its Imadol-set
  // commission rate. Both are locked here and re-enforced on the server.
  const [fromBranch, setFromBranch] = useState(isBranchWorkspace && ownLocationId ? ownLocationId : '');
  const toBranch = masterBranchId;
  const [settlementDate, setSettlementDate] = useState(new Date().toISOString().split('T')[0]);
  const [commissionPerParcel, setCommissionPerParcel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [loadingOrders, setLoadingOrders] = useState(false);

  const branchOptions = branches.map((b) => ({ value: b.id, label: b.name }));
  const payingBranchOptions = branchOptions.filter((branch) => branch.value !== toBranch);
  const loadOrders = useCallback(
    async (signal: AbortSignal) => {
      if (!fromBranch) {
        setOrders([]);
        return;
      }
      setLoadingOrders(true);
      try {
        const res = await getBranchOrders({
          // COD is held where delivery happened. The master branch receives
          // the payment and is not a parcel-route filter.
          toBranchId: fromBranch,
          metric: 'pendingDeposit',
          availableForSettlement: true,
          pageSize: 100,
        }, signal);
        const list = Array.isArray(res.data) ? res.data : [];
        setOrders(list);
        setSelectedIds(new Set(list.map((o) => o.id)));
      } catch {
        setError('Failed to load unsettled orders collected by this branch.');
      } finally {
        setLoadingOrders(false);
      }
    },
    [fromBranch],
  );

  useEffect(() => {
    const c = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- request lifecycle owns loading
    loadOrders(c.signal);
    return () => c.abort();
  }, [loadOrders]);

  // Branch workspace: fill the commission field from the branch's own agreed
  // rate once the directory loads. The field is read-only for them.
  useEffect(() => {
    if (!isBranchWorkspace || commissionPerParcel) return;
    const own = branches.find((b) => b.id === fromBranch);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from the directory
    if (own) setCommissionPerParcel(String(own.commissionPerParcel));
  }, [isBranchWorkspace, branches, fromBranch, commissionPerParcel]);

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
    if (!masterBranchId) {
      setError('The Imadol master branch is unavailable. Check that the Imadol hub is active.');
      return;
    }
    if (!fromBranch) {
      setError('Select the branch that must pay Imadol.');
      return;
    }
    if (fromBranch === toBranch) {
      setError('Imadol cannot pay itself. Select another paying branch.');
      return;
    }
    if (selectedOrders.length === 0) {
      setError('Select at least one order to settle.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await createBranchSettlement({
        fromBranchId: fromBranch,
        toBranchId: toBranch,
        settlementDate,
        orderIds: selectedOrders.map((order) => String(order.id)),
        commissionPerParcel: commission,
      });
      navigate(`/branches/settlement/${response.data.id}`, { state: { created: true } });
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
        Branch COD
      </button>

      <div className="scp-header">
        <h1>Add Branch Statement</h1>
        <p>{isBranchWorkspace
          ? 'Select the delivered orders whose COD you are remitting to Imadol, then create the pending statement.'
          : 'Create a pending COD statement for a branch to pay Imadol.'}</p>
      </div>

      <form className="scp-form" onSubmit={handleSubmit} noValidate>
        <section className="scp-section">
          <SectionHeader
            icon={<Building2 size={18} />}
            title="Payment direction"
            description="The collecting branch pays its COD to Imadol, less its commission."
          />
          <div className="scp-row">
            <div className="scp-field">
              <FormField
                label="Paying branch"
                type="select"
                required
                value={fromBranch}
                onChange={(id) => {
                  setFromBranch(id);
                  const branch = branches.find((item) => item.id === id);
                  setCommissionPerParcel(branch ? String(branch.commissionPerParcel) : '');
                }}
                placeholder="Select branch"
                options={payingBranchOptions}
                disabled={isBranchWorkspace}
              />
            </div>
            <div className="scp-field">
              <FormField
                label="Master branch (receiving)"
                type="select"
                required
                value={toBranch}
                onChange={() => {}}
                placeholder="Imadol"
                options={branchOptions}
                disabled
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
                disabled={isBranchWorkspace}
                hint={isBranchWorkspace
                  ? "Your branch's agreed rate, set by Imadol."
                  : "Rs. per parcel, deducted from each order's COD."}
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
              emptyMessage="No unsettled COD orders were delivered by this branch."
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
            {saving ? 'Creating…' : 'Create Pending Statement'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default BranchSettlementCreatePage;
