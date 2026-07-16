import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Users, ListChecks } from 'lucide-react';
import Button from '../components/Button';
import FormField from '../components/FormField';
import { getUnsettledOrders, createSettlement, type UnsettledOrderItem } from '../services/finance.service';
import { getRiders, getVendors } from '../services/users.service';
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
    const fetchEntities = async () => {
      setFetching(true);
      try {
        if (payeeType === 'rider') {
          const res = await getRiders();
          if (res?.success && Array.isArray(res.data)) {
            setEntityOptions(res.data.map((r: any) => ({
              value: r.id,
              label: r.name || r.client_name || '',
            })));
          }
        } else {
          const res = await getVendors();
          if (res?.success && Array.isArray(res.data)) {
            setEntityOptions(res.data.map((v: any) => ({
              value: v.id,
              label: v.company || v.client || '',
            })));
          }
        }
      } catch {
        setEntityOptions([]);
      } finally {
        setFetching(false);
      }
    };
    fetchEntities();
  }, [payeeType]);

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
      await createSettlement({
        payeeType,
        targetId: selectedEntityId,
        codCollectionIds: Array.from(selected),
        settlementDate,
      });
      navigate('/finance');
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
              <FormField
                label={payeeType === 'rider' ? 'Rider' : 'Vendor'}
                type="select"
                required
                value={selectedEntityId}
                onChange={(value) => {
                  setSelectedEntityId(value);
                  setSelected(new Set());
                }}
                placeholder={fetching ? 'Loading...' : `Select ${payeeType}`}
                options={entityOptions}
                disabled={fetching}
              />
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
            <SectionHeader
              icon={<ListChecks size={18} />}
              title={`Unsettled Orders (${orders.length})`}
              description="Select the orders to include in this settlement."
            />

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
                      <th style={{ textAlign: 'left' }}>Tracking ID</th>
                      <th style={{ textAlign: 'left' }}>Receiver</th>
                      <th style={{ textAlign: 'right' }}>COD</th>
                      {payeeType === 'vendor' && (
                        <th style={{ textAlign: 'right' }}>Delivery Charge</th>
                      )}
                      <th style={{ textAlign: 'right' }}>
                        {payeeType === 'vendor' ? 'Net Payable' : 'Collected'}
                      </th>
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
                        <td className="scp-mono">{order.trackingId}</td>
                        <td>{order.receiverName}</td>
                        <td style={{ textAlign: 'right' }}>Rs. {order.codAmount.toLocaleString()}</td>
                        {payeeType === 'vendor' && (
                          <td style={{ textAlign: 'right' }}>Rs. {order.deliveryCharge.toLocaleString()}</td>
                        )}
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          Rs. {order.netPayable.toLocaleString()}
                        </td>
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
