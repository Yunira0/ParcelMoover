import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Users, ListChecks, Download } from 'lucide-react';
import Button from '../components/Button';
import FormField from '../components/FormField';
import StatusChip from '../components/StatusChip';
import { getUnsettledOrders, createSettlement, type UnsettledOrderItem } from '../services/finance.service';
import { getRiders, searchVendors } from '../services/users.service';
import { downloadExcel, type CellValue } from '../utils/excel';
import './SettlementCreatePage.css';

type PayeeType = 'rider' | 'vendor';

const SectionHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
}> = ({ icon, title, description }) => (
  <div className="scp-section-header">
    <div className="scp-section-icon">{icon}</div>
    <div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  </div>
);

/**
 * The declared COD and the cash that actually arrived, as a labelled pair.
 * They match on most rows, so the two figures used to read as one repeated
 * number; the rows that matter are the partial deliveries where collected
 * falls short - netPayable is computed from collected, not from COD - so the
 * shortfall is called out rather than left for the operator to spot.
 */
const CodCell: React.FC<{ codAmount: number; collectedAmount: number }> = ({
  codAmount,
  collectedAmount,
}) => {
  const shortfall = codAmount - collectedAmount;
  const isShort = shortfall > 0;
  return (
    <div className="scp-cod">
      <span className="scp-cod-label">COD</span>
      <span className="scp-cod-value">Rs. {codAmount.toLocaleString()}</span>
      <span className={`scp-cod-label${isShort ? ' scp-cod-short' : ''}`}>Collected</span>
      <span
        className={`scp-cod-value${isShort ? ' scp-cod-short' : ''}`}
        title={isShort ? `Rs. ${shortfall.toLocaleString()} short of the declared COD` : undefined}
      >
        Rs. {collectedAmount.toLocaleString()}
      </span>
    </div>
  );
};

const SettlementCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const payeeType: PayeeType = searchParams.get('type') === 'vendor' ? 'vendor' : 'rider';

  const [entityOptions, setEntityOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [orders, setOrders] = useState<UnsettledOrderItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchingOrders, setFetchingOrders] = useState(false);
  const [settlementDate, setSettlementDate] = useState(new Date().toISOString().split('T')[0]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (payeeType !== 'rider') return;
    const fetchRiders = async () => {
      setFetching(true);
      try {
        const res = await getRiders({ pageSize: 100 });
        if (res?.success && Array.isArray(res.data)) {
          setEntityOptions(res.data.map((r: any) => ({
            value: r.id,
            label: r.name || r.client_name || '',
          })));
        }
      } catch {
        setEntityOptions([]);
      } finally {
        setFetching(false);
      }
    };
    fetchRiders();
  }, [payeeType]);

  // Vendor picker is server-side searched instead (see handleVendorSearch) -
  // riders are fetched at pageSize: 100 (the backend's hard cap), but
  // vendors easily run into the hundreds and a single unpaginated fetch would
  // silently cut the list off.
  const handleVendorSearch = async (search: string, offset: number) => {
    const res = await searchVendors(search, 50, offset);
    if (res?.success && Array.isArray(res.data)) {
      return {
        results: res.data.map((v: any) => ({ id: v.id, label: v.label })),
        hasMore: res.hasMore ?? false,
      };
    }
    return { results: [], hasMore: false };
  };

  useEffect(() => {
    if (!selectedEntityId) {
      setOrders([]);
      setSelected(new Set());
      return;
    }

    const fetchOrders = async () => {
      setFetchingOrders(true);
      try {
        const res = await getUnsettledOrders(payeeType, selectedEntityId);
        if (res?.success && res.data?.items) {
          setOrders(res.data.items);
        } else {
          setOrders([]);
        }
      } catch {
        setOrders([]);
      } finally {
        setFetchingOrders(false);
      }
    };
    fetchOrders();
  }, [selectedEntityId, payeeType]);

  const toggleOrder = (codCollectionId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(codCollectionId)) next.delete(codCollectionId);
      else next.add(codCollectionId);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === orders.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(orders.map((o) => o.codCollectionId)));
    }
  };

  const selectedOrders = useMemo(
    () => orders.filter((o) => selected.has(o.codCollectionId)),
    [orders, selected],
  );
  const totalAmount = selectedOrders.reduce((sum, o) => sum + o.netPayable, 0);

  // Exports what the operator is looking at: the ticked rows once they've
  // started choosing, otherwise the whole unsettled list. The button label says
  // which, so the file never surprises them.
  const downloadOrdersExcel = () => {
    const rowsToExport = selected.size > 0 ? selectedOrders : orders;
    if (rowsToExport.length === 0) return;

    const isVendor = payeeType === 'vendor';
    const headers = [
      'SN',
      'Order ID',
      'Tracking ID',
      'Receiver',
      'Receiver Phone',
      'Order Type',
      isVendor ? 'Destination' : 'Location',
      'COD',
      ...(isVendor ? ['Delivery Charge', 'Net Payable'] : []),
    ];
    const rows: CellValue[][] = rowsToExport.map((order, index) => [
      index + 1,
      `#${order.orderNumber}`,
      order.trackingId,
      order.receiverName,
      order.receiverPhone,
      order.orderType,
      isVendor ? order.destination : order.location || '-',
      order.codAmount,
      ...(isVendor ? [order.deliveryCharge, order.netPayable] : []),
    ]);

    // Totals under the numeric columns; pad out the leading text columns.
    const numericColumns = isVendor ? 3 : 1;
    const sum = (pick: (o: UnsettledOrderItem) => number) =>
      rowsToExport.reduce((total, order) => total + pick(order), 0);
    rows.push([
      ...new Array(headers.length - numericColumns).fill(''),
      sum((o) => o.codAmount),
      ...(isVendor ? [sum((o) => o.deliveryCharge), sum((o) => o.netPayable)] : []),
    ]);

    downloadExcel(
      `unsettled-orders-${payeeType}-${settlementDate}.xlsx`,
      'Unsettled Orders',
      headers,
      rows,
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!selectedEntityId) {
      setError(`Please select a ${payeeType}.`);
      return;
    }

    if (selected.size === 0) {
      setError('Please select at least one order.');
      return;
    }

    setLoading(true);
    try {
      const res = await createSettlement({
        payeeType,
        targetId: selectedEntityId,
        codCollectionIds: Array.from(selected),
        settlementDate,
      });
      // Go straight to the new statement's own bill page instead of back to
      // the list table - that's the page the user actually wants to see.
      navigate(`/finance/settlements/${res.data.id}`);
    } catch (err: any) {
      const data = err.response?.data;
      setError(data?.message || 'Failed to create settlement');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="scp-page">
      <button type="button" className="scp-back" onClick={() => navigate('/finance')}>
        <ArrowLeft size={15} />
        COD Management
      </button>

      <div className="scp-header">
        <h1>Add Settlement</h1>
        <p>Select a {payeeType} and choose the unsettled orders to include in this settlement.</p>
      </div>

      <form className="scp-form" onSubmit={handleSubmit} noValidate>
        <section className="scp-section">
          <SectionHeader
            icon={<Users size={18} />}
            title={payeeType === 'rider' ? 'Rider' : 'Vendor'}
            description={`Choose the ${payeeType} to settle and the settlement date.`}
          />
          <div className="scp-row">
            <div className="scp-field">
              {payeeType === 'rider' ? (
                <FormField
                  label="Rider"
                  type="select"
                  required
                  value={selectedEntityId}
                  onChange={(value) => {
                    setSelectedEntityId(value);
                    setSelected(new Set());
                  }}
                  placeholder={fetching ? 'Loading...' : 'Select rider'}
                  options={entityOptions}
                  disabled={fetching}
                />
              ) : (
                <FormField
                  label="Vendor"
                  type="searchable-select-async"
                  required
                  value={selectedEntityId}
                  onChange={(value) => {
                    setSelectedEntityId(value);
                    setSelected(new Set());
                  }}
                  placeholder="Select vendor"
                  searchPlaceholder="Search vendor by name..."
                  emptyMessage="No vendors found."
                  asyncSearch={handleVendorSearch}
                />
              )}
            </div>
            <div className="scp-field">
              <FormField
                label="Settlement Date"
                type="date"
                value={settlementDate}
                onChange={setSettlementDate}
              />
            </div>
          </div>
        </section>

        {selectedEntityId && (
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
                disabled={orders.length === 0}
              >
                <Download size={15} />
                {selected.size > 0 ? `Download Excel (${selected.size} selected)` : 'Download Excel'}
              </Button>
            </div>

            {fetchingOrders ? (
              <div className="scp-empty">Loading orders...</div>
            ) : orders.length === 0 ? (
              <div className="scp-empty">No unsettled orders found for this {payeeType}.</div>
            ) : (
              <div className="scp-table-wrap">
                <table className="scp-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }}>
                        <input
                          type="checkbox"
                          checked={selected.size === orders.length && orders.length > 0}
                          onChange={toggleAll}
                        />
                      </th>
                      <th style={{ textAlign: 'left' }}>Order ID</th>
                      <th style={{ textAlign: 'left' }}>Tracking ID</th>
                      <th style={{ textAlign: 'left' }}>Receiver</th>
                      <th style={{ textAlign: 'left' }}>Number</th>
                      <th style={{ textAlign: 'left' }}>Order Type</th>
                      {payeeType === 'vendor' && <th style={{ textAlign: 'left' }}>Destination</th>}
                      {payeeType === 'rider' && <th style={{ textAlign: 'left' }}>Location</th>}
                      {/* Rider rows have no delivery-charge deduction, so COD and
                          collected are always the same figure - one column, not two.
                          The cell holds a label/value block rather than a bare number,
                          so the block is centred and the header centres over it - right
                          alignment shoved both against the Delivery Charge column. */}
                      <th className="scp-cod-head">COD</th>
                      {payeeType === 'vendor' && (
                        <>
                          <th style={{ textAlign: 'right' }}>Delivery Charge</th>
                          <th style={{ textAlign: 'right' }}>Net Payable</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr
                        key={order.codCollectionId}
                        className={selected.has(order.codCollectionId) ? 'scp-row-selected' : ''}
                        onClick={() => toggleOrder(order.codCollectionId)}
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.has(order.codCollectionId)}
                            onChange={() => toggleOrder(order.codCollectionId)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="scp-mono">#{order.orderNumber}</td>
                        <td className="scp-mono">{order.trackingId}</td>
                        <td>
                          {order.receiverName}
                          {order.receiverAddress && (
                            <div className="scp-subtext">{order.receiverAddress}</div>
                          )}
                        </td>
                        <td className="scp-mono">{order.receiverPhone}</td>
                        <td>
                          {order.isReturnToVendor ? (
                            <StatusChip tone="info">RTV</StatusChip>
                          ) : (
                            <span style={{ textTransform: 'capitalize' }}>{order.orderType}</span>
                          )}
                        </td>
                        {payeeType === 'vendor' && <td>{order.destination || '-'}</td>}
                        {payeeType === 'rider' && <td>{order.location || '-'}</td>}
                        <td className="scp-cod-head">
                          <CodCell codAmount={order.codAmount} collectedAmount={order.collectedAmount} />
                        </td>
                        {payeeType === 'vendor' && (
                          <>
                            <td className="scp-num" style={{ textAlign: 'right' }}>
                              Rs. {order.deliveryCharge.toLocaleString()}
                            </td>
                            <td className="scp-num scp-num-strong" style={{ textAlign: 'right' }}>
                              Rs. {order.netPayable.toLocaleString()}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {selected.size > 0 && (
              <div className="scp-summary">
                <span>{selected.size} order{selected.size > 1 ? 's' : ''} selected</span>
                <span className="scp-summary-total">Total: Rs. {totalAmount.toLocaleString()}</span>
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
          <Button type="button" variant="secondary" onClick={() => navigate('/finance')} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={loading || fetching || !selectedEntityId}>
            {loading ? 'Adding...' : 'Add Settlement'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default SettlementCreatePage;
